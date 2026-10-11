import { redux, TidalApi } from "@luna/lib";

const API = "https://api.tidal.com/v1";

export interface PlaylistInfo {
	uuid: string;
	title: string;
	numberOfTracks: number;
	lastUpdated?: string;
	squareImage?: string;
	image?: string;
}

/** A song from the user's selection */
export interface SourceTrack {
	trackId?: string;
	albumId?: string;
}

type Paged<T> = { items?: T[]; totalNumberOfItems?: number };

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const withQuery = (path: string, extra = "") => `${API}/${path}${path.includes("?") ? "&" : "?"}${TidalApi.queryArgs()}${extra}`;

const request = async (url: string, init: RequestInit = {}, retries = 3): Promise<Response> => {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, {
			...init,
			headers: { ...(await TidalApi.getAuthHeaders()), ...(init.headers as Record<string, string> | undefined) },
		});
		if (res.ok) return res;
		// Retry on rate limits / server errors
		if (attempt < retries && (res.status === 429 || res.status >= 500)) {
			const retryAfter = Number(res.headers.get("retry-after"));
			await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * (attempt + 1));
			continue;
		}
		return res;
	}
};

const getJson = async <T>(url: string): Promise<T> => {
	const res = await request(url);
	if (!res.ok) throw new Error(`${res.status} ${res.statusText} @ ${url}`);
	return res.json() as Promise<T>;
};

const PAGE_CONCURRENCY = 6;

/** Fetches all pages, the ones after the first in parallel */
const fetchAllPages = async <T>(path: string, pageSize: number): Promise<T[]> => {
	const pageUrl = (offset: number) => withQuery(path, `&limit=${pageSize}&offset=${offset}`);
	const first = await getJson<Paged<T>>(pageUrl(0));
	const items: T[] = [...(first.items ?? [])];
	const total = first.totalNumberOfItems ?? items.length;
	if (items.length === 0 || items.length >= total) return items;

	const step = items.length; // server may cap the page size
	const offsets: number[] = [];
	for (let offset = step; offset < total; offset += step) offsets.push(offset);

	const pages: T[][] = new Array(offsets.length);
	let next = 0;
	const worker = async () => {
		while (next < offsets.length) {
			const index = next++;
			pages[index] = (await getJson<Paged<T>>(pageUrl(offsets[index]))).items ?? [];
		}
	};
	await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, offsets.length) }, worker));
	for (const page of pages) items.push(...page);
	return items;
};

const getUserId = () => {
	const userId = redux.store.getState().session?.userId;
	if (userId === undefined || userId === null) throw new Error("Not logged in");
	return userId;
};

/** All playlists created by the current user */
export const getUserPlaylists = async (): Promise<PlaylistInfo[]> => {
	const playlists = await fetchAllPages<redux.Playlist>(`users/${getUserId()}/playlists`, 50);
	return playlists
		.map((p) => ({
			uuid: p.uuid,
			title: p.title,
			numberOfTracks: p.numberOfTracks,
			lastUpdated: p.lastItemAddedAt ?? p.lastUpdated,
			squareImage: p.squareImage,
			image: p.image,
		}))
		.sort((a, b) => (b.lastUpdated ?? "").localeCompare(a.lastUpdated ?? ""));
};

/** All items in a playlist */
export const getPlaylistItems = (playlistUUID: string) => fetchAllPages<redux.MediaItem>(`playlists/${playlistUUID}/items`, 100);

/** All favorited (hearted) tracks of the current user */
export const getFavoriteTracks = async (): Promise<SourceTrack[]> => {
	const favorites = await fetchAllPages<{ item: redux.Track }>(`users/${getUserId()}/favorites/tracks`, 1000);
	return favorites.map(({ item }) => ({
		trackId: String(item.id),
		albumId: item.album?.id === undefined || item.album?.id === null ? undefined : String(item.album.id),
	}));
};

/** Track ids of an album in album order, videos ignored */
export const getAlbumTrackIds = async (albumId: string): Promise<string[]> => {
	const items = await fetchAllPages<redux.MediaItem>(`albums/${albumId}/items`, 100);
	return items.filter((i) => i.type === "track").map((i) => String(i.item.id));
};

/** Album id of a track, from the redux store or the API */
export const getTrackAlbumId = async (trackId: string): Promise<string | undefined> => {
	const stored = redux.store.getState().content.mediaItems[trackId];
	const storedAlbumId = stored?.type === "track" ? (stored.item as redux.Track).album?.id : undefined;
	if (storedAlbumId !== undefined && storedAlbumId !== null) return String(storedAlbumId);

	const track = await getJson<redux.Track>(withQuery(`tracks/${trackId}`)).catch(() => undefined);
	const albumId = track?.album?.id;
	return albumId === undefined || albumId === null ? undefined : String(albumId);
};

const CHUNK_SIZE = 50;

/** Appends tracks to a playlist; dupes are skipped server-side, `added` is derived from numberOfTracks */
export class PlaylistWriter {
	private initialCount?: number;
	private lastCount?: number;
	public sent = 0;

	constructor(public readonly uuid: string) {}

	/** Tracks actually added so far */
	public get added() {
		return this.initialCount === undefined || this.lastCount === undefined ? 0 : this.lastCount - this.initialCount;
	}

	private async fetchMeta() {
		const res = await request(withQuery(`playlists/${this.uuid}`));
		if (!res.ok) throw new Error(`Failed to load playlist (${res.status} ${res.statusText})`);
		const etag = res.headers.get("etag");
		if (etag === null) throw new Error("Playlist has no ETag (is it your own playlist?)");
		const { numberOfTracks, numberOfVideos } = (await res.json()) as redux.Playlist;
		const count = (numberOfTracks ?? 0) + (numberOfVideos ?? 0);
		this.initialCount ??= count;
		this.lastCount = count;
		return etag;
	}

	public async add(trackIds: string[]) {
		for (let i = 0; i < trackIds.length; i += CHUNK_SIZE) {
			const chunk = trackIds.slice(i, i + CHUNK_SIZE);
			let res: Response | undefined;
			// ETag changes after every write, retry once if stale (412)
			for (let attempt = 0; attempt < 2; attempt++) {
				const etag = await this.fetchMeta();
				res = await request(withQuery(`playlists/${this.uuid}/items`), {
					method: "POST",
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
						"If-None-Match": etag,
					},
					body: `trackIds=${chunk.join(",")}&onDupes=SKIP&onArtifactNotFound=SKIP`,
				});
				if (res.status !== 412) break;
			}
			if (!res?.ok) throw new Error(`Failed to add tracks (${res?.status} ${res?.statusText})`);
			this.sent += chunk.length;
		}
	}

	/** Updates `added` after the last POST */
	public async finish() {
		if (this.sent > 0) await this.fetchMeta();
	}
}

/** Reloads the playlist in the Tidal UI */
export const refreshPlaylistView = (playlistUUID: string) => {
	try {
		redux.actions["content/LOAD_LIST_ITEMS_PAGE"]({ listName: `playlists/${playlistUUID}`, listType: "mediaItems", reset: true });
	} catch {
		/* purely cosmetic */
	}
};
