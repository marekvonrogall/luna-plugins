import { languageName } from "./languages";
import type { LanguageSummary } from "./playlistLanguages";

const SVG = "http://www.w3.org/2000/svg";
const COLORS = ["#9882d4", "#feaad1", "#f2ed94", "#5acfd5", "#b57baf", "#86cdff", "#75b168", "#7797dd"];
const OTHER_COLOR = "#77767a";
const MAX_SLICES = COLORS.length;

export type Slice = { label: string; share: number; songs: number; color: string };

/** Largest languages get the colors in order; past eight, the rest is "Other" */
export const slicesOf = (summary: LanguageSummary): Slice[] => {
	const languages = summary.languages;
	const named = languages.length > MAX_SLICES ? languages.slice(0, MAX_SLICES - 1) : languages;
	const slices = named.map(({ code, share, songs }, index) => ({ label: languageName(code), share, songs, color: COLORS[index] }));
	const rest = languages.slice(named.length);
	if (rest.length > 0)
		slices.push({
			label: `Other (${rest.length})`,
			share: rest.reduce((sum, { share }) => sum + share, 0),
			songs: rest.reduce((sum, { songs }) => sum + songs, 0),
			color: OTHER_COLOR,
		});
	return slices;
};

export const percent = (share: number) => (share > 0 && share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`);

/** Donut ring segments; `gap` in degrees between slices */
export const donut = (slices: Slice[], size: number, thickness: number, gap: number) => {
	const svg = document.createElementNS(SVG, "svg");
	svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
	svg.setAttribute("width", String(size));
	svg.setAttribute("height", String(size));
	const radius = (size - thickness) / 2;
	const center = size / 2;
	const point = (angle: number) => {
		const rad = ((angle - 90) * Math.PI) / 180;
		return `${(center + radius * Math.cos(rad)).toFixed(2)} ${(center + radius * Math.sin(rad)).toFixed(2)}`;
	};
	let angle = 0;
	const paths = slices.map((slice) => {
		const sweep = slice.share * 360;
		const path = document.createElementNS(SVG, "path");
		path.setAttribute("fill", "none");
		path.setAttribute("stroke", slice.color);
		path.setAttribute("stroke-width", String(thickness));
		if (slices.length === 1 || sweep >= 359.9) {
			// A full ring can't be drawn as one arc
			path.setAttribute("d", `M ${point(0)} A ${radius} ${radius} 0 1 1 ${point(180)} A ${radius} ${radius} 0 1 1 ${point(360)}`);
		} else {
			const half = Math.min(gap / 2, sweep / 4);
			const start = angle + half;
			const end = angle + sweep - half;
			path.setAttribute("d", `M ${point(start)} A ${radius} ${radius} 0 ${end - start > 180 ? 1 : 0} 1 ${point(end)}`);
		}
		angle += sweep;
		svg.append(path);
		return path;
	});
	return { svg, paths };
};
