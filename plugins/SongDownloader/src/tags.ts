import { Album, MediaItem, Quality, type redux } from "@luna/lib";

export type FlacTags = Awaited<ReturnType<MediaItem["flacTags"]>>["tags"];
export type MetaTags = { tags: FlacTags; coverUrl: string | undefined };

const parseDate = (date: string | null | undefined) => {
	if (date === null || date === undefined) return undefined;
	const parsed = new Date(date);
	return isNaN(parsed.getTime()) ? undefined : parsed;
};

/** Luna's title formatting: the version is appended unless the title already contains it */
export const formatTitle = (title: string | undefined, version?: string | null) => {
	if (title === undefined) throw new Error("Title is undefined");
	if (version && !title.toLowerCase().includes(version.toLowerCase())) return `${title} (${version})`;
	return title;
};

const names = (artists?: readonly { name?: string | null }[] | null) =>
	(artists ?? []).map((artist) => artist.name).filter((name): name is string => !!name);

const cache = new WeakMap<MediaItem, Promise<MetaTags>>();

/**
 * Same tags as Luna's mediaItem.flacTags(), but only from TIDAL. Luna also asks MusicBrainz (2–4 requests per track,
 * rate limited to 1/s, so mostly 503) and then even prefers MusicBrainz' spelling for title and album, which made
 * file names depend on whether MusicBrainz happened to answer. Artist names come straight from the track data
 * instead of one artist request each.
 */
export const getTags = (mediaItem: MediaItem): Promise<MetaTags> => {
	let tags = cache.get(mediaItem);
	if (tags === undefined) {
		tags = makeTags(mediaItem);
		cache.set(mediaItem, tags);
		tags.catch(() => cache.delete(mediaItem));
	}
	return tags;
};

const makeTags = async (mediaItem: MediaItem): Promise<MetaTags> => {
	const track = mediaItem.tidalItem as Readonly<redux.Track>;
	const tags: FlacTags = {};

	const [album, lyrics, coverUrl] = await Promise.all([
		track.album?.id !== undefined ? Album.fromId(track.album.id) : undefined,
		mediaItem.lyrics().catch(() => undefined),
		mediaItem.coverUrl(),
	]);

	tags.title = formatTitle(track.title, track.version);
	tags.trackNumber = track.trackNumber?.toString();
	tags.discNumber = track.volumeNumber?.toString();

	const releaseDate = parseDate(track.releaseDate) ?? parseDate(album?.releaseDate) ?? parseDate(track.streamStartDate);
	tags.year = releaseDate?.getFullYear().toString();
	tags.date = releaseDate?.toISOString().slice(0, 10);

	tags.REPLAYGAIN_TRACK_PEAK = mediaItem.replayGainPeak?.toString();
	tags.REPLAYGAIN_TRACK_GAIN = mediaItem.replayGain?.toString();
	tags.comment = mediaItem.url;
	tags.copyright = track.copyright ?? undefined;
	tags.bpm = track.bpm?.toString();
	tags.isrc = track.isrc ?? undefined;

	tags.artist = names(track.artists);
	if (tags.artist.length === 0 && track.artist?.name) tags.artist = [track.artist.name];
	if (tags.artist.length === 0) tags.artist = ["Unknown Artist"];

	if (album) {
		const tidalAlbum = album.tidalAlbum;
		tags.upc = tidalAlbum.upc ?? undefined;
		tags.album = formatTitle(tidalAlbum.title, tidalAlbum.version);
		tags.albumArtist = names(tidalAlbum.artists);
		if (tags.albumArtist.length === 0) tags.albumArtist = ["Unknown Artist"];
		tags.genres = album.genre;
		tags.organization = album.recordLabel;
		tags.totalTracks = album.numberOfTracks?.toString();
		tags.date = album.releaseDate ?? tags.date;
		tags.year = album.releaseYear ?? tags.year;
	}

	tags.lyrics = lyrics?.subtitles ?? lyrics?.lyrics;
	tags.album ??= track.album?.title ?? "Unknown Album";

	return { tags, coverUrl };
};

/** Luna's mediaItem.max() without MusicBrainz: looks for a higher quality version by TIDAL's own ISRC only */
export const findRealMax = async (mediaItem: MediaItem): Promise<MediaItem> => {
	if (mediaItem.bestQuality >= Quality.Max) return mediaItem;
	const isrc = mediaItem.tidalItem.isrc;
	if (!isrc) return mediaItem;
	const best = await MediaItem.fromIsrc(isrc).catch(() => undefined);
	return best !== undefined && best.bestQuality > mediaItem.bestQuality ? best : mediaItem;
};
