import { Tracer, type LunaUnload } from "@luna/core";
import { Album, ContextMenu, Playlist, redux, StyleTag, type MediaCollection } from "@luna/lib";

import {
	getAlbumTracks,
	getArtistReleases,
	getFavoriteAlbums,
	getFavoriteArtists,
	getFavoriteTracks,
	getPlaylistItems,
	getTrackSource,
	HttpError,
	mapLimited,
	getPlaylistTrackIds,
	getUserPlaylists,
	refreshPlaylistLists,
	refreshPlaylistView,
	type ArtistInfo,
	toSourceTrack,
	type SourceTrack,
} from "./api";
import { setupFavoritesButton } from "./favorites";
import { OverflowError, PlaylistChain } from "./chain";
import { addProgressToastStyles, ProgressToast } from "../../../shared/progressToast";
import { pickArtists, pickTarget, type TargetChoice } from "./ui";

import styles from "file://styles.css?minify";

export const { trace, errSignal } = Tracer("[Collector]");
export const unloads = new Set<LunaUnload>();

new StyleTag("Collector", unloads, styles);
addProgressToastStyles("Collector", unloads);

const BUTTON_TEXT = "Collect";
const addAlbumsButton = ContextMenu.addButton(unloads);
const menuButton = ContextMenu.addButton(unloads);

let running = false;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Resolves the right-clicked album, playlist or songs into { trackId, albumId } pairs */
const resolveSources = async (collection: MediaCollection, onProgress: (done: number, total: number) => void): Promise<SourceTrack[]> => {
	if (collection instanceof Album) {
		const { tidalAlbum } = collection;
		return [{ albumId: String(collection.id), albumTitle: tidalAlbum.title, artist: tidalAlbum.artist?.name ?? tidalAlbum.artists?.[0]?.name }];
	}

	// Playlist items already include the album
	if (collection instanceof Playlist) {
		const items = await getPlaylistItems(String(collection.uuid));
		return items.filter((i) => i.type === "track").map((i) => toSourceTrack(i.item as redux.Track));
	}

	// Single song or selection
	const tMediaItems = (collection as { tMediaItems?: unknown }).tMediaItems;
	if (Array.isArray(tMediaItems)) {
		const tracks = (tMediaItems as { item: { id: redux.ItemId }; type: redux.ContentType }[]).filter((i) => i.type === "track");
		const sources: SourceTrack[] = [];
		for (const { item } of tracks) {
			sources.push(await getTrackSource(String(item.id)));
			onProgress(sources.length, tracks.length);
		}
		return sources;
	}

	// Fallback for other collection types
	const sources: SourceTrack[] = [];
	const total = await collection.count();
	for await (const mediaItem of await collection.mediaItems()) {
		if (mediaItem.contentType !== "track") continue;
		sources.push({ ...toSourceTrack(mediaItem.tidalItem), trackId: String(mediaItem.id) });
		onProgress(sources.length, total);
	}
	return sources;
};

type OnProgress = (done: number, total: number) => void;
type LoadSources = (onProgress: OnProgress) => Promise<SourceTrack[]>;

/** e.g. “Album” by Artist (album 123, via “Track”) */
const describeAlbum = ({ albumId, albumTitle, artist, trackTitle }: SourceTrack) => {
	const album = albumTitle ? `“${albumTitle}”` : "Unknown album";
	const by = artist ? ` by ${artist}` : "";
	const via = trackTitle ? `, via “${trackTitle}”` : "";
	return `${album}${by} (album ${albumId}${via})`;
};

const describeError = (err: unknown) => {
	if (err instanceof HttpError && err.status === 404) return "not found, probably removed or not available in your country";
	return err instanceof Error ? err.message : String(err);
};

const quoted = (titles: string[]) => titles.map((t) => `“${t}”`).join(" and ");

