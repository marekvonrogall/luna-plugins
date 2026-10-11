import { TidalApi, type redux } from "@luna/lib";

type Page = { items?: redux.MediaItem[]; totalNumberOfItems?: number };

const PAGE_SIZE = 100;
const CONCURRENCY = 6;

const getPage = async (playlistUUID: string, offset: number): Promise<Page> => {
	const url = `https://api.tidal.com/v1/playlists/${playlistUUID}/items?${TidalApi.queryArgs()}&limit=${PAGE_SIZE}&offset=${offset}`;
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, { headers: await TidalApi.getAuthHeaders() });
		if (res.ok) return res.json();
		// Retry on rate limits / server errors
		if (attempt < 3 && (res.status === 429 || res.status >= 500)) {
			await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
			continue;
		}
		throw new Error(`Failed to load playlist items (${res.status} ${res.statusText})`);
	}
};

/** All items of a playlist, always fresh: Luna's TidalApi/Playlist cache the first response for the whole session */
export const fetchPlaylistItems = async (playlistUUID: string): Promise<redux.MediaItem[]> => {
	const first = await getPage(playlistUUID, 0);
	const items = [...(first.items ?? [])];
	const total = first.totalNumberOfItems ?? items.length;
	if (items.length === 0 || items.length >= total) return items;

	const step = items.length; // server may cap the page size
	const offsets: number[] = [];
	for (let offset = step; offset < total; offset += step) offsets.push(offset);

	const pages: redux.MediaItem[][] = new Array(offsets.length);
	let next = 0;
	const worker = async () => {
		while (next < offsets.length) {
			const index = next++;
			pages[index] = (await getPage(playlistUUID, offsets[index])).items ?? [];
		}
	};
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, offsets.length) }, worker));
	for (const page of pages) items.push(...page);
	return items;
};
