import { ReactiveStore } from "@luna/core";

export type RatingPlaylist = { uuid: string; title: string };
type Store = {
	/** Rating ("0.5" … "5") → its playlist */
	playlists: Record<string, RatingPlaylist | undefined>;
	/** Rating mode plays songs in random order */
	rateShuffle: boolean;
	/** Rating mode starts each song at this percentage of its length */
	rateStartAt: number;
	/** Rating mode as a higher / lower game against songs you already rated */
	rateGame: boolean;
	/** Replaced track id → current id */
	aliases: Record<string, string>;
};

/** One playlist per rating, kept until changed in the plugin settings */
export const settings = await ReactiveStore.getPluginStorage<Store>("Comité", { playlists: {}, rateShuffle: true, rateStartAt: 0, rateGame: false, aliases: {} });

/** Half-star steps from 0.5 to 5 */
export const RATINGS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] as const;

/** e.g. 3.5 → "★★★½" */
export const stars = (rating: number) => (rating < 1 ? "½★" : "★".repeat(Math.floor(rating)) + (rating % 1 ? "½" : ""));

export const getRatingPlaylist = (rating: number) => settings.playlists[String(rating)];

/**
 * The stored entries are reactive proxies, which IndexedDB can't save. Copying them into the new object made every
 * save after the first one fail silently, so always build plain objects.
 */
const plainPlaylists = () => {
	const result: Record<string, RatingPlaylist> = {};
	for (const [key, value] of Object.entries(settings.playlists ?? {})) {
		if (value?.uuid) result[key] = { uuid: String(value.uuid), title: String(value.title) };
	}
	return result;
};

/** The song's current id */
export const canonicalId = (trackId: string) => {
	let id = trackId;
	for (let step = 0; step < 5; step++) {
		const next = settings.aliases?.[id];
		if (next === undefined || next === id) break;
		id = String(next);
	}
	return id;
};

/** The song's current id and all its old ones */
export const idsOfSong = (trackId: string) => {
	const id = canonicalId(trackId);
	const ids = new Set([id, trackId]);
	for (const [old, current] of Object.entries(settings.aliases ?? {})) if (canonicalId(String(current)) === id) ids.add(old);
	return [...ids];
};

const MAX_ALIASES = 5000;

/** Links `oldId` to `newId`; false if already linked */
export const linkTrackIds = (oldId: string, newId: string) => {
	if (oldId === newId || canonicalId(oldId) === canonicalId(newId)) return false;
	const aliases: Record<string, string> = {};
	for (const [key, value] of Object.entries(settings.aliases ?? {})) aliases[key] = String(value);
	aliases[oldId] = newId;
	const keys = Object.keys(aliases);
	for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ALIASES))) delete aliases[key];
	settings.aliases = aliases;
	return true;
};

export const setRatingPlaylist = (rating: number, playlist: RatingPlaylist | undefined) => {
	const playlists = plainPlaylists();
	if (playlist === undefined) delete playlists[String(rating)];
	else playlists[String(rating)] = { uuid: String(playlist.uuid), title: String(playlist.title) };
	settings.playlists = playlists;
};
