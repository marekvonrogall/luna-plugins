import type { LunaUnloads } from "@luna/core";
import { redux } from "@luna/lib";

import { checkIcon } from "../../../shared/playlistPicker";
import { marqueeLine, startMarquee } from "./marquee";

// "Playlist Tools" replaces TIDAL's "Add to playlist", which shows inside it: never moved (React would break), only positioned
// over a slot. Cloned from TIDAL's menu, so no hashed class names

export interface SubmenuBuilder {
	item: (label: string, onClick: () => void) => HTMLElement;
	/** Caption like TIDAL's "Recent" */
	heading: (text: string) => HTMLElement;
	clear: () => void;
	/** Call after changing the content */
	reposition: () => void;
}

export interface EntryHandle {
	/** Disabled submenus don't open */
	setDisabled: (disabled: boolean) => void;
	close: () => void;
}

export interface ToolOption {
	label: string;
	onClick?: () => void;
	/** Filled on first open */
	submenu?: (menu: SubmenuBuilder) => void;
	ref?: (handle: EntryHandle) => void;
}

export interface RecentPlaylist {
	uuid: string;
	title: string;
	/** Row in TIDAL's submenu */
	row: Element;
}

export interface PlaylistTools {
	entry: HTMLElement;
	/** TIDAL's "Add to playlist" */
	native: Element | null;
	/** TIDAL's recent playlists */
	recentPlaylists: () => RecentPlaylist[];
	onClose: (cleanup: () => void) => void;
}

const SUBMENU_ATTR = "data-collector-submenu";
const PANEL_ATTR = "data-collector-panel";
const OPEN_ATTR = "data-collector-open";
const FALLBACK_ATTR = "data-collector-fallback";
const TICK_ATTR = "data-collector-tick";
const TICKED_ATTR = "data-collector-ticked";
const ITEM = '[data-type="contextmenu-item"]';
const SUBMENU = '[data-type="contextmenu-item__submenu"]';
const PLAYLIST_ROW = "[data-track--playlist-uuid]";
const NATIVE_ATTR = "data-collector-native";
const SHOWN_ATTR = "data-collector-shown";
const SLOT_ATTR = "data-collector-slot";
/** Longer names scroll */
const MENU_WIDTH = 240;
const LABEL = `:is([${PANEL_ATTR}], [${NATIVE_ATTR}]) ${ITEM} > button > span:first-child`;

/** We show our submenus ourselves; nested TIDAL ones only while hovered */
export const MENU_CSS = `
[${SUBMENU_ATTR}] > ${SUBMENU} > button + div,
[${SUBMENU_ATTR}][${FALLBACK_ATTR}] > button + div { display: none !important; transition: none !important; }
[${SUBMENU_ATTR}][${OPEN_ATTR}] > ${SUBMENU} > button + div,
[${SUBMENU_ATTR}][${OPEN_ATTR}][${FALLBACK_ATTR}] > button + div { display: block !important; visibility: visible !important; opacity: 1 !important; pointer-events: auto !important; }
[${PANEL_ATTR}] { overflow: visible !important; max-height: none !important; height: auto !important; }
[${NATIVE_ATTR}]:not([${SHOWN_ATTR}]) { display: none !important; }
[${NATIVE_ATTR}][${SHOWN_ATTR}] { position: absolute !important; z-index: 10000; box-sizing: border-box; margin: 0 !important; }
[${NATIVE_ATTR}]:not(:hover) > ${SUBMENU} > button + div { display: none !important; }
[${SLOT_ATTR}] { visibility: hidden; pointer-events: none; }
[${FALLBACK_ATTR}] { position: relative; }
[${FALLBACK_ATTR}] > button + div { position: absolute; top: -8px; left: 100%; z-index: 10; min-width: 240px; padding: 8px 0; border-radius: 8px; background: #242429; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5); }
[${SUBMENU_ATTR}] [data-collector-arrow] { margin-left: auto; padding-left: 16px; opacity: 0.6; }
[${TICKED_ATTR}] > button { display: flex !important; align-items: center; }
[${TICKED_ATTR}] > button > span:first-child { flex: 1 1 auto; min-width: 0; }
[${TICK_ATTR}] { flex: none; width: 18px; height: 18px; margin-left: 12px; margin-right: 12px; fill: currentColor; }
[data-collector-disabled] { opacity: 0.4; pointer-events: none; cursor: default; }
[${PANEL_ATTR}],
[${NATIVE_ATTR}] > ${SUBMENU} > button + div > div { box-sizing: border-box; width: ${MENU_WIDTH}px !important; min-width: 0 !important; max-width: ${MENU_WIDTH}px !important; }
:is([${PANEL_ATTR}], [${NATIVE_ATTR}]) ${ITEM} > button { display: flex !important; align-items: center; min-width: 0; }
${LABEL} { flex: 1 1 auto; min-width: 0; ${marqueeLine} }
[${TICKED_ATTR}] .playlist-indicator-check { display: none !important; }
[data-collector-dim] { opacity: 0.5; }
`;

