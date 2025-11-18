import { MediaItem } from "@luna/lib";
import { showOpenDialog, showSaveDialog } from "@luna/lib.native";
import { settings } from "./Settings";

import sanitize from "sanitize-filename";

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
export const getFileName = async (mediaItem: MediaItem) => {
	let fileName = `${settings.pathFormat}.${await mediaItem.fileExtension()}`;
	const { tags } = await mediaItem.flacTags();
	for (const tag of MediaItem.availableTags) {
		let tagValue = tags[tag];
		if (Array.isArray(tagValue)) tagValue = tagValue[0];
		if (tagValue === undefined) continue;
		fileName = fileName.replaceAll(`{${tag}}`, sanitize(tagValue));
	}
	return fileName;
};
export const getSimpleFileName = async (mediaItem: MediaItem) => {
  const { tags } = await mediaItem.flacTags();

  let artist = tags.artist;
  let title = tags.title;

  if (Array.isArray(artist)) artist = artist[0];
  if (Array.isArray(title)) title = title[0];

  artist = artist ? sanitize(artist) : 'UnknownArtist';
  title = title ? sanitize(title) : 'UnknownTitle';

  return `${artist} - ${title}`;
};

