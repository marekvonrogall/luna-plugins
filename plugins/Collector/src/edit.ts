import { syncPlaylist } from "../../../shared/playlistSync";
import { getPlaylist, PlaylistWriter, removeTracksFromPlaylist, type PlaylistInfo } from "./api";
import { describeError, plural, quoted } from "./collect";
import { addToPlaylistContents, forgetPlaylist, setPlaylistContents } from "./membership";
import { trace } from "./trace";

type Result = { title: string; count: number };

/** “A” (+3), “B” (+0), or “A” alone */
const listResults = (results: Result[], sign: string) =>
	results.length === 1 ? quoted([results[0].title]) : results.map((r) => `“${r.title}” (${sign}${r.count})`).join(", ");

const finish = (summary: string[], failed: string[]) => {
	const text = summary.filter(Boolean).join(" ");
	if (failed.length > 0) {
		trace.err(`Failed:\n${failed.map((line) => `  • ${line}`).join("\n")}`);
		trace.msg.warn(text);
	} else trace.msg.log(text);
};

// No progress popup: adding and removing are quick, only the summary is shown

/** Songs already in a playlist are skipped */
export const addToPlaylists = async (targets: PlaylistInfo[], trackIds: string[]) => {
	const results: Result[] = [];
	const failed: string[] = [];
	let didntFit = 0;
	for (const target of targets) {
		const writer = new PlaylistWriter(target.uuid, target.title);
		try {
			const rest = await writer.add(trackIds);
			didntFit += rest.length;
			await writer.finish();
			results.push({ title: target.title, count: writer.added });
			const updated = await getPlaylist(target.uuid).catch(() => undefined);
			const sent = new Set(rest);
			addToPlaylistContents(target.uuid, target.stamp, updated?.stamp, trackIds.filter((id) => !sent.has(id)));
		} catch (err) {
			forgetPlaylist(target.uuid);
			failed.push(`“${target.title}”: ${describeError(err)}`);
		} finally {
			syncPlaylist(target.uuid);
		}
	}

	const added = results.reduce((sum, r) => sum + r.count, 0);
	const expected = results.length * trackIds.length;
	finish(
		[
			results.length > 0 ? `Added ${plural(added, "song")} to ${listResults(results, "+")}.` : "",
			added < expected - didntFit ? `Songs already in a playlist were skipped.` : "",
			didntFit > 0 ? `${plural(didntFit, "song")} didn't fit because a playlist is full.` : "",
			failed.length > 0 ? `${plural(failed.length, "playlist")} failed (see console).` : "",
		],
		failed,
	);
};

/** Removes every copy of the songs */
export const removeFromPlaylists = async (targets: PlaylistInfo[], trackIds: string[]) => {
	const ids = new Set(trackIds);
	const results: Result[] = [];
	const failed: string[] = [];
	for (const target of targets) {
		try {
			const { removed, remaining } = await removeTracksFromPlaylist(target.uuid, ids);
			results.push({ title: target.title, count: removed });
			if (removed > 0) {
				// Contents known exactly, no re-read needed
				const updated = await getPlaylist(target.uuid).catch(() => undefined);
				setPlaylistContents(target.uuid, updated?.stamp, remaining);
				syncPlaylist(target.uuid);
			}
		} catch (err) {
			forgetPlaylist(target.uuid);
			syncPlaylist(target.uuid);
			failed.push(`“${target.title}”: ${describeError(err)}`);
		}
	}

	const changed = results.filter((r) => r.count > 0);
	const removed = changed.reduce((sum, r) => sum + r.count, 0);
	finish(
		[
			changed.length > 0 ? `Removed ${plural(removed, "song")} from ${listResults(changed, "−")}.` : results.length > 0 ? "None of the playlists had these songs." : "",
			failed.length > 0 ? `${plural(failed.length, "playlist")} failed (see console).` : "",
		],
		failed,
	);
};
