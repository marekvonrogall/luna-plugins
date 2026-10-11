import type { LunaUnloads } from "@luna/core";
import { observe, redux } from "@luna/lib";

import type { RateSource } from "./rateMode";

const BUTTON_ATTR = "data-comite-rate";
const FAVORITES_ID = "comite-favorites-rate";
const FAVORITES_PATH = /^\/my-collection\/tracks\/?$/;
const STAR_SVG =
	'<path d="M12 3.2l2.6 5.5 6 .7-4.4 4.1 1.2 6L12 16.6 6.6 19.5l1.2-6-4.4-4.1 6-.7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>';

const currentPath = () => redux.store.getState().router?.currentPath ?? window.location.pathname;

/** Album or playlist shown on the current page */
const currentSource = (): RateSource | undefined => {
	const state = redux.store.getState();
	const path = currentPath();
	const album = /^\/album\/(\d+)/.exec(path);
	if (album) return { type: "album", id: album[1], title: state.content.albums[album[1]]?.title };
	const playlist = /^\/playlist\/([0-9a-f-]{36})/i.exec(path);
	if (playlist) return { type: "playlist", id: playlist[1], title: state.content.playlists[playlist[1]]?.title };
	return undefined;
};

/** Copies TIDAL's "More" button so "Rate" looks native, then swaps icon and label */
const createButton = (more: HTMLElement, onRate: (source: RateSource) => void) => {
	const button = more.cloneNode(true) as HTMLElement;
	for (const attr of [...button.attributes]) if (attr.name.startsWith("data-")) button.removeAttribute(attr.name);
	button.setAttribute(BUTTON_ATTR, "");
	button.setAttribute("aria-label", "Rate songs");
	const svg = button.querySelector("svg");
	if (svg) {
		svg.setAttribute("viewBox", "0 0 24 24");
		svg.innerHTML = STAR_SVG;
	}
	const label = button.querySelector("span");
	if (label) label.textContent = "Rate";
	button.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		const source = currentSource();
		if (source) onRate(source);
	});
	return button;
};

export const FAVORITES_RATE_CSS = `
#${FAVORITES_ID} { display: inline-flex; align-items: center; gap: 6px; height: 32px; margin-left: 12px; padding: 0 12px 0 10px; border: none; border-radius: 16px; background: transparent; color: inherit; font-size: 13px; font-weight: 600; vertical-align: middle; cursor: pointer; opacity: 0.8; }
#${FAVORITES_ID}:hover { background: rgba(255, 255, 255, 0.1); opacity: 1; }
#${FAVORITES_ID} svg { width: 20px; height: 20px; }
`;

/** Page title of the favorites page (same spot Collector uses for its "..." button) */
const findHeading = () =>
	document.querySelector<HTMLElement>('[data-test="main"] h1') ?? document.querySelector<HTMLElement>("main h1") ?? document.querySelector<HTMLElement>('[data-test="main"] h2');

/** The favorite tracks page has no "More" button, so "Rate" sits next to the title */
const setupFavoritesButton = (unloads: LunaUnloads, onRate: (source: RateSource) => void) => {
	let queued = false;
	const ensure = () => {
		queued = false;
		const existing = document.getElementById(FAVORITES_ID);
		if (!FAVORITES_PATH.test(currentPath())) return existing?.remove();
		const heading = findHeading();
		if (heading === null || (existing !== null && heading.contains(existing))) return;

		const button = existing ?? document.createElement("button");
		if (existing === null) {
			button.id = FAVORITES_ID;
			button.title = "Rate your favorite tracks";
			button.innerHTML = `<svg viewBox="0 0 24 24">${STAR_SVG}</svg><span>Rate</span>`;
			button.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				onRate({ type: "favorites", id: "favorites", title: "your favorite tracks" });
			});
		}
		// Left of Collector's "..." button if that plugin is installed
		const collectorMore = heading.querySelector("#collector-favorites-more");
		if (collectorMore) heading.insertBefore(button, collectorMore);
		else heading.appendChild(button);
	};
	// TIDAL re-renders a lot, so check at most once per frame
	const queue = () => {
		if (queued) return;
		queued = true;
		requestAnimationFrame(ensure);
	};
	redux.intercept("router/NAVIGATED", unloads, () => {
		queue();
	});
	observe(unloads, "h1", queue);
	queue();
	unloads.add(() => document.getElementById(FAVORITES_ID)?.remove());
};

/** Adds "Rate" left of the "More" button on album and playlist pages, and next to the title on the favorites page */
export const setupRateButton = (unloads: LunaUnloads, onRate: (source: RateSource) => void) => {
	const ensure = (more: HTMLElement) => {
		if (currentSource() === undefined) return;
		const container = more.parentElement;
		if (!container || container.querySelector(`[${BUTTON_ATTR}]`)) return;
		container.insertBefore(createButton(more, onRate), more);
	};
	const scan = () => document.querySelectorAll<HTMLElement>('[data-test="show-context-menu-button"]').forEach(ensure);

	observe<HTMLElement>(unloads, '[data-test="show-context-menu-button"]', ensure);
	scan();
	setupFavoritesButton(unloads, onRate);
	unloads.add(() => document.querySelectorAll(`[${BUTTON_ATTR}]`).forEach((node) => node.remove()));
};
