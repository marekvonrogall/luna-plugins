import { type BuildOptions } from "esbuild";

import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

import { listen, pluginBuildOptions } from "luna/build";

const releaseFileName = (fileName: string) =>
	fileName
		.normalize("NFD")
		.replace(/\p{Mn}/gu, "")
		.replace(/[^A-Za-z0-9._-]/g, "_");

const pluginFolders = await readdir(join(process.cwd(), "./plugins"));
const buildConfigs: BuildOptions[] = await Promise.all(
	pluginFolders.map(async (name) => {
		const config = await pluginBuildOptions(`./plugins/${name}`);
		return { ...config, outfile: `./dist/${releaseFileName(config.outfile!.replace("./dist/", ""))}` };
	}),
);

listen(buildConfigs);

// Quick export of plugins for store functionality
const pkg = JSON.parse(await readFile(join(process.cwd(), "./package.json"), "utf8"));
pkg.plugins ??= buildConfigs.map((config) => config.outfile?.replace("./dist/", ""));
await mkdir(join(process.cwd(), "./dist"), { recursive: true });
await writeFile(join(process.cwd(), "./dist/store.json"), JSON.stringify(pkg));
