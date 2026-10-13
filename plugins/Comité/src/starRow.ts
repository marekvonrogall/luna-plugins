import { stars } from "./store";

/** Look is set per place through CSS variables (size, gap, colours) */
export const STAR_ROW_CSS = `
.comite-starrow { display: inline-flex; gap: var(--star-gap, 5px); }
.comite-starbtn { position: relative; padding: 0; margin: 0; border: none; background: none; color: inherit; font-size: var(--star-size, 18px); line-height: 1; cursor: pointer; transition: transform 0.12s; }
.comite-starbtn:disabled { cursor: progress; }
.comite-star-base { color: var(--star-dim-color, currentColor); opacity: var(--star-dim-opacity, 0.45); }
.comite-star-fill { position: absolute; top: 0; left: 0; width: 0; overflow: hidden; white-space: nowrap; color: var(--star-color, currentColor); pointer-events: none; }
`;

export interface StarRow {
	element: HTMLElement;
	setValue(value: number): void;
	setDisabled(disabled: boolean): void;
	/** While false, hovering doesn't preview (e.g. keep the just-rated stars visible) */
	setInteractive(interactive: boolean): void;
}

/**
 * Five stars with half steps: the left half of a star gives x.5, the right half x.
 * `baseGlyph` is the empty star (outline in the player bar, a dim full star in rating mode).
 */
export const createStarRow = (onRate: (value: number) => void, baseGlyph = "☆"): StarRow => {
	const row = document.createElement("div");
	row.className = "comite-starrow";
	const buttons = [1, 2, 3, 4, 5].map((index) => {
		const button = document.createElement("button");
		button.className = "comite-starbtn";
		button.dataset.index = String(index);
		const base = document.createElement("span");
		base.className = "comite-star-base";
		base.textContent = baseGlyph;
		const fill = document.createElement("span");
		fill.className = "comite-star-fill";
		fill.textContent = "★";
		button.append(base, fill);
		row.appendChild(button);
		return { button, fill, index };
	});

	let value = 0;
	let preview: number | undefined;
	let disabled = false;
	let interactive = true;

	const valueAt = (e: MouseEvent) => {
		const button = (e.target as Element | null)?.closest<HTMLElement>(".comite-starbtn");
		if (!button || !row.contains(button)) return undefined;
		const index = Number(button.dataset.index);
		const rect = button.getBoundingClientRect();
		return e.clientX - rect.left < rect.width / 2 ? index - 0.5 : index;
	};

	const paint = () => {
		const shown = preview ?? value;
		for (const { button, fill, index } of buttons) {
			const percent = shown >= index ? 100 : shown >= index - 0.5 ? 50 : 0;
			fill.style.width = `${percent}%`;
			button.dataset.fill = String(percent);
		}
		row.title = preview !== undefined ? `${stars(preview)} (${preview})` : value > 0 ? `Rated ${stars(value)} (${value})` : "";
	};

	row.addEventListener("mousemove", (e) => {
		if (disabled || !interactive) return;
		const next = valueAt(e);
		if (next !== preview) {
			preview = next;
			paint();
		}
	});
	row.addEventListener("mouseleave", () => {
		preview = undefined;
		paint();
	});
	row.addEventListener("click", (e) => {
		if (disabled) return;
		const clicked = valueAt(e);
		if (clicked !== undefined) onRate(clicked);
	});
	paint();

	return {
		element: row,
		setValue(next) {
			value = next;
			paint();
		},
		setDisabled(next) {
			disabled = next;
			for (const { button } of buttons) button.disabled = next;
			if (next) preview = undefined;
			paint();
		},
		setInteractive(next) {
			interactive = next;
			if (!next) preview = undefined;
			paint();
		},
	};
};
