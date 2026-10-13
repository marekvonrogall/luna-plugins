import { createPlaylist, getPlaylistTrackIds, mapLimited, PLAYLIST_LIMIT, PlaylistWriter, type PlaylistInfo } from "./api";

const NUMBERED = /^(.*)-(\d+)$/;

/** No playlist left to write into, the run has to stop */
export class OverflowError extends Error {}

/**
 * Writes into the target playlist and overflows into “{name}-2”, “{name}-3”… once it's full.
 * Songs in any playlist of that chain count as already collected.
 */
export class PlaylistChain {
	/** Track ids not to send: exclusion playlists plus the other playlists of the chain */
	public readonly skip: Set<string>;
	public readonly created: string[] = [];
	/** Leftovers of a full playlist that turned out to be in the chain already */
	public dropped = 0;

	private readonly writers: PlaylistWriter[] = [];
	private readonly byTitle: Map<string, PlaylistInfo>;
	private readonly base: string;
	private number: number;

	constructor(target: PlaylistInfo, playlists: PlaylistInfo[], skip: Set<string>) {
		this.skip = skip;
		this.byTitle = new Map(playlists.map((p) => [p.title, p]));
		// Picking “Name-3” continues the chain of “Name”
		const match = NUMBERED.exec(target.title);
		if (match && Number(match[2]) >= 2 && this.byTitle.has(match[1])) {
			this.base = match[1];
			this.number = Number(match[2]);
		} else {
			this.base = target.title;
			this.number = 1;
		}
		this.writers.push(new PlaylistWriter(target.uuid, target.title));
	}

	private get current() {
		return this.writers[this.writers.length - 1];
	}

	public get currentTitle() {
		return this.current.title;
	}

	public get added() {
		return this.writers.reduce((sum, w) => sum + w.added, 0);
	}
	public get sent() {
		return this.writers.reduce((sum, w) => sum + w.sent, 0);
	}
	/** Titles of the playlists songs went into */
	public get titles() {
		return this.writers.filter((w) => w.sent > 0).map((w) => w.title);
	}
	public get uuids() {
		return this.writers.map((w) => w.uuid);
	}

	/** Reads the other existing playlists of the chain so their songs aren't added again */
	public async init() {
		const others = [...this.byTitle.values()].filter((p) => {
			if (p.uuid === this.current.uuid) return false;
			if (p.title === this.base) return true;
			const match = NUMBERED.exec(p.title);
			return match !== null && match[1] === this.base && Number(match[2]) >= 2;
		});
		const idSets = await mapLimited(others, 2, (p) => getPlaylistTrackIds(p.uuid));
		for (const ids of idSets) for (const id of ids) this.skip.add(id);
	}

	/** Adds tracks, moving on to the next playlist of the chain whenever one is full */
	public async add(trackIds: string[], onSwitch: (title: string) => void) {
		let rest = await this.current.add(trackIds);
		while (rest.length > 0) {
			await this.next(onSwitch);
			const before = rest.length;
			rest = rest.filter((id) => !this.skip.has(id));
			this.dropped += before - rest.length;
			rest = await this.current.add(rest);
		}
	}

	private async next(onSwitch: (title: string) => void) {
		try {
			await this.switchToNext(onSwitch);
		} catch (err) {
			throw new OverflowError(`“${this.current.title}” is full and the next playlist couldn't be prepared: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private async switchToNext(onSwitch: (title: string) => void) {
		const full = this.current;
		await full.finish();
		// The next playlist must not repeat songs of the full one
		for (const id of await getPlaylistTrackIds(full.uuid)) this.skip.add(id);

		while (true) {
			this.number++;
			const title = `${this.base}-${this.number}`;
			const existing = this.byTitle.get(title);
			// Existing ones were read in init(); full ones are passed over
			if (existing !== undefined) {
				if (existing.numberOfTracks >= PLAYLIST_LIMIT) continue;
				this.writers.push(new PlaylistWriter(existing.uuid, title));
			} else {
				const created = await createPlaylist(title);
				this.byTitle.set(title, created);
				this.created.push(title);
				this.writers.push(new PlaylistWriter(created.uuid, title));
			}
			onSwitch(title);
			return;
		}
	}

	public finish() {
		return this.current.finish();
	}
}
