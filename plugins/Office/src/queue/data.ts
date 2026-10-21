import { ContentBase, MediaItem, redux, type TCoverRes } from "@luna/lib";

export interface TrackArtist {
	id?: redux.ItemId;
	name: string;
}

export interface TrackInfo {
	id: redux.ItemId;
	title: string;
	artists: TrackArtist[];
	album?: { id: redux.ItemId; title: string };
	coverId?: string;
	/** Seconds */
	duration: number;
}

type StoredItem = {
	id: redux.ItemId;
	title?: string;
	version?: string | null;
	duration?: number;
	artist?: TrackArtist | null;
	artists?: TrackArtist[] | null;
	album?: { id: redux.ItemId; title?: string; cover?: string | null } | null;
	/** Videos */
	imageId?: string | null;
};

const infoOf = new WeakMap<object, TrackInfo>();
const fetched = new Map<string, TrackInfo>();
const loading = new Set<string>();
const failures = new Map<string, number>();

const toInfo = (item: StoredItem): TrackInfo => {
	let info = infoOf.get(item);
	if (info !== undefined) return info;
	let title = item.title ?? "Unknown song";
	if (item.version && !title.toLowerCase().includes(item.version.toLowerCase())) title += ` (${item.version})`;
	const artists = item.artists?.length ? item.artists : item.artist ? [item.artist] : [];
	info = {
		id: item.id,
		title,
		artists: artists.map(({ id, name }) => ({ id, name })),
		album: item.album?.id !== undefined ? { id: item.album.id, title: item.album.title ?? "" } : undefined,
		coverId: item.album?.cover ?? item.imageId ?? undefined,
		duration: item.duration ?? 0,
	};
	infoOf.set(item, info);
	return info;
};

/** Song details if TIDAL (or an earlier lookup) already has them, without loading anything */
export const knownTrackInfo = (id: redux.ItemId): TrackInfo | undefined => {
	const key = String(id);
	const stored = redux.store.getState().content.mediaItems[key]?.item as StoredItem | undefined;
	return stored !== undefined ? toInfo(stored) : fetched.get(key);
};

/**
 * Song details from TIDAL's store. Songs TIDAL hasn't loaded are fetched in the background, `onLoad` is called once they arrive.
 */
export const trackInfo = (id: redux.ItemId, onLoad: () => void): TrackInfo | undefined => {
	const known = knownTrackInfo(id);
	if (known !== undefined) return known;
	const key = String(id);
	if (!loading.has(key)) {
		loading.add(key);
		// Failed lookups are retried a few times, a bit later
		const retry = () => {
			const tries = (failures.get(key) ?? 0) + 1;
			failures.set(key, tries);
			if (tries < 3)
				setTimeout(() => {
					loading.delete(key);
					onLoad();
				}, 3000 * tries);
		};
		MediaItem.fromId(id)
			.then((mediaItem) => {
				if (mediaItem === undefined) return retry();
				fetched.set(key, toInfo(mediaItem.tidalItem as unknown as StoredItem));
				onLoad();
			})
			.catch(retry);
	}
	return undefined;
};

export const coverUrl = (info: TrackInfo | undefined, res: TCoverRes) => (info?.coverId ? ContentBase.formatCoverUrl(info.coverId, { res }) : undefined);

export const artistNames = (info: TrackInfo | undefined) => info?.artists.map((artist) => artist.name).join(", ") ?? "";

export const formatDuration = (seconds: number) => {
	if (!(seconds > 0)) return "";
	const total = Math.round(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = String(total % 60).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

export const formatLength = (seconds: number) => {
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return m === 0 ? `${h} h` : `${h} h ${m} min`;
};

export const songCount = (count: number) => `${count} ${count === 1 ? "song" : "songs"}`;
