import { type LunaUnload } from "@luna/core";
import { Album, ContextMenu, MediaItems, Playlist, redux, StyleTag, type MediaCollection } from "@luna/lib";

import { getArtistReleases, getFavoriteAlbumArtists, getFavoriteAlbums, getFavoriteArtists, getFavoriteTrackArtists, getFavoriteTracks, getUserPlaylists, type ArtistInfo, type PlaylistInfo } from "./api";
import { collectAlbums, loadArtistsReleases } from "./collect";
import { addToPlaylists, removeFromPlaylists } from "./edit";
import { setupFavoritesButton } from "./favorites";
import { forgetPlaylist, scanPlaylists } from "./membership";
import { MENU_CSS, setTick, setupMenuRestore, showPlaylistTools, type EntryHandle, type PlaylistTools, type SubmenuBuilder } from "./menu";
import { getSelection, type LoadSources, type Selection } from "./selection";
import { trace } from "./trace";
import { PICKER_CSS, pickArtists, pickCollectTargets, pickPlaylists, type PlaylistChanges } from "./ui";
import { MULTI_SELECT_MENU, onMultiSelectMenu } from "../../../shared/multiSelectMenu";
import { addPlaylistPickerStyles } from "../../../shared/playlistPicker";
import { addProgressToastStyles } from "../../../shared/progressToast";

import styles from "file://styles.css?minify";

export { errSignal, trace } from "./trace";
export const unloads = new Set<LunaUnload>();

new StyleTag("Collector", unloads, styles);
new StyleTag("Collector-menu", unloads, MENU_CSS);
new StyleTag("Collector-picker", unloads, PICKER_CSS);
addProgressToastStyles("Collector", unloads);
addPlaylistPickerStyles("Collector", unloads);
setupMenuRestore(unloads);

const MENU_LABEL = "Playlist Tools";
/** Latest playlists also checked for several songs */
const RECENT_COUNT = 10;
/** Luna buttons for the "..." menus, reused across menus */
const menuButtons: ReturnType<typeof ContextMenu.addButton>[] = [];

let running = false;

/** Needed on every right-click, so kept briefly */
const LIST_MAX_AGE = 15_000;
let playlistList: { at: number; promise: Promise<PlaylistInfo[]> } | undefined;
const recentUserPlaylists = () => {
	if (playlistList === undefined || Date.now() - playlistList.at > LIST_MAX_AGE) {
		const promise = getUserPlaylists();
		playlistList = { at: Date.now(), promise };
		promise.catch(() => (playlistList = undefined));
	}
	return playlistList.promise;
};
const playlistChanged = (uuid: unknown) => {
	playlistList = undefined;
	if (uuid !== undefined && uuid !== null) forgetPlaylist(String(uuid));
};
// Changes made with TIDAL's own menus
redux.intercept("content/ADD_MEDIA_ITEMS_TO_PLAYLIST_SUCCESS", unloads, (payload) => playlistChanged(payload?.playlistUUID));
redux.intercept("content/REMOVE_MEDIA_ITEMS_FROM_PLAYLIST_SUCCESS", unloads, (payload) => playlistChanged(payload?.playlistUUID));

const closeContextMenu = () => {
	// TIDAL's multi-select menu ignores contextMenu/CLOSE
	const local = document.querySelector<HTMLElement>(`${MULTI_SELECT_MENU} [data-test="context-menu-close-button"]`);
	try {
		redux.actions["contextMenu/CLOSE"]();
	} catch {
		/* menu may already be closed */
	}
	local?.click();
};

/** Runs one playlist change at a time */
const exclusive = async (what: string, task: () => Promise<void>) => {
	if (running) {
		trace.msg.warn("Collector is still busy, please wait until it's done.");
		return;
	}
	running = true;
	try {
		await task();
	} catch (err) {
		trace.msg.err.withContext(what)(err as Error);
	} finally {
		running = false;
	}
};

/** Asks for targets, then collects the albums of the loaded songs */
const startCollect = async (subtitle: string, loadSources: LoadSources, sourcePlaylistUuid?: string) => {
	if (running) return trace.msg.warn("Collector is still busy, please wait until it's done.");
	// The playlist being collected from can't be its own target
	const choice = await pickCollectTargets(unloads, getUserPlaylists, subtitle, sourcePlaylistUuid);
	if (choice === undefined) return;
	await exclusive("Failed to collect", () => collectAlbums(unloads, choice, loadSources));
};

