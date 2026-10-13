import { access, mkdir, readdir, rename } from "fs/promises";
import path from "path";

// Keep the original case, the renderer side lower-cases for lookups itself
const normalizePath = (value: string) => value.replaceAll("\\", "/");

export const scanSongPaths = async (directory: string) => {
	const resolvedDirectory = path.resolve(directory);
	const files: string[] = [];
	const directoriesToScan = [resolvedDirectory];

	while (directoriesToScan.length > 0) {
		const currentDirectory = directoriesToScan.pop()!;
		let entries;
		try {
			entries = await readdir(currentDirectory, { withFileTypes: true, encoding: "utf8" });
		} catch {
			continue;
		}

		for (const entry of entries) {
			const fullPath = path.join(currentDirectory, entry.name);
			if (entry.isDirectory()) {
				directoriesToScan.push(fullPath);
				continue;
			}
			if (!entry.isFile()) continue;
			files.push(normalizePath(path.relative(resolvedDirectory, fullPath)));
		}
	}

	return { resolvedDirectory, files };
};

/** Renames a song inside the library; returns false if the target already exists */
export const renameSongFile = async (directory: string, from: string, to: string) => {
	const target = path.join(directory, to);
	try {
		await access(target);
		return false;
	} catch {
		// Target is free
	}
	await mkdir(path.dirname(target), { recursive: true });
	await rename(path.join(directory, from), target);
	return true;
};
