import type { LunaUnloads } from "@luna/core";
import { ContentBase, StyleTag } from "@luna/lib";

export interface PickablePlaylist {
	uuid: string;
	title: string;
	numberOfTracks: number;
	squareImage?: string;
	image?: string;
}

// Sizes and colours match TIDAL's own "Add to playlist" dialog
const CSS = `
@keyframes luna-dialog-fade { from { opacity: 0; } }
@keyframes luna-dialog-in { from { opacity: 0; transform: scale(0.96); } }
.luna-dialog-overlay { position: fixed; inset: 0; z-index: 100000; display: flex; align-items: center; justify-content: center; padding: 0 16px; background: rgba(0, 0, 0, 0.8); animation: luna-dialog-fade 0.2s ease-out; }
.luna-dialog-modal { box-sizing: border-box; display: flex; flex-direction: column; width: 480px; max-width: 100%; min-height: 100px; max-height: calc(100vh - 120px); overflow: hidden; border-radius: 16px; background: #18181b; color: #fff; box-shadow: rgba(0, 0, 0, 0.3) 1px 12px 20px 0; font-size: 14px; font-weight: 500; line-height: 20px; animation: luna-dialog-in 0.2s ease-out; }
.luna-dialog-modal * { box-sizing: border-box; }
.luna-dialog-header { display: flex; flex: none; align-items: flex-start; justify-content: space-between; min-height: 48px; padding: 24px 24px 0; }
.luna-dialog-heading { flex: 1 1 0%; min-width: 0; }
.luna-dialog-title { color: #fff; font-size: 16px; font-weight: 500; line-height: 24px; }
.luna-dialog-subtitle { margin-top: 4px; color: rgba(255, 255, 255, 0.6); font-size: 14px; font-weight: 400; line-height: 20px; }
.luna-dialog-close { flex: none; width: 24px; height: 24px; margin: 0 0 0 1rem; padding: 0; border: none; border-radius: 1000px; background: transparent; color: #fff; cursor: pointer; }
.luna-dialog-close:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
.luna-dialog-close svg { display: block; width: 24px; height: 24px; fill: currentColor; }
.luna-dialog-body { display: flex; flex: 0 1 auto; flex-direction: column; min-height: 0; padding: 24px 24px 14px; overflow: hidden; color: rgba(255, 255, 255, 0.6); font-size: 16px; line-height: 24px; }
.luna-dialog-search { position: relative; display: flex; flex: none; align-items: center; margin-bottom: 16px; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 36px; background: transparent; color: rgba(255, 255, 255, 0.6); cursor: text; transition: background-color 0.2s ease-in-out, border-color 0.2s ease-in-out, color 0.2s ease-in-out; }
.luna-dialog-search:focus-within { background: #fff; color: #000; }
.luna-dialog-search svg { position: absolute; top: 50%; left: 10px; width: 24px; height: 24px; transform: translateY(-50%); fill: currentColor; pointer-events: none; }
.luna-dialog-search input { flex-grow: 1; min-width: 0; height: 40px; padding: 0 36px 0 44px; overflow: hidden; border: none; outline: none; background: none; color: inherit; font: inherit; font-size: 16px; font-weight: 400; white-space: nowrap; text-overflow: ellipsis; }
.luna-dialog-search input::placeholder { color: inherit; opacity: 1; transition: color 0.2s ease-in-out; }
.luna-dialog-search:focus-within input::placeholder { color: rgba(0, 0, 0, 0.6); }
.luna-dialog-tools { display: flex; flex: none; align-items: center; gap: 16px; margin: -4px 0 8px; padding: 0 6px; font-size: 13px; line-height: 20px; }
.luna-dialog-counter { margin-right: auto; }
.luna-dialog-link { padding: 0; border: none; background: none; color: rgba(255, 255, 255, 0.6); font: inherit; font-weight: 500; cursor: pointer; transition: color 0.15s; }
.luna-dialog-link:hover, .luna-dialog-link:focus-visible { color: #fff; outline: none; }
.luna-dialog-list { position: relative; flex: 0 1 auto; height: calc(100svh - 360px); min-height: 64px; max-height: 640px; overflow-y: auto; scrollbar-gutter: stable; }
.luna-dialog-row { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; width: 100%; height: 64px; padding: 1px 6px; border: none; border-radius: 8px; background: transparent; color: #787887; font: inherit; font-size: 14px; font-weight: 400; line-height: normal; text-align: left; white-space: nowrap; cursor: pointer; transition: background-color 0.15s, color 0.15s; }
.luna-dialog-row:hover { background: rgba(255, 255, 255, 0.1); color: rgba(255, 255, 255, 0.8); }
.luna-dialog-row:focus { outline: none; background: rgba(255, 255, 255, 0.1); color: #fff; }
.luna-dialog-row:focus-visible { outline: 1px solid #fff; outline-offset: -1px; }
.luna-dialog-cover { display: block; width: 42px; height: 42px; margin: 11px 16px 11px 11px; background: #242429; object-fit: cover; }
.luna-dialog-cover-round { border-radius: 50%; }
.luna-dialog-row-title { margin: 0 0 4px; overflow: hidden; color: #fff; font-weight: 500; text-overflow: ellipsis; }
.luna-dialog-row-detail { overflow: hidden; color: rgba(255, 255, 255, 0.6); font-size: 13px; text-overflow: ellipsis; }
.luna-dialog-trailing { display: flex; align-items: center; margin: 0 10px 0 12px; }
.luna-dialog-trailing svg { width: 24px; height: 24px; fill: #fff; }
.luna-dialog-toggle { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: 1.5px solid rgba(255, 255, 255, 0.4); border-radius: 50%; transition: background-color 0.15s, border-color 0.15s; }
.luna-dialog-toggle svg { width: 16px; height: 16px; fill: #000; opacity: 0; transition: opacity 0.15s; }
.luna-dialog-row:hover .luna-dialog-toggle { border-color: rgba(255, 255, 255, 0.8); }
.luna-dialog-row[aria-checked="true"] .luna-dialog-toggle { border-color: #fff; background: #fff; }
.luna-dialog-row[aria-checked="true"] .luna-dialog-toggle svg { opacity: 1; }
.luna-dialog-empty { padding: 20px 6px; font-size: 14px; line-height: 20px; text-align: center; white-space: normal; }
.luna-dialog-footer { display: flex; flex: none; justify-content: flex-end; gap: 8px; padding: 10px 24px 24px; }
.luna-dialog-footer:empty { display: none; }
.luna-dialog-btn { height: 40px; padding: 0 20px; border: none; border-radius: 1000px; background: rgba(255, 255, 255, 0.1); color: #fff; font: inherit; font-size: 14px; font-weight: 500; cursor: pointer; transition: background-color 0.15s, opacity 0.15s; }
.luna-dialog-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.15); }
.luna-dialog-btn-primary { background: #fff; color: #000; }
.luna-dialog-btn-primary:hover:not(:disabled) { background: rgba(255, 255, 255, 0.8); }
.luna-dialog-btn:disabled { opacity: 0.4; cursor: default; }
.luna-dialog-btn:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
`;

