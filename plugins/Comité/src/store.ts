import { ReactiveStore } from "@luna/core";

export type RatingPlaylist = { uuid: string; title: string };
type Store = { playlists: Record<string, RatingPlaylist | undefined> };

/** One playlist per star rating, kept until changed in the plugin settings */
export const settings = await ReactiveStore.getPluginStorage<Store>("Comité", { playlists: {} });

export const RATINGS = [1, 2, 3, 4, 5] as const;
export const stars = (rating: number) => "★".repeat(rating) + "☆".repeat(5 - rating);

export const getRatingPlaylist = (rating: number) => settings.playlists[String(rating)];
export const setRatingPlaylist = (rating: number, playlist: RatingPlaylist | undefined) => {
	// Reassign so the store persists it
	const playlists = { ...settings.playlists };
	if (playlist === undefined) delete playlists[String(rating)];
	else playlists[String(rating)] = { uuid: playlist.uuid, title: playlist.title };
	settings.playlists = playlists;
};
