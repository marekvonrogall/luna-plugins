import { addTrack, getPlaylistInfo, getPlaylistTrackIds, getUserPlaylists, refreshPlaylistView, removeTrack } from "./api";
import { trace } from "./core";
import { getRatingPlaylist, RATINGS, setRatingPlaylist, stars, type RatingPlaylist } from "./store";

/** Track ids per rating, read from the rating playlists */
const cache = new Map<number, Set<string>>();
const MAX_AGE = 5 * 60 * 1000;
let loadedAt = 0;
let loading: Promise<void> | undefined;

/** Called whenever the cached ratings changed, so the stars can re-render */
export const ratingListeners = new Set<() => void>();
const notify = () => ratingListeners.forEach((listener) => listener());

/** Increases with every load per rating, so an older load that finishes late can't overwrite a newer one */
const loadVersions = new Map<number, number>();

export const loadRating = async (rating: number) => {
	const version = (loadVersions.get(rating) ?? 0) + 1;
	loadVersions.set(rating, version);
	const playlist = getRatingPlaylist(rating);
	if (playlist === undefined) {
		cache.delete(rating);
		notify();
		return;
	}
	const ids = await getPlaylistTrackIds(playlist.uuid);
	if (loadVersions.get(rating) !== version) return;
	cache.set(rating, ids);
	notify();
	trace.log(`${stars(rating)}: ${ids.size} songs from “${playlist.title}”`);
};

/** Sets (or with undefined clears) the playlist of a rating; its songs count as rated right away */
export const assignRatingPlaylist = async (rating: number, playlist: RatingPlaylist | undefined) => {
	setRatingPlaylist(rating, playlist);
	// The old playlist's songs stop counting immediately, the new ones as soon as they're loaded
	cache.delete(rating);
	notify();
	await loadRating(rating);
};

/** Your playlists that aren't used for another rating (the rating's own playlist stays selectable) */
export const playlistsForRating = (rating: number) => async () => {
	const used = new Set(RATINGS.filter((other) => other !== rating).map((other) => getRatingPlaylist(other)?.uuid));
	return (await getUserPlaylists()).filter((playlist) => !used.has(playlist.uuid));
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
	for (const rating of [...RATINGS].reverse()) if (cache.get(rating)?.has(trackId)) return rating;
	return 0;
};

/** On load: picks up renamed playlists, and clears a rating's playlist only if TIDAL says it no longer exists */
export const validateRatingPlaylists = async () => {
	for (const rating of RATINGS) {
		const playlist = getRatingPlaylist(rating);
		if (playlist === undefined) continue;
		try {
			const info = await getPlaylistInfo(playlist.uuid);
			if (info === undefined) {
				trace.warn(`The ${stars(rating)} playlist “${playlist.title}” no longer exists, choose a new one in the settings`);
				await assignRatingPlaylist(rating, undefined);
			} else if (info.title !== playlist.title) {
				setRatingPlaylist(rating, { uuid: playlist.uuid, title: info.title });
			}
		} catch (err) {
			// Offline or similar: keep the playlist as it is
			trace.warn.withContext(`Couldn't check the ${stars(rating)} playlist`)(err as Error);
		}
	}
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
