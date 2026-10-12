import type { LunaUnloads } from "@luna/core";

import { isSaving, rateTrack, ratingListeners, shownRating } from "./ratings";
import { createStarRow, type StarRow } from "./starRow";

const CELL = "comite-rating-cell";
const HEADER = "comite-rating-header";
const HIDDEN = "data-comite-hidden";
const WIDTH = 104;
const ROW_SELECTOR = '[data-test="tracklist-row"]';
const HEADER_SELECTOR = '[role="row"][class*="_tableHeader_"]';
const CONTEXT_SELECTOR = ':scope > [class*="_contextColumn_"]';
/** Artist pages ("Top Tracks") use a real <table> with different markup */
const TABLE_ROW_SELECTOR = 'tr[data-test^="tracklist-row"]';

/**
 * Fixed width like BPM / Key. Shown only while every other column still gets its full width,
 * so artist and the heart column keep priority. Empty stars stay faint until the row is hovered.
 */
export const RATING_COLUMN_CSS = `
.${CELL}:not(td), .${HEADER}:not(th) { flex: 0 0 ${WIDTH}px !important; padding-right: 16px !important; }
.${CELL}:not(td) { display: flex; align-items: center; }
td.${CELL}, th.${HEADER} { width: ${WIDTH - 16}px; padding: 0 16px; white-space: nowrap; vertical-align: middle; text-align: left; }
.${CELL} { --star-size: 15px; --star-gap: 1px; --star-dim-opacity: 0.2; }
.${CELL}[${HIDDEN}], .${HEADER}[${HIDDEN}] { display: none !important; }
:is(${ROW_SELECTOR}, ${TABLE_ROW_SELECTOR}):is(:hover, :focus-within) .${CELL} { --star-dim-opacity: 0.5; }
@media (width <= 576px) { .${CELL}, .${HEADER} { display: none !important; } }
`;

/** True if the row has room for the column on top of the base width of every other column */
const fits = (row: HTMLElement) => {
	let needed = WIDTH;
	for (const child of row.children) {
		if (child.classList.contains(CELL) || child.classList.contains(HEADER)) continue;
		const style = getComputedStyle(child);
		if (style.display === "none") continue;
		const basis = parseFloat(style.flexBasis);
		if (Number.isNaN(basis)) needed += child.getBoundingClientRect().width;
		else needed += basis + (style.boxSizing === "border-box" ? 0 : parseFloat(style.paddingLeft) + parseFloat(style.paddingRight));
	}
	return row.clientWidth >= needed;
};

const fit = (cell: HTMLElement) => {
	if (cell.tagName === "TD" || cell.tagName === "TH") return;
	const row = cell.parentElement;
	if (row) cell.toggleAttribute(HIDDEN, !fits(row));
};

const starRows = new WeakMap<HTMLElement, StarRow>();

const paintCell = (cell: HTMLElement) => {
	const row = starRows.get(cell);
	const trackId = cell.dataset.trackId;
	if (row === undefined || trackId === undefined) return;
	const rating = shownRating(trackId);
	row.setValue(rating);
	row.setDisabled(isSaving(trackId));
};

const createCell = (tag: "div" | "td" = "div") => {
	const cell = document.createElement(tag);
	cell.className = CELL;
	cell.setAttribute("role", "cell");
	const row = createStarRow((value) => {
		const trackId = cell.dataset.trackId;
		if (trackId !== undefined) rateTrack(trackId, value);
	});
	starRows.set(cell, row);
	cell.appendChild(row.element);
	// Clicking the stars must not select, play or start dragging the row
	for (const type of ["click", "dblclick", "pointerdown"]) cell.addEventListener(type, (e) => e.stopPropagation());
	cell.addEventListener("mousedown", (e) => {
		e.stopPropagation();
		e.preventDefault();
	});
	return cell;
};

/** Header cell cloned from a plain (non-sortable) column so it looks like TIDAL's */
const createHeader = (header: HTMLElement) => {
	const columns = [...header.querySelectorAll<HTMLElement>(':scope > [role="columnheader"]')];
	const source = columns.reverse().find((column) => !column.querySelector('[class*="Sortable"]')) ?? columns[0];
	if (source === undefined) return undefined;
	const cell = source.cloneNode(true) as HTMLElement;
	cell.className = HEADER;
	cell.removeAttribute("tabindex");
	const label = document.createElement("span");
	label.textContent = "Rating";
	const inner = cell.querySelector<HTMLElement>('[class*="_headerColumn_"]');
	if (inner) inner.replaceChildren(label);
	else cell.replaceChildren(label);
	const style = getComputedStyle(source);
	cell.style.display = style.display;
	cell.style.alignItems = style.alignItems;
	return cell;
};

/** Tables can't use flex bases: the column hides once artist or the buttons get cut off, and returns only when the table is wider than at that moment */
type TableState = { hidden: boolean; hideBelow: number };
const tableStates = new WeakMap<HTMLTableElement, TableState>();
const tables = new Set<HTMLTableElement>();
let tableResize: ResizeObserver | undefined;

const squeezed = (table: HTMLTableElement) => {
	for (const cell of table.querySelectorAll<HTMLElement>('td[class*="_artistColumn_"], td[class*="_buttonColumn_"]')) {
		const inner = cell.firstElementChild;
		const target = inner instanceof HTMLElement && getComputedStyle(inner).display !== "inline" ? inner : cell;
		if (target.scrollWidth > target.clientWidth + 1 || target.scrollHeight > target.clientHeight + 1) return true;
	}
	return false;
};

const setTableHidden = (table: HTMLTableElement, hidden: boolean) =>
	table.querySelectorAll(`.${CELL}, .${HEADER}`).forEach((element) => element.toggleAttribute(HIDDEN, hidden));

