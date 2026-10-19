import { redux } from "@luna/lib";

import { fetchPlaylistPage } from "../../../shared/playlistItems";
import { getArtistCatalog } from "./api";
import { getTrackMeta, ratedTracks, ratingsVersion } from "./ratings";

/** Playlists show an average once this share of their songs is rated */
const PLAYLIST_MIN_COVERAGE = 0.75;
/** Playlists with this many songs or more are only averaged on request (shift-click) */
const MAX_PLAYLIST_SIZE = 500;
/** Playlists without a lastUpdated stamp are re-read after this long */
const PLAYLIST_MAX_AGE = 10 * 60 * 1000;

export type AverageResult =
	| {
			kind: "average";
			value: number;
			rated: number;
			total?: number;
			/** Artists: average of the songs by this artist alone (no other credited artist) */
			solo?: { value: number; rated: number };
			/** Artists: rated songs this artist made together with others */
			collabRated?: number;
	  }
	| { kind: "incomplete"; rated: number; total: number }
	| { kind: "unrated" }
	| { kind: "too-big"; total: number };

/** Ratings grouped by album and artist, rebuilt only when ratings changed */
let indexed = -1;
let all = new Map<string, number>();
let byAlbum = new Map<string, number[]>();
let byArtist = new Map<string, number[]>();
let byArtistSolo = new Map<string, number[]>();
const index = () => {
	if (indexed === ratingsVersion()) return;
	indexed = ratingsVersion();
	all = ratedTracks();
	byAlbum = new Map();
	byArtist = new Map();
	byArtistSolo = new Map();
	const push = (map: Map<string, number[]>, key: string, rating: number) => {
		const list = map.get(key);
		if (list) list.push(rating);
		else map.set(key, [rating]);
	};
	for (const [trackId, rating] of all) {
		const meta = getTrackMeta(trackId);
		if (meta === undefined) continue;
		if (meta.album !== undefined) push(byAlbum, meta.album, rating);
		const artists = new Set(meta.artists);
		for (const artist of artists) push(byArtist, artist, rating);
		if (artists.size === 1) push(byArtistSolo, [...artists][0], rating);
	}
};

const average = (ratings: number[], total?: number): AverageResult => ({
	kind: "average",
	value: ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length,
	rated: ratings.length,
	total,
});

/** Free: any rated song on the album is enough, and the song count (for the tooltip) comes from TIDAL's store if it's there */
export const albumAverage = (albumId: string): AverageResult => {
	index();
	const ratings = byAlbum.get(albumId);
	if (ratings === undefined) return { kind: "unrated" };
	const total = redux.store.getState().content.albums[albumId]?.numberOfTracks;
	return average(ratings, typeof total === "number" ? total : undefined);
};

/** Free: any rated song by the artist is enough */
export const artistAverage = (artistId: string): AverageResult => {
	index();
	const ratings = byArtist.get(artistId);
	if (ratings === undefined) return { kind: "unrated" };
	const solo = byArtistSolo.get(artistId);
	return {
		...(average(ratings) as Extract<AverageResult, { kind: "average" }>),
		solo: solo === undefined ? undefined : { value: solo.reduce((sum, rating) => sum + rating, 0) / solo.length, rated: solo.length },
		collabRated: ratings.length - (solo?.length ?? 0),
	};
};

/** Share of an artist's catalogue that is rated */
export type CatalogShare = { rated: number; total: number };

/** Artist catalogues (2 requests each), loaded once per session */
const catalogs = new Map<string, { loading: Promise<void>; albumIds?: Set<string>; total?: number }>();

const catalogShare = (albumIds: Set<string>, total: number): CatalogShare | undefined => {
	if (total <= 0) return undefined;
	index();
	let rated = 0;
	for (const albumId of albumIds) rated += byAlbum.get(albumId)?.length ?? 0;
	return { rated: Math.min(rated, total), total };
};

/** Without a request: the share if the artist's catalogue is already loaded */
export const artistCatalogShareIfLoaded = (artistId: string): CatalogShare | undefined => {
	const catalog = catalogs.get(artistId);
	return catalog?.albumIds === undefined || catalog.total === undefined ? undefined : catalogShare(catalog.albumIds, catalog.total);
};

/** Songs on the artist's own albums, EPs and singles that are rated (2 requests the first time per artist) */
export const artistCatalogShare = async (artistId: string): Promise<CatalogShare | undefined> => {
	let catalog = catalogs.get(artistId);
	if (catalog === undefined) {
		const entry: { loading: Promise<void>; albumIds?: Set<string>; total?: number } = { loading: Promise.resolve() };
		entry.loading = limited(() => getArtistCatalog(artistId)).then(({ albumIds, totalTracks }) => {
			entry.albumIds = albumIds;
			entry.total = totalTracks;
		});
		// Try again next time if it failed
		entry.loading.catch(() => catalogs.delete(artistId));
		catalogs.set(artistId, entry);
		catalog = entry;
	}
	await catalog.loading;
	return artistCatalogShareIfLoaded(artistId);
};