const addAlbumsToPlaylist = async ({ target, exclusions, playlists }: TargetChoice, loadSources: LoadSources) => {
	const toast = new ProgressToast(unloads);
	const heading = () => `Adding to “${chain?.currentTitle ?? target.title}”`;
	let chain: PlaylistChain | undefined;
	try {
		toast.update(heading(), "Reading your selection…");
		const sources = await loadSources((done, total) => toast.update(heading(), `Reading your selection… (${done}/${total})`, done / total));
		if (toast.cancelled) return;

		// Songs of exclusion playlists are never sent
		const skip = new Set<string>();
		if (exclusions.length > 0) {
			toast.update(heading(), `Reading ${plural(exclusions.length, "exclusion playlist")}…`);
			const idSets = await mapLimited(exclusions, 2, (p) => getPlaylistTrackIds(p.uuid));
			for (const ids of idSets) for (const id of ids) skip.add(id);
		}

		// Target isn't pre-read (slow for big playlists), Tidal skips dupes server-side.
		// Existing overflow playlists (“Name-2”…) are read so they don't get the same songs again.
		chain = new PlaylistChain(target, playlists, skip);
		await chain.init();
		if (toast.cancelled) return;

		const sentThisRun = new Set<string>();
		const processedAlbums = new Set<string>();

		let albumsHandled = 0;
		let noAlbum = 0;
		let aiAlbums = 0;
		let aiSongs = 0;
		let excluded = 0;
		const failedAlbums: string[] = [];

		for (let i = 0; i < sources.length; i++) {
			if (toast.cancelled) break;
			const source = sources[i];
			const { trackId, albumId } = source;

			// Album already handled via this song
			if (trackId !== undefined && sentThisRun.has(trackId)) continue;
			if (albumId === undefined) {
				noAlbum++;
				continue;
			}
			// Fetch each album only once
			if (processedAlbums.has(albumId)) continue;
			processedAlbums.add(albumId);
			if (source.aiAlbum) {
				aiAlbums++;
				continue;
			}

			toast.update(
				`${heading()} (${i + 1}/${sources.length})`,
				`${plural(albumsHandled, "album")} · ${plural(chain.added, "song")} added`,
				i / sources.length,
			);

			try {
				const { trackIds, aiCount } = await getAlbumTracks(albumId);
				// Album made up of AI songs only
				if (trackIds.length === 0 && aiCount > 0) {
					aiAlbums++;
					continue;
				}
				aiSongs += aiCount;
				const toSend: string[] = [];
				for (const id of new Set(trackIds)) {
					if (sentThisRun.has(id)) continue;
					if (chain.skip.has(id)) excluded++;
					else toSend.push(id);
				}
				if (toSend.length > 0) await chain.add(toSend, (title) => trace.log(`Playlist full, continuing in “${title}”`));
				for (const id of toSend) sentThisRun.add(id);
				albumsHandled++;
			} catch (err) {
				// Can't continue without a playlist to write into
				if (err instanceof OverflowError) {
					trace.msg.err(err.message);
					break;
				}
				const line = `${describeAlbum(source)}: ${describeError(err)}`;
				failedAlbums.push(line);
				// Keep the stack for unexpected (non-HTTP) errors
				if (err instanceof HttpError) trace.err(`Failed to add ${line}`);
				else trace.err(`Failed to add ${line}`, err);
			}
		}

		await chain.finish().catch(trace.warn.withContext("Failed to read final playlist size"));
		for (const uuid of chain.uuids) refreshPlaylistView(uuid);
		if (chain.created.length > 0) refreshPlaylistLists();

		const skipped = chain.sent - chain.added + excluded + chain.dropped;
		const summary = [
			`${toast.cancelled ? "Cancelled. " : ""}Added ${plural(chain.added, "song")} from ${plural(albumsHandled, "album")} to ${quoted(chain.titles) || `“${target.title}”`}.`,
			chain.created.length > 0 ? `Created ${quoted(chain.created)} because the playlist was full.` : "",
			skipped > 0 ? `Skipped ${plural(skipped, "song")} already in the ${exclusions.length > 0 ? "target or exclusion playlists" : "playlist"} or unavailable.` : "",
			noAlbum > 0 ? `${plural(noAlbum, "song")} had no album info.` : "",
			aiAlbums + aiSongs > 0 ? `Left out AI-generated music (${[aiAlbums > 0 ? plural(aiAlbums, "album") : "", aiSongs > 0 ? plural(aiSongs, "song") : ""].filter(Boolean).join(", ")}).` : "",
			failedAlbums.length > 0 ? `${plural(failedAlbums.length, "album")} failed (see console).` : "",
		]
			.filter(Boolean)
			.join(" ");
		if (failedAlbums.length > 0) {
			trace.err(`${plural(failedAlbums.length, "album")} failed:\n${failedAlbums.map((line) => `  • ${line}`).join("\n")}`);
			trace.msg.warn(summary);
		} else trace.msg.log(summary);
	} finally {
		toast.remove();
	}
};

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

