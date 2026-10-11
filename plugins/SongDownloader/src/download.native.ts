import { createWriteStream } from "fs";
import { access, mkdir, rename, rm } from "fs/promises";
import path from "path";
import { pipeline } from "stream/promises";

import { FlacStreamTagger, PictureType } from "flac-stream-tagger";

import type { PlaybackInfo } from "@luna/lib";
import { fetchMediaItemStream } from "@luna/lib.native";

type Progress = { total?: number; downloaded?: number };
type Tags = { tags: Record<string, string[] | string>; coverUrl?: string };

const active: Record<string, Progress> = {};

export const getDownloadProgress = async (trackId: string) => {
	const progress = active[trackId];
	return progress && { total: progress.total, downloaded: progress.downloaded };
};

const exists = (filePath: string) => access(filePath).then(
	() => true,
	() => false,
);

const fetchCover = async (url?: string) => {
	if (!url) return undefined;
	try {
		const res = await fetch(url);
		if (!res.ok) return undefined;
		return { pictureType: PictureType.FrontCover, buffer: Buffer.from(await res.arrayBuffer()) };
	} catch {
		return undefined;
	}
};

/**
 * Luna's download without its two problems: a failing stream (e.g. 403) rejects instead of crashing TIDAL
 * with an unhandled error and hanging, and a half-written file is removed instead of staying in the library.
 */
export const downloadTrack = async (trackId: string, playbackInfo: PlaybackInfo, pathParts: string | string[], tags?: Tags) => {
	const filePath = Array.isArray(pathParts) ? path.join(...pathParts) : pathParts;
	if (await exists(filePath)) return;
	await mkdir(path.dirname(filePath), { recursive: true });

	const partPath = `${filePath}.part`;
	const progress: Progress = {};
	active[trackId] = progress;
	try {
		// Without tags Luna returns the raw stream, so its errors reach pipeline() instead of going unhandled
		const source = await fetchMediaItemStream(playbackInfo, { progress });
		if (playbackInfo.manifestMimeType === "application/vnd.tidal.bts" && tags !== undefined) {
			const tagger = new FlacStreamTagger({ tagMap: tags.tags, picture: await fetchCover(tags.coverUrl) });
			await pipeline(source, tagger, createWriteStream(partPath));
		} else {
			await pipeline(source, createWriteStream(partPath));
		}
		await rename(partPath, filePath);
	} catch (err) {
		await rm(partPath, { force: true });
		throw err;
	} finally {
		delete active[trackId];
	}
};
