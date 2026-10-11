import { MediaItem, type redux } from "@luna/lib";
import { showOpenDialog, showSaveDialog } from "@luna/lib.native";
import { settings } from "./Settings";

import sanitize from "sanitize-filename";

/** Luna's download sanitizes names with sanitize-filename, which cuts at 255 UTF-8 bytes (and with it the extension) */
const MAX_NAME_BYTES = 250;
/** Windows MAX_PATH is 260 including the terminating null */
const MAX_PATH_LENGTH = 259;
/** Always reserve room for the longest extension, so .flac and .m4a files share the same stem */
const LONGEST_EXTENSION = ".flac";

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Cuts whole characters (never half an emoji or accent) off the end until `fits`; Windows drops trailing dots/spaces */
const cutToFit = (text: string, fits: (candidate: string) => boolean) => {
	if (fits(text)) return text;
	const chars = Array.from(segmenter.segment(text), (s) => s.segment);
	// Largest prefix that fits
	let low = 0;
	let high = chars.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (fits(chars.slice(0, mid).join(""))) low = mid;
		else high = mid - 1;
	}
	return chars.slice(0, low).join("").replace(/[. ]+$/, "") || "_";
};

/** Shortens a relative path without extension so every name and the whole path fit Windows' and Luna's limits */
export const fitPathStem = (stem: string, baseDir?: string) => {
	const parts = stem.split(/[\\/]+/);
	const fileStem = parts.pop() ?? "";
	const dirs = parts.map((dir) => cutToFit(dir, (c) => byteLength(c) <= MAX_NAME_BYTES).replace(/[. ]+$/, "") || "_");
	const used = (baseDir === undefined ? 0 : baseDir.replace(/[\\/]+$/, "").length + 1) + dirs.reduce((sum, dir) => sum + dir.length + 1, 0);
	const name = cutToFit(
		fileStem,
		(c) => byteLength(c + LONGEST_EXTENSION) <= MAX_NAME_BYTES && (baseDir === undefined || used + c.length + LONGEST_EXTENSION.length <= MAX_PATH_LENGTH),
	);
	return [...dirs, name].join("/");
};

/** Whether every name and the whole path fit, see fitPathStem */
const fitsLimits = (stem: string, baseDir?: string) => {
	const parts = stem.split(/[\\/]+/);
	const fileStem = parts.pop() ?? "";
	if (parts.some((dir) => byteLength(dir) > MAX_NAME_BYTES)) return false;
	if (byteLength(fileStem + LONGEST_EXTENSION) > MAX_NAME_BYTES) return false;
	return baseDir === undefined || baseDir.replace(/[\\/]+$/, "").length + 1 + stem.length + LONGEST_EXTENSION.length <= MAX_PATH_LENGTH;
};

/** Shortens a value to `maxBytes`, marking the cut with … */
const shorten = (value: string, maxBytes: number) => {
	if (byteLength(value) <= maxBytes) return value;
	const cut = cutToFit(value, (c) => byteLength(c + "…") <= maxBytes);
	return `${cut === "_" ? "" : cut}…`;
};

/**
 * Fills the path format with the (sanitized) tag values. If that's too long, the longest values are shortened first,
 * down to a common length, so e.g. a huge album name can't push the title out of the file name.
 */
export const buildPathStem = (format: string, values: Record<string, string | undefined>, baseDir?: string) => {
	const fill = (maxBytes: number) => {
		let stem = format;
		for (const tag of MediaItem.availableTags) {
			const value = values[tag];
			if (value !== undefined) stem = stem.replaceAll(`{${tag}}`, shorten(value, maxBytes));
		}
		return stem;
	};
	const full = fill(Infinity);
	if (fitsLimits(full, baseDir)) return { stem: full, fullStem: full };

	// Largest per-value limit that fits
	let low = 0;
	let high = Math.max(0, ...Object.values(values).map((value) => (value === undefined ? 0 : byteLength(value))));
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (fitsLimits(fill(mid), baseDir)) low = mid;
		else high = mid - 1;
	}
	// fitPathStem as safety net, e.g. for long fixed text in the format itself
	return { stem: fitPathStem(fill(low), baseDir), fullStem: full };
};

