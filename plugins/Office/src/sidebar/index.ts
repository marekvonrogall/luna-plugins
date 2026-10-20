import type { LunaUnload, LunaUnloads } from "@luna/core";
import { observe, PlayState, redux, StyleTag } from "@luna/lib";

// Watch mode doesn't track sidebar.css: save this file to rebuild
import styles from "file://sidebar.css?minify";

import { trace } from "../log";
import { coverUrl, trackInfo } from "../queue/data";
import { settings, settingsListeners } from "../Settings";
import { swapImage } from "../swapImage";

/** Set by us, not TIDAL, so they survive its re-renders */
const CURRENT = "data-office-current";
const PLAYING = "data-office-playing";
const STUCK = "data-office-stuck";
/** The icon a fit was measured for */
const FITTED = "data-office-fitted";
/** TIDAL pads its icons differently, so these are scaled to the same drawn size (--osb-glyph) */
const FIT_ICONS = [
	"#sidebar-content > a[data-test] > svg",
	'[data-test="sidebar-collection-menu"] > svg:first-child',
	'a[data-test^="sidebar-collection-"] > svg:first-child',
	'[data-test="sidebar-scrollable-nav"] > a > :first-child > svg',
].join(", ");
const FIT_VARS = ["--osb-fit", "--osb-fit-x", "--osb-fit-y"] as const;
/** Labels pinned while scrolling: "All playlists" and "Collection" */
const STICKY = [
	':has(> * > [data-test="create-folder-or-playlist"])',
	':has(> a[data-test^="sidebar-collection-"]):not(#sidebar-content, [role="menu"]) > :first-child:not(a)',
].join(", ");

const setAttr = (node: Element, name: string, value: string | null) => {
	if (node.getAttribute(name) === value) return;
	if (value === null) node.removeAttribute(name);
	else node.setAttribute(name, value);
};

const trimPath = (path: string) => path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
const pathOf = (href: string | null) => {
	if (!href) return;
	try {
		return trimPath(new URL(href, window.location.origin).pathname);
	} catch {
		return;
	}
};
const currentPath = () => trimPath(redux.store.getState().router?.currentPath || window.location.pathname);
/** The page or one below it ("/" only itself) */
const isCurrent = (target: string, path: string) => target === path || (target !== "/" && path.startsWith(`${target}/`));

const iconOf = (svg: SVGSVGElement) => svg.querySelector("use")?.getAttribute("href") ?? "";

const unfitIcon = (svg: SVGElement) => {
	for (const name of FIT_VARS) svg.style.removeProperty(name);
	svg.removeAttribute(FITTED);
};

/** Scales and centers an icon's drawing to --osb-glyph */
const fitIcon = (svg: SVGSVGElement) => {
	const icon = iconOf(svg);
	if (svg.getAttribute(FITTED) === icon) return;
	const glyph = parseFloat(getComputedStyle(svg).getPropertyValue("--osb-glyph"));
	// Without the transform
	const width = svg.clientWidth;
	const height = svg.clientHeight;
	if (!glyph || !width || !height) return;
	let box: DOMRect;
	try {
		box = svg.getBBox();
	} catch {
		return;
	}
	// Not rendered yet, e.g. in a closed menu
	if (box.width <= 0 || box.height <= 0) return;
	// Drawing units to pixels
	const view = svg.viewBox.baseVal;
	const hasView = !!view && view.width > 0 && view.height > 0;
	const unit = hasView ? Math.min(width / view.width, height / view.height) : 1;
	const originX = hasView ? (view.x + view.width / 2) * unit - width / 2 : 0;
	const originY = hasView ? (view.y + view.height / 2) * unit - height / 2 : 0;
	const scale = glyph / (Math.max(box.width, box.height) * unit);
	const offsetX = (box.x + box.width / 2) * unit - originX - width / 2;
	const offsetY = (box.y + box.height / 2) * unit - originY - height / 2;
	svg.style.setProperty("--osb-fit", scale.toFixed(4));
	svg.style.setProperty("--osb-fit-x", `${(-offsetX * scale).toFixed(2)}px`);
	svg.style.setProperty("--osb-fit-y", `${(-offsetY * scale).toFixed(2)}px`);
	svg.setAttribute(FITTED, icon);
};

const playingPath = () => {
	const queue = PlayState.playQueue;
	const context = queue?.elements?.[queue.currentIndex]?.context;
	if (context?.type === "playlist" && context.id) return `/playlist/${context.id}`;
};