const editPlaylists = async (selection: Selection, mode: "add" | "remove") => {
	// Like TIDAL's dialog: title only
	const changes = await pickPlaylists(unloads, getUserPlaylists, {
		title: mode === "add" ? "Add to playlists" : "Remove from playlists",
		mode,
		trackIds: selection.trackIds,
		hideUuid: selection.playlistUuid,
	});
	if (changes === undefined) return;
	await applyChanges(selection, changes);
};

const applyChanges = (selection: Selection, { add, remove }: PlaylistChanges) =>
	exclusive("Failed to change playlists", async () => {
		const trackIds = await selection.trackIds();
		if (add.length > 0) await addToPlaylists(add, trackIds);
		if (remove.length > 0) await removeFromPlaylists(remove, trackIds);
		playlistList = undefined;
	});

/** From a playlist clicked in the menu */
const removeFromOne = async (selection: Selection, uuid: string, title: string) => {
	const known = await recentUserPlaylists().catch(() => []);
	await applyChanges(selection, { add: [], remove: [known.find((p) => p.uuid === uuid) ?? { uuid, title, numberOfTracks: 0 }] });
};

/** Playlists with (some of) the songs: all with `all`, else only `include`d ones. Cached, quick after the first time */
const findPlaylistsWith = (selection: Selection, all: boolean) => {
	const state = { found: [] as PlaylistInfo[], counts: new Map<string, number | undefined>(), total: 0, done: !all, failed: false };
	const listeners = new Set<() => void>();
	const requested = new Set<string>();
	let scanning = 0;
	let stopped = false;
	const notify = () => {
		if (!stopped) for (const listener of listeners) listener();
	};
	const base = Promise.all([recentUserPlaylists(), selection.trackIds()]).then(([playlists, trackIds]) => {
		state.total = trackIds.length;
		return { playlists, trackIds, byUuid: new Map(playlists.map((p) => [p.uuid, p])), order: new Map(playlists.map((p, i) => [p.uuid, i])) };
	});
	const scan = async (uuids?: string[]) => {
		const { playlists, trackIds, byUuid, order } = await base;
		const targets = (uuids ? uuids.flatMap((uuid) => byUuid.get(uuid) ?? []) : playlists).filter((p) => !requested.has(p.uuid));
		if (targets.length === 0 || stopped) return;
		for (const p of targets) requested.add(p.uuid);
		scanning++;
		state.done = false;
		notify();
		try {
			await scanPlaylists(
				targets,
				trackIds,
				(playlist, count) => {
					state.counts.set(playlist.uuid, count);
					if ((count ?? 0) > 0) {
						state.found.push(playlist);
						state.found.sort((a, b) => order.get(a.uuid)! - order.get(b.uuid)!);
					}
					notify();
				},
				() => stopped,
			);
		} finally {
			state.done = --scanning === 0;
			notify();
		}
	};
	const run = (uuids?: string[]) =>
		scan(uuids).catch((err) => {
			state.failed = true;
			state.done = true;
			trace.warn("Couldn't check which playlists have the songs", err);
			notify();
		});
	if (all) void run();
	return {
		state,
		onChange: (listener: () => void) => listeners.add(listener),
		stop: () => (stopped = true),
		include: (uuids: string[]) => void run(uuids),
		/** Also the user's latest playlists */
		includeLatest: (count: number) => void base.then(({ playlists }) => run(playlists.slice(0, count).map((p) => p.uuid))),
	};
};
type Search = ReturnType<typeof findPlaylistsWith>;

/** Tick if all songs are in it, dash if some */
const tickState = (count: number | undefined, total: number) => (!count ? "none" : count >= total ? "all" : "some");

/** Ticks in TIDAL's recent playlists, reapplied when TIDAL re-renders */
const tickRecentPlaylists = (tools: PlaylistTools, search: Search) => {
	const apply = () => {
		const recent = tools.recentPlaylists();
		// TIDAL often fills these in late
		search.include(recent.map((p) => p.uuid));
		for (const { uuid, row } of recent) {
			if (search.state.counts.has(uuid)) setTick(row, tickState(search.state.counts.get(uuid), search.state.total));
		}
	};
	apply();
	if (tools.native === null) return apply;
	let queued = false;
	const observer = new MutationObserver(() => {
		if (queued) return;
		queued = true;
		requestAnimationFrame(() => {
			queued = false;
			apply();
		});
	});
	observer.observe(tools.native, { childList: true, subtree: true });
	tools.onClose(() => observer.disconnect());
	return apply;
};

