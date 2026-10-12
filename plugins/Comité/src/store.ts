import { ReactiveStore } from "@luna/core";

export type RatingPlaylist = { uuid: string; title: string };
type Store = {
	/** Rating ("0.5" … "5") → its playlist */
	playlists: Record<string, RatingPlaylist | undefined>;
	/** Rating mode plays songs in random order */
	rateShuffle: boolean;
};

/** One playlist per rating, kept until changed in the plugin settings */
export const settings = await ReactiveStore.getPluginStorage<Store>("Comité", { playlists: {}, rateShuffle: true });

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

export const setRatingPlaylist = (rating: number, playlist: RatingPlaylist | undefined) => {
	const playlists = plainPlaylists();
	if (playlist === undefined) delete playlists[String(rating)];
	else playlists[String(rating)] = { uuid: String(playlist.uuid), title: String(playlist.title) };
	settings.playlists = playlists;
};
