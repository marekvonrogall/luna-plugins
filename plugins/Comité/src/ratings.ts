import { addTrack, getPlaylistInfo, waitForLogin, getPlaylistTrackIds, getUserPlaylists, refreshPlaylistView, removeTrack } from "./api";
import { pickPlaylist } from "../../../shared/playlistPicker";
import { trace, unloads } from "./core";
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

/** Reloads all rating playlists (one run at a time); after a failure the next song change tries again */
export const refreshRatings = () =>
	(loading ??= waitForLogin()
		.then(() =>
			Promise.all(
				RATINGS.map((rating) =>
					loadRating(rating).then(
						() => true,
						(err) => {
							trace.warn.withContext(`Failed to load the ${rating}★ playlist`)(err as Error);
							return false;
						},
					),
				),
			),
		)
		.then((results) => {
			if (results.every(Boolean)) loadedAt = Date.now();
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
	await waitForLogin();
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

/** Ratings being saved right now, shown before TIDAL has confirmed them */
const pending = new Map<string, number>();
let picking = false;

/** The rating to show for a song: the one being saved, else the stored one */
export const shownRating = (trackId: string) => pending.get(trackId) ?? ratingOf(trackId);
export const isSaving = (trackId: string) => pending.has(trackId);

/** Rates a song from a star row; clicking its current rating again removes it. A rating's first use asks for its playlist. */
export const rateTrack = async (trackId: string, clicked: number) => {
	if (pending.has(trackId) || picking) return;
	const next = ratingOf(trackId) === clicked ? 0 : clicked;
	pending.set(trackId, next);
	notify();
	try {
		// Cancelling the picker keeps the old rating
		if (next !== 0 && getRatingPlaylist(next) === undefined) {
			picking = true;
			const chosen = await pickPlaylist(unloads, {
				title: `Playlist for ${stars(next)}`,
				subtitle: `Songs you rate ${next}★ are added to this playlist. Playlists used for another rating aren't listed.`,
				loadPlaylists: playlistsForRating(next),
			}).finally(() => {
				picking = false;
			});
			if (!chosen) return;
			await assignRatingPlaylist(next, chosen);
		}
		await applyRating(trackId, next);
	} catch (err) {
		trace.msg.err.withContext("Failed to save the rating")(err as Error);
	} finally {
		pending.delete(trackId);
		notify();
	}
};