/** TIDAL's "Show all playlists" opens our dialog instead */
const replaceShowAll = (tools: PlaylistTools, onShowAll: () => void) => {
	const native = tools.native;
	if (native === null) return;
	const onClick = (e: Event) => {
		if (!(e.target as Element | null)?.closest?.('[data-track--icon-clicked="show_all_playlists"]')) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		onShowAll();
	};
	// Capture phase: TIDAL's handler never sees the click
	native.addEventListener("click", onClick, true);
	tools.onClose(() => native.removeEventListener("click", onClick, true));
};

const collectAlbumsOf = (selection: Selection, collection: unknown) => {
	const subtitle =
		collection instanceof Album
			? `${selection.what[0].toUpperCase()}${selection.what.slice(1)} will be added.`
			: `The full album of ${selection.single ? "this song" : `each of ${selection.what}`} will be added.`;
	return startCollect(subtitle, selection.sources, selection.playlistUuid);
};

/** Pick artists (skipped for a single one), then collect their discographies */
const collectArtists = async (loadArtists: () => Promise<ArtistInfo[]>, sourcePlaylistUuid?: string) => {
	if (running) return trace.msg.warn("Collector is still busy, please wait until it's done.");
	const artists = await pickArtists(unloads, loadArtists, {
		title: "Collect artists",
		subtitle: "Every album and single of the ticked artists will be added.",
		skipSingle: true,
	});
	if (artists === undefined || artists.length === 0) return;
	const names = artists.length === 1 ? artists[0].name : `the ${artists.length} selected artists`;
	await startCollect(`Every album and single by ${names} will be added.`, (onProgress) => loadArtistsReleases(artists, onProgress), sourcePlaylistUuid);
};

/** A menu's subject, to set it up only once */
const collectionKey = (collection: MediaCollection) => {
	if (collection instanceof Album) return `album:${collection.id}`;
	if (collection instanceof Playlist) return `playlist:${collection.uuid}`;
	if (collection instanceof MediaItems) return `items:${collection.tMediaItems.map((i) => i.item.id).join(",")}`;
	return "other";
};
const KEY_ATTR = "data-collector-for";
const attaching = new WeakSet<Element>();

/** Adds "Playlist Tools", once per menu and selection */
const addPlaylistTools = async (contextMenu: Element, collection: MediaCollection) => {
	const key = collectionKey(collection);
	if (attaching.has(contextMenu)) return;
	if (contextMenu.getAttribute(KEY_ATTR) === key && contextMenu.querySelector("[data-collector-submenu]")) return;
	attaching.add(contextMenu);
	try {
		await setUpPlaylistTools(contextMenu, collection);
		contextMenu.setAttribute(KEY_ATTR, key);
	} finally {
		attaching.delete(contextMenu);
	}
};

const setUpPlaylistTools = async (contextMenu: Element, collection: MediaCollection) => {
	const count = await collection.count();
	if (count === 0) return;
	const selection = getSelection(collection, count);
	if (selection.count === 0) return;
	// Album(s)/Artist(s) by song count
	const many = collection instanceof Playlist || (!(collection instanceof Album) && selection.count > 1);
	const s = many ? "s" : "";

	const run = (action: () => unknown) => () => {
		closeContextMenu();
		action();
	};
	// One song: every playlist; several: the recent ones
	const search: Search = findPlaylistsWith(selection, selection.single);
	if (!selection.single) search.includeLatest(RECENT_COUNT);
	let tools: PlaylistTools | undefined;
	let removeEntry: EntryHandle | undefined;
	let removeMenu: SubmenuBuilder | undefined;

	/** "Show all playlists", then playlists with the songs */
	const fillRemoveMenu = () => {
		const menu = removeMenu;
		if (menu === undefined) return;
		menu.clear();
		menu.item("Show all playlists", run(() => editPlaylists(selection, "remove")));
		const { found, done, counts, total } = search.state;
		if (found.length > 0) menu.heading(selection.single ? "In playlists" : "Recent");
		for (const { uuid, title } of found) setTick(menu.item(title, run(() => removeFromOne(selection, uuid, title))), tickState(counts.get(uuid), total));
		if (!done) menu.heading("Checking playlists…");
		menu.reposition();
	};

	tools = await showPlaylistTools(unloads, contextMenu, MENU_LABEL, [
		{
			label: "Remove from playlist",
			submenu: (menu) => {
				removeMenu = menu;
				fillRemoveMenu();
			},
			ref: (handle) => (removeEntry = handle),
		},
		{ label: `Collect Album${s}`, onClick: run(() => collectAlbumsOf(selection, collection)) },
		{ label: `Collect Artist${s}`, onClick: run(() => collectArtists(selection.artists, selection.playlistUuid)) },
	]);
	if (tools === undefined) {
		search.stop();
		return;
	}
	const found = search;
	tools.onClose(() => found.stop());
	replaceShowAll(tools, run(() => editPlaylists(selection, "add")));

	const retick = tickRecentPlaylists(tools, found);
	const update = () => {
		retick();
		fillRemoveMenu();
		// Nothing to remove a single song from
		const { done, failed } = found.state;
		if (selection.single) removeEntry?.setDisabled(done && !failed && found.state.found.length === 0);
	};
	found.onChange(update);
	update();
};

