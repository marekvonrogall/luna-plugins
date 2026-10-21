import { redux } from "@luna/lib";

import { fetchPlaylistItems } from "../../../shared/playlistItems";
import { trackExists } from "./api";
import { trace } from "./core";
import { ownEditListeners } from "./ratings";
import { canonicalId, linkTrackIds } from "./store";

/**
 * TIDAL replaces track ids. Playlist tables keep showing the old id, while the API returns the current id at the
 * same position. Rows with an id the API doesn't list are matched to the API's song (by position, else by title and
 * length) and linked once TIDAL confirms the old id is gone, so suggestion rows never get linked.
 */

type Entry = { id: string; title: string; artists: string[]; duration?: number };
/** `misses`: rows (id@position) checked without a match. `adoptUntil`: after our own edit, the next version is taken over */
type PlaylistIds = { version: string; at: number; entries: Entry[]; ids: Set<string>; misses: Set<string>; adoptUntil?: number };

const lists = new Map<string, PlaylistIds>();
const loading = new Map<string, Promise<void>>();
const failedAt = new Map<string, number>();
const MAX_AGE = 5 * 60 * 1000;
const checking = new Set<string>();
/** Ids TIDAL still knows: never linked */
const alive = new Set<string>();
const RETRY_AFTER = 60 * 1000;

const normalize = (text: string | null | undefined) =>
	(text ?? "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

/** Changes when the playlist is edited */
const playlistVersion = (uuid: string) => {
	const playlist = redux.store.getState().content.playlists[uuid];
	return `${playlist?.lastUpdated ?? ""}|${playlist?.numberOfTracks ?? ""}`;
};

const OWN_EDIT_WINDOW = 30 * 1000;

const entryOf = (id: string): Entry => {
	const item = redux.store.getState().content.mediaItems[id]?.item;
	return {
		id,
		title: normalize(item?.title),
		artists: (item?.artists ?? []).map((artist) => normalize(artist.name)),
		duration: item?.duration ?? undefined,
	};
};

// Added songs go to the end
ownEditListeners.add((uuid, added, removed) => {
	const list = lists.get(uuid);
	if (list === undefined) return;
	const gone = new Set(removed);
	list.entries = list.entries.filter((entry) => !gone.has(entry.id));
	for (const id of added) if (!list.entries.some((entry) => entry.id === id)) list.entries.push(entryOf(id));
	list.ids = new Set(list.entries.map((entry) => entry.id));
	list.misses.clear();
	list.adoptUntil = Date.now() + OWN_EDIT_WINDOW;
});

/** The API's copy of the playlist; undefined until loaded, then `onLoaded` runs */
const playlistIds = (uuid: string, onLoaded: () => void) => {
	const version = playlistVersion(uuid);
	const cached = lists.get(uuid);
	if (cached !== undefined && cached.version !== version && (cached.adoptUntil ?? 0) > Date.now()) {
		cached.version = version;
		cached.adoptUntil = undefined;
	}
	if (cached?.version === version && Date.now() - cached.at < MAX_AGE) return cached;
	if (!loading.has(uuid) && Date.now() - (failedAt.get(uuid) ?? 0) > RETRY_AFTER) {
		const load = fetchPlaylistItems(uuid)
			.then((items) => {
				const entries = items.map(({ item }) => ({
					id: String(item.id),
					title: normalize(item.title),
					artists: (item.artists ?? []).map((artist) => normalize(artist.name)),
					duration: item.duration ?? undefined,
				}));
				lists.set(uuid, { version, at: Date.now(), entries, ids: new Set(entries.map((entry) => entry.id)), misses: new Set() });
				onLoaded();
			})
			.catch((err) => {
				failedAt.set(uuid, Date.now());
				trace.warn.withContext("Couldn't load the playlist to match old song ids")(err as Error);
			})
			.finally(() => loading.delete(uuid));
		loading.set(uuid, load);
	}
	return cached;
};

const currentPlaylistUuid = () => {
	const path = redux.store.getState().router?.currentPath ?? window.location.pathname;
	return /^\/playlist\/([0-9a-f-]{36})/i.exec(path)?.[1];
};

const rowIndex = (row: HTMLElement) => {
	const value = row.getAttribute("data-index") ?? row.closest("[data-index]")?.getAttribute("data-index");
	return value === null || value === undefined || value === "" ? undefined : Number(value);
};

/** The row's song from TIDAL's store, or else its text */
const describeRow = (row: HTMLElement, trackId: string) => {
	const item = redux.store.getState().content.mediaItems[trackId]?.item;
	if (item === undefined) return { text: normalize(row.textContent) };
	return {
		title: normalize(item.title),
		artists: (item.artists ?? []).map((artist) => normalize(artist.name)),
		duration: item.duration ?? undefined,
	};
};

const sameSong = (entry: Entry, row: ReturnType<typeof describeRow>) => {
	if (entry.title === "") return false;
	if ("text" in row) return row.text.includes(entry.title) && entry.artists.some((artist) => artist !== "" && row.text.includes(artist));
	if (row.title !== entry.title) return false;
	if (row.duration !== undefined && entry.duration !== undefined && Math.abs(row.duration - entry.duration) > 2) return false;
	return row.artists.length === 0 || entry.artists.some((artist) => row.artists.includes(artist));
};

/** The id to rate a row by: its own, or the current one if it shows an old id. `onLoaded` asks for a re-check. */
export const resolveRowId = (row: HTMLElement, trackId: string, onLoaded: () => void) => {
	const known = canonicalId(trackId);
	if (known !== trackId) return known;
	const uuid = currentPlaylistUuid();
	if (uuid === undefined) return trackId;
	const list = playlistIds(uuid, onLoaded);
	if (list === undefined || list.ids.has(trackId) || alive.has(trackId)) return trackId;

	const index = rowIndex(row);
	const key = `${trackId}@${index}`;
	if (list.misses.has(key)) return trackId;
	const song = describeRow(row, trackId);
	let match = index === undefined ? undefined : list.entries[index];
	if (match !== undefined && !sameSong(match, song)) match = undefined;
	if (match === undefined && !("text" in song)) {
		const candidates = list.entries.filter((entry) => sameSong(entry, song));
		if (candidates.length === 1) match = candidates[0];
	}
	if (match === undefined || match.id === trackId) {
		// Text-only rows are retried once TIDAL's data is there
		if (!("text" in song)) list.misses.add(key);
		return trackId;
	}
	if (!checking.has(trackId)) {
		checking.add(trackId);
		const current = match.id;
		let retry = true;
		trackExists(trackId)
			.then((exists) => {
				retry = exists === undefined;
				if (exists === true) alive.add(trackId);
				else if (exists === false && linkTrackIds(trackId, current)) {
					trace.log(`Song ${trackId} is stored as ${current}`);
					onLoaded();
				}
			})
			.catch(() => {})
			// Offline: retry later, not every frame
			.finally(() => (retry ? setTimeout(() => checking.delete(trackId), RETRY_AFTER) : checking.delete(trackId)));
	}
	return trackId;
};
