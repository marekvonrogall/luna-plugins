import { Album, MediaItems, Playlist, redux, TidalApi, type MediaCollection } from "@luna/lib";

import { fetchPlaylistItems } from "../../../shared/playlistItems";

/**
 * A track as the API lists it. Enough to check the library, without creating Luna MediaItems:
 * MediaItem.fromId loads every track that isn't in TIDAL's store with its own request, one after another.
 */
export type CollectionItem = {
	id: redux.ItemId;
	type: redux.ContentType;
	/** Missing if it couldn't be loaded; such tracks are checked the slow way when downloading */
	tidalItem?: redux.Track;
};

const PAGE_SIZE = 100;
const CONCURRENCY = 6;

/** Runs `task` for every entry, at most `limit` at a time, keeping the order */
const mapLimit = async <T, R>(entries: T[], limit: number, task: (entry: T) => Promise<R>): Promise<R[]> => {
	const results: R[] = new Array(entries.length);
	let next = 0;
	const worker = async () => {
		while (next < entries.length) {
			const index = next++;
			results[index] = await task(entries[index]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, entries.length) }, worker));
	return results;
};

const toCollectionItem = ({ item, type }: redux.MediaItem): CollectionItem => ({ id: item.id!, type, tidalItem: item as redux.Track });

type Page = { items?: redux.MediaItem[]; totalNumberOfItems?: number };

const getAlbumPage = async (albumId: redux.ItemId, offset: number): Promise<Page> => {
	const url = `https://api.tidal.com/v1/albums/${albumId}/items?${TidalApi.queryArgs()}&limit=${PAGE_SIZE}&offset=${offset}`;
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, { headers: await TidalApi.getAuthHeaders() });
		if (res.ok) return res.json();
		// Retry on rate limits / server errors
		if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
			await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
			continue;
		}
		throw new Error(`Failed to load album items (${res.status} ${res.statusText})`);
	}
};

/** All items of an album, 100 per request */
const fetchAlbumItems = async (albumId: redux.ItemId): Promise<redux.MediaItem[]> => {
	const first = await getAlbumPage(albumId, 0);
	const items = [...(first.items ?? [])];
	const total = first.totalNumberOfItems ?? items.length;
	if (items.length === 0 || items.length >= total) return items;

	const step = items.length; // server may cap the page size
	const offsets: number[] = [];
	for (let offset = step; offset < total; offset += step) offsets.push(offset);
	const pages = await mapLimit(offsets, CONCURRENCY, async (offset) => (await getAlbumPage(albumId, offset)).items ?? []);
	for (const page of pages) items.push(...page);
	return items;
};

/** Selected tracks: most are already in TIDAL's store, the rest are loaded a few at a time */
const resolveIds = async (tMediaItems: MediaItems["tMediaItems"]): Promise<CollectionItem[]> => {
	const stored = redux.store.getState().content.mediaItems as Record<string, redux.MediaItem | undefined>;
	return mapLimit(tMediaItems, CONCURRENCY, async ({ item: { id }, type }) => {
		const fromStore = stored[String(id)]?.item;
		if (fromStore !== undefined) return { id, type, tidalItem: fromStore as redux.Track };
		if (type !== "track") return { id, type };
		const tidalItem = await TidalApi.track(id).catch(() => undefined);
		return { id, type, tidalItem: tidalItem ?? undefined };
	});
};

/** All tracks of an album, playlist or selection, loaded in pages instead of one request per track */
export const getCollectionItems = async (collection: MediaCollection): Promise<CollectionItem[]> => {
	// Luna caches playlist contents per session, so newly added songs would be missing: read it fresh
	if (collection instanceof Playlist) return (await fetchPlaylistItems(String(collection.uuid))).map(toCollectionItem);
	if (collection instanceof Album) {
		const items = await fetchAlbumItems(collection.id).catch(() => collection.tMediaItems());
		return items.map(toCollectionItem);
	}
	if (collection instanceof MediaItems) return resolveIds(collection.tMediaItems);

	// Unknown collection type: the slow way
	const items: CollectionItem[] = [];
	for await (const mediaItem of await collection.mediaItems()) items.push({ id: mediaItem.id, type: mediaItem.contentType, tidalItem: mediaItem.tidalItem as redux.Track });
	return items;
};
