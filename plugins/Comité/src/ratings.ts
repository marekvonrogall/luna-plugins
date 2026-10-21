import { redux } from "@luna/lib";

import { fetchPlaylistItems } from "../../../shared/playlistItems";
import { syncPlaylist } from "../../../shared/playlistSync";
import { addTrack, getPlaylistInfo, getUserPlaylists, removeTrack, waitForLogin } from "./api";
import { pickPlaylist } from "../../../shared/playlistPicker";
import { trace, unloads } from "./core";
import { canonicalId, getRatingPlaylist, idsOfSong, linkTrackIds, RATINGS, setRatingPlaylist, stars, type RatingPlaylist } from "./store";

/** Track ids per rating, read from the rating playlists */
const cache = new Map<number, Set<string>>();
const MAX_AGE = 5 * 60 * 1000;
let loadedAt = 0;
let loading: Promise<void> | undefined;

/** Called whenever the cached ratings changed, so the stars can re-render */
export const ratingListeners = new Set<() => void>();
let changes = 0;
const notify = () => {
	changes++;
	ratingListeners.forEach((listener) => listener());
};
/** Changes whenever any rating changed */
export const ratingsVersion = () => changes;

/** Album and artists of every rated song, so averages per album / artist need no extra requests */
type TrackMeta = { album?: string; albumTitle?: string; artists: string[]; artistNames: string; cover?: string; songKey: string; title: string };
const trackMeta = new Map<string, TrackMeta>();

/** Words that mark a " - …" title suffix as a version (e.g. "Song - Live at Wembley"), not part of the name */
const VERSION_SUFFIX = /\s[-–—]\s[^-–—]*\b(?:live|version|mix|remix|edit|remaster(?:ed)?|acoustic|piano|orchestral|instrumental|demo|mono|stereo|unplugged|session|reprise|sped up|slowed)\b[^-–—]*$/i;

/**
 * Base name of a song, so all its versions match: "Song 1", "Song 1 (Live)", "Song 1 [Piano]", "Song 1 - Orchestral Version"
 * and the TIDAL version field all give "song 1". Ignores case and punctuation.
 */
export const songKey = (title: string, _version?: string | null) =>
	title
		.replace(/\s*[([][^)\]]*[)\]]/g, " ")
		.replace(VERSION_SUFFIX, " ")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

/** Full name as TIDAL shows it, e.g. "Song 1 (Live)" */
const displayTitle = (title: string, version?: string | null) => (version ? `${title} (${version})` : title);

const rememberTrack = (item: redux.MediaItem["item"] | undefined) => {
	if (item === undefined) return;
	const version = "version" in item ? (item.version as string | null | undefined) : undefined;
	trackMeta.set(String(item.id), {
		album: item.album?.id === undefined ? undefined : String(item.album.id),
		albumTitle: item.album?.title ?? undefined,
		artists: (item.artists ?? []).map((artist) => String(artist.id)),
		artistNames: (item.artists ?? []).map((artist) => artist.name).join(", "),
		cover: item.album?.cover ?? undefined,
		songKey: songKey(item.title ?? "", version),
		title: displayTitle(item.title ?? "", version),
	});
};
export const getTrackMeta = (trackId: string) => trackMeta.get(canonicalId(trackId)) ?? trackMeta.get(trackId);

/** Rated songs (other than `trackId`) with the same name and at least one shared artist, e.g. a single re-released on an album */
export const sameSongRatings = (trackId: string, key: string, artistIds: string[]) => {
	const artists = new Set(artistIds);
	trackId = canonicalId(trackId);
	const matches: { trackId: string; rating: number; albumTitle?: string; title: string }[] = [];
	if (key === "") return matches;
	for (const [id, rating] of ratedTracks()) {
		if (id === trackId) continue;
		const meta = trackMeta.get(id);
		if (meta?.songKey !== key || !meta.artists.some((artist) => artists.has(artist))) continue;
		matches.push({ trackId: id, rating, albumTitle: meta.albumTitle, title: meta.title });
	}
	return matches;
};

/** Every rated song with its (highest) rating */
export const ratedTracks = () => {
	const all = new Map<string, number>();
	for (const rating of RATINGS) for (const id of cache.get(rating) ?? []) all.set(id, rating);
	return all;
};

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
	const items = await fetchPlaylistItems(playlist.uuid);
	if (loadVersions.get(rating) !== version) return;
	const ids = new Set<string>();
	for (const { item } of items) {
		ids.add(String(item.id));
		rememberTrack(item);
	}
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

/** Highest rating whose playlist contains the song, 0 if none */
export const ratingOf = (trackId: string) => {
	const id = canonicalId(trackId);
	for (const rating of [...RATINGS].reverse()) if (cache.get(rating)?.has(id)) return rating;
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

/** Puts the song into the playlist of `rating` and removes it from the other rating playlists (0 = unrated) */
export const applyRating = async (trackId: string, rating: number) => {
	let id = canonicalId(trackId);
	const target = rating === 0 ? undefined : getRatingPlaylist(rating);
	if (!trackMeta.has(id)) rememberTrack(redux.store.getState().content.mediaItems[id]?.item ?? redux.store.getState().content.mediaItems[trackId]?.item);
	if (target !== undefined) {
		const added = await addTrack(target.uuid, id);
		// TIDAL stored the current id instead of an old one
		if (added?.length === 1 && added[0] !== id) {
			trace.log(`Song ${id} is stored as ${added[0]}`);
			linkTrackIds(id, added[0]);
			const meta = trackMeta.get(id);
			if (meta !== undefined) trackMeta.set(added[0], meta);
			id = added[0];
		}
		if (!cache.has(rating)) cache.set(rating, new Set());
		cache.get(rating)!.add(id);
		syncPlaylist(target.uuid);
	}
	const ids = idsOfSong(id);
	for (const other of RATINGS) {
		const cached = cache.get(other);
		if (other === rating || !ids.some((each) => cached?.has(each))) continue;
		const playlist = getRatingPlaylist(other);
		// Same playlist used for two ratings: don't remove what was just added
		if (playlist === undefined || playlist.uuid === target?.uuid) continue;
		await removeTrack(playlist.uuid, ids);
		for (const each of ids) cached!.delete(each);
		syncPlaylist(playlist.uuid);
	}
	notify();
};

/** Ratings being saved right now, shown before TIDAL has confirmed them */
const pending = new Map<string, number>();
let picking = false;

/** The rating to show for a song: the one being saved, else the stored one */
export const shownRating = (trackId: string) => pending.get(canonicalId(trackId)) ?? ratingOf(trackId);
export const isSaving = (trackId: string) => pending.has(canonicalId(trackId));

/** Rates a song from a star row; clicking its current rating again removes it. A rating's first use asks for its playlist. */
export const rateTrack = async (rowTrackId: string, clicked: number) => {
	const trackId = canonicalId(rowTrackId);
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
