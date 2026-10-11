import { Tracer, type LunaUnload } from "@luna/core";
import { Album, ContextMenu, Playlist, redux, StyleTag, type MediaCollection } from "@luna/lib";

import {
	getAlbumTrackIds,
	getArtistReleases,
	getFavoriteAlbums,
	getFavoriteArtists,
	getFavoriteTracks,
	getPlaylistItems,
	getTrackSource,
	HttpError,
	mapLimited,
	getUserPlaylists,
	PlaylistWriter,
	refreshPlaylistView,
	type PlaylistInfo,
	toSourceTrack,
	type SourceTrack,
} from "./api";
import { setupFavoritesButton } from "./favorites";
import { pickPlaylist, ProgressToast } from "./ui";

import styles from "file://styles.css?minify";

export const { trace, errSignal } = Tracer("[Collector]");
export const unloads = new Set<LunaUnload>();

new StyleTag("Collector", unloads, styles);

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

const addAlbumsToPlaylist = async (target: PlaylistInfo, loadSources: LoadSources, sourcePlaylistUuid?: string) => {
	const toast = new ProgressToast(unloads);
	try {
		toast.update(`Adding to “${target.title}”`, "Reading your selection…");
		const sources = await loadSources((done, total) =>
			toast.update(`Adding to “${target.title}”`, `Reading your selection… (${done}/${total})`, done / total),
		);
		if (toast.cancelled) return;

		// Target isn't pre-read (slow for big playlists), Tidal skips dupes server-side
		const writer = new PlaylistWriter(target.uuid);

		// Already in the target if the source playlist is the target
		const knownInTarget = new Set<string>();
		if (sourcePlaylistUuid === target.uuid) {
			for (const { trackId } of sources) if (trackId !== undefined) knownInTarget.add(trackId);
		}
		const sentThisRun = new Set<string>();
		const processedAlbums = new Set<string>();

		let albumsHandled = 0;
		let noAlbum = 0;
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

			toast.update(
				`Adding to “${target.title}” (${i + 1}/${sources.length})`,
				`${plural(albumsHandled, "album")} · ${plural(writer.added, "song")} added`,
				i / sources.length,
			);

			try {
				const albumTrackIds = await getAlbumTrackIds(albumId);
				const toSend = [...new Set(albumTrackIds)].filter((id) => !knownInTarget.has(id) && !sentThisRun.has(id));
				if (toSend.length > 0) await writer.add(toSend);
				for (const id of toSend) sentThisRun.add(id);
				albumsHandled++;
			} catch (err) {
				const line = `${describeAlbum(source)}: ${describeError(err)}`;
				failedAlbums.push(line);
				// Keep the stack for unexpected (non-HTTP) errors
				if (err instanceof HttpError) trace.err(`Failed to add ${line}`);
				else trace.err(`Failed to add ${line}`, err);
			}
		}

		await writer.finish().catch(trace.warn.withContext("Failed to read final playlist size"));
		if (writer.added > 0) refreshPlaylistView(target.uuid);

		const skipped = writer.sent - writer.added;
		const summary = [
			`${toast.cancelled ? "Cancelled. " : ""}Added ${plural(writer.added, "song")} from ${plural(albumsHandled, "album")} to “${target.title}”.`,
			skipped > 0 ? `Skipped ${plural(skipped, "song")} already in the playlist or unavailable.` : "",
			noAlbum > 0 ? `${plural(noAlbum, "song")} had no album info.` : "",
			failedAlbums.length > 0 ? `${plural(failedAlbums.length, "album")} failed (see console).` : "",
		]
			.filter(Boolean)
			.join(" ");
		if (failedAlbums.length > 0) {
			trace.err(`${plural(failedAlbums.length, "album")} failed:\n${failedAlbums.map((line) => `  • ${line}`).join("\n")}`);
			trace.msg.warn(summary);
		}
		else trace.msg.log(summary);
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
	const target = await pickPlaylist(unloads, getUserPlaylists, `${subtitle} Songs already in the playlist are skipped.`);
	if (target === undefined) return;

	running = true;
	try {
		await addAlbumsToPlaylist(target, loadSources, sourcePlaylistUuid);
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

/** Releases of every followed artist, a few artists at a time */
const loadFollowedArtistsReleases: LoadSources = async (onProgress) => {
	const artists = await getFavoriteArtists();
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

type MenuAction = { subtitle: string; load: LoadSources };

/** What "Collect" does in the "..." menus TIDAL opens via contextMenu/OPEN */
const getMenuAction = (event: redux.ActionPayloads["contextMenu/OPEN"]): MenuAction | undefined => {
	switch (event.type) {
		// Artist page: the whole discography
		case "ARTIST": {
			const artistId = String(event.id);
			const artistName = redux.store.getState().content.artists[artistId]?.name;
			return { subtitle: `Every album and single by ${artistName ?? "this artist"} will be added.`, load: () => getArtistReleases(artistId) };
		}
		// My Collection → Albums
		case "MY_ALBUMS_SORT_ORDER":
			return { subtitle: "Every song of every album in your collection will be added.", load: () => getFavoriteAlbums() };
		// My Collection → Artists
		case "MY_ARTISTS_SORT_ORDER":
			return { subtitle: "Every album and single of every artist you follow will be added.", load: loadFollowedArtistsReleases };
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
	menuButton.onClick(() => {
		if (running) return;
		try {
			redux.actions["contextMenu/CLOSE"]();
		} catch {
			/* menu may already be closed */
		}
		startCollect(action.subtitle, action.load);
	});

	await showClean(menuButton, contextMenu);
});

setupFavoritesButton(unloads, () =>
	startCollect("The full album of every song in your favorites will be added.", () => getFavoriteTracks()),
);
