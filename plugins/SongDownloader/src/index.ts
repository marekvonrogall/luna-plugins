import { Tracer, type LunaUnload } from "@luna/core";
import { ContextMenu, MediaItem, safeInterval, StyleTag } from "@luna/lib";

import { addProgressToastStyles, ProgressToast } from "../../../shared/progressToast";
import { getCollectionItems, type CollectionItem } from "./collectionItems";
import { downloadTrack, getDownloadProgress } from "./download.native";
import { getFreshPlaybackInfo } from "./playbackInfo";
import { getDownloadFolder, getDownloadPath, getFastLookupInfo, getResolvedFileInfo } from "./helpers";
import { DEFAULT_PARALLEL, MAX_PARALLEL, settings } from "./Settings";
import { findRealMax, getTags } from "./tags";
import { addSongToCache, hasSongInCache, hasSongStemInCache, refreshSongCache, renameSongInCache } from "./songCache";

import styles from "file://downloadButton.css?minify";

export const { errSignal, trace } = Tracer("[Librarian]");
export const unloads = new Set<LunaUnload>();

new StyleTag("SongDownloader", unloads, styles);
addProgressToastStyles("SongDownloader", unloads);

const downloadButton = ContextMenu.addButton(unloads);

export { Settings } from "./Settings";
ContextMenu.onMediaItem(unloads, async ({ mediaCollection, contextMenu }) => {
	const trackCount = await mediaCollection.count();
	if (trackCount === 0) return;

	const defaultText = (downloadButton.text = `Download ${trackCount} tracks`);

	downloadButton.onClick(async () => {
		if (downloadButton.elem === undefined) return;
		const downloadFolder = settings.defaultPath ?? await getDownloadFolder() ?? undefined;
		downloadButton.elem.classList.add("download-button");
		const toast = new ProgressToast(unloads);
		toast.update("Downloading tracks", "Starting…");
		try {
			// Loaded in pages (100 tracks per request) instead of Luna's one request per track
			toast.update("Downloading tracks", "Loading tracks…");
			const items = await getCollectionItems(mediaCollection).catch(trace.msg.err.withContext("Failed to load tracks"));
			if (!items) return;
			const trackCount = items.length;

			type PreparedTrack = {
				item: CollectionItem;
				simpleFileName: string;
				title: string;
			};

			const preparedTracks: PreparedTrack[] = [];
			let skippedExisting = 0;
			let downloadedMissing = 0;

		
			if (downloadFolder !== undefined) {
				downloadButton.text = "Scanning library...";
				toast.update("Downloading tracks", "Scanning your library…");
				await refreshSongCache(downloadFolder);
			}
			downloadButton.elem!.style.setProperty("--progress", `${0}%`);
			downloadButton.text = `Checking tracks... (0/${trackCount})`;
			// Only the API data is needed here, so this makes no requests
			for (const item of items) {
				if (toast.cancelled) break;
				if (item.tidalItem === undefined) {
					// Couldn't be loaded in advance: checked with its tags in the download loop
					preparedTracks.push({ item, simpleFileName: `Track ${item.id}`, title: `Track ${item.id}` });
					continue;
				}
				const { relativePathStem, simpleFileName, title } = getFastLookupInfo(item.tidalItem, downloadFolder);
				if (downloadFolder !== undefined && hasSongStemInCache(downloadFolder, relativePathStem)) skippedExisting++;
				else preparedTracks.push({ item, simpleFileName, title });
			}
			const checked = preparedTracks.length + skippedExisting;
			downloadButton.text = `Checking tracks... (${checked}/${trackCount})`;
			downloadButton.elem!.style.setProperty("--progress", `${(checked / Math.max(trackCount, 1)) * 100}%`);
			toast.update("Preparing downloads", `Checking tracks (${checked}/${trackCount})`, checked / Math.max(trackCount, 1));

			let downloaded = 0;
			let unavailable = 0;
			/** Tracks that are done, whether downloaded, skipped or failed */
			let finished = 0;
			const totalToDownload = preparedTracks.length;
			// With a save dialog per file, downloads have to stay one at a time
			const parallel = downloadFolder === undefined ? 1 : Math.max(1, Math.min(MAX_PARALLEL, Math.round(settings.parallelDownloads ?? DEFAULT_PARALLEL)));
			/** Track id → name, for the downloads currently running */
			const active = new Map<string, string>();
			/** Lower-cased file names being written right now, so the same file is never downloaded twice at once */
			const writing = new Set<string>();
			let stopped = false;

			const skip = () => {
				skippedExisting++;
				finished++;
			};

			const downloadOne = async (preparedTrack: PreparedTrack) => {
				let mediaItem: MediaItem;
				let fileInfo: Awaited<ReturnType<typeof getResolvedFileInfo>>;
				try {
					// Only tracks that actually get downloaded become Luna MediaItems
					const found = await MediaItem.fromId(preparedTrack.item.id, preparedTrack.item.type);
					if (found === undefined) throw new Error("Track is not available");
					mediaItem = settings.useRealMAX ? await findRealMax(found) : found;
					fileInfo = await getResolvedFileInfo(mediaItem, settings.downloadQuality, downloadFolder);
				} catch (err) {
					unavailable++;
					finished++;
					trace.warn(`Skipped ${preparedTrack.simpleFileName} (track ${preparedTrack.item.id}): ${err instanceof Error ? err.message : String(err)}`);
					return;
				}
				const { fileName, legacyFileName, simpleFileName, tags } = fileInfo;
				const fileKey = fileName.toLowerCase();
				const trackId = String(mediaItem.id);

				if (downloadFolder !== undefined && hasSongInCache(downloadFolder, fileName)) return skip();
				// Same file already being downloaded (e.g. the playlist contains the song twice)
				if (writing.has(fileKey) || active.has(trackId)) return skip();
				// Saved by an older version under a cut-off name (often without extension): fix the name, don't download again
				if (downloadFolder !== undefined && legacyFileName !== undefined && hasSongInCache(downloadFolder, legacyFileName)) {
					await renameSongInCache(downloadFolder, legacyFileName, fileName)
						.then((renamed) => renamed && trace.log(`Renamed “${legacyFileName}” to “${fileName}”`))
						.catch(trace.warn.withContext(`Failed to rename “${legacyFileName}”`));
					return skip();
				}

				const path = downloadFolder !== undefined ? [downloadFolder, fileName] : await getDownloadPath(fileName);
				if (path === undefined) {
					// Save dialog cancelled: stop everything
					stopped = true;
					return;
				}

				writing.add(fileKey);
				active.set(trackId, simpleFileName);
				try {
					// Own download instead of mediaItem.download(): fresh links (Luna's expire → 403) and no crash on stream errors
					const downloadCompleted = await (async () => {
						const playbackInfo = await getFreshPlaybackInfo(mediaItem.id, settings.downloadQuality);
						if (playbackInfo === undefined) throw new Error(`Track ${mediaItem.id} is not available`);
						await downloadTrack(trackId, playbackInfo, path, await getTags(mediaItem));
						return true;
					})().catch(trace.msg.err.withContext(`Failed to download ${tags.title ?? preparedTrack.title}`));
					if (downloadCompleted === true) {
						downloaded++;
						if (downloadFolder !== undefined) {
							downloadedMissing++;
							addSongToCache(downloadFolder, fileName);
						}
					}
				} finally {
					writing.delete(fileKey);
					active.delete(trackId);
					finished++;
				}
			};

			// One progress display for all running downloads
			let rendering = false;
			const render = async () => {
				if (rendering || downloadButton.elem === undefined) return;
				rendering = true;
				try {
					const running: { name: string; share: number }[] = [];
					for (const [trackId, name] of active) {
						const progress = await getDownloadProgress(trackId);
						const share = progress?.total ? (progress.downloaded ?? 0) / progress.total : 0;
						running.push({ name, share });
					}
					const overall = (finished + running.reduce((sum, { share }) => sum + share, 0)) / Math.max(totalToDownload, 1);
					const title = `Downloading · ${finished}/${totalToDownload} done`;
					const lines = running.map(({ name, share }) => ({ text: name, value: `${(share * 100).toFixed(0)}%` }));
					toast.update(title, lines.length > 0 ? lines : "Preparing…", overall);
					downloadButton.elem.style.setProperty("--progress", `${overall * 100}%`);
					downloadButton.elem.innerHTML = `
						<div>${title} (${(overall * 100).toFixed(0)}%)</div>
						<div style="font-size: 0.9em; color: #fff;">${running.map(({ name }) => name).join("<br>")}</div>
					`;
				} finally {
					rendering = false;
				}
			};
			const clearInterval = safeInterval(unloads, render, 200);

			let next = 0;
			const worker = async () => {
				while (!stopped && !toast.cancelled && next < preparedTracks.length) {
					await downloadOne(preparedTracks[next++]);
				}
			};
			try {
				await Promise.all(Array.from({ length: Math.min(parallel, totalToDownload) }, worker));
			} finally {
				clearInterval();
			}
			if (stopped) return;

			downloadButton.text = skippedExisting > 0 ? `Downloaded ${downloadedMissing}/${trackCount} tracks (Skipped ${skippedExisting})` : defaultText;
			downloadButton.elem.style.setProperty("--progress", "0%");
			downloadButton.elem.classList.remove("download-button");

			const skippedText = skippedExisting > 0 ? ` Skipped ${skippedExisting} already in your library.` : "";
			const unavailableText = unavailable > 0 ? ` ${unavailable} not available (see console).` : "";
			const summary = `${toast.cancelled ? "Cancelled. " : ""}Downloaded ${downloaded} of ${trackCount} tracks.${skippedText}${unavailableText}`;
			if (unavailable > 0) trace.msg.warn(summary);
			else trace.msg.log(summary);
		} finally {
			toast.remove();
		}
	});

	await downloadButton.show(contextMenu);
});
