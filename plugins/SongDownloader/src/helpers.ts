import { MediaItem, type redux } from "@luna/lib";
import { showOpenDialog, showSaveDialog } from "@luna/lib.native";
import { settings } from "./Settings";

import sanitize from "sanitize-filename";

const normalizeTagValue = (value: unknown) => {
	if (Array.isArray(value)) return value[0];
	return value;
};

export const getResolvedFileInfo = async (mediaItem: MediaItem, audioQuality?: redux.AudioQuality) => {
	let fileName = `${settings.pathFormat}.${await mediaItem.fileExtension(audioQuality)}`;
	const { tags } = await mediaItem.flacTags();

	for (const tag of MediaItem.availableTags) {
		const tagValue = normalizeTagValue(tags[tag]);
		if (typeof tagValue !== "string") continue;
		fileName = fileName.replaceAll(`{${tag}}`, sanitize(tagValue));
	}

	let artist = normalizeTagValue(tags.artist);
	let title = normalizeTagValue(tags.title);

	artist = typeof artist === "string" && artist.length > 0 ? sanitize(artist) : "UnknownArtist";
	title = typeof title === "string" && title.length > 0 ? sanitize(title) : "UnknownTitle";

	return { tags, fileName, simpleFileName: `${artist} - ${title}` };
};

export const getFastLookupInfo = (mediaItem: MediaItem) => {
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

	let relativePathStem = settings.pathFormat;
	for (const tag of MediaItem.availableTags) {
		const replacement = sanitize(fastTags[tag] ?? "");
		relativePathStem = relativePathStem.replaceAll(`{${tag}}`, replacement);
	}

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