/** At most two page requests at a time, so a page full of covers can't trigger rate limiting */
let running = 0;
const waiting: (() => void)[] = [];
const limited = async <T>(task: () => Promise<T>): Promise<T> => {
	while (running >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
	running++;
	try {
		return await task();
	} finally {
		running--;
		waiting.shift()?.();
	}
};

/** Song ids read so far (in playlist order); a playlist is only read as far as needed */
type PlaylistEntry = { stamp: string; at: number; total: number; ids: string[]; complete: boolean };
const playlists = new Map<string, PlaylistEntry>();
/** One read per playlist at a time */
const queues = new Map<string, Promise<unknown>>();

const ratingsOf = (ids: string[]) => ids.map((id) => all.get(id)).filter((rating): rating is number => rating !== undefined);

/** Already so many unrated songs that 75% can't be reached even if all the rest is rated */
const hopeless = (entry: PlaylistEntry) => {
	index();
	const unrated = entry.ids.length - ratingsOf(entry.ids).length;
	return unrated > entry.total * (1 - PLAYLIST_MIN_COVERAGE);
};

/** Share of the playlist read so far (0-1), reported after every page request */
export type Progress = (fraction: number) => void;

/** Reads pages until the playlist is complete, turns out hopeless, or (without force) too big */
const fill = async (uuid: string, entry: PlaylistEntry, force: boolean, onProgress?: Progress) => {
	const report = () => onProgress?.(entry.total > 0 ? Math.min(1, entry.ids.length / entry.total) : 1);
	while (!entry.complete) {
		if (!force && entry.total >= 0 && (entry.total >= MAX_PLAYLIST_SIZE || hopeless(entry))) return;
		if (force && entry.total >= 0) return fillRest(uuid, entry, report);
		onProgress?.(0);
		const page = await limited(() => fetchPlaylistPage(uuid, entry.ids.length));
		entry.total = page.total;
		entry.ids.push(...page.items.map(({ item }) => String(item.id)));
		if (page.items.length === 0 || entry.ids.length >= entry.total) entry.complete = true;
		report();
	}
};

/** Shift-click on a big playlist: all remaining pages, two at a time */
const fillRest = async (uuid: string, entry: PlaylistEntry, report: () => void) => {
	const step = 100;
	const offsets: number[] = [];
	for (let offset = entry.ids.length; offset < entry.total; offset += step) offsets.push(offset);
	report();
	await Promise.all(
		offsets.map((offset) =>
			limited(() => fetchPlaylistPage(uuid, offset)).then((page) => {
				entry.ids.push(...page.items.map(({ item }) => String(item.id)));
				report();
			}),
		),
	);
	entry.complete = true;
};

/**
 * Playlists under 500 songs with 75% rated. Reading stops early once 75% is out of reach,
 * and continues from there later if more songs got rated. `force` (shift-click) reads everything and skips both rules.
 */
export const playlistAverage = async (uuid: string, force = false, onProgress?: Progress): Promise<AverageResult> => {
	const info = redux.store.getState().content.playlists[uuid];
	const stamp = info?.lastUpdated ?? "";
	let entry = playlists.get(uuid);
	if (entry === undefined || entry.stamp !== stamp || (stamp === "" && Date.now() - entry.at > PLAYLIST_MAX_AGE)) {
		// TIDAL already knows the size of playlists in your collection: no request for big ones
		if (!force && typeof info?.numberOfTracks === "number" && info.numberOfTracks >= MAX_PLAYLIST_SIZE) return { kind: "too-big", total: info.numberOfTracks };
		entry = { stamp, at: Date.now(), total: -1, ids: [], complete: false };
		playlists.set(uuid, entry);
	}
	const current = entry;
	const queued = (queues.get(uuid) ?? Promise.resolve()).then(() => fill(uuid, current, force, onProgress));
	queues.set(
		uuid,
		queued.catch(() => {}),
	);
	await queued;

	index();
	const ratings = ratingsOf(current.ids);
	if (!force && current.total >= MAX_PLAYLIST_SIZE) return { kind: "too-big", total: current.total };
	if (ratings.length === 0) return current.complete || force ? { kind: "unrated" } : { kind: "incomplete", rated: 0, total: current.total };
	if (force || (current.complete && ratings.length >= current.total * PLAYLIST_MIN_COVERAGE)) return average(ratings, current.total);
	return { kind: "incomplete", rated: ratings.length, total: current.total };
};
