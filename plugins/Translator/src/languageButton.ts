import type { LunaUnloads } from "@luna/core";
import { observe, redux } from "@luna/lib";

import { donut, slicesOf } from "./languageChart";
import { openLanguagePanel } from "./languagePanel";
import { cachedSummary, type LanguageSummary } from "./playlistLanguages";

const BUTTON_ATTR = "data-translator-languages";
// "More" in the page header; the bar that replaces the header when scrolling has one too
const MORE_SELECTOR = '[data-test="show-context-menu-button"]';
const PLAY_ALL = '[data-test="play-all"], [data-test="shuffle-all"]';
const GLOBE_SVG =
	'<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5z" fill="none" stroke="currentColor" stroke-width="1.6"/>';

const currentPlaylist = () => {
	const path = redux.store.getState().router?.currentPath ?? window.location.pathname;
	const uuid = /^\/playlist\/([0-9a-f-]{36})/i.exec(path)?.[1];
	if (uuid === undefined) return undefined;
	return { uuid, title: redux.store.getState().content.playlists[uuid]?.title };
};

const isHeaderMore = (more: HTMLElement) => {
	let node = more.parentElement;
	for (let depth = 0; node !== null && depth < 4; depth++, node = node.parentElement) if (node.querySelector(PLAY_ALL)) return true;
	return false;
};

/** Globe until the playlist was analyzed, then a small donut of its languages */
const setIcon = (button: HTMLElement, summary: LanguageSummary | undefined) => {
	const svg = button.querySelector("svg");
	if (svg === null) return;
	if (summary === undefined || summary.withLyrics === 0) {
		svg.setAttribute("viewBox", "0 0 24 24");
		svg.innerHTML = GLOBE_SVG;
		return;
	}
	const chart = donut(slicesOf(summary), 24, 5, 12).svg;
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.replaceChildren(...chart.childNodes);
};

const updateIcons = async () => {
	const playlist = currentPlaylist();
	const summary = playlist === undefined ? undefined : await cachedSummary(playlist.uuid);
	document.querySelectorAll<HTMLElement>(`[${BUTTON_ATTR}]`).forEach((button) => setIcon(button, summary));
};

/** Copies TIDAL's "More" button so it looks native, then swaps icon and label */
const createButton = (more: HTMLElement, unloads: LunaUnloads) => {
	const button = more.cloneNode(true) as HTMLElement;
	for (const attr of [...button.attributes]) if (attr.name.startsWith("data-")) button.removeAttribute(attr.name);
	button.setAttribute(BUTTON_ATTR, "");
	button.setAttribute("aria-label", "Languages of this playlist");
	button.title = "Languages of this playlist";
	const label = button.querySelector("span");
	if (label) label.textContent = "Languages";
	button.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		const playlist = currentPlaylist();
		if (playlist) openLanguagePanel(unloads, playlist.uuid, playlist.title, () => updateIcons());
	});
	return button;
};

/** Adds "Languages" left of the "More" button on playlist pages */
export const setupLanguageButton = (unloads: LunaUnloads) => {
	const ensure = (more: HTMLElement) => {
		if (currentPlaylist() === undefined || !isHeaderMore(more)) return;
		const container = more.parentElement;
		if (!container || container.querySelector(`[${BUTTON_ATTR}]`)) return;
		container.insertBefore(createButton(more, unloads), more);
		updateIcons();
	};
	observe<HTMLElement>(unloads, MORE_SELECTOR, ensure);
	document.querySelectorAll<HTMLElement>(MORE_SELECTOR).forEach(ensure);
	redux.intercept("router/NAVIGATED", unloads, () => {
		updateIcons();
	});
	unloads.add(() => document.querySelectorAll(`[${BUTTON_ATTR}]`).forEach((node) => node.remove()));
};
