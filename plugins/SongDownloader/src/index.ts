import { Tracer, type LunaUnload } from "@luna/core";
import { ContextMenu, safeInterval, StyleTag } from "@luna/lib";

import { getDownloadFolder, getDownloadPath, getFastLookupInfo, getResolvedFileInfo } from "./helpers";
import { settings } from "./Settings";
import { addSongToCache, hasSongInCache, hasSongStemInCache, refreshSongCache } from "./songCache";

import styles from "file://downloadButton.css?minify";

export const { errSignal, trace } = Tracer("[SongDownloader]");
export const unloads = new Set<LunaUnload>();

new StyleTag("SongDownloader", unloads, styles);

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
			await refreshSongCache(downloadFolder);
		}
		downloadButton.elem!.style.setProperty("--progress", `${0}%`);
		downloadButton.text = `Fetching selected tracks... (0/${trackCount})`;
		for await (let mediaItem of await mediaCollection.mediaItems()) {
			const { relativePathStem, simpleFileName, title } = getFastLookupInfo(mediaItem);
			if (downloadFolder !== undefined && hasSongStemInCache(downloadFolder, relativePathStem)) {
				skippedExisting++;
			}
			else preparedTracks.push({ mediaItem, relativePathStem, simpleFileName, title });
			downloadButton.text = `Fetching selected tracks... (${preparedTracks.length+skippedExisting}/${trackCount})`;
			downloadButton.elem!.style.setProperty("--progress", `${((preparedTracks.length + skippedExisting) / trackCount) * 100}%`);
		}

		let currentIndex = 1;
		const totalToDownload = preparedTracks.length;
		for (const preparedTrack of preparedTracks) {
			let mediaItem = preparedTrack.mediaItem;
			if (settings.useRealMAX) mediaItem = (await mediaItem.max()) ?? mediaItem;
			const { fileName, simpleFileName, tags } = await getResolvedFileInfo(mediaItem, settings.downloadQuality);

			if (downloadFolder !== undefined && hasSongInCache(downloadFolder, fileName)) {
				skippedExisting++;
				currentIndex++;
				continue;
			}

			downloadButton.elem!.innerHTML = `
      			<div>Fetching download path... (${currentIndex}/${totalToDownload})</div>
      			<div style="font-size: 0.9em; color: #fff;">${simpleFileName}</div>
    		`;
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
			if (downloadFolder !== undefined && downloadCompleted === true) {
				downloadedMissing++;
				addSongToCache(downloadFolder, fileName);
			}
			currentIndex++;
		}

		downloadButton.text = skippedExisting > 0 ? `Downloaded ${downloadedMissing}/${trackCount} tracks (Skipped ${skippedExisting})` : defaultText;
		downloadButton.elem.style.setProperty("--progress", "0%");
		downloadButton.elem.classList.remove("download-button");
	});

	await downloadButton.show(contextMenu);
});