/** Each plugin adds the styles under its own id, so unloading one plugin doesn't unstyle the other */
export const addPlaylistPickerStyles = (pluginName: string, unloads: LunaUnloads) => new StyleTag(`${pluginName}-playlist-picker`, unloads, CSS);

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

const SVG = "http://www.w3.org/2000/svg";
const SEARCH_ICON =
	"M5.11531 5.11531C7.93575 2.29488 12.5087 2.29491 15.3292 5.11531C17.9096 7.69576 18.1267 11.7413 15.9854 14.5714L21.2071 19.793L19.793 21.2071L14.5714 15.9854C11.7413 18.1267 7.69576 17.9096 5.11531 15.3292C2.29491 12.5087 2.29488 7.93575 5.11531 5.11531ZM13.9151 6.52938C11.8757 4.49002 8.56876 4.48999 6.52938 6.52938C4.48999 8.56876 4.49002 11.8757 6.52938 13.9151C8.56878 15.9545 11.8757 15.9545 13.9151 13.9151C15.9545 11.8757 15.9545 8.56878 13.9151 6.52938Z";
const CLOSE_ICON = "M5.7 4.3 12 10.6l6.3-6.3 1.4 1.4-6.3 6.3 6.3 6.3-1.4 1.4-6.3-6.3-6.3 6.3-1.4-1.4 6.3-6.3-6.3-6.3z";
const CHECK_ICON = "M9.5 15.7 19.1 6.1l1.4 1.4-11 11-6-6 1.4-1.4z";

/** Uses TIDAL's own icon when its sprite is on the page, otherwise our copy */
const icon = (path: string, sprite?: string) => {
	const svg = document.createElementNS(SVG, "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	if (sprite && document.getElementById(sprite)) {
		const use = document.createElementNS(SVG, "use");
		use.setAttribute("href", `#${sprite}`);
		svg.appendChild(use);
	} else {
		const shape = document.createElementNS(SVG, "path");
		shape.setAttribute("d", path);
		shape.setAttribute("fill-rule", "evenodd");
		svg.appendChild(shape);
	}
	return svg;
};

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
export const matches = (text: string, query: string) => text.toLowerCase().includes(query.trim().toLowerCase());
export const itemCount = (count: number) => `${count} ${count === 1 ? "item" : "items"}`;
export const playlistCover = (playlist: PickablePlaylist) => ContentBase.formatCoverUrl(playlist.squareImage ?? playlist.image, { res: "160" });
export const emptyMessage = (text: string) => el("div", "luna-dialog-empty", text);