/** Undoes our changes to the menu */
let restore: (() => void) | undefined;

export const restoreMenu = () => {
	const undo = restore;
	restore = undefined;
	undo?.();
};

const stripAttributes = (root: Element) => {
	for (const node of [root, ...root.querySelectorAll("*")]) {
		for (const attr of [...node.attributes]) {
			if (attr.name === "data-test" || attr.name.startsWith("data-track") || attr.name === "disabled" || attr.name.startsWith("aria-") || attr.name === "data-disabled")
				node.removeAttribute(attr.name);
		}
		for (const cls of [...node.classList]) if (/disabled/i.test(cls)) node.classList.remove(cls);
	}
};

/** First plain top-level entry, cloned for ours */
const findTemplate = (contextMenu: Element, exclude?: Element | null) => {
	for (const item of contextMenu.querySelectorAll(`div${ITEM}`)) {
		if (exclude?.contains(item) || item.closest(SUBMENU) || item.closest(`[${SUBMENU_ATTR}]`)) continue;
		if (item.querySelector("button span")) return item;
	}
};

const plainItem = (template: Element, label: string) => {
	const item = template.cloneNode(true) as HTMLElement;
	stripAttributes(item);
	const span = item.querySelector("button span") as HTMLSpanElement;
	// Drop icons and sort arrows
	for (const sibling of [...(span.parentElement?.children ?? [])]) if (sibling !== span) sibling.remove();
	span.replaceChildren(label);
	return item;
};

const onActivate = (item: Element, onClick: () => void) =>
	item.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		onClick();
	});

const findAddToPlaylist = (contextMenu: Element) => contextMenu.querySelector('[data-test="add-to-playlist"]')?.closest(ITEM) ?? null;

/** TIDAL may still be rendering the menu */
const waitFor = async <T>(find: () => T | null | undefined, frames = 10): Promise<T | undefined> => {
	for (let i = 0; i < frames; i++) {
		const found = find();
		if (found) return found;
		await new Promise((r) => requestAnimationFrame(r));
	}
	return find() ?? undefined;
};

/** Next to the entry (left if no room), inside the window */
const placeBeside = (entry: Element, container: HTMLElement) => {
	container.style.setProperty("transform", "none", "important");
	container.style.setProperty("bottom", "auto", "important");
	const box = container.getBoundingClientRect();
	if (box.width === 0) return;
	const anchor = (entry.querySelector(SUBMENU) ?? entry).getBoundingClientRect();
	let left = anchor.right;
	if (left + box.width > window.innerWidth - 8) left = Math.max(8, anchor.left - box.width);
	let dy = 0;
	if (box.bottom > window.innerHeight - 8) dy = window.innerHeight - 8 - box.bottom;
	if (box.top + dy < 8) dy = 8 - box.top;
	container.style.setProperty("transform", `translate(${Math.round(left - box.left)}px, ${Math.round(dy)}px)`, "important");
};

interface Submenu {
	entry: HTMLElement;
	panel: HTMLElement;
	close: () => void;
	reposition: () => void;
	detach: () => void;
}

interface SubmenuOptions {
	onFirstOpen?: (panel: HTMLElement) => void;
	onOpen?: () => void;
	onClose?: () => void;
	/** Hovering it counts as hovering the entry */
	companion?: Element;
}