/** Marks the open page, the playing playlist and pinned labels */
const attach = (unloads: LunaUnloads) => {
	let aside: HTMLElement | undefined;
	let positioned = false;
	let frame = 0;
	const bars = document.createElement("span");
	bars.className = "osb-bars";
	bars.setAttribute("aria-hidden", "true");
	bars.append(...Array.from({ length: 3 }, () => document.createElement("i")));
	const ambient = document.createElement("div");
	ambient.className = "osb-ambient";
	ambient.setAttribute("aria-hidden", "true");
	const ambientState: { url?: string } = {};

	/** The current song's cover behind the sidebar, like the queue's */
	const tint = () => {
		if (!aside || !settings.sidebarTint) return ambient.remove();
		if (ambient.parentElement !== aside) aside.append(ambient);
		const queue = PlayState.playQueue;
		const current = queue?.elements?.[queue.currentIndex];
		swapImage(ambient, coverUrl(current ? trackInfo(current.mediaItemId, schedule) : undefined, "320"), ambientState, schedule);
	};

	const mark = () => {
		frame = 0;
		if (!aside?.isConnected) return;
		const path = currentPath();
		const playing = playingPath();
		const state = PlayState.playing ? "playing" : "paused";
		for (const link of aside.querySelectorAll<HTMLAnchorElement>("a[href]")) {
			const target = pathOf(link.getAttribute("href"));
			setAttr(link, CURRENT, target !== undefined && isCurrent(target, path) ? "" : null);
			setAttr(link, PLAYING, target !== undefined && target === playing ? state : null);
		}
		const playingRow = aside.querySelector(`[data-test="sidebar-scrollable-nav"] > a[${PLAYING}]`);
		if (!playingRow) bars.remove();
		else if (bars.parentElement !== playingRow) playingRow.append(bars);
		for (const svg of aside.querySelectorAll<SVGSVGElement>(FIT_ICONS)) fitIcon(svg);
		tint();
		const menu = aside.querySelector('[data-test="sidebar-collection-menu"]');
		if (menu) setAttr(menu, CURRENT, isCurrent("/my-collection", path) ? "" : null);
		updateStuck();
	};
	const schedule = () => {
		if (!frame) frame = requestAnimationFrame(mark);
	};

	const updateStuck = () => {
		if (!aside) return;
		for (const label of aside.querySelectorAll<HTMLElement>(STICKY)) {
			const viewport = label.closest<HTMLElement>("[data-overlayscrollbars-viewport]") ?? label.parentElement;
			// Also while pushed out with its section
			const stuck = !!viewport && viewport.scrollTop > 0 && label.getBoundingClientRect().top - viewport.getBoundingClientRect().top <= 1;
			setAttr(label, STUCK, stuck ? "" : null);
		}
	};

	const contentObserver = new MutationObserver(schedule);
	const onScroll = () => updateStuck();

	const release = () => {
		contentObserver.disconnect();
		bars.remove();
		ambient.remove();
		if (!aside) return;
		aside.removeEventListener("scroll", onScroll, true);
		aside.removeEventListener("pointerover", schedule);
		for (const node of aside.querySelectorAll(`[${CURRENT}], [${PLAYING}], [${STUCK}]`)) {
			node.removeAttribute(CURRENT);
			node.removeAttribute(PLAYING);
			node.removeAttribute(STUCK);
		}
		for (const svg of aside.querySelectorAll<SVGElement>(`[${FITTED}]`)) unfitIcon(svg);
		if (positioned) aside.style.removeProperty("position");
		aside = undefined;
		positioned = false;
	};

	const watch = (node: HTMLElement) => {
		if (node === aside) return;
		release();
		aside = node;
		// For the right edge (::after)
		positioned = getComputedStyle(node).position === "static";
		if (positioned) node.style.position = "relative";
		contentObserver.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
		node.addEventListener("scroll", onScroll, { capture: true, passive: true });
		// Fits icons in menus shown on hover
		node.addEventListener("pointerover", schedule, { passive: true });
		mark();
	};

	const existing = document.getElementById("sidebar");
	if (existing) watch(existing);
	observe<HTMLElement>(unloads, "#sidebar", watch);

	let lastPath: unknown;
	let lastQueue: unknown;
	let lastPlaying: unknown;
	const unsubscribe = redux.store.subscribe(() => {
		const state = redux.store.getState();
		const playing = PlayState.playing;
		if (state.router?.currentPath === lastPath && state.playQueue === lastQueue && playing === lastPlaying) return;
		lastPath = state.router?.currentPath;
		lastQueue = state.playQueue;
		lastPlaying = playing;
		schedule();
	});

	settingsListeners.add(schedule);

	unloads.add(() => {
		settingsListeners.delete(schedule);
		unsubscribe();
		if (frame) cancelAnimationFrame(frame);
		release();
	});
};

/** Sets up the sidebar; toggled by its setting */
export const setupSidebar = (unloads: LunaUnloads) => {
	let active: Set<LunaUnload> | undefined;
	const disable = () => {
		active?.forEach((unload) => unload());
		active = undefined;
	};
	const sync = () => {
		if (settings.sidebar === (active !== undefined)) return;
		if (!settings.sidebar) return disable();
		active = new Set();
		new StyleTag("Office-sidebar", active, styles);
		try {
			attach(active);
		} catch (err) {
			trace.msg.err.withContext("Couldn't set up the sidebar")(err as Error);
			disable();
		}
	};
	settingsListeners.add(sync);
	sync();
	unloads.add(() => {
		settingsListeners.delete(sync);
		disable();
	});
};
