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

/**
 * Song details from TIDAL's store. Songs TIDAL hasn't loaded are fetched in the background, `onLoad` is called once they arrive.
 */
export const trackInfo = (id: redux.ItemId, onLoad: () => void): TrackInfo | undefined => {
	const key = String(id);
	const stored = redux.store.getState().content.mediaItems[key]?.item as StoredItem | undefined;
	if (stored !== undefined) return toInfo(stored);
	const cached = fetched.get(key);
	if (cached !== undefined) return cached;
	if (!loading.has(key)) {
		loading.add(key);
		MediaItem.fromId(id)
			.then((mediaItem) => {
				if (mediaItem !== undefined) fetched.set(key, toInfo(mediaItem.tidalItem as unknown as StoredItem));
				onLoad();
			})
			.catch(() => {});
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

const clockFormat = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" });
/** "21:34", or "9:34" in 12-hour locales (no AM/PM, it's always within the next hours) */
export const formatClock = (epochMs: number) =>
	clockFormat
		.formatToParts(epochMs)
		.filter(({ type }) => type !== "dayPeriod")
		.map(({ value }) => value)
		.join("")
		.trim();

export const songCount = (count: number) => `${count} ${count === 1 ? "song" : "songs"}`;