const fitTable = (table: HTMLTableElement) => {
	let state = tableStates.get(table);
	if (state === undefined) tableStates.set(table, (state = { hidden: false, hideBelow: 0 }));
	const width = table.clientWidth;
	if (state.hidden && width >= state.hideBelow) state.hidden = false;
	setTableHidden(table, state.hidden);
	if (!state.hidden && squeezed(table)) {
		state.hidden = true;
		state.hideBelow = width + 1;
		setTableHidden(table, true);
	}
};

const tableTrackId = (row: HTMLElement) => {
	for (const element of row.querySelectorAll<HTMLElement>('[data-test^="image-container-track-"], [data-test^="tracklist-id-"]')) {
		const match = /\d+/.exec(element.dataset.test ?? "");
		if (match) return match[0];
	}
	return undefined;
};

/** Header cell for the table: a copy of TIDAL's TIME header with a new label */
const createTableHeader = (headerRow: HTMLTableRowElement) => {
	const source = headerRow.querySelector<HTMLElement>(':scope > th[class*="_timeColumn_"]') ?? [...headerRow.querySelectorAll<HTMLElement>(":scope > th")].find((th) => th.textContent?.trim());
	const cell = document.createElement("th");
	cell.className = HEADER;
	const label = source?.firstElementChild?.cloneNode(false) as HTMLElement | undefined;
	if (label) {
		label.textContent = "RATING";
		cell.appendChild(label);
	} else cell.textContent = "RATING";
	return cell;
};

const syncTables = () => {
	const changed = new Set<HTMLTableElement>();
	for (const row of document.querySelectorAll<HTMLElement>(TABLE_ROW_SELECTOR)) {
		const trackId = tableTrackId(row);
		const table = row.closest("table");
		if (trackId === undefined || table === null) continue;
		let cell = row.querySelector<HTMLElement>(`:scope > .${CELL}`);
		if (cell === null) {
			cell = createCell("td");
			row.insertBefore(cell, row.querySelector(':scope > td[class*="_buttonColumn_"]') ?? row.lastElementChild);
			changed.add(table);
		}
		if (cell.dataset.trackId !== trackId) {
			cell.dataset.trackId = trackId;
			paintCell(cell);
		}
	}
	for (const table of changed) {
		const headerRow = table.querySelector<HTMLTableRowElement>("thead tr");
		if (headerRow && !headerRow.querySelector(`:scope > .${HEADER}`)) headerRow.insertBefore(createTableHeader(headerRow), headerRow.lastElementChild);
		if (!tables.has(table)) {
			tables.add(table);
			tableResize?.observe(table);
		}
		fitTable(table);
	}
	for (const table of tables) if (!table.isConnected) {
		tables.delete(table);
		tableResize?.unobserve(table);
	}
};

/** Adds missing cells and updates rows the virtual list reused for another song */
const sync = () => {
	syncTables();
	for (const header of document.querySelectorAll<HTMLElement>(HEADER_SELECTOR)) {
		if (header.querySelector(`:scope > .${HEADER}`)) continue;
		const cell = createHeader(header);
		if (cell === undefined) continue;
		header.insertBefore(cell, header.querySelector(CONTEXT_SELECTOR));
		fit(cell);
	}
	for (const row of document.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
		const trackId = row.dataset.trackId;
		let cell = row.querySelector<HTMLElement>(`:scope > .${CELL}`);
		if (!trackId) {
			cell?.remove();
			continue;
		}
		if (cell === null) {
			cell = createCell();
			row.insertBefore(cell, row.querySelector(CONTEXT_SELECTOR));
			fit(cell);
		}
		if (cell.dataset.trackId !== trackId) {
			cell.dataset.trackId = trackId;
			paintCell(cell);
		}
	}
};

/** A "Rating" column in track tables (playlists, albums, favourites…) with clickable half-star ratings */
export const setupRatingColumn = (unloads: LunaUnloads) => {
	// Show / hide again whenever the table width changes (window, sidebar); one row stands in for its table
	let resizeFrame = 0;
	const resizeObserver = new ResizeObserver(() => {
		resizeFrame ||= requestAnimationFrame(() => {
			resizeFrame = 0;
			document.querySelectorAll<HTMLElement>(`.${CELL}, .${HEADER}`).forEach(fit);
		});
	});
	let tableFrame = 0;
	tableResize = new ResizeObserver(() => {
		tableFrame ||= requestAnimationFrame(() => {
			tableFrame = 0;
			tables.forEach(fitTable);
		});
	});
	let watched: Element | null = null;
	const watch = () => {
		if (watched?.isConnected) return;
		if (watched) resizeObserver.unobserve(watched);
		watched = document.querySelector(ROW_SELECTOR);
		if (watched) resizeObserver.observe(watched);
	};

	let frame = 0;
	const observer = new MutationObserver(() => {
		frame ||= requestAnimationFrame(() => {
			frame = 0;
			sync();
			watch();
		});
	});
	observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-track-id"] });
	const repaint = () => document.querySelectorAll<HTMLElement>(`.${CELL}`).forEach(paintCell);
	ratingListeners.add(repaint);
	sync();
	watch();
	unloads.add(() => {
		observer.disconnect();
		resizeObserver.disconnect();
		tableResize?.disconnect();
		tableResize = undefined;
		tables.clear();
		cancelAnimationFrame(tableFrame);
		cancelAnimationFrame(frame);
		cancelAnimationFrame(resizeFrame);
		ratingListeners.delete(repaint);
		document.querySelectorAll(`.${CELL}, .${HEADER}`).forEach((element) => element.remove());
	});
};
