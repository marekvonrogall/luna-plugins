import { normalizeCode, sameLanguage } from "./languages";
import { settings } from "./Settings";
import { googleTranslate, googleTranslateEach } from "./translate.native";

// Google's limit is ~5000 characters per request
const MAX_CHARS = 4500;
const MAX_SONGS = 300;
const RETRY_AFTER = 30_000;
// Pause after a rate limit: 1 minute, doubling up to 15
const PAUSE_MIN = 60_000;
const PAUSE_MAX = 15 * 60_000;
let pausedUntil = 0;
let pause = PAUSE_MIN;
const isRateLimit = (err: unknown) => /\b(429|403)\b/.test(err instanceof Error ? err.message : String(err));

export type LineTranslation = { text: string; source?: string };

export type SongTranslation = {
	/** Main language of the song */
	source?: string;
	lines: Map<string, LineTranslation>;
	pending?: Promise<void>;
	failedAt?: number;
};

const songs = new Map<string, SongTranslation>();

export const isSkipped = (source: string) =>
	sameLanguage(source, settings.targetLanguage) || settings.neverTranslate.some((code) => sameLanguage(code, source));

export const showLine = (song: SongTranslation, line: LineTranslation) => {
	const source = line.source ?? song.source;
	return source === undefined || !isSkipped(source);
};

/** Splits lines into requests below the character limit, never inside a line */
export const chunkLines = (lines: string[], maxChars = MAX_CHARS) => {
	const chunks: string[][] = [];
	let current: string[] = [];
	let length = 0;
	for (const line of lines) {
		if (current.length > 0 && length + 1 + line.length > maxChars) {
			chunks.push(current);
			current = [];
			length = 0;
		}
		length += (current.length > 0 ? 1 : 0) + line.length;
		current.push(line);
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
};

export type TranslateApi = {
	each: (lines: string[], target: string) => Promise<LineTranslation[]>;
	joined: (text: string, target: string) => Promise<LineTranslation>;
};
const google: TranslateApi = { each: googleTranslateEach, joined: googleTranslate };

// Fall back to the joined endpoint for the session once the per-line one fails
let eachUnsupported = false;

/** Translates the lines as one text; if the line count doesn't match, splits them in half and retries */
const translateJoined = async (lines: string[], target: string, api: TranslateApi): Promise<LineTranslation[]> => {
	const result = await api.joined(lines.join("\n"), target);
	const parts = result.text.split("\n");
	if (parts.length === lines.length) return parts.map((part) => ({ text: part.trim(), source: result.source }));
	if (lines.length === 1) return [{ text: result.text.replace(/\s*\n\s*/g, " ").trim(), source: result.source }];
	const middle = Math.ceil(lines.length / 2);
	return [...(await translateJoined(lines.slice(0, middle), target, api)), ...(await translateJoined(lines.slice(middle), target, api))];
};

export const translateLines = async (lines: string[], target: string, api: TranslateApi = google): Promise<LineTranslation[]> => {
	if (!eachUnsupported) {
		try {
			const results = await api.each(lines, target);
			if (results.length === lines.length) return results.map(({ text, source }) => ({ text: text.trim(), source }));
			eachUnsupported = true;
		} catch (err) {
			// No fallback request on rate limits
			if (isRateLimit(err)) throw err;
			eachUnsupported = true;
		}
	}
	return translateJoined(lines, target, api);
};

const mainLanguage = (song: SongTranslation) => {
	const counts = new Map<string, number>();
	for (const { source } of song.lines.values()) if (source !== undefined) counts.set(source, (counts.get(source) ?? 0) + 1);
	return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/** Returns the cached translation and translates missing lines in the background */
export const getSongTranslation = (lines: string[], onUpdate: () => void, onError: (err: unknown) => void, api: TranslateApi = google): SongTranslation => {
	const target = settings.targetLanguage;
	const key = `${target}\u0000${lines.join("\n")}`;
	let song = songs.get(key);
	if (song === undefined) {
		song = { lines: new Map() };
		songs.set(key, song);
		if (songs.size > MAX_SONGS) songs.delete(songs.keys().next().value!);
	}
	const missing = lines.filter((line) => !song.lines.has(line));
	const skipped = song.source !== undefined && isSkipped(song.source);
	const waiting = (song.failedAt !== undefined && Date.now() - song.failedAt < RETRY_AFTER) || Date.now() < pausedUntil;
	if (missing.length > 0 && !skipped && !waiting && song.pending === undefined) {
		const current = song;
		current.pending = (async () => {
			for (const chunk of chunkLines(missing)) {
				const translations = await translateLines(chunk, target, api);
				chunk.forEach((line, index) => {
					const { text, source } = translations[index];
					current.lines.set(line, { text, source: source === undefined ? undefined : normalizeCode(source) });
				});
				current.source = mainLanguage(current);
				onUpdate();
				// Stop if the song is entirely in a skipped language
				const all = [...current.lines.values()];
				if (all.length > 0 && all.every((line) => line.source !== undefined && isSkipped(line.source))) return;
			}
		})()
			.then(() => {
				current.failedAt = undefined;
				pause = PAUSE_MIN;
			})
			.catch((err) => {
				current.failedAt = Date.now();
				if (isRateLimit(err)) {
					pausedUntil = Date.now() + pause;
					pause = Math.min(pause * 2, PAUSE_MAX);
				}
				onError(err);
			})
			.finally(() => {
				current.pending = undefined;
				onUpdate();
			});
	}
	return song;
};