/** Bare check mark, styled by the caller */
export const checkIcon = () => icon(CHECK_ICON);

/** Round tick for checklist rows, filled when aria-checked="true" */
export const toggleMark = () => {
	const toggle = el("div", "luna-dialog-toggle");
	toggle.appendChild(icon(CHECK_ICON));
	return toggle;
};

export const button = (text: string, primary = false) => el("button", primary ? "luna-dialog-btn luna-dialog-btn-primary" : "luna-dialog-btn", text);

export interface Modal<T> {
	/** Holds the search field and list */
	body: HTMLDivElement;
	setHeader: (title: string, subtitle?: string) => void;
	/** Buttons at the bottom right, none hides the footer */
	setFooter: (...buttons: HTMLButtonElement[]) => void;
	close: (value: T | undefined) => void;
	/** Extra key handling, Escape always closes */
	onKey: (handler: (e: KeyboardEvent) => void) => void;
}

/** Dialog shell like TIDAL's: title, close button, body and footer. `close` resolves once */
export const openModal = <T>(unloads: LunaUnloads, resolve: (value: T | undefined) => void): Modal<T> => {
	const overlay = el("div", "luna-dialog-overlay");
	const modal = el("div", "luna-dialog-modal");
	modal.setAttribute("role", "dialog");
	modal.setAttribute("aria-modal", "true");
	const header = el("div", "luna-dialog-header");
	const heading = el("div", "luna-dialog-heading");
	const closeButton = el("button", "luna-dialog-close");
	closeButton.type = "button";
	closeButton.title = "Close";
	closeButton.appendChild(icon(CLOSE_ICON, "general__close"));
	header.append(heading, closeButton);
	const body = el("div", "luna-dialog-body");
	const footer = el("div", "luna-dialog-footer");
	modal.append(header, body, footer);
	overlay.appendChild(modal);

	let settled = false;
	const keyHandlers: ((e: KeyboardEvent) => void)[] = [];
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			e.stopPropagation();
			close(undefined);
		} else for (const handler of keyHandlers) handler(e);
	};
	const close = (value: T | undefined) => {
		if (settled) return;
		settled = true;
		document.removeEventListener("keydown", onKey, true);
		overlay.remove();
		unloads.delete(unload);
		resolve(value);
	};
	const unload = () => close(undefined);
	unloads.add(unload);

	closeButton.addEventListener("click", () => close(undefined));
	overlay.addEventListener("mousedown", (e) => {
		if (e.target === overlay) close(undefined);
	});
	document.addEventListener("keydown", onKey, true);
	document.body.appendChild(overlay);

	return {
		body,
		setHeader: (title, subtitle) => {
			heading.replaceChildren(el("div", "luna-dialog-title", title));
			if (subtitle) heading.appendChild(el("div", "luna-dialog-subtitle", subtitle));
		},
		setFooter: (...buttons) => footer.replaceChildren(...buttons),
		close,
		onKey: (handler) => keyHandlers.push(handler),
	};
};

/** TIDAL's rounded search field */
export const searchField = (placeholder = "Search") => {
	const field = el("div", "luna-dialog-search");
	const input = el("input");
	input.type = "text";
	input.autocomplete = "off";
	input.placeholder = placeholder;
	input.setAttribute("aria-label", placeholder);
	field.append(icon(SEARCH_ICON), input);
	field.addEventListener("mousedown", (e) => {
		if (e.target !== input) {
			e.preventDefault();
			input.focus();
		}
	});
	return { field, input };
};

export const list = () => el("div", "luna-dialog-list");

export interface RowOptions {
	title: string;
	detail?: string;
	imageUrl?: string;
	/** Round cover, for artists */
	round?: boolean;
	trailing?: Element;
}

