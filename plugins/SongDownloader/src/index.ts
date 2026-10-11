import { Tracer, type LunaUnload } from "@luna/core";
import { ContextMenu, MediaItems, Playlist, safeInterval, StyleTag, type MediaCollection } from "@luna/lib";

import { fetchPlaylistItems } from "../../../shared/playlistItems";
import { addProgressToastStyles, ProgressToast } from "../../../shared/progressToast";
import { getDownloadFolder, getDownloadPath, getFastLookupInfo, getResolvedFileInfo } from "./helpers";
import { settings } from "./Settings";
import { addSongToCache, hasSongInCache, hasSongStemInCache, refreshSongCache } from "./songCache";

import styles from "file://downloadButton.css?minify";

export const { errSignal, trace } = Tracer("[SongDownloader]");
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
			// Luna caches playlist contents per session, so newly added songs would be missing: read it fresh
			let collection: MediaCollection = mediaCollection;
			if (mediaCollection instanceof Playlist) {
				toast.update("Downloading tracks", "Loading playlist…");
				const items = await fetchPlaylistItems(String(mediaCollection.uuid)).catch(trace.msg.err.withContext("Failed to load playlist"));
				if (!items) return;
				collection = MediaItems.fromTMediaItems(items);
			}
			const trackCount = await collection.count();

			type PreparedTrack = {
				mediaItem: Awaited<ReturnType<(typeof mediaCollection)["mediaItems"]>> extends AsyncIterable<infer T> ? T : never;
				relativePathStem: string;
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
			downloadButton.text = `Fetching selected tracks... (0/${trackCount})`;
			for await (let mediaItem of await collection.mediaItems()) {
				if (toast.cancelled) break;
				const { relativePathStem, simpleFileName, title } = getFastLookupInfo(mediaItem);
				if (downloadFolder !== undefined && hasSongStemInCache(downloadFolder, relativePathStem)) {
					skippedExisting++;
				}
				else preparedTracks.push({ mediaItem, relativePathStem, simpleFileName, title });
				downloadButton.text = `Fetching selected tracks... (${preparedTracks.length+skippedExisting}/${trackCount})`;
				downloadButton.elem!.style.setProperty("--progress", `${((preparedTracks.length + skippedExisting) / trackCount) * 100}%`);
				const checked = preparedTracks.length + skippedExisting;
				toast.update("Preparing downloads", `Checking tracks (${checked}/${trackCount})`, checked / trackCount);
			}

			let currentIndex = 1;
			let downloaded = 0;
			let unavailable = 0;
			const totalToDownload = preparedTracks.length;
			for (const preparedTrack of preparedTracks) {
				if (toast.cancelled) break;
				let mediaItem = preparedTrack.mediaItem;
				let fileInfo: Awaited<ReturnType<typeof getResolvedFileInfo>>;
				try {
					if (settings.useRealMAX) mediaItem = (await mediaItem.max()) ?? mediaItem;
					fileInfo = await getResolvedFileInfo(mediaItem, settings.downloadQuality);
				} catch (err) {
					unavailable++;
					currentIndex++;
					trace.warn(`Skipped ${preparedTrack.simpleFileName} (track ${mediaItem.id}): ${err instanceof Error ? err.message : String(err)}`);
					continue;
				}
				const { fileName, simpleFileName, tags } = fileInfo;

				if (downloadFolder !== undefined && hasSongInCache(downloadFolder, fileName)) {
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
						const progress = await mediaItem.downloadProgress();
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

				const downloadCompleted = await mediaItem
					.download(path, settings.downloadQuality)
					.then(() => true)
					.catch(trace.msg.err.withContext(`Failed to download ${tags.title ?? preparedTrack.title}`));
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
