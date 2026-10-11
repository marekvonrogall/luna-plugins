import { addTrack, getPlaylistTrackIds, refreshPlaylistView, removeTrack } from "./api";
import { trace } from "./core";
import { getRatingPlaylist, RATINGS } from "./store";

/** Track ids per rating, read from the rating playlists */
const cache = new Map<number, Set<string>>();
const MAX_AGE = 5 * 60 * 1000;
let loadedAt = 0;
let loading: Promise<void> | undefined;

/** Called whenever the cached ratings changed, so the stars can re-render */
export const ratingListeners = new Set<() => void>();
const notify = () => ratingListeners.forEach((listener) => listener());

export const loadRating = async (rating: number) => {
	const playlist = getRatingPlaylist(rating);
	if (playlist === undefined) cache.delete(rating);
	else cache.set(rating, await getPlaylistTrackIds(playlist.uuid));
	notify();
};

/** Reloads all rating playlists (one run at a time) */
export const refreshRatings = () =>
	(loading ??= Promise.all(RATINGS.map((rating) => loadRating(rating).catch(trace.warn.withContext(`Failed to load the ${rating}★ playlist`))))
		.then(() => {
			loadedAt = Date.now();
		})
		.finally(() => {
			loading = undefined;
		}));

/** Reloads in the background if the cache is older than a few minutes, e.g. after changes on another device */
export const refreshRatingsIfStale = () => {
	if (Date.now() - loadedAt > MAX_AGE) refreshRatings();
};

/** Highest rating whose playlist contains the track, 0 if none */
export const ratingOf = (trackId: string) => {
	for (let rating = 5; rating >= 1; rating--) if (cache.get(rating)?.has(trackId)) return rating;
	return 0;
};

/** Puts the track into the playlist of `rating` and removes it from the other rating playlists (0 = unrated) */
export const applyRating = async (trackId: string, rating: number) => {
	const target = rating === 0 ? undefined : getRatingPlaylist(rating);
	if (target !== undefined) {
		await addTrack(target.uuid, trackId);
		if (!cache.has(rating)) cache.set(rating, new Set());
		cache.get(rating)!.add(trackId);
		refreshPlaylistView(target.uuid);
	}
	for (const other of RATINGS) {
		if (other === rating || !cache.get(other)?.has(trackId)) continue;
		const playlist = getRatingPlaylist(other);
		// Same playlist used for two ratings: don't remove what was just added
		if (playlist === undefined || playlist.uuid === target?.uuid) continue;
		await removeTrack(playlist.uuid, trackId);
		cache.get(other)!.delete(trackId);
		refreshPlaylistView(playlist.uuid);
	}
	notify();
};
