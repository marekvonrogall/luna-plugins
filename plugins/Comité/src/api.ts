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

/** Track ids in a playlist (fresh) */
export const getPlaylistTrackIds = async (uuid: string) => new Set((await fetchPlaylistItems(uuid)).map((i) => String(i.item.id)));

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
};

/** Adds a track, TIDAL skips it if it's already in the playlist */
export const addTrack = (uuid: string, trackId: string) =>
	modify(uuid, "Failed to add the song", (etag) =>
		request(withQuery(`playlists/${uuid}/items`), {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded", "If-None-Match": etag },
			body: `trackIds=${trackId}&onDupes=SKIP&onArtifactNotFound=SKIP`,
		}),
	);

/** Removes every occurrence of a track (looked up fresh, positions change when the playlist is edited) */
export const removeTrack = async (uuid: string, trackId: string) => {
	const items = await fetchPlaylistItems(uuid);
	const indices = items.flatMap((item, index) => (String(item.item.id) === trackId ? [index] : []));
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
