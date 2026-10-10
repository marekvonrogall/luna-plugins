import { Tracer, type LunaUnload } from "@luna/core";
import { Album, ContextMenu, Playlist, redux, StyleTag, type MediaCollection } from "@luna/lib";

import {
	getAlbumTrackIds,
	getPlaylistItems,
	getTrackAlbumId,
	getUserPlaylists,
	PlaylistWriter,
	refreshPlaylistView,
	type PlaylistInfo,
	type SourceTrack,
} from "./api";
import { pickPlaylist, ProgressToast } from "./ui";

import styles from "file://styles.css?minify";

export const { trace, errSignal } = Tracer("[Collector]");
export const unloads = new Set<LunaUnload>();

new StyleTag("Collector", unloads, styles);

const BUTTON_TEXT = "Collect";
const addAlbumsButton = ContextMenu.addButton(unloads);

let running = false;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Resolves the right-clicked album, playlist or songs into { trackId, albumId } pairs */
const resolveSources = async (collection: MediaCollection, onProgress: (done: number, total: number) => void): Promise<SourceTrack[]> => {
	if (collection instanceof Album) return [{ albumId: String(collection.id) }];

	// Playlist items already include the album
	if (collection instanceof Playlist) {
		const items = await getPlaylistItems(String(collection.uuid));
		return items
			.filter((i) => i.type === "track")
			.map((i) => {
				const albumId = (i.item as redux.Track).album?.id;
				return { trackId: String(i.item.id), albumId: albumId === undefined || albumId === null ? undefined : String(albumId) };
			});
	}

	// Single song or selection
	const tMediaItems = (collection as { tMediaItems?: unknown }).tMediaItems;
	if (Array.isArray(tMediaItems)) {
		const tracks = (tMediaItems as { item: { id: redux.ItemId }; type: redux.ContentType }[]).filter((i) => i.type === "track");
		const sources: SourceTrack[] = [];
		for (const { item } of tracks) {
			const trackId = String(item.id);
			sources.push({ trackId, albumId: await getTrackAlbumId(trackId) });
			onProgress(sources.length, tracks.length);
		}
		return sources;
	}

	// Fallback for other collection types
	const sources: SourceTrack[] = [];
	const total = await collection.count();
	for await (const mediaItem of await collection.mediaItems()) {
		if (mediaItem.contentType !== "track") continue;
		const albumId = mediaItem.tidalItem.album?.id;
		sources.push({ trackId: String(mediaItem.id), albumId: albumId === undefined || albumId === null ? undefined : String(albumId) });
		onProgress(sources.length, total);
	}
	return sources;
};

const addAlbumsToPlaylist = async (collection: MediaCollection, target: PlaylistInfo) => {
	const toast = new ProgressToast(unloads);
	try {
		toast.update(`Adding to “${target.title}”`, "Reading your selection…");
		const sources = await resolveSources(collection, (done, total) =>
			toast.update(`Adding to “${target.title}”`, `Reading your selection… (${done}/${total})`, done / total),
		);
		if (toast.cancelled) return;

		// Target isn't pre-read (slow for big playlists), Tidal skips dupes server-side
		const writer = new PlaylistWriter(target.uuid);

		// Already in the target if the source playlist is the target
		const knownInTarget = new Set<string>();
		if (collection instanceof Playlist && String(collection.uuid) === target.uuid) {
			for (const { trackId } of sources) if (trackId !== undefined) knownInTarget.add(trackId);
		}
		const sentThisRun = new Set<string>();
		const processedAlbums = new Set<string>();

		let albumsHandled = 0;
		let noAlbum = 0;
		const failedAlbums: string[] = [];

		for (let i = 0; i < sources.length; i++) {
			if (toast.cancelled) break;
			const { trackId, albumId } = sources[i];

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
				failedAlbums.push(albumId);
				trace.err.withContext(`Failed to add album ${albumId}`)(err as Error);
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
		if (failedAlbums.length > 0) trace.msg.warn(summary);
		else trace.msg.log(summary);
	} finally {
		toast.remove();
	}
};

ContextMenu.onMediaItem(unloads, async ({ mediaCollection, contextMenu }) => {
	const count = await mediaCollection.count();
	if (count === 0) return;

	addAlbumsButton.text = running ? "Adding albums to playlist…" : BUTTON_TEXT;
	addAlbumsButton.onClick(async () => {
		if (running) return;
		try {
			redux.actions["contextMenu/CLOSE"]();
		} catch {
			/* menu may already be closed */
		}

		const subtitle =
			mediaCollection instanceof Album
				? `The album “${mediaCollection.tidalAlbum.title}” will be added. Songs already in the playlist are skipped.`
				: mediaCollection instanceof Playlist
					? `The full album of every song in “${mediaCollection.tidalPlaylist.title}” will be added. Songs already in the playlist are skipped.`
					: `The full album of ${count === 1 ? "the selected song" : `each of the ${count} selected songs`} will be added. Songs already in the playlist are skipped.`;
		const target = await pickPlaylist(unloads, getUserPlaylists, subtitle);
		if (target === undefined) return;

		running = true;
		try {
			await addAlbumsToPlaylist(mediaCollection, target);
		} catch (err) {
			trace.msg.err.withContext("Failed to add albums to playlist")(err as Error);
		} finally {
			running = false;
		}
	});

	await addAlbumsButton.show(contextMenu);
});
