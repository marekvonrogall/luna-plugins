import { ReactiveStore } from "@luna/core";

import { getPlaylistTrackIds, mapLimited, type PlaylistInfo } from "./api";

// TIDAL can't tell if a song is in a playlist, so playlists are read once and cached (across restarts) until they change

type Stored = { stamp: string; ids: string[] };

const store = ReactiveStore.getStore("@marekvonrogall/Collector.playlistContents");
const memory = new Map<string, { stamp: string; ids: Set<string> }>();
const pending = new Map<string, Promise<Set<string>>>();

const remember = (uuid: string, stamp: string, ids: Set<string>) => {
	memory.set(uuid, { stamp, ids });
	store.set<Stored>(uuid, { stamp, ids: [...ids] }).catch(() => {
		/* only a cache */
	});
};

/** Track ids of a playlist, re-read only after it changed. Shared set, don't modify */
export const playlistTrackIds = (playlist: PlaylistInfo): Promise<Set<string>> => {
	const { uuid, stamp } = playlist;
	if (stamp === undefined) return getPlaylistTrackIds(uuid);
	const known = memory.get(uuid);
	if (known?.stamp === stamp) return Promise.resolve(known.ids);

	const key = `${uuid}|${stamp}`;
	let promise = pending.get(key);
	if (promise === undefined) {
		promise = (async () => {
			const stored = await store.get<Stored>(uuid).catch(() => undefined);
			if (stored?.stamp === stamp && Array.isArray(stored.ids)) {
				const ids = new Set(stored.ids);
				memory.set(uuid, { stamp, ids });
				return ids;
			}
			const ids = await getPlaylistTrackIds(uuid);
			remember(uuid, stamp, ids);
			return ids;
		})().finally(() => pending.delete(key));
		pending.set(key, promise);
	}
	return promise;
};

/** After our own edit with a known result */
export const setPlaylistContents = (uuid: string, stamp: string | undefined, ids: Set<string>) => {
	if (stamp === undefined) forgetPlaylist(uuid);
	else remember(uuid, stamp, ids);
};

/** After adding: known contents plus the new songs, if the cache was current */
export const addToPlaylistContents = (uuid: string, before: string | undefined, after: string | undefined, added: string[]) => {
	const known = memory.get(uuid);
	if (known === undefined || before === undefined || known.stamp !== before || after === undefined) return forgetPlaylist(uuid);
	remember(uuid, after, new Set([...known.ids, ...added]));
};

/** Re-read next time */
export const forgetPlaylist = (uuid: string) => {
	memory.delete(uuid);
	store.del(uuid).catch(() => {
		/* only a cache */
	});
};

/** How many of `trackIds` each playlist has; undefined if it couldn't be read */
export const scanPlaylists = async (
	playlists: PlaylistInfo[],
	trackIds: string[],
	onResult: (playlist: PlaylistInfo, count: number | undefined) => void,
	isCancelled: () => boolean,
) => {
	await mapLimited(playlists, 3, async (playlist) => {
		if (isCancelled()) return;
		try {
			const ids = await playlistTrackIds(playlist);
			let count = 0;
			for (const id of trackIds) if (ids.has(id)) count++;
			if (!isCancelled()) onResult(playlist, count);
		} catch {
			if (!isCancelled()) onResult(playlist, undefined);
		}
	});
};
