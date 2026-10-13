import { Tracer, type LunaUnload } from "@luna/core";
import { ContextMenu, MediaItem, safeInterval, StyleTag } from "@luna/lib";

import { addProgressToastStyles, ProgressToast } from "../../../shared/progressToast";
import { getCollectionItems, type CollectionItem } from "./collectionItems";
import { downloadTrack, getDownloadProgress } from "./download.native";
import { getFreshPlaybackInfo } from "./playbackInfo";
import { getDownloadFolder, getDownloadPath, getFastLookupInfo, getResolvedFileInfo } from "./helpers";
import { settings } from "./Settings";
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

			let currentIndex = 1;
			let downloaded = 0;
			let unavailable = 0;
			const totalToDownload = preparedTracks.length;
			for (const preparedTrack of preparedTracks) {
				if (toast.cancelled) break;
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
					currentIndex++;
					trace.warn(`Skipped ${preparedTrack.simpleFileName} (track ${preparedTrack.item.id}): ${err instanceof Error ? err.message : String(err)}`);
					continue;
				}
				const { fileName, legacyFileName, simpleFileName, tags } = fileInfo;

				if (downloadFolder !== undefined && hasSongInCache(downloadFolder, fileName)) {
					skippedExisting++;
					currentIndex++;
					continue;
				}
				// Saved by an older version under a cut-off name (often without extension): fix the name, don't download again
				if (downloadFolder !== undefined && legacyFileName !== undefined && hasSongInCache(downloadFolder, legacyFileName)) {
					await renameSongInCache(downloadFolder, legacyFileName, fileName)
						.then((renamed) => renamed && trace.log(`Renamed “${legacyFileName}” to “${fileName}”`))
						.catch(trace.warn.withContext(`Failed to rename “${legacyFileName}”`));
					skippedExisting++;
					currentIndex++;
					continue;
				}

				downloadButton.elem!.innerHTML = `
	      			<div>Fetching download path... (${currentIndex}/${totalToDownload})</div>
	      			<div style="font-size: 0.9em; color: #fff;">${simpleFileName}</div>
	    		`;
				toast.update(`Downloading ${currentIndex}/${totalToDownload}`, simpleFileName, (currentIndex - 1) / totalToDownload);
				const path = downloadFolder !== undefined ? [downloadFolder, fileName] : await getDownloadPath(fileName);
				if (path === undefined) return;

				const clearInterval = safeInterval(
					unloads,
					async () => {
						const progress = await getDownloadProgress(String(mediaItem.id));
						if (progress === undefined) return;
						const { total, downloaded } = progress;
						if (total === undefined || downloaded === undefined) return;
						const percent = total > 0 ? (downloaded / total) * 100 : 0
						downloadButton.elem!.style.setProperty("--progress", `${percent}%`);
						const downloadedMB = (downloaded / 1048576).toFixed(0);
						const totalMB = (total / 1048576).toFixed(0);
						// Overall progress: finished files plus the share of the current one
						toast.update(
							`Downloading ${currentIndex}/${totalToDownload}`,
							`${simpleFileName} · ${downloadedMB}/${totalMB} MB`,
							(currentIndex - 1 + percent / 100) / totalToDownload,
						);
						downloadButton.elem!.innerHTML = `
	      					<div>Downloading ${currentIndex}/${totalToDownload} (${downloadedMB}/${totalMB}MB ${percent.toFixed(0)}%)</div>
	      					<div style="font-size: 0.9em; color: #fff;">${simpleFileName}</div>
	    				`;
					},
					50,
				);

				// Own download instead of mediaItem.download(): fresh links (Luna's expire → 403) and no crash on stream errors
				const downloadCompleted = await (async () => {
					const playbackInfo = await getFreshPlaybackInfo(mediaItem.id, settings.downloadQuality);
					if (playbackInfo === undefined) throw new Error(`Track ${mediaItem.id} is not available`);
					await downloadTrack(String(mediaItem.id), playbackInfo, path, await getTags(mediaItem));
					return true;
				})().catch(trace.msg.err.withContext(`Failed to download ${tags.title ?? preparedTrack.title}`));
				clearInterval();
				if (downloadCompleted === true) downloaded++;
				if (downloadFolder !== undefined && downloadCompleted === true) {
					downloadedMissing++;
					addSongToCache(downloadFolder, fileName);
				}
				currentIndex++;
			}

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