/** Where older versions saved the file: Luna cut the name at 255 bytes, often dropping the extension */
const legacyPath = (stem: string, extension: string) => {
	const parts = stem.split(/[\\/]+/);
	const fileStem = parts.pop() ?? "";
	return [...parts, sanitize(`${fileStem}.${extension}`)].join("/");
};

const normalizeTagValue = (value: unknown) => {
	if (Array.isArray(value)) return value[0];
	return value;
};

/** `baseDir` is the download folder, used to keep the full path within Windows' limit */
export const getResolvedFileInfo = async (mediaItem: MediaItem, audioQuality?: redux.AudioQuality, baseDir?: string) => {
	const extension = await mediaItem.fileExtension(audioQuality);
	const { tags } = await mediaItem.flacTags();

	const values: Record<string, string | undefined> = {};
	for (const tag of MediaItem.availableTags) {
		const tagValue = normalizeTagValue(tags[tag]);
		if (typeof tagValue === "string") values[tag] = sanitize(tagValue);
	}
	const { stem, fullStem } = buildPathStem(settings.pathFormat, values, baseDir);
	const fileName = `${stem}.${extension}`;
	const oldFileName = legacyPath(fullStem, extension);

	let artist = normalizeTagValue(tags.artist);
	let title = normalizeTagValue(tags.title);

	artist = typeof artist === "string" && artist.length > 0 ? sanitize(artist) : "UnknownArtist";
	title = typeof title === "string" && title.length > 0 ? sanitize(title) : "UnknownTitle";

	return {
		tags,
		fileName,
		/** Set when older versions would have saved this song under a different (cut off) name */
		legacyFileName: oldFileName.toLowerCase() === fileName.toLowerCase() ? undefined : oldFileName,
		simpleFileName: `${artist} - ${title}`,
	};
};

export const getFastLookupInfo = (mediaItem: MediaItem, baseDir?: string) => {
	const tidalItem = mediaItem.tidalItem;
	const firstArtist = tidalItem.artists?.[0]?.name ?? tidalItem.artist?.name ?? "UnknownArtist";
	const albumTitle = tidalItem.album?.title ?? "UnknownAlbum";
	const title = tidalItem.version ? `${tidalItem.title} (${tidalItem.version})` : tidalItem.title;
	const releaseDate = tidalItem.releaseDate ?? tidalItem.streamStartDate;
	const year = releaseDate?.slice(0, 4);

	const fastTags: Record<string, string | undefined> = {
		title,
		artist: firstArtist,
		album: albumTitle,
		trackNumber: tidalItem.trackNumber?.toString(),
		discNumber: tidalItem.volumeNumber?.toString(),
		year,
		date: releaseDate,
		isrc: tidalItem.isrc ?? undefined,
	};

	const values: Record<string, string | undefined> = {};
	for (const tag of MediaItem.availableTags) values[tag] = sanitize(fastTags[tag] ?? "");
	const relativePathStem = buildPathStem(settings.pathFormat, values, baseDir).stem;

	const simpleFileName = `${sanitize(firstArtist)} - ${sanitize(title)}`;
	return {
		relativePathStem,
		simpleFileName,
		title,
	};
};

export const getDownloadFolder = async () => {
	const { canceled, filePaths } = await showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
	if (!canceled) return filePaths[0];
};
export const getDownloadPath = async (defaultPath: string) => {
	const { canceled, filePath } = await showSaveDialog({
		defaultPath,
		filters: [{ name: "", extensions: [defaultPath ?? "*"] }],
	});
	if (!canceled) return filePath;
};
export const getFileName = async (mediaItem: MediaItem, audioQuality?: redux.AudioQuality) => {
	return (await getResolvedFileInfo(mediaItem, audioQuality)).fileName;
};
export const getSimpleFileName = async (mediaItem: MediaItem) => {
	return (await getResolvedFileInfo(mediaItem)).simpleFileName;
};

