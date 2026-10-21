import type { LunaUnload, LunaUnloads } from "@luna/core";
import { observe, StyleTag } from "@luna/lib";

import { isCompact } from "./compact";
import { settings, settingsListeners } from "./Settings";

const PINNED = "data-office-pinned-header";
/** Bottom of the navigation bar */
const EDGE = "--office-header-edge";
/** The view's own bottom, kept when its top moves */
const BOTTOM = "--office-view-bottom";
const VIEW = '[data-test="new-now-playing"]';

/** The properties we set on a node, so only those are removed */
const REVEALED = "data-office-revealed";
/** On the page while the bar is shown above the open view */
const SHOWN = "data-office-header-shown";

/** The full-screen view starts below the bar */
const styles = `
[${PINNED}] { top: var(${EDGE}, 0px) !important; bottom: var(${BOTTOM}, 0px) !important; height: auto !important; }
html[${SHOWN}] #mainHeader { background: #18181b !important; }
`;

const viewOpen = () => document.getElementById("footerPlayer")?.classList.contains("nowPlayingVisible") ?? false;

/** How TIDAL may hide the bar while the view is open, and the undo */
const HIDERS: { prop: string; value: string; hidden: (style: CSSStyleDeclaration) => boolean; ancestors: boolean }[] = [
	{ prop: "opacity", value: "1", hidden: (style) => style.opacity !== "1", ancestors: true },
	{ prop: "visibility", value: "visible", hidden: (style) => style.visibility !== "visible", ancestors: true },
	{ prop: "transform", value: "none", hidden: (style) => style.transform !== "none", ancestors: false },
	{ prop: "pointer-events", value: "auto", hidden: (style) => style.pointerEvents === "none", ancestors: false },
];

const unreveal = () => {
	document.documentElement.removeAttribute(SHOWN);
	for (const node of document.querySelectorAll<HTMLElement>(`[${REVEALED}]`)) {
		for (const prop of (node.getAttribute(REVEALED) ?? "").split(",")) if (prop) node.style.removeProperty(prop);
		node.removeAttribute(REVEALED);
	}
};

/** Undoes whatever hides the bar, its contents or its ancestors */
const reveal = () => {
	const header = document.getElementById("mainHeader");
	if (!header) return;
	document.documentElement.setAttribute(SHOWN, "");
	const own = [header, ...header.querySelectorAll<HTMLElement>(':scope > *, :scope > * > *, [data-test="navigation-arrows"] > *')];
	const around: HTMLElement[] = [];
	for (let node = header.parentElement; node && node !== document.body; node = node.parentElement) around.push(node);
	const mark = (node: HTMLElement, prop: string) => {
		const set = new Set((node.getAttribute(REVEALED) ?? "").split(",").filter(Boolean)).add(prop);
		node.setAttribute(REVEALED, [...set].join(","));
	};
	const fix = (node: HTMLElement, ancestor: boolean) => {
		// A fade-out that just started still reads as visible: stopping it reveals its target before the next paint
		const fading = getComputedStyle(node);
		if (/all|opacity|visibility|transform/.test(fading.transitionProperty) && fading.transitionDuration.split(",").some((d) => parseFloat(d) > 0)) {
			node.style.setProperty("transition", "none", "important");
			mark(node, "transition");
		}
		const style = getComputedStyle(node);
		for (const hider of HIDERS) {
			if (ancestor && !hider.ancestors) continue;
			if (!hider.hidden(style)) continue;
			mark(node, hider.prop);
			node.style.setProperty(hider.prop, hider.value, "important");
		}
	};
	own.forEach((node) => fix(node, false));
	around.forEach((node) => fix(node, true));
};

