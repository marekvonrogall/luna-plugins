import { redux, TidalApi } from "@luna/lib";

/** The mobile app's "My Activity" service */
const API = "https://api.tidal.com/v2/my-activity";

export interface Timeline {
	month: number;
	year: number;
	title?: string;
}

export interface MonetaryInfo {
	amount: number;
	currency: string;
	text?: string | null;
}

export interface ActivityArtist {
	id: number;
	name: string;
	picture?: string | null;
	/** Album cover TIDAL shows instead of a missing picture */
	selectedAlbumCoverFallback?: string | null;
}

export interface StreamedArtist {
	artist: ActivityArtist;
	nrOfStreams: number;
	royalty?: MonetaryInfo | null;
}

export interface ActivityImage {
	id?: string;
	url: string;
	orientation?: string | null;
}

export interface Activity {
	activityType?: string;
	title?: string | null;
	subtitle?: string | null;
	header?: string | null;
	images?: ActivityImage[] | null;
	month?: number | null;
	year?: number | null;
	nrOfDaysLeft?: number;
}

export interface Note {
	text?: string | null;
	subtitle?: string | null;
	url?: string | null;
}

export interface TopArtists {
	activity?: Activity | null;
	artists?: StreamedArtist[] | null;
	directArtistPayout?: (Note & { artistName?: string | null; payout?: MonetaryInfo | null }) | null;
	disclaimers?: Note[] | null;
	fanCenteredRoyalties?: Note | null;
	metadata?: { timeline?: Timeline[] | null } | null;
	totalNrOfStreams?: number | null;
}

export class HttpError extends Error {
	constructor(public readonly status: number, statusText: string) {
		super(`${status} ${statusText}`);
	}
}

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/** e.g. 2026-10-21T16:21:00.000+02:00; the server derives "this month" from it */
const zonedNow = () => {
	const now = new Date();
	const offset = -now.getTimezoneOffset();
	const sign = offset >= 0 ? "+" : "-";
	const abs = Math.abs(offset);
	return (
		`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
		`T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}` +
		`${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
	);
};

/** "en" from "en_US", "de-DE", … */
const language = () => {
	const setting = (redux.store.getState().settings as { language?: string } | undefined)?.language ?? navigator.language;
	return (setting || "en").split(/[_-]/)[0];
};

const request = async (url: string, retries = 2): Promise<Response> => {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, { cache: "no-store", headers: await TidalApi.getAuthHeaders() });
		if (res.ok) return res;
		if (attempt < retries && (res.status === 429 || res.status >= 500)) {
			const retryAfter = Number(res.headers.get("retry-after"));
			await new Promise((r) => setTimeout(r, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * (attempt + 1)));
			continue;
		}
		return res;
	}
};

/** Includes the server's message, if any */
const failed = async (res: Response) => {
	let detail = "";
	try {
		const body = (await res.json()) as { userMessage?: string; message?: string; errors?: { detail?: string }[] };
		detail = body.userMessage ?? body.message ?? body.errors?.[0]?.detail ?? "";
	} catch {
		/* no JSON body */
	}
	return new HttpError(res.status, detail ? `${res.statusText}: ${detail}` : res.statusText);
};

const get = async <T>(path: string, extra: Record<string, string> = {}): Promise<T> => {
	const params = new URLSearchParams({
		currentZonedDateTime: zonedNow(),
		locale: language(),
		countryCode: redux.store.getState().session?.countryCode ?? "US",
		...extra,
	});
	const res = await request(`${API}/${path}?${params}`);
	if (!res.ok) throw await failed(res);
	return (await res.json()) as T;
};

/** Past months are final; the running month and the timeline are refetched after a while */
const FRESH_FOR = 5 * 60_000;
const cache = new Map<string, { at: number; promise: Promise<unknown> }>();

const cached = <T>(key: string, stale: boolean, force: boolean, load: () => Promise<T>): Promise<T> => {
	const entry = cache.get(key);
	if (!force && entry !== undefined && !(stale && Date.now() - entry.at >= FRESH_FOR)) return entry.promise as Promise<T>;
	const promise = load();
	cache.set(key, { at: Date.now(), promise });
	promise.catch(() => cache.get(key)?.promise === promise && cache.delete(key));
	return promise;
};

export const isRunningMonth = (month: Timeline) => {
	const now = new Date();
	return month.year === now.getFullYear() && month.month === now.getMonth() + 1;
};

/** Months with activity, newest first (the current month if none) */
export const getTimeline = (force = false) =>
	cached("timeline", true, force, async () => {
		const { timeline } = await get<{ timeline?: Timeline[] | null }>("timeline");
		const months = [...(timeline ?? [])].sort((a, b) => b.year - a.year || b.month - a.month);
		if (months.length > 0) return months;
		const now = new Date();
		return [{ month: now.getMonth() + 1, year: now.getFullYear() }];
	});

/** Months count from 1 */
export const getTopArtists = (month: Timeline, force = false) =>
	cached(`${month.year}-${month.month}`, isRunningMonth(month), force, () =>
		get<TopArtists>("top-artists", { month: String(month.month), year: String(month.year) }),
	);

const imageUrl = (uuid: string, size: number) => `https://resources.tidal.com/images/${uuid.split("-").join("/")}/${size}x${size}.jpg`;

/** Picture, else TIDAL's album cover fallback */
export const artistImage = (artist: Pick<ActivityArtist, "picture" | "selectedAlbumCoverFallback"> | null | undefined, large = false) => {
	if (artist?.picture) return imageUrl(artist.picture, large ? 750 : 320);
	if (artist?.selectedAlbumCoverFallback) return imageUrl(artist.selectedAlbumCoverFallback, large ? 640 : 320);
	return undefined;
};

/** For artists listed without either */
export const lookUpArtistImage = async (id: number) => {
	const stored = redux.store.getState().content?.artists?.[id] as ActivityArtist | undefined;
	if (stored?.picture || stored?.selectedAlbumCoverFallback) return artistImage(stored);
	return artistImage((await TidalApi.artist(id)) as ActivityArtist | undefined);
};
