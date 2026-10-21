import type { LunaUnloads } from "@luna/core";

import { getAlbumTracks, getArtistReleases, HttpError, mapLimited, refreshPlaylistLists, refreshPlaylistView, type ArtistInfo, type SourceTrack } from "./api";
import { OverflowError, PlaylistChain } from "./chain";
import { trace } from "./trace";
import { forgetPlaylist, playlistTrackIds } from "./membership";
import type { LoadSources, OnProgress } from "./selection";
import type { TargetChoice } from "./ui";
import { ProgressToast } from "../../../shared/progressToast";

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const quoted = (titles: string[]) => {
	const q = titles.map((t) => `“${t}”`);
	return q.length <= 1 ? (q[0] ?? "") : `${q.slice(0, -1).join(", ")} and ${q[q.length - 1]}`;
};

/** e.g. “Album” by Artist (album 123, via “Track”) */
const describeAlbum = ({ albumId, albumTitle, artist, trackTitle }: SourceTrack) => {
	const album = albumTitle ? `“${albumTitle}”` : "Unknown album";
	const by = artist ? ` by ${artist}` : "";
	const via = trackTitle ? `, via “${trackTitle}”` : "";
	return `${album}${by} (album ${albumId}${via})`;
};

export const describeError = (err: unknown) => {
	if (err instanceof HttpError && err.status === 404) return "not found, probably removed or not available in your country";
	return err instanceof Error ? err.message : String(err);
};

/** Releases of the given artists, a few artists at a time */
export const loadArtistsReleases = async (artists: ArtistInfo[], onProgress: OnProgress) => {
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

/** Adds the full albums of the loaded songs to every target */
export const collectAlbums = async (unloads: LunaUnloads, { targets, exclusions, playlists }: TargetChoice, loadSources: LoadSources) => {
	const toast = new ProgressToast(unloads);
	let chains: PlaylistChain[] = [];
	const heading = () => (targets.length === 1 ? `Adding to “${chains[0]?.currentTitle ?? targets[0].title}”` : `Adding to ${targets.length} playlists`);
	try {
		toast.update(heading(), "Reading your selection…");
		const sources = await loadSources((done, total) => toast.update(heading(), `Reading your selection… (${done}/${total})`, done / total));
		if (toast.cancelled) return;

		// Songs of exclusion playlists are never sent
		const excludedIds = new Set<string>();
		if (exclusions.length > 0) {
			toast.update(heading(), `Reading ${plural(exclusions.length, "exclusion playlist")}…`);
			const idSets = await mapLimited(exclusions, 2, (p) => playlistTrackIds(p));
			for (const ids of idSets) for (const id of ids) excludedIds.add(id);
		}

		// Targets aren't pre-read (slow for big playlists), TIDAL skips dupes server-side.
		// Existing overflow playlists (“Name-2”…) are read so they don't get the same songs again.
		chains = targets.map((target) => new PlaylistChain(target, playlists, new Set(excludedIds)));
		for (const chain of chains) await chain.init();
		if (toast.cancelled) return;

		const collected = new Set<string>();
		const sentTo = new Map(chains.map((chain) => [chain, new Set<string>()]));
		const stopped = new Set<PlaylistChain>();
		const processedAlbums = new Set<string>();

		let albumsHandled = 0;
		let noAlbum = 0;
		let aiAlbums = 0;
		let aiSongs = 0;
		let excluded = 0;
		const failedAlbums: string[] = [];
		const totalAdded = () => chains.reduce((sum, chain) => sum + chain.added, 0);

		for (let i = 0; i < sources.length; i++) {
			if (toast.cancelled || stopped.size === chains.length) break;
			const source = sources[i];
			const { trackId, albumId } = source;

			// Album already handled via this song
			if (trackId !== undefined && collected.has(trackId)) continue;
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

			toast.update(`${heading()} (${i + 1}/${sources.length})`, `${plural(albumsHandled, "album")} · ${plural(totalAdded(), "song")} added`, i / sources.length);

			try {
				const { trackIds, aiCount } = await getAlbumTracks(albumId);
				// Album made up of AI songs only
				if (trackIds.length === 0 && aiCount > 0) {
					aiAlbums++;
					continue;
				}
				aiSongs += aiCount;
				const albumIds = [...new Set(trackIds)];
				for (const id of albumIds) {
					if (excludedIds.has(id)) excluded++;
					collected.add(id);
				}
				for (const chain of chains) {
					if (stopped.has(chain) || toast.cancelled) continue;
					const sent = sentTo.get(chain)!;
					const toSend = albumIds.filter((id) => !sent.has(id) && !chain.skip.has(id));
					try {
						if (toSend.length > 0) await chain.add(toSend, (title) => trace.log(`Playlist full, continuing in “${title}”`));
						for (const id of toSend) sent.add(id);
					} catch (err) {
						// Can't continue without a playlist to write into
						if (!(err instanceof OverflowError)) throw err;
						trace.msg.err(err.message);
						stopped.add(chain);
					}
				}
				albumsHandled++;
			} catch (err) {
				const line = `${describeAlbum(source)}: ${describeError(err)}`;
				failedAlbums.push(line);
				// Keep the stack for unexpected (non-HTTP) errors
				if (err instanceof HttpError) trace.err(`Failed to add ${line}`);
				else trace.err(`Failed to add ${line}`, err);
			}
		}

		for (const chain of chains) {
			await chain.finish().catch(trace.warn.withContext("Failed to read final playlist size"));
			for (const uuid of chain.uuids) {
				forgetPlaylist(uuid);
				refreshPlaylistView(uuid);
			}
		}
		if (chains.some((chain) => chain.created.length > 0)) refreshPlaylistLists();

		const added = totalAdded();
		const skipped = chains.reduce((sum, chain) => sum + chain.sent - chain.added + chain.dropped, 0) + excluded;
		const created = chains.flatMap((chain) => chain.created);
		const where =
			chains.length === 1
				? `to ${quoted(chains[0].titles) || `“${targets[0].title}”`}`
				: `to ${chains.length} playlists (${chains.map((chain, i) => `${quoted(chain.titles) || `“${targets[i].title}”`} +${chain.added}`).join(", ")})`;
		const summary = [
			`${toast.cancelled ? "Cancelled. " : ""}Added ${plural(added, "song")} from ${plural(albumsHandled, "album")} ${where}.`,
			created.length > 0 ? `Created ${quoted(created)} because a playlist was full.` : "",
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
