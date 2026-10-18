import { ReactiveStore } from "@luna/core";
import { redux, TidalApi } from "@luna/lib";

import { fetchPlaylistItems } from "../../../shared/playlistItems";
import { detectLanguages } from "./detect";

const CONCURRENCY = 4;
/** Languages below this share of a song are treated as detection noise */
const SONG_MIN_SHARE = 0.1;
/** Songs without lyrics are checked again after this long */
const NO_LYRICS_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

/** Language shares of a song, or null if it has no lyrics */
type SongLanguages = { shares: Record<string, number> | null; at: number };

export type LanguageSummary = {
	/** Average share per language over the songs with lyrics (largest first), and how many songs it appears in */
	languages: { code: string; share: number; songs: number }[];
	withLyrics: number;
	withoutLyrics: number;
	failed: number;
};

const songStore = ReactiveStore.getStore("@marekvonrogall/Translator.songs");
const playlistStore = ReactiveStore.getStore("@marekvonrogall/Translator.playlists");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Plain lyrics text, or undefined if the song has none */
const fetchLyrics = async (trackId: string): Promise<string | undefined> => {
	const url = `https://desktop.tidal.com/v1/tracks/${trackId}/lyrics?${TidalApi.queryArgs()}`;
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, { headers: await TidalApi.getAuthHeaders() });
		if (res.ok) {
			const { lyrics, subtitles } = (await res.json()) as redux.Lyrics;
			return lyrics || subtitles || undefined;
		}
		if (res.status === 404) return undefined;
		if (attempt < 4 && (res.status === 429 || res.status >= 500)) {
			await sleep(2000 * (attempt + 1));
			continue;
		}
		throw new Error(`Failed to load lyrics (${res.status})`);
	}
};

const songLanguages = async (trackId: string): Promise<SongLanguages> => {
	const cached = await songStore.get<SongLanguages>(trackId);
	if (cached !== undefined && (cached.shares !== null || Date.now() - cached.at < NO_LYRICS_MAX_AGE)) return cached;
	const lyrics = await fetchLyrics(trackId);
	const shares = lyrics === undefined ? null : detectLanguages(lyrics);
	const result: SongLanguages = { shares: shares && Object.keys(shares).length > 0 ? shares : null, at: Date.now() };
	await songStore.set(trackId, result);
	// Let TIDAL breathe between songs
	await sleep(0);
	return result;
};

/** Drops languages below the minimum share (keeps at least the main one) and scales the rest back to 100% */
const withoutNoise = (shares: Record<string, number>) => {
	const sorted = Object.entries(shares).sort((a, b) => b[1] - a[1]);
	const kept = sorted.filter(([, share], index) => index === 0 || share >= SONG_MIN_SHARE);
	const total = kept.reduce((sum, [, share]) => sum + share, 0);
	return kept.map(([code, share]) => [code, share / total] as const);
};

export const summarize = (songs: (Record<string, number> | null)[], failed = 0): LanguageSummary => {
	const totals = new Map<string, { share: number; songs: number }>();
	const withLyrics = songs.filter((shares): shares is Record<string, number> => shares !== null);
	for (const shares of withLyrics) {
		for (const [code, share] of withoutNoise(shares)) {
			const entry = totals.get(code) ?? { share: 0, songs: 0 };
			entry.share += share / withLyrics.length;
			entry.songs++;
			totals.set(code, entry);
		}
	}
	return {
		languages: [...totals].map(([code, { share, songs }]) => ({ code, share, songs })).sort((a, b) => b.share - a.share),
		withLyrics: withLyrics.length,
		withoutLyrics: songs.length - withLyrics.length,
		failed,
	};
};

/** Identifies a playlist version: the summary is reused as long as the playlist didn't change */
const playlistStamp = (uuid: string) => {
	const playlist = redux.store.getState().content.playlists[uuid];
	return playlist?.lastUpdated ? `${playlist.lastUpdated}|${playlist.numberOfTracks}` : undefined;
};

/** The last summary of the playlist, if it's still up to date */
export const cachedSummary = async (uuid: string): Promise<LanguageSummary | undefined> => {
	const stamp = playlistStamp(uuid);
	const cached = await playlistStore.get<{ stamp: string; summary: LanguageSummary }>(uuid);
	return stamp !== undefined && cached?.stamp === stamp ? cached.summary : undefined;
};

/** Reads the lyrics of every song (cached per song) and sums up the languages */
export const analyzePlaylist = async (uuid: string, onProgress: (done: number, total: number) => void, cancelled: () => boolean) => {
	const items = await fetchPlaylistItems(uuid);
	const trackIds = [...new Set(items.filter(({ type }) => type === "track").map(({ item }) => String(item.id)))];
	const results: (Record<string, number> | null)[] = [];
	let failed = 0;
	let next = 0;
	let done = 0;
	onProgress(0, trackIds.length);
	const worker = async () => {
		while (next < trackIds.length && !cancelled()) {
			const trackId = trackIds[next++];
			try {
				results.push((await songLanguages(trackId)).shares);
			} catch {
				failed++;
			}
			onProgress(++done, trackIds.length);
		}
	};
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, trackIds.length) }, worker));
	const summary = summarize(results, failed);
	const stamp = playlistStamp(uuid);
	if (!cancelled() && failed === 0 && stamp !== undefined) await playlistStore.set(uuid, { stamp, summary });
	return summary;
};