// Luna's element may be a closing menu
const currentMenu = (fallback: Element) => document.querySelector('[data-test="contextmenu"] > [data-type="list-container__context-menu"]') ?? fallback;
ContextMenu.onMediaItem(unloads, ({ mediaCollection, contextMenu }) => addPlaylistTools(currentMenu(contextMenu), mediaCollection));

onMultiSelectMenu(unloads, ({ mediaCollection, contextMenu }) => addPlaylistTools(contextMenu, mediaCollection));

/** Our menu entry is cloned from TIDAL's first entry, so strip its disabled state and extra icons */
const showClean = async (button: ReturnType<typeof ContextMenu.addButton>, contextMenu: Element) => {
	const elem = await button.show(contextMenu);
	const item = elem?.closest('[data-type="contextmenu-item"]');
	if (!elem || !item) return;
	// Keep only the label, e.g. drop the sort arrow of the sort-order menus
	for (const sibling of [...(elem.parentElement?.children ?? [])]) if (sibling !== elem) sibling.remove();
	for (const node of [item, ...item.querySelectorAll("*")]) {
		node.removeAttribute("disabled");
		node.removeAttribute("aria-disabled");
		node.removeAttribute("data-disabled");
		for (const cls of [...node.classList]) if (/disabled/i.test(cls)) node.classList.remove(cls);
	}
};

type MenuAction = { label: string; onClick: () => unknown };

/** Entries for the "..." menus TIDAL opens via contextMenu/OPEN */
const getMenuActions = (event: redux.ActionPayloads["contextMenu/OPEN"]): MenuAction[] => {
	switch (event.type) {
		// Artist page: the whole discography
		case "ARTIST": {
			const artistId = String(event.id);
			const artistName = redux.store.getState().content.artists[artistId]?.name;
			const subtitle = `Every album and single by ${artistName ?? "this artist"} will be added.`;
			return [{ label: "Collect Artist", onClick: () => startCollect(subtitle, () => getArtistReleases(artistId)) }];
		}
		// My Collection → Albums
		case "MY_ALBUMS_SORT_ORDER":
			return [
				{ label: "Collect Albums", onClick: () => startCollect("Every song of every album in your collection will be added.", () => getFavoriteAlbums()) },
				{ label: "Collect Artists", onClick: () => collectArtists(getFavoriteAlbumArtists) },
			];
		// My Collection → Artists
		case "MY_ARTISTS_SORT_ORDER":
			return [{ label: "Collect Artists", onClick: () => collectArtists(getFavoriteArtists) }];
	}
	return [];
};

ContextMenu.onOpen(unloads, async ({ event, contextMenu }) => {
	const actions = getMenuActions(event);
	if (actions.length === 0) {
		// Shown only with the console's "Verbose" level, helps finding menu types to support
		console.debug("[Collector] No Collect for context menu type", event.type);
		return;
	}
	for (const [i, action] of actions.entries()) {
		const button = (menuButtons[i] ??= ContextMenu.addButton(unloads));
		button.text = action.label;
		button.onClick(() => {
			closeContextMenu();
			action.onClick();
		});
		await showClean(button, contextMenu);
	}
});

setupFavoritesButton(unloads, [
	{ label: "Collect Albums", onClick: () => startCollect("The full album of every song in your favorites will be added.", () => getFavoriteTracks()) },
	{ label: "Collect Artists", onClick: () => collectArtists(getFavoriteTrackArtists) },
]);
