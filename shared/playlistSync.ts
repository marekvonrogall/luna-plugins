import type { LunaUnloads } from "@luna/core";
import { redux, TidalApi } from "@luna/lib";

type Fetch = typeof fetch;
type Shared = {
	/** When each playlist was last edited */
	editedAt: Map<string, number>;
	/** When any playlist was last edited, for lists like the sidebar */
	listsEditedAt: number;
	/** When each URL was last loaded fresh */
	freshAt: Map<string, number>;
	/** Called after any successful playlist edit, TIDAL's own included */
	onWrite: Set<(uuid: string) => void>;
	/** Latest request handler, so plugin reloads update it */
	handle?: (original: Fetch, input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
	installs: number;
};
// Shared across plugins and reloads
const shared = ((globalThis as Record<symbol, unknown>)[Symbol.for("vrm.playlistSync")] ??= {}) as Shared;
shared.editedAt ??= new Map();
shared.listsEditedAt ??= 0;
shared.freshAt ??= new Map();
shared.onWrite ??= new Set();
shared.installs ??= 0;

const TIDAL = /^https:\/\/[\w.-]*tidal\.com\//;
const PLAYLIST_LISTS = /playlist|my-collection|folders/i;
const PLAYLIST_ID = /\/playlists\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

const urlOf = (input: RequestInfo | URL) => (typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

const markEdited = (uuid?: string) => {
	if (uuid !== undefined) shared.editedAt.set(uuid, Date.now());
	shared.listsEditedAt = Date.now();
};

/** Edited since this URL was last loaded fresh */
const isStale = (url: string) => {
	let editedAt = PLAYLIST_LISTS.test(url) ? shared.listsEditedAt : 0;
	for (const [uuid, at] of shared.editedAt) if (at > editedAt && url.includes(uuid)) editedAt = at;
	return editedAt > (shared.freshAt.get(url) ?? 0);
};

const handle = async (original: Fetch, input: RequestInfo | URL, init?: RequestInit) => {
	const url = urlOf(input);
	if (!TIDAL.test(url)) return original(input, init);
	const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();

	if (method !== "GET") {
		const res = await original(input, init);
		const uuid = PLAYLIST_ID.exec(url)?.[1];
		if (res.ok && uuid !== undefined) {
			markEdited(uuid);
			for (const listener of shared.onWrite) {
				try {
					listener(uuid);
				} catch {
					/* next listener */
				}
			}
		}
		return res;
	}

	if (init?.cache !== undefined || !isStale(url)) return original(input, init);
	// First load since an edit skips the browser cache
	if (input instanceof Request && init === undefined) input = new Request(input, { cache: "no-cache" });
	else init = { ...init, cache: "no-cache" };
	const started = Date.now();
	const res = await original(input, init);
	if (res.ok) shared.freshAt.set(url, started);
	return res;
};

const WRAPPED = Symbol.for("vrm.playlistSync.fetch");

/** Watches TIDAL's requests: playlist edits are reported, and the first load after an edit skips the browser cache */
export const keepPlaylistsFresh = (unloads: LunaUnloads) => {
	shared.installs++;
	shared.handle = handle;
	unloads.add(() => {
		if (--shared.installs === 0) shared.handle = undefined;
	});
	if ((globalThis.fetch as unknown as Record<symbol, boolean>)[WRAPPED]) return;
	const original = globalThis.fetch.bind(globalThis);
	const wrapped = ((input: RequestInfo | URL, init?: RequestInit) => (shared.handle ? shared.handle(original, input, init) : original(input, init))) as Fetch;
	(wrapped as unknown as Record<symbol, boolean>)[WRAPPED] = true;
	globalThis.fetch = wrapped;
};

/** Calls `listener` after every successful edit of a playlist, TIDAL's own included */
export const onPlaylistWrite = (unloads: LunaUnloads, listener: (uuid: string) => void) => {
	shared.onWrite.add(listener);
	unloads.add(() => void shared.onWrite.delete(listener));
};

const dispatch = (type: string, payload: unknown) => {
	try {
		const build = (redux.actions as unknown as Record<string, ((p: unknown) => unknown) | undefined>)[type];
		if (build !== undefined) build(payload);
		else redux.store.dispatch({ type, payload });
	} catch {
		/* purely cosmetic */
	}
};

const json = (value: unknown) => {
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return "";
	}
};

type Tag = string | { type: string; id?: unknown };
type ApiState = {
	queries?: Record<string, { originalArgs?: unknown; endpointName?: string; data?: unknown } | undefined>;
	provided?: Record<string, unknown>;
};

/** Tags providing the cache entries (RTK Query's old and new `provided` layouts) */
const tagsOf = (provided: ApiState["provided"], keys: Set<string>): Tag[] => {
	if (provided === undefined || provided === null) return [];
	const byKey = provided.keys as Record<string, Tag[]> | undefined;
	if (byKey !== undefined && typeof byKey === "object" && !Array.isArray(byKey)) return [...keys].flatMap((key) => byKey[key] ?? []);
	const byType = (provided.tags ?? provided) as Record<string, Record<string, string[]>>;
	const tags: Tag[] = [];
	for (const [type, ids] of Object.entries(byType)) {
		if (typeof ids !== "object" || ids === null) continue;
		for (const [id, cacheKeys] of Object.entries(ids)) {
			if (!Array.isArray(cacheKeys) || !cacheKeys.some((key) => keys.has(key))) continue;
			tags.push(id === "__internal_without_id" ? type : { type, id });
		}
	}
	return tags;
};

/** Refetches TIDAL's cached API results that contain the playlists (only shown ones cost a request) */
const invalidateApiCaches = (uuids: string[]) => {
	const state = redux.store.getState() as unknown as Record<string, ApiState | undefined>;
	for (const [slice, api] of Object.entries(state)) {
		if (typeof api?.queries !== "object" || api.queries === null || !("provided" in api)) continue;
		const keys = new Set<string>();
		const own = new Set<string>();
		for (const [key, query] of Object.entries(api.queries)) {
			const args = key + json(query?.originalArgs);
			if (uuids.some((uuid) => args.includes(uuid))) {
				own.add(key);
				keys.add(key);
			} else if (uuids.some((uuid) => json(query?.data).includes(uuid))) keys.add(key);
		}
		if (keys.size === 0) continue;
		const tags = new Map(tagsOf(api.provided, keys).map((tag) => [json(tag), tag]));
		if (tags.size > 0) dispatch(`${slice}/invalidateTags`, [...tags.values()]);
		// Untagged ones can't be refetched, drop them instead
		else for (const queryCacheKey of own) dispatch(`${slice}/queries/removeQueryResult`, { queryCacheKey });
	}
};

const openPlaylist = () => {
	const path = redux.store.getState().router?.currentPath ?? window.location.pathname;
	return /^\/playlist\/([0-9a-f-]{36})/i.exec(path)?.[1];
};

/** Reloads the playlist's song list in the shown sort. Only "playlists/<uuid>": others like "playlist/<uuid>" fail (404) */
const reloadItems = (uuid: string) => {
	type Page = redux.ActionPayloads["content/LOAD_LIST_ITEMS_PAGE"];
	const listName = `playlists/${uuid}`;
	const content = redux.store.getState().content as unknown as Record<string, unknown>;
	let list: redux.List | undefined;
	for (const [key, value] of Object.entries(content)) {
		if (key.endsWith("Lists") && typeof value === "object" && value !== null) list ??= (value as Record<string, redux.List | undefined>)[listName];
	}
	dispatch("content/LOAD_LIST_ITEMS_PAGE", {
		listName,
		listType: "mediaItems",
		reset: true,
		order: (list?.currentOrder ?? undefined) as Page["order"],
		orderDirection: (list?.currentDirection ?? undefined) as Page["orderDirection"],
	} satisfies Page);
};

/** Puts the current playlist info and ETag into TIDAL's store */
const pushPlaylist = async (uuid: string) => {
	const res = await fetch(`https://api.tidal.com/v1/playlists/${uuid}?${TidalApi.queryArgs()}`, {
		cache: "no-store",
		headers: await TidalApi.getAuthHeaders(),
	});
	if (!res.ok) return;
	const etag = res.headers.get("etag");
	const playlist = (await res.json()) as redux.Playlist;
	// With a stale ETag TIDAL's own edits fail
	if (etag !== null) dispatch("etag/SET_PLAYLIST_ETAG", { playlistId: uuid, etag });
	dispatch("content/LOAD_PLAYLIST_SUCCESS", { playlist });
};

const pending = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

const flush = async () => {
	timer = undefined;
	const uuids = [...pending];
	pending.clear();
	await Promise.all(uuids.map((uuid) => pushPlaylist(uuid).catch(() => undefined)));
	invalidateApiCaches(uuids);
	// Hidden lists load again when opened
	const open = openPlaylist();
	if (open !== undefined && uuids.includes(open)) reloadItems(open);
};

/** Makes TIDAL show a playlist's current songs and track count after an API edit. Edits close together are synced at once */
export const syncPlaylist = (uuid: string) => {
	markEdited(uuid);
	pending.add(uuid);
	timer ??= setTimeout(() => void flush(), 300);
};

/** Makes new playlists show up in TIDAL's sidebar and collection */
export const syncPlaylistLists = () => {
	markEdited();
	dispatch("content/LOAD_CREATED_PLAYLISTS", { reset: true, getAll: true });
	dispatch("folders/LOAD_FOLDER_ITEMS", { context: "sidebar", reset: true, loadAll: true });
};
