import { redux, TidalApi } from "@luna/lib";

import type { PickablePlaylist } from "../../../shared/playlistPicker";
import { fetchPlaylistItems } from "../../../shared/playlistItems";

const API = "https://api.tidal.com/v1";
const withQuery = (path: string, extra = "") => `${API}/${path}${path.includes("?") ? "&" : "?"}${TidalApi.queryArgs()}${extra}`;

const request = async (url: string, init: RequestInit = {}, retries = 3): Promise<Response> => {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, { ...init, headers: { ...(await TidalApi.getAuthHeaders()), ...(init.headers as Record<string, string> | undefined) } });
		if (res.ok) return res;
		// Retry on rate limits / server errors
		if (attempt < retries && (res.status === 429 || res.status >= 500)) {
			await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
			continue;
		}
		return res;
	}
};

/** Right after TIDAL starts, login isn't finished yet (getAuthHeaders throws TidalError A0001): waits until it is */
let signedIn: Promise<void> | undefined;
export const waitForLogin = () =>
	(signedIn ??= (async () => {
		for (let attempt = 0; ; attempt++) {
			try {
				await TidalApi.getAuthHeaders();
				return;
			} catch {
				await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** attempt, 10_000)));
			}
		}
	})());

const failed = (what: string, res: Response) => new Error(`${what} (${res.status} ${res.statusText})`);

/** All playlists created by the current user, most recently updated first */
export const getUserPlaylists = async (): Promise<PickablePlaylist[]> => {
	const userId = redux.store.getState().session?.userId;
	if (userId === undefined || userId === null) throw new Error("Not logged in");
	const playlists: redux.Playlist[] = [];
	for (let offset = 0; ; ) {
		const res = await request(withQuery(`users/${userId}/playlists`, `&limit=50&offset=${offset}`));
		if (!res.ok) throw failed("Failed to load playlists", res);
		const page = (await res.json()) as { items?: redux.Playlist[]; totalNumberOfItems?: number };
		const items = page.items ?? [];
		playlists.push(...items);
		offset += items.length;
		if (items.length === 0 || offset >= (page.totalNumberOfItems ?? 0)) break;
	}
	return playlists
		.map((p) => ({ uuid: p.uuid, title: p.title, numberOfTracks: p.numberOfTracks, squareImage: p.squareImage, image: p.image, updated: p.lastItemAddedAt ?? p.lastUpdated }))
		.sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));
};

/** All items of an album, in album order */
export const getAlbumItems = async (albumId: string): Promise<redux.MediaItem[]> => {
	const items: redux.MediaItem[] = [];
	for (let offset = 0; ; ) {
		const res = await request(withQuery(`albums/${albumId}/items`, `&limit=100&offset=${offset}`));
		if (!res.ok) throw failed("Failed to load the album", res);
		const page = (await res.json()) as { items?: redux.MediaItem[]; totalNumberOfItems?: number };
		const pageItems = page.items ?? [];
		items.push(...pageItems);
		offset += pageItems.length;
		if (pageItems.length === 0 || offset >= (page.totalNumberOfItems ?? 0)) break;
	}
	return items;
};

/** Songs of a mix or radio; falls back to the mix page if the items endpoint isn't available */
export const getMixItems = async (mixId: string): Promise<redux.MediaItem[]> => {
	const items: redux.MediaItem[] = [];
	for (let offset = 0; ; ) {
		const res = await request(withQuery(`mixes/${mixId}/items`, `&limit=100&offset=${offset}`));
		if (!res.ok) break;
		const page = (await res.json()) as { items?: redux.MediaItem[]; totalNumberOfItems?: number };
		const pageItems = page.items ?? [];
		items.push(...pageItems);
		offset += pageItems.length;
		if (pageItems.length === 0 || offset >= (page.totalNumberOfItems ?? 0)) return items;
	}
	if (items.length > 0) return items;

	const res = await request(withQuery(`pages/mix`, `&mixId=${encodeURIComponent(mixId)}`));
	if (!res.ok) throw failed("Failed to load the mix", res);
	type Module = { type?: string; pagedList?: { items?: redux.Track[] } };
	const page = (await res.json()) as { rows?: { modules?: Module[] }[] };
	const modules = (page.rows ?? []).flatMap((row) => row.modules ?? []);
	return modules
		.filter((module) => module.type === "TRACK_LIST")
		.flatMap((module) => module.pagedList?.items ?? [])
		.map((item) => ({ type: "track" as const, item }));
};

const fetchPaged = async <T>(path: string, limit: number, what: string): Promise<T[]> => {
	const items: T[] = [];
	for (let offset = 0; ; ) {
		const res = await request(withQuery(path, `&limit=${limit}&offset=${offset}`));
		if (!res.ok) throw failed(what, res);
		const page = (await res.json()) as { items?: T[]; totalNumberOfItems?: number };
		const pageItems = page.items ?? [];
		items.push(...pageItems);
		offset += pageItems.length;
		if (pageItems.length === 0 || offset >= (page.totalNumberOfItems ?? 0)) break;
	}
	return items;
};

/**
 * An artist's albums, EPs and singles ("appears on" compilations excluded): `releases` with clean/explicit twins merged
 * (the explicit one kept), `all` including both twins
 */