/** Asks for a target playlist, then collects the albums of the loaded songs into it */
const startCollect = async (subtitle: string, loadSources: LoadSources, sourcePlaylistUuid?: string) => {
	if (running) return;
	// The playlist being collected from can't be its own target
	const choice = await pickTarget(unloads, getUserPlaylists, subtitle, sourcePlaylistUuid);
	if (choice === undefined) return;

	running = true;
	try {
		await addAlbumsToPlaylist(choice, loadSources);
	} catch (err) {
		trace.msg.err.withContext("Failed to add albums to playlist")(err as Error);
	} finally {
		running = false;
	}
};

ContextMenu.onMediaItem(unloads, async ({ mediaCollection, contextMenu }) => {
	const count = await mediaCollection.count();
	if (count === 0) return;

	addAlbumsButton.text = running ? "Adding albums to playlist…" : BUTTON_TEXT;
	addAlbumsButton.onClick(() => {
		if (running) return;
		try {
			redux.actions["contextMenu/CLOSE"]();
		} catch {
			/* menu may already be closed */
		}

		const subtitle =
			mediaCollection instanceof Album
				? `The album “${mediaCollection.tidalAlbum.title}” will be added.`
				: mediaCollection instanceof Playlist
					? `The full album of every song in “${mediaCollection.tidalPlaylist.title}” will be added.`
					: `The full album of ${count === 1 ? "the selected song" : `each of the ${count} selected songs`} will be added.`;
		const sourcePlaylistUuid = mediaCollection instanceof Playlist ? String(mediaCollection.uuid) : undefined;
		startCollect(subtitle, (onProgress) => resolveSources(mediaCollection, onProgress), sourcePlaylistUuid);
	});

	await showClean(addAlbumsButton, contextMenu);
});

/** Releases of the given artists, a few artists at a time */
const loadArtistsReleases = async (artists: ArtistInfo[], onProgress: OnProgress) => {
	let done = 0;
	const releases = await mapLimited(artists, 4, async (artist) => {
		try {
			return await getArtistReleases(artist.id);
		} catch (err) {
			trace.err(`Failed to load releases of ${artist.name} (artist ${artist.id}): ${describeError(err)}`);
			return [];
		} finally {
			onProgress(++done, artists.length);
		}
	});
	return releases.flat();
};

/** `prepare` runs before the playlist picker and may cancel by returning undefined */
type MenuAction = { subtitle: string; prepare: () => Promise<LoadSources | undefined> };

/** What "Collect" does in the "..." menus TIDAL opens via contextMenu/OPEN */
const getMenuAction = (event: redux.ActionPayloads["contextMenu/OPEN"]): MenuAction | undefined => {
	switch (event.type) {
		// Artist page: the whole discography
		case "ARTIST": {
			const artistId = String(event.id);
			const artistName = redux.store.getState().content.artists[artistId]?.name;
			return { subtitle: `Every album and single by ${artistName ?? "this artist"} will be added.`, prepare: async () => () => getArtistReleases(artistId) };
		}
		// My Collection → Albums
		case "MY_ALBUMS_SORT_ORDER":
			return { subtitle: "Every song of every album in your collection will be added.", prepare: async () => () => getFavoriteAlbums() };
		// My Collection → Artists
		case "MY_ARTISTS_SORT_ORDER":
			return {
				subtitle: "Every album and single of the selected artists will be added.",
				prepare: async () => {
					const artists = await pickArtists(unloads, getFavoriteArtists);
					return artists && ((onProgress) => loadArtistsReleases(artists, onProgress));
				},
			};
	}
};

ContextMenu.onOpen(unloads, async ({ event, contextMenu }) => {
	const action = getMenuAction(event);
	if (action === undefined) {
		// Shown only with the console's "Verbose" level, helps finding menu types to support
		console.debug("[Collector] No Collect for context menu type", event.type);
		return;
	}

	menuButton.text = running ? "Adding albums to playlist…" : BUTTON_TEXT;
	menuButton.onClick(async () => {
		if (running) return;
		try {
			redux.actions["contextMenu/CLOSE"]();
		} catch {
			/* menu may already be closed */
		}
		const load = await action.prepare();
		if (load !== undefined) startCollect(action.subtitle, load);
	});

	await showClean(menuButton, contextMenu);
});

setupFavoritesButton(unloads, () =>
	startCollect("The full album of every song in your favorites will be added.", () => getFavoriteTracks()),
);
