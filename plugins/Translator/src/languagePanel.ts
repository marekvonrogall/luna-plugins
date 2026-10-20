import type { LunaUnloads } from "@luna/core";

import { donut, percent, slicesOf } from "./languageChart";
import { analyzePlaylist, type LanguageSummary } from "./playlistLanguages";

const PANEL = "luna-languages";

export const LANGUAGE_PANEL_CSS = `
.${PANEL}-backdrop { position: fixed; inset: 0; z-index: 100000; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.55); }
.${PANEL} { width: 460px; max-width: calc(100vw - 32px); padding: 20px 22px; border-radius: 12px; background: #1c1c1f; color: #fff; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6); font-size: 13px; }
.${PANEL}-title { font-size: 18px; font-weight: 700; }
.${PANEL}-subtitle { margin-top: 2px; color: #a0a0a8; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.${PANEL}-body { display: flex; gap: 22px; align-items: center; margin-top: 16px; }
.${PANEL}-body.is-done { margin-top: 0; }
.${PANEL}-chart { position: relative; flex: none; }
.${PANEL}-chart path { transition: opacity 0.15s; }
.${PANEL}-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; text-align: center; }
.${PANEL}-center b { font-size: 22px; font-variant-numeric: tabular-nums; }
.${PANEL}-center span { max-width: 96px; color: #a0a0a8; font-size: 12px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.${PANEL}-legend { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.${PANEL}-row { display: grid; grid-template-columns: 10px 1fr auto auto; align-items: center; gap: 8px; padding: 4px 6px; border-radius: 6px; transition: opacity 0.15s, background 0.15s; }
.${PANEL}-row.active { background: rgba(255, 255, 255, 0.07); }
.${PANEL}-swatch { width: 10px; height: 10px; border-radius: 3px; }
.${PANEL}-name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.${PANEL}-share { font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; }
.${PANEL}-songs { min-width: 76px; color: #a0a0a8; font-size: 12px; font-variant-numeric: tabular-nums; text-align: right; }
.${PANEL}-dim { opacity: 0.3; }
.${PANEL}-note { color: #a0a0a8; font-size: 12px; line-height: 1.5; }
.${PANEL}-progress { flex: 1; display: flex; flex-direction: column; gap: 8px; }
.${PANEL}-bar { height: 4px; border-radius: 2px; background: #333; overflow: hidden; }
.${PANEL}-fill { height: 100%; width: 0%; background: #3987e5; transition: width 0.2s; }
.${PANEL}-footer { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
.${PANEL}-footer .${PANEL}-note { flex: 1; min-width: 0; }
.${PANEL}-button { padding: 6px 14px; border: none; border-radius: 8px; background: #2b2b30; color: #fff; font-size: 13px; cursor: pointer; }
.${PANEL}-button:hover { background: #3a3a40; }
`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
	const node = document.createElement(tag);
	node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const renderSummary = (body: HTMLElement, note: HTMLElement, summary: LanguageSummary) => {
	body.replaceChildren();
	body.classList.add("is-done");
	const parts = [`${plural(summary.withLyrics, "song")} with lyrics`];
	if (summary.withoutLyrics > 0) parts.push(`${summary.withoutLyrics} without`);
	if (summary.failed > 0) parts.push(`${summary.failed} couldn't be loaded`);
	note.textContent = parts.join(", ");
	if (summary.withLyrics === 0) {
		body.append(el("div", `${PANEL}-note`, "None of the songs have lyrics on TIDAL."));
		return;
	}

	const slices = slicesOf(summary);
	const { svg, paths } = donut(slices, 160, 26, 2.5);
	const chart = el("div", `${PANEL}-chart`);
	const center = el("div", `${PANEL}-center`);
	const value = el("b", "");
	const label = el("span", "");
	center.append(value, label);
	chart.append(svg, center);

	const legend = el("div", `${PANEL}-legend`);
	const rows = slices.map((slice) => {
		const row = el("div", `${PANEL}-row`);
		const swatch = el("span", `${PANEL}-swatch`);
		swatch.style.background = slice.color;
		row.append(swatch, el("span", `${PANEL}-name`, slice.label), el("span", `${PANEL}-share`, percent(slice.share)), el("span", `${PANEL}-songs`, `in ${plural(slice.songs, "song")}`));
		legend.append(row);
		return row;
	});

	// Hovering a slice or a row highlights both and shows its share in the middle
	const highlight = (index?: number) => {
		const shown = slices[index ?? 0];
		value.textContent = percent(shown.share);
		label.textContent = shown.label;
		paths.forEach((path, i) => path.classList.toggle(`${PANEL}-dim`, index !== undefined && i !== index));
		rows.forEach((row, i) => {
			row.classList.toggle("active", i === index);
			row.classList.toggle(`${PANEL}-dim`, index !== undefined && i !== index);
		});
	};
	[...paths, ...rows].forEach((node, i) => {
		const index = i % slices.length;
		node.addEventListener("mouseenter", () => highlight(index));
		node.addEventListener("mouseleave", () => highlight());
	});
	highlight();
	body.append(chart, legend);
};

/** Opens the languages window for a playlist and analyzes it; closing cancels (finished songs stay cached) */
export const openLanguagePanel = (unloads: LunaUnloads, uuid: string, title: string | undefined, onDone: (summary: LanguageSummary) => void) => {
	let cancelled = false;
	const backdrop = el("div", `${PANEL}-backdrop`);
	const panel = el("div", PANEL);
	const body = el("div", `${PANEL}-body`);
	const note = el("div", `${PANEL}-note`);
	const close = el("button", `${PANEL}-button`, "Close");
	const footer = el("div", `${PANEL}-footer`);
	footer.append(note, close);
	panel.append(el("div", `${PANEL}-title`, "Languages"), el("div", `${PANEL}-subtitle`, title ?? "This playlist"), body, footer);
	backdrop.append(panel);

	const remove = () => {
		cancelled = true;
		backdrop.remove();
		document.removeEventListener("keydown", onKey, true);
		unloads.delete(remove);
	};
	const onKey = (e: KeyboardEvent) => e.key === "Escape" && remove();
	close.addEventListener("click", remove);
	backdrop.addEventListener("click", (e) => e.target === backdrop && remove());
	document.addEventListener("keydown", onKey, true);
	unloads.add(remove);
	document.body.append(backdrop);

	const progress = el("div", `${PANEL}-progress`);
	const status = el("div", `${PANEL}-note`, "Loading the playlist…");
	const bar = el("div", `${PANEL}-bar`);
	const fill = el("div", `${PANEL}-fill`);
	bar.append(fill);
	progress.append(status, bar);
	body.append(progress);

	analyzePlaylist(
		uuid,
		(done, total) => {
			status.textContent = `Reading lyrics… ${done} / ${total}`;
			fill.style.width = `${total > 0 ? (done / total) * 100 : 100}%`;
		},
		() => cancelled,
	)
		.then((summary) => {
			if (cancelled) return;
			renderSummary(body, note, summary);
			onDone(summary);
		})
		.catch((err) => {
			if (!cancelled) status.textContent = `Couldn't analyze the playlist: ${err instanceof Error ? err.message : String(err)}`;
		});
};
