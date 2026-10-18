// Runs in the main process to avoid CORS. Uses Electron's net with browser headers, since Google rate-limits plain Node requests.
import { net } from "electron";

const HEADERS = {
	"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
	Accept: "*/*",
	"Accept-Language": "en-US,en;q=0.9",
};
const MAX_URL = 7000;

type Result = { text: string; source?: string };

const request = (url: string, body?: string) => {
	const doFetch = typeof net?.fetch === "function" ? net.fetch.bind(net) : fetch;
	return doFetch(url, {
		method: body === undefined ? "GET" : "POST",
		headers: body === undefined ? HEADERS : { ...HEADERS, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
		body,
	});
};

// [[["translated", "original", …], …], null, "detected language", …]
const googleapis = async (text: string, target: string): Promise<Result> => {
	const base = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t`;
	const url = `${base}&q=${encodeURIComponent(text)}`;
	const res = url.length <= MAX_URL ? await request(url) : await request(base, new URLSearchParams({ q: text }).toString());
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const data = (await res.json()) as unknown[];
	const segments = Array.isArray(data?.[0]) ? (data[0] as unknown[][]) : [];
	return {
		text: segments.map((segment) => (typeof segment?.[0] === "string" ? segment[0] : "")).join(""),
		source: typeof data?.[2] === "string" ? data[2] : undefined,
	};
};

// [["translated", "detected language"]] or ["translated"]
const chromeExtension = async (text: string, target: string): Promise<Result> => {
	const base = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(target)}`;
	const url = `${base}&q=${encodeURIComponent(text)}`;
	const res = url.length <= MAX_URL ? await request(url) : await request(base, new URLSearchParams({ q: text }).toString());
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const data = (await res.json()) as unknown;
	const first = Array.isArray(data) ? data[0] : undefined;
	if (typeof first === "string") return { text: first };
	if (Array.isArray(first) && typeof first[0] === "string") return { text: first[0], source: typeof first[1] === "string" ? first[1] : undefined };
	throw new Error("Unexpected answer");
};

// [["translated", "uk"], ["translated", "fr"], …]
const parseEach = (data: unknown, count: number): Result[] => {
	const item = (value: unknown): Result | undefined => {
		if (typeof value === "string") return { text: value };
		if (Array.isArray(value) && typeof value[0] === "string") return { text: value[0], source: typeof value[1] === "string" ? value[1] : undefined };
		return undefined;
	};
	// A single line may come back unwrapped
	if (count === 1 && (typeof data === "string" || (Array.isArray(data) && typeof data[0] === "string"))) {
		const single = item(data);
		if (single !== undefined) return [single];
	}
	if (!Array.isArray(data) || data.length !== count) throw new Error("Unexpected answer");
	const results = data.map(item);
	if (results.some((result) => result === undefined)) throw new Error("Unexpected answer");
	return results as Result[];
};

const eachEndpoint = (base: string) => async (lines: string[], target: string): Promise<Result[]> => {
	const query = new URLSearchParams();
	for (const line of lines) query.append("q", line);
	const res = await request(`${base}&sl=auto&tl=${encodeURIComponent(target)}`, query.toString());
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return parseEach(await res.json(), lines.length);
};

/** Translates each line separately (with its own detected language) in one request */
export const googleTranslateEach = async (lines: string[], target: string): Promise<Result[]> => {
	if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(target)) throw new Error(`Invalid target language "${target}"`);
	const errors: string[] = [];
	for (const [name, endpoint] of [
		["translate.googleapis.com", eachEndpoint("https://translate.googleapis.com/translate_a/t?client=gtx")],
		["clients5.google.com", eachEndpoint("https://clients5.google.com/translate_a/t?client=dict-chrome-ex")],
	] as const) {
		try {
			return await endpoint(lines, target);
		} catch (err) {
			errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	throw new Error(`Google refused the translation (${errors.join(", ")})`);
};

/** Translates the text as a whole (one detected language) */
export const googleTranslate = async (text: string, target: string): Promise<Result> => {
	if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(target)) throw new Error(`Invalid target language "${target}"`);
	const errors: string[] = [];
	for (const [name, endpoint] of [
		["translate.googleapis.com", googleapis],
		["clients5.google.com", chromeExtension],
	] as const) {
		try {
			return await endpoint(text, target);
		} catch (err) {
			errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	throw new Error(`Google refused the translation (${errors.join(", ")})`);
};
