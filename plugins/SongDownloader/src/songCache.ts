import { scanSongPaths } from "./songCache.native";

type SongCacheMeta = {
	directory?: string;
	count: number;
	scannedAt?: number;
};

let cachedDirectoryKey: string | undefined;
let cachedDirectory: string | undefined;
let cachedSongs = new Set<string>();
let cachedSongStems = new Set<string>();
let scannedAt: number | undefined;

const normalizePath = (value: string) => value.replaceAll("\\", "/").toLowerCase();
const directoryKey = (value: string) => normalizePath(value).replace(/\/+$/, "");
const withoutExtension = (relativePath: string) => {
	const lastSlashIndex = relativePath.lastIndexOf("/");
	const lastDotIndex = relativePath.lastIndexOf(".");
	if (lastDotIndex <= lastSlashIndex) return relativePath;
	return relativePath.slice(0, lastDotIndex);
};

export const refreshSongCache = async (directory: string) => {
	const { resolvedDirectory, files } = await scanSongPaths(directory);
	const targetDirectoryKey = directoryKey(resolvedDirectory);
	const normalizedFiles = files.map(normalizePath);

	cachedDirectoryKey = targetDirectoryKey;
	cachedDirectory = resolvedDirectory;
	cachedSongs = new Set(normalizedFiles);
	cachedSongStems = new Set(normalizedFiles.map(withoutExtension));
	scannedAt = Date.now();

	return cachedSongs.size;
};

export const hasSongInCache = (directory: string, relativeSongPath: string) => {
	if (cachedDirectoryKey === undefined) return false;
	if (cachedDirectoryKey !== directoryKey(directory)) return false;
	return cachedSongs.has(normalizePath(relativeSongPath));
};

export const hasSongStemInCache = (directory: string, relativeSongPathStem: string) => {
	if (cachedDirectoryKey === undefined) return false;
	if (cachedDirectoryKey !== directoryKey(directory)) return false;
	return cachedSongStems.has(normalizePath(relativeSongPathStem));
};

export const addSongToCache = (directory: string, relativeSongPath: string) => {
	if (cachedDirectoryKey === undefined) return;
	if (cachedDirectoryKey !== directoryKey(directory)) return;
	const normalized = normalizePath(relativeSongPath);
	cachedSongs.add(normalized);
	cachedSongStems.add(withoutExtension(normalized));
};

export const getSongCacheMeta = (): SongCacheMeta => ({
	directory: cachedDirectory,
	count: cachedSongs.size,
	scannedAt,
});
