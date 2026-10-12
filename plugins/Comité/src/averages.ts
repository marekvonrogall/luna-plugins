import { redux } from "@luna/lib";

import { fetchPlaylistPage } from "../../../shared/playlistItems";
import { getTrackMeta, ratedTracks, ratingsVersion } from "./ratings";

/** Playlists show an average once this share of their songs is rated */
const PLAYLIST_MIN_COVERAGE = 0.75;
/** Playlists with this many songs or more are only averaged on request (shift-click) */
const MAX_PLAYLIST_SIZE = 500;
/** Artists show an average once this many of their songs are rated */
const ARTIST_MIN_RATED = 10;
/** Playlists without a lastUpdated stamp are re-read after this long */
const PLAYLIST_MAX_AGE = 10 * 60 * 1000;

export type AverageResult =
	| { kind: "average"; value: number; rated: number; total?: number }
	| { kind: "incomplete"; rated: number; total: number }
	| { kind: "unrated" }
	| { kind: "too-big"; total: number };

/** Ratings grouped by album and artist, rebuilt only when ratings changed */
let indexed = -1;
let all = new Map<string, number>();
let byAlbum = new Map<string, number[]>();
let byArtist = new Map<string, number[]>();
const index = () => {
	if (indexed === ratingsVersion()) return;
	indexed = ratingsVersion();
	all = ratedTracks();
	byAlbum = new Map();
	byArtist = new Map();
	const push = (map: Map<string, number[]>, key: string, rating: number) => {
		const list = map.get(key);
		if (list) list.push(rating);
		else map.set(key, [rating]);
	};
	for (const [trackId, rating] of all) {
		const meta = getTrackMeta(trackId);
		if (meta === undefined) continue;
		if (meta.album !== undefined) push(byAlbum, meta.album, rating);
		for (const artist of new Set(meta.artists)) push(byArtist, artist, rating);
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

/** Free: 10 rated songs (or a shift-click) are enough */
export const artistAverage = (artistId: string, force = false): AverageResult => {
	index();
	const ratings = byArtist.get(artistId);
	if (ratings === undefined) return { kind: "unrated" };
	if (force || ratings.length >= ARTIST_MIN_RATED) return average(ratings);
	return { kind: "incomplete", rated: ratings.length, total: ARTIST_MIN_RATED };
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

/** Reads pages until the playlist is complete, turns out hopeless, or (without force) too big */
const fill = async (uuid: string, entry: PlaylistEntry, force: boolean) => {
	while (!entry.complete) {
		if (!force && entry.total >= 0 && (entry.total >= MAX_PLAYLIST_SIZE || hopeless(entry))) return;
		const page = await limited(() => fetchPlaylistPage(uuid, entry.ids.length));
		entry.total = page.total;
		entry.ids.push(...page.items.map(({ item }) => String(item.id)));
		if (page.items.length === 0 || entry.ids.length >= entry.total) entry.complete = true;
	}
};

/**
 * Playlists under 500 songs with 75% rated. Reading stops early once 75% is out of reach,
 * and continues from there later if more songs got rated. `force` (shift-click) reads everything and skips both rules.
 */
export const playlistAverage = async (uuid: string, force = false): Promise<AverageResult> => {
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
	const queued = (queues.get(uuid) ?? Promise.resolve()).then(() => fill(uuid, current, force));
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