/** Entry with arrow and submenu, cloned from "Add to playlist" if there is one */
const makeSubmenu = (native: Element | null, template: Element, label: string, { onFirstOpen, onOpen, onClose, companion }: SubmenuOptions = {}): Submenu => {
	let entry: HTMLElement;
	let opener: HTMLElement;
	let container: HTMLElement;
	let panel: HTMLElement;
	const nativeOpener = native?.querySelector(`${SUBMENU} > button`);
	if (native && nativeOpener) {
		entry = native.cloneNode(true) as HTMLElement;
		stripAttributes(entry);
		const sub = entry.querySelector(SUBMENU)!;
		opener = sub.querySelector(":scope > button") as HTMLElement;
		const text = opener.querySelector("span");
		if (text) text.replaceChildren(label);
		let copied = opener.nextElementSibling as HTMLElement | null;
		if (copied === null) {
			// TIDAL renders its submenu only while open
			sub.setAttribute(FALLBACK_ATTR, "");
			copied = document.createElement("div");
			sub.appendChild(copied);
		}
		container = copied;
		// Keep TIDAL's box styling, not its content
		panel = (container.firstElementChild as HTMLElement | null) ?? container;
		container.replaceChildren(panel);
		panel.replaceChildren();
	} else {
		entry = plainItem(template, label);
		opener = entry.querySelector("button") as HTMLElement;
		const arrow = document.createElement("span");
		arrow.setAttribute("data-collector-arrow", "");
		arrow.textContent = "›";
		opener.appendChild(arrow);
		entry.setAttribute(FALLBACK_ATTR, "");
		container = document.createElement("div");
		panel = container;
		entry.appendChild(container);
	}
	entry.setAttribute(SUBMENU_ATTR, "");
	entry.setAttribute("aria-haspopup", "true");
	entry.setAttribute("aria-expanded", "false");
	panel.setAttribute(PANEL_ATTR, "");
	container.removeAttribute("style");

	let filled = onFirstOpen === undefined;
	const open = () => {
		if (entry.hasAttribute(OPEN_ATTR) || entry.hasAttribute("data-collector-disabled")) return;
		if (!filled) {
			filled = true;
			onFirstOpen!(panel);
		}
		entry.setAttribute(OPEN_ATTR, "");
		entry.setAttribute("aria-expanded", "true");
		placeBeside(entry, container);
		onOpen?.();
	};
	const close = () => {
		if (!entry.hasAttribute(OPEN_ATTR)) return;
		entry.removeAttribute(OPEN_ATTR);
		entry.setAttribute("aria-expanded", "false");
		onClose?.();
	};
	const inside = (node: EventTarget | null) => node instanceof Node && (entry.contains(node) || !!companion?.contains(node));
	// Closes instantly, like TIDAL's
	const onLeave = (e: MouseEvent) => {
		if (!inside(e.relatedTarget)) close();
	};
	entry.addEventListener("mouseenter", open);
	entry.addEventListener("mouseleave", onLeave);
	companion?.addEventListener("mouseleave", onLeave as EventListener);
	opener.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (entry.hasAttribute(OPEN_ATTR)) close();
		else open();
	});
	const reposition = () => {
		if (!entry.hasAttribute(OPEN_ATTR)) return;
		placeBeside(entry, container);
		onOpen?.();
	};
	const detach = () => companion?.removeEventListener("mouseleave", onLeave as EventListener);
	return { entry, panel, close, reposition, detach };
};

const disable = (entry: Element, close: () => void) => (disabled: boolean) => {
	if (disabled) {
		entry.setAttribute("data-collector-disabled", "");
		entry.setAttribute("aria-disabled", "true");
		close();
	} else {
		entry.removeAttribute("data-collector-disabled");
		entry.removeAttribute("aria-disabled");
	}
};

const dashIcon = () => {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttribute("d", "M6 11h12v2H6z");
	svg.appendChild(path);
	return svg;
};

/** Tick at the end of an entry if all songs are in it, dash if some, nothing if none */
export const setTick = (row: Element, state: "all" | "some" | "none", title?: string) => {
	const button = row.querySelector(":scope > button") ?? row;
	row.setAttribute(TICKED_ATTR, "");
	const tick = button.querySelector(`[${TICK_ATTR}]`);
	if (state === "none") {
		tick?.remove();
		return;
	}
	if (tick?.getAttribute(TICK_ATTR) !== state) {
		const icon = state === "all" ? checkIcon() : dashIcon();
		icon.setAttribute(TICK_ATTR, state);
		if (tick) tick.replaceWith(icon);
		else button.appendChild(icon);
	}
	if (title) row.setAttribute("title", title);
	else row.removeAttribute("title");
};

