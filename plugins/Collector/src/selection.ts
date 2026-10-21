import { Album, MediaItems, Playlist, redux, type MediaCollection } from "@luna/lib";

import {
	getAlbumTrackIds,
	getPlaylistItems,
	getTrack,
	getTrackSource,
	mainArtists,
	toSourceTrack,
	uniqueArtists,
	withPictures,
	type ArtistInfo,
	type SourceTrack,
} from "./api";

export type OnProgress = (done: number, total: number) => void;
export type LoadSources = (onProgress: OnProgress) => Promise<SourceTrack[]>;

/** What a context menu is about; loads only what an action needs */
export interface Selection {
	/** Songs; an album counts as one */
	count: number;
	/** e.g. "this song", "the album “X”" */
	what: string;
	/** Exactly one song */
	single: boolean;
	/** Right-clicked playlist, never its own target */
	playlistUuid?: string;
	trackIds: () => Promise<string[]>;
	sources: LoadSources;
	artists: () => Promise<ArtistInfo[]>;
}

const once = <T>(load: () => Promise<T>) => {
	let promise: Promise<T> | undefined;
	return () => {
		promise ??= load();
		promise.catch(() => (promise = undefined));
		return promise;
	};
};

const unique = (ids: string[]) => [...new Set(ids)];

export const getSelection = (collection: MediaCollection, count: number): Selection => {
	if (collection instanceof Album) {
		const { tidalAlbum } = collection;
		const albumId = String(collection.id);
		return {
			count: 1,
			what: `the album “${tidalAlbum.title}”`,
			single: false,
			trackIds: once(async () => unique(await getAlbumTrackIds(albumId))),
			sources: async () => [{ albumId, albumTitle: tidalAlbum.title, artist: tidalAlbum.artist?.name ?? tidalAlbum.artists?.[0]?.name }],
			artists: async () => withPictures(uniqueArtists(mainArtists(tidalAlbum))),
		};
	}

	if (collection instanceof Playlist) {
		const uuid = String(collection.uuid);
		// Playlist items include album and artists
		const tracks = once(async () => (await getPlaylistItems(uuid)).filter((i) => i.type === "track").map((i) => i.item as redux.Track));
		return {
			count,
			what: `the songs of “${collection.tidalPlaylist.title}”`,
			single: false,
			playlistUuid: uuid,
			trackIds: once(async () => unique((await tracks()).map((t) => String(t.id)))),
			sources: async () => (await tracks()).map(toSourceTrack),
			artists: async () => withPictures(uniqueArtists((await tracks()).flatMap((t) => mainArtists(t)))),
		};
	}

	const tMediaItems = collection instanceof MediaItems ? collection.tMediaItems : [];
	const ids = unique(tMediaItems.filter((i) => i.type === "track").map((i) => String(i.item.id)));
	return {
		count: ids.length,
		what: ids.length === 1 ? "this song" : `the ${ids.length} selected songs`,
		single: ids.length === 1,
		trackIds: async () => ids,
		sources: async (onProgress) => {
			const sources: SourceTrack[] = [];
			for (const id of ids) {
				sources.push(await getTrackSource(id));
				onProgress(sources.length, ids.length);
			}
			return sources;
		},
		artists: once(async () => {
			const artists: ArtistInfo[] = [];
			for (const id of ids) {
				const track = await getTrack(id);
				if (track !== undefined) artists.push(...mainArtists(track));
			}
			return withPictures(uniqueArtists(artists));
		}),
	};
};
