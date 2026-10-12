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

/**
 * Fixed width like BPM / Key. Shown only while every other column still gets its full width,
 * so artist and the heart column keep priority. Empty stars stay faint until the row is hovered.
 */
export const RATING_COLUMN_CSS = `
.${CELL}, .${HEADER} { flex: 0 0 ${WIDTH}px !important; padding-right: 16px !important; }
.${CELL} { display: flex; align-items: center; --star-size: 15px; --star-gap: 1px; --star-dim-opacity: 0.2; }
.${CELL}[${HIDDEN}], .${HEADER}[${HIDDEN}] { display: none !important; }
${ROW_SELECTOR}:is(:hover, :focus-within) .${CELL} { --star-dim-opacity: 0.5; }
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

const createCell = () => {
	const cell = document.createElement("div");
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

/** Adds missing cells and updates rows the virtual list reused for another song */
const sync = () => {
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
		cancelAnimationFrame(frame);
		cancelAnimationFrame(resizeFrame);
		ratingListeners.delete(repaint);
		document.querySelectorAll(`.${CELL}, .${HEADER}`).forEach((element) => element.remove());
	});
};
