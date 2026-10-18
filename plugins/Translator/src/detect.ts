import { detect, detectAll } from "tinyld/heavy";

import { normalizeCode } from "./languages";

/** Shorter lines are only matched against languages found in the song's longer lines */
const LONG_LINE = 15;
const UK_ONLY = /[іїєґ]/i;
const RU_ONLY = /[ыэъё]/i;

const letters = (text: string) => text.match(/\p{L}/gu)?.length ?? 0;

/** Lyrics as lines, without timestamps, section tags ("[Chorus]") and empty lines */
export const lyricsLines = (lyrics: string) =>
	lyrics
		.split(/\r?\n/)
		.map((line) => line.replace(/^\s*\[\d+:\d+(?:\.\d+)?\]/, "").replace(/^\s*\[[^\]]*\]\s*$/, "").trim())
		.filter((line) => letters(line) > 0);

/** Share of each language in the lyrics (0-1, by letters), e.g. { en: 0.47, uk: 0.38, fr: 0.15 } */
export const detectLanguages = (lyrics: string): Record<string, number> => {
	const lines = lyricsLines(lyrics);
	const text = lines.join("\n");
	// Ukrainian and Russian share most letters; the song's own letters tell them apart
	const fix = (code: string) => {
		const lang = normalizeCode(code);
		if (lang === "ru" && UK_ONLY.test(text) && !RU_ONLY.test(text)) return "uk";
		if (lang === "uk" && RU_ONLY.test(text) && !UK_ONLY.test(text)) return "ru";
		return lang;
	};

	const long = lines.map((line) => (letters(line) >= LONG_LINE ? fix(detect(line)) || undefined : undefined));
	const found = new Set(long.filter((lang): lang is string => lang !== undefined));
	const shares: Record<string, number> = {};
	let total = 0;
	lines.forEach((line, index) => {
		let lang = long[index];
		if (lang === undefined) {
			const candidates = detectAll(line).map(({ lang }) => fix(lang));
			lang = candidates.find((candidate) => found.has(candidate)) ?? candidates[0];
		}
		if (!lang) return;
		const weight = letters(line);
		shares[lang] = (shares[lang] ?? 0) + weight;
		total += weight;
	});
	for (const lang in shares) shares[lang] /= total;
	return shares;
};
