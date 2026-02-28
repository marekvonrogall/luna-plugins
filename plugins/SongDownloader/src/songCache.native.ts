import { readdir } from "fs/promises";
import path from "path";

const normalizePath = (value: string) => value.replaceAll("\\", "/").toLowerCase();

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