const getArtistReleases = async (artistId: string): Promise<{ releases: redux.Album[]; all: redux.Album[] }> => {
	const [albums, singles] = await Promise.all([
		fetchPaged<redux.Album>(`artists/${artistId}/albums`, 100, "Failed to load the artist's albums"),
		fetchPaged<redux.Album>(`artists/${artistId}/albums?filter=EPSANDSINGLES`, 100, "Failed to load the artist's singles"),
	]);
	// Same release as clean + explicit version: keep only the explicit one
	const releases = new Map<string, redux.Album>();
	for (const album of [...albums, ...singles]) {
		const key = `${album.title}|${album.version ?? ""}|${album.numberOfTracks}`.toLowerCase();
		const existing = releases.get(key);
		if (existing === undefined || (!existing.explicit && album.explicit)) releases.set(key, album);
	}
	return { releases: [...releases.values()], all: [...albums, ...singles] };
};

export const getArtistAlbumIds = async (artistId: string) => (await getArtistReleases(artistId)).releases.map((album) => String(album.id));

/**
 * Song count of an artist's own albums, EPs and singles (clean/explicit twins counted once),
 * and the ids of all those releases (both twins, so a rating on either version counts)
 */
export const getArtistCatalog = async (artistId: string) => {
	const { releases, all } = await getArtistReleases(artistId);
	return {
		albumIds: new Set(all.map((album) => String(album.id))),
		totalTracks: releases.reduce((sum, album) => sum + (album.numberOfTracks ?? 0), 0),
	};
};


/** All favorited (hearted) tracks, as media items */
export const getFavoriteTrackItems = async (): Promise<redux.MediaItem[]> => {
	const userId = redux.store.getState().session?.userId;
	if (userId === undefined || userId === null) throw new Error("Not logged in");
	const items: redux.MediaItem[] = [];
	for (let offset = 0; ; ) {
		const res = await request(withQuery(`users/${userId}/favorites/tracks`, `&limit=1000&offset=${offset}`));
		if (!res.ok) throw failed("Failed to load your favorite tracks", res);
		const page = (await res.json()) as { items?: { item: redux.Track }[]; totalNumberOfItems?: number };
		const pageItems = page.items ?? [];
		items.push(...pageItems.map(({ item }) => ({ type: "track" as const, item })));
		offset += pageItems.length;
		if (pageItems.length === 0 || offset >= (page.totalNumberOfItems ?? 0)) break;
	}
	return items;
};

/** Current title of a playlist; undefined if it no longer exists (other errors throw, so nothing gets cleared by mistake) */
export const getPlaylistInfo = async (uuid: string): Promise<{ title: string } | undefined> => {
	const res = await request(withQuery(`playlists/${uuid}`));
	if (res.status === 404 || res.status === 410) return undefined;
	if (!res.ok) throw failed("Failed to check the playlist", res);
	const playlist = (await res.json()) as redux.Playlist;
	return { title: playlist.title };
};

/** false if TIDAL no longer knows the id (404), undefined if unsure */
export const trackExists = async (trackId: string): Promise<boolean | undefined> => {
	const res = await request(withQuery(`tracks/${trackId}`));
	if (res.ok) return true;
	if (res.status === 404) return false;
	return undefined;
};

const getEtag = async (uuid: string) => {
	const res = await request(withQuery(`playlists/${uuid}`));
	if (!res.ok) throw failed("Failed to load playlist", res);
	const etag = res.headers.get("etag");
	if (etag === null) throw new Error("Playlist has no ETag (is it your own playlist?)");
	return etag;
};

/** Changes a playlist; the ETag changes after every write, so retry once if it went stale (412) */
const modify = async (uuid: string, what: string, send: (etag: string) => Promise<Response>) => {
	let res: Response | undefined;
	for (let attempt = 0; attempt < 2; attempt++) {
		res = await send(await getEtag(uuid));
		if (res.status !== 412) break;
	}
	if (!res?.ok) throw failed(what, res!);
	return res;
};

/** Adds a track (skipped if already there); returns the ids TIDAL added, which for an old id is the current one */
export const addTrack = async (uuid: string, trackId: string): Promise<string[] | undefined> => {
	const res = await modify(uuid, "Failed to add the song", (etag) =>
		request(withQuery(`playlists/${uuid}/items`), {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded", "If-None-Match": etag },
			body: `trackIds=${trackId}&onDupes=SKIP&onArtifactNotFound=SKIP`,
		}),
	);
	try {
		const body = (await res.json()) as { addedItemIds?: (string | number)[] };
		return Array.isArray(body?.addedItemIds) ? body.addedItemIds.map(String) : undefined;
	} catch {
		return undefined;
	}
};

/** Removes every occurrence of any of the ids (looked up fresh, positions change on edits) */
export const removeTrack = async (uuid: string, trackIds: string[]) => {
	const ids = new Set(trackIds);
	const items = await fetchPlaylistItems(uuid);
	const indices = items.flatMap((item, index) => (ids.has(String(item.item.id)) ? [index] : []));
	if (indices.length === 0) return;
	await modify(uuid, "Failed to remove the song", (etag) =>
		request(withQuery(`playlists/${uuid}/items/${indices.join(",")}`), { method: "DELETE", headers: { "If-None-Match": etag } }),
	);
};

/** Ask the TIDAL UI to reload a playlist so changes show without a restart */
export const refreshPlaylistView = (uuid: string) => {
	try {
		redux.actions["content/LOAD_LIST_ITEMS_PAGE"]({ listName: `playlists/${uuid}`, listType: "mediaItems", reset: true });
	} catch {
		/* purely cosmetic */
	}
};