export const showPlaylistTools = async (unloads: LunaUnloads, contextMenu: Element, label: string, options: ToolOption[]): Promise<PlaylistTools | undefined> => {
	restoreMenu();
	contextMenu.querySelectorAll(`[${SUBMENU_ATTR}]`).forEach((old) => old.remove());

	const native = (await waitFor(() => findAddToPlaylist(contextMenu))) ?? null;
	if (!contextMenu.isConnected) return;
	const template = findTemplate(contextMenu, native);
	if (template === undefined) throw new Error("No menu entry to copy found");

	const cleanups: (() => void)[] = [];
	// TIDAL's entry is shown over this placeholder
	const slot = native ? plainItem(template, "Add to playlist") : undefined;
	slot?.setAttribute(SLOT_ATTR, "");
	const showNative = () => {
		if (!native || !slot) return;
		const node = native as HTMLElement;
		node.setAttribute(SHOWN_ATTR, "");
		const parent = node.offsetParent ?? document.body;
		const from = parent.getBoundingClientRect();
		const to = slot.getBoundingClientRect();
		const style = getComputedStyle(slot);
		const marginLeft = parseFloat(style.marginLeft) || 0;
		const marginRight = parseFloat(style.marginRight) || 0;
		node.style.setProperty("left", `${to.left - marginLeft - from.left + parent.scrollLeft - parent.clientLeft}px`, "important");
		node.style.setProperty("top", `${to.top - from.top + parent.scrollTop - parent.clientTop}px`, "important");
		node.style.setProperty("width", `${to.width + marginLeft + marginRight}px`, "important");
	};
	const hideNative = () => {
		if (!native) return;
		const node = native as HTMLElement;
		node.removeAttribute(SHOWN_ATTR);
		for (const prop of ["left", "top", "width"]) node.style.removeProperty(prop);
	};
	const tools = makeSubmenu(native, template, label, { onOpen: showNative, onClose: hideNative, companion: native ?? undefined });
	cleanups.push(tools.close, tools.detach);
	if (slot) tools.panel.appendChild(slot);

	const nativeHeading = native?.querySelector('[data-type="contextmenu-open"] > :not([data-type="contextmenu-item"])') ?? null;
	const builder = (panel: HTMLElement, reposition: () => void): SubmenuBuilder => ({
		clear: () => panel.replaceChildren(),
		reposition,
		item: (text, onClick) => {
			const item = plainItem(template, text);
			onActivate(item, onClick);
			panel.appendChild(item);
			return item;
		},
		heading: (text) => {
			let heading: Element;
			if (nativeHeading) {
				heading = nativeHeading.cloneNode(true) as Element;
				stripAttributes(heading);
				const deepest = heading.querySelector("span") ?? heading;
				deepest.textContent = text;
			} else heading = Object.assign(document.createElement("div"), { textContent: text });
			panel.appendChild(heading);
			return heading as HTMLElement;
		},
	});

	for (const option of options) {
		if (option.submenu) {
			const fill = option.submenu;
			const sub: Submenu = makeSubmenu(native, template, option.label, { onFirstOpen: (panel) => fill(builder(panel, () => sub.reposition())) });
			cleanups.push(sub.close);
			tools.panel.appendChild(sub.entry);
			option.ref?.({ setDisabled: disable(sub.entry, sub.close), close: sub.close });
		} else {
			const item = plainItem(template, option.label);
			if (option.onClick) onActivate(item, option.onClick);
			tools.panel.appendChild(item);
			option.ref?.({ setDisabled: disable(item, () => {}), close: () => {} });
		}
	}

	if (native) {
		native.before(tools.entry);
		native.setAttribute(NATIVE_ATTR, "");
	} else contextMenu.appendChild(tools.entry);
	restore = () => {
		for (const cleanup of cleanups) cleanup();
		hideNative();
		native?.removeAttribute(NATIVE_ATTR);
		tools.entry.remove();
	};
	unloads.add(restoreMenu);
	cleanups.push(startMarquee(native ? [tools.entry, native] : [tools.entry], LABEL));

	return {
		entry: tools.entry,
		native,
		recentPlaylists: () =>
			[...(native?.querySelectorAll(PLAYLIST_ROW) ?? [])].map((row) => ({
				uuid: row.getAttribute("data-track--playlist-uuid")!,
				// The tracking attribute has the plain name, the text may have other plugins' marks
				title: row.getAttribute("data-track--icon-clicked") ?? row.querySelector("button span")?.firstChild?.textContent ?? "",
				row,
			})),
		onClose: (cleanup) => cleanups.push(cleanup),
	};
};

/** Undo before TIDAL closes or reuses the menu */
export const setupMenuRestore = (unloads: LunaUnloads) => {
	for (const action of ["contextMenu/CLOSE", "contextMenu/OPEN", "contextMenu/OPEN_MEDIA_ITEM", "contextMenu/OPEN_MULTI_MEDIA_ITEM"] as const)
		redux.intercept(action, unloads, () => restoreMenu());
};
