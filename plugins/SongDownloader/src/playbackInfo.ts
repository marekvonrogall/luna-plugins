import { parseDasha, TidalApi, type PlaybackInfo, type PlaybackInfoResponse, type redux, type TidalManifest } from "@luna/lib";

/**
 * Like Luna's getPlaybackInfo, but always fresh. Luna caches it for the whole session and the
 * download links inside expire, so later downloads of that track fail with 403.
 */
export const getFreshPlaybackInfo = async (trackId: redux.ItemId, audioQuality: redux.AudioQuality): Promise<PlaybackInfo | undefined> => {
	const url = `https://desktop.tidal.com/v1/tracks/${trackId}/playbackinfo?audioquality=${audioQuality}&playbackmode=STREAM&assetpresentation=FULL`;
	let res: Response;
	for (let attempt = 0; ; attempt++) {
		res = await fetch(url, { headers: await TidalApi.getAuthHeaders() });
		// Several downloads at once can hit TIDAL's rate limit: wait a bit and retry
		if (attempt < 4 && (res.status === 429 || res.status >= 500)) {
			await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
			continue;
		}
		break;
	}
	if (res.status === 403 || res.status === 404) return undefined;
	if (!res.ok) throw new Error(`Failed to get stream info (${res.status} ${res.statusText})`);
	const info = (await res.json()) as PlaybackInfoResponse;

	switch (info.manifestMimeType) {
		case "application/vnd.tidal.bts": {
			const manifest: TidalManifest = JSON.parse(atob(info.manifest));
			return { ...info, manifestMimeType: info.manifestMimeType, manifest, mimeType: manifest.mimeType };
		}
		case "application/dash+xml": {
			const manifest = await parseDasha(atob(info.manifest), "https://sp-ad-cf.audio.tidal.com");
			return { ...info, manifestMimeType: info.manifestMimeType, manifest, mimeType: "audio/mp4" };
		}
		default:
			throw new Error(`Unsupported stream type: ${info.manifestMimeType}`);
	}
};