const pin = (unloads: LunaUnloads) => {
	new StyleTag("Office-pinned-header", unloads, styles);
	const root = document.documentElement;

	let measured = false;
	const measure = () => {
		// TIDAL may have moved the bar away while the view is open
		if (measured && viewOpen() && !document.documentElement.hasAttribute(SHOWN)) return;
		const header = document.getElementById("mainHeader")?.getBoundingClientRect();
		// Hidden: keep the last value
		if (!header || header.height <= 0) return;
		root.style.setProperty(EDGE, `${Math.max(0, Math.round(header.bottom))}px`);
		measured = true;
	};

	// TIDAL may still change the bar after opening: rechecked a few times
	let timers: number[] = [];
	const syncBar = () => {
		timers.forEach(clearTimeout);
		timers = [];
		if (!viewOpen()) return unreveal();
		// Observers run before the next paint, so this avoids a flash
		reveal();
		for (const delay of [120, 350, 700]) timers.push(window.setTimeout(reveal, delay));
	};

	// Only the overlaid view (TIDAL keeps another for its separate full-screen mode)
	const scan = () => {
		measure();
		for (const view of document.querySelectorAll<HTMLElement>(VIEW)) {
			const overlay = getComputedStyle(view).position === "fixed";
			if (!overlay) {
				view.removeAttribute(PINNED);
				view.style.removeProperty(BOTTOM);
				continue;
			}
			if (view.hasAttribute(PINNED)) continue;
			// Not shown yet. Offsets ignore the slide-in animation, unlike the bounding box
			if (view.offsetHeight <= 0) continue;
			const bottom = window.innerHeight - (view.offsetTop + view.offsetHeight);
			view.style.setProperty(BOTTOM, `${Math.max(0, Math.round(bottom))}px`);
			view.setAttribute(PINNED, "");
		}
	};

	const resizeObserver = new ResizeObserver(measure);
	// The bar's classes may change a moment after the footer's
	const headerObserver = new MutationObserver(() => viewOpen() && reveal());
	const watchHeader = (header: Element) => {
		resizeObserver.disconnect();
		resizeObserver.observe(header);
		headerObserver.disconnect();
		headerObserver.observe(header, { attributes: true, attributeFilter: ["class"], subtree: true });
		measure();
	};
	const footerObserver = new MutationObserver(() => {
		syncBar();
		scan();
	});
	const watchFooter = (footer: Element) => {
		footerObserver.disconnect();
		footerObserver.observe(footer, { attributes: true, attributeFilter: ["class"] });
	};
	const onResize = () => {
		measure();
		// Its bottom moves with the window: remeasured unpinned
		for (const view of document.querySelectorAll<HTMLElement>(`[${PINNED}]`)) {
			view.removeAttribute(PINNED);
			view.style.removeProperty(BOTTOM);
		}
		scan();
	};

	const header = document.getElementById("mainHeader");
	if (header) watchHeader(header);
	const footer = document.getElementById("footerPlayer");
	if (footer) watchFooter(footer);
	syncBar();
	scan();
	observe(unloads, "#mainHeader", watchHeader);
	observe(unloads, "#footerPlayer", watchFooter);
	observe(unloads, VIEW, scan);
	window.addEventListener("resize", onResize);

	unloads.add(() => {
		resizeObserver.disconnect();
		headerObserver.disconnect();
		footerObserver.disconnect();
		window.removeEventListener("resize", onResize);
		timers.forEach(clearTimeout);
		unreveal();
		root.style.removeProperty(EDGE);
		for (const view of document.querySelectorAll<HTMLElement>(`[${PINNED}]`)) {
			view.removeAttribute(PINNED);
			view.style.removeProperty(BOTTOM);
		}
	});
};

/** Keeps the navigation bar above the full-screen view; toggled by its setting */
export const setupPinnedHeader = (unloads: LunaUnloads) => {
	let active: Set<LunaUnload> | undefined;
	const disable = () => {
		active?.forEach((unload) => unload());
		active = undefined;
	};
	const sync = () => {
		const wanted = settings.pinnedHeader && !isCompact();
		if (wanted === (active !== undefined)) return;
		if (!wanted) return disable();
		active = new Set();
		pin(active);
	};
	settingsListeners.add(sync);
	sync();
	unloads.add(() => {
		settingsListeners.delete(sync);
		disable();
	});
};