/** One list entry: 42px cover, title and a detail line */
export const row = ({ title, detail, imageUrl, round, trailing }: RowOptions) => {
	const node = el("button", "luna-dialog-row");
	node.type = "button";
	const coverClass = round ? "luna-dialog-cover luna-dialog-cover-round" : "luna-dialog-cover";
	if (imageUrl) {
		const img = el("img", coverClass);
		img.alt = "";
		img.width = img.height = 42;
		img.loading = "lazy";
		img.decoding = "async";
		img.draggable = false;
		img.src = imageUrl;
		node.appendChild(img);
	} else node.appendChild(el("div", coverClass));
	const text = el("div");
	text.appendChild(el("div", "luna-dialog-row-title", title));
	if (detail) text.appendChild(el("div", "luna-dialog-row-detail", detail));
	node.appendChild(text);
	if (trailing) {
		const wrap = el("div", "luna-dialog-trailing");
		wrap.appendChild(trailing);
		node.appendChild(wrap);
	}
	return node;
};

export interface CheckItem {
	id: string;
	title: string;
	detail?: string;
	imageUrl?: string;
}

/** Searchable list with a tick per row, plus select all / none for the visible rows */
export const checklist = (items: CheckItem[], checked: Set<string>, round: boolean, onChange: () => void) => {
	const { field, input } = searchField();
	const tools = el("div", "luna-dialog-tools");
	const counter = el("div", "luna-dialog-counter");
	const all = el("button", "luna-dialog-link", "Select all");
	const none = el("button", "luna-dialog-link", "Select none");
	tools.append(counter, all, none);
	const rows = list();

	const visible = () => items.filter((item) => matches(item.title, input.value));
	const render = () => {
		rows.replaceChildren();
		const shown = visible();
		if (shown.length === 0) rows.appendChild(emptyMessage(items.length === 0 ? "Nothing here." : "No matches."));
		for (const item of shown) {
			const node = row({ ...item, round, trailing: toggleMark() });
			node.setAttribute("role", "checkbox");
			node.setAttribute("aria-checked", String(checked.has(item.id)));
			node.addEventListener("click", () => {
				if (checked.has(item.id)) checked.delete(item.id);
				else checked.add(item.id);
				node.setAttribute("aria-checked", String(checked.has(item.id)));
				onChange();
			});
			rows.appendChild(node);
		}
	};
	const setVisible = (value: boolean) => {
		for (const item of visible()) value ? checked.add(item.id) : checked.delete(item.id);
		render();
		onChange();
	};
	all.addEventListener("click", () => setVisible(true));
	none.addEventListener("click", () => setVisible(false));
	input.addEventListener("input", render);
	render();
	return { nodes: [field, tools, rows], input, counter };
};

export interface PickPlaylistOptions {
	title: string;
	subtitle?: string;
	loadPlaylists: () => Promise<PickablePlaylist[]>;
	/** Marked with a tick as the current choice */
	currentUuid?: string;
	/** Shows a "Remove" button that resolves null */
	allowClear?: boolean;
}

/** Searchable playlist picker. Resolves the playlist, null for "Remove", or undefined when closed */
export const pickPlaylist = (unloads: LunaUnloads, options: PickPlaylistOptions): Promise<PickablePlaylist | null | undefined> =>
	new Promise((resolve) => {
		const modal = openModal<PickablePlaylist | null>(unloads, resolve);
		modal.setHeader(options.title, options.subtitle);
		const { field, input } = searchField();
		const rows = list();
		rows.appendChild(emptyMessage("Loading playlists…"));
		modal.body.append(field, rows);
		if (options.allowClear) {
			const clear = button("Remove");
			clear.addEventListener("click", () => modal.close(null));
			modal.setFooter(clear);
		}

		let playlists: PickablePlaylist[] = [];
		let shown: PickablePlaylist[] = [];
		const render = () => {
			shown = playlists.filter((p) => matches(p.title, input.value));
			rows.replaceChildren();
			if (shown.length === 0) rows.appendChild(emptyMessage(playlists.length === 0 ? "You don't have any playlists yet." : "No matching playlists."));
			for (const playlist of shown) {
				const current = playlist.uuid === options.currentUuid;
				const node = row({ title: playlist.title, detail: itemCount(playlist.numberOfTracks), imageUrl: playlistCover(playlist), trailing: current ? icon(CHECK_ICON) : undefined });
				if (current) node.setAttribute("aria-current", "true");
				node.addEventListener("click", () => modal.close(playlist));
				rows.appendChild(node);
			}
		};
		modal.onKey((e) => {
			if (e.key === "Enter" && document.activeElement === input && shown.length > 0) {
				e.preventDefault();
				modal.close(shown[0]);
			}
		});
		input.addEventListener("input", render);
		input.focus();

		options
			.loadPlaylists()
			.then((result) => {
				playlists = result;
				render();
			})
			.catch((err) => rows.replaceChildren(emptyMessage(`Failed to load playlists: ${errorText(err)}`)));
	});
