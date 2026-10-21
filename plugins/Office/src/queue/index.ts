import type { LunaUnload, LunaUnloads } from "@luna/core";
import { observe, PlayState, redux, StyleTag } from "@luna/lib";

import styles from "file://styles.css?minify";

import { trace } from "../log";
import { isCompact } from "../compact";
import { settings, settingsListeners } from "../Settings";
import { artistNames, coverUrl, formatDuration, formatLength, knownTrackInfo, songCount, trackInfo, type TrackInfo } from "./data";
import { swapImage } from "../swapImage";
import { marqueeLine, startMarquee } from "../marquee";

type Element_ = redux.PlayQueueElement;
type Mode = "next" | "history";
type ListItem = { element: Element_; index: number; virtual?: string };

const SVG = (d: string, size: number) =>
	`<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON = {
	close: "M19.707 5.707 13.414 12l6.293 6.293-1.414 1.414L12 13.414l-6.293 6.293-1.414-1.414L10.586 12 4.293 5.707l1.414-1.414L12 10.586l6.293-6.293 1.414 1.414Z",
	save: "M3 5h13v2H3V5Zm0 5h13v2H3v-2Zm0 5h8v2H3v-2Zm15-2h2v3h3v2h-3v3h-2v-3h-3v-2h3v-3Z",
	more: "M6.5 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm7.5 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm7.5 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
	play: "M7 4.5v15a.5.5 0 0 0 .76.43l12.5-7.5a.5.5 0 0 0 0-.86L7.76 4.07A.5.5 0 0 0 7 4.5Z",
};

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

const iconButton = (action: string, icon: string, label: string, className = "oq-icon-btn", size = 20) => {
	const button = h("button", className);
	button.type = "button";
	button.dataset.action = action;
	button.title = label;
	button.setAttribute("aria-label", label);
	button.innerHTML = SVG(icon, size);
	return button;
};

const link = (className: string, href?: string) => {
	const a = h("a", className);
	if (href) a.setAttribute("href", href);
	a.draggable = false;
	return a;
};

const navigate = (href: string) => {
	const url = new URL(href, window.location.origin);
	redux.actions["router/PUSH"]({ pathname: url.pathname, search: url.search, replace: false });
};

const play = (index: number) => {
	PlayState.moveTo(index);
	PlayState.play();
};

/** Title of a recent search; the badge sits next to the link */
const TITLE_LINK = '[data-test="grid-item-detail-text-title-link"]';
/** Results while typing ("direct hits"); the badge sits next to the title line */
const HIT = '[data-test*="-direct-hit-"]:not([data-test*="--"])';
const HIT_LINE = `${HIT} [data-wave-number-of-lines]:has(> a)`;
const HIT_ROW = `${HIT} :has(> [data-wave-number-of-lines] > a)`;
const TITLE_LINE = `${TITLE_LINK} [data-wave-number-of-lines], ${HIT_LINE}`;
/** Titles as wide as their text, badge right behind, scrolling instead of "…". Unwrapped titles need every box up to the row to shrink. */
const SEARCH_TITLE_CSS = `
.oq-search-popover :has(> ${TITLE_LINK}) { display: flex !important; align-items: center !important; justify-content: flex-start !important; gap: 6px !important; min-width: 0 !important; }
.oq-search-popover :has(> ${TITLE_LINK}) > ${TITLE_LINK} { flex: 0 1 auto !important; min-width: 0 !important; max-width: 100% !important; overflow: hidden !important; }
.oq-search-popover :has(> ${TITLE_LINK}) > :not(${TITLE_LINK}) { flex: none !important; }
.oq-search-popover :has(> ${TITLE_LINK}) > :not(${TITLE_LINK}):empty { display: none !important; }
.oq-search-popover ${TITLE_LINK} > * { display: block !important; min-width: 0 !important; max-width: 100% !important; overflow: hidden !important; }
.oq-search-popover :is(${HIT}, ${TITLE_LINK}) *:has([data-wave-number-of-lines] > a), .oq-search-popover *:has(> ${TITLE_LINK}), .oq-search-popover :is(${HIT}, ${TITLE_LINK}) > * { min-width: 0 !important; }
.oq-search-popover ${HIT_ROW} { display: flex !important; align-items: center !important; justify-content: flex-start !important; gap: 6px !important; min-width: 0 !important; max-width: 100% !important; }
.oq-search-popover ${HIT_ROW} > :not([data-wave-number-of-lines]) { flex: none !important; margin-left: 0 !important; }
.oq-search-popover ${HIT_LINE} { flex: 0 1 auto !important; }
.oq-search-popover :is(${TITLE_LINE}) { display: block !important; min-width: 0 !important; -webkit-line-clamp: unset !important; line-clamp: unset !important; ${marqueeLine} }
`;

const tidalAside = () => document.getElementById("playQueueSidebar");

interface Row {
	node: HTMLDivElement;
	cover: HTMLImageElement;
	title: HTMLDivElement;
	artist: HTMLDivElement;
	duration: HTMLSpanElement;
	remove: HTMLButtonElement;
	info?: TrackInfo;
}

interface Section {
	root: HTMLElement;
	title: HTMLHeadingElement;
	detail: HTMLSpanElement;
	action: HTMLButtonElement;
	list: HTMLDivElement;
	items: ListItem[];
}

const createPanel = (unloads: LunaUnloads) => {
	const onLoad = () => schedule();

	// #region Structure
	const panel = h("div", "oq-panel");
	panel.setAttribute("role", "complementary");
	panel.setAttribute("aria-label", "Play queue");
	// Finds the panel's containing block (an ancestor may be transformed)
	const probe = h("i", "oq-probe");
	probe.setAttribute("aria-hidden", "true");
	const ambient = h("div", "oq-ambient");
	const ambientState: { url?: string } = {};

	const mini = h("div", "oq-mini");
	const miniCover = h("img", "oq-mini-cover");
	miniCover.alt = "";
	miniCover.draggable = false;
	const miniText = h("button", "oq-mini-text");
	miniText.type = "button";
	miniText.dataset.action = "top";
	miniText.title = "Back to the current song";
	const miniTitle = h("span", "oq-mini-title");
	const miniArtist = h("span", "oq-mini-artist");
	miniText.append(miniTitle, miniArtist);
	mini.append(miniCover, miniText, iconButton("save", ICON.save, "Save the queue as a playlist", "oq-icon-btn oq-icon-btn--flat"), iconButton("close", ICON.close, "Close", "oq-icon-btn oq-icon-btn--flat"));

	const scroll = h("div", "oq-scroll");

	const hero = h("section", "oq-hero is-empty");
	const heroCovers = h("div", "oq-hero-covers");
	const heroState: { url?: string } = {};
	const heroTop = h("div", "oq-hero-top");
	const source = link("oq-source");
	heroTop.append(source, iconButton("save", ICON.save, "Save the queue as a playlist"), iconButton("close", ICON.close, "Close"));
	const heroMeta = h("div", "oq-hero-meta");
	const heroTitle = link("oq-hero-title");
	const heroArtists = h("div", "oq-hero-artists");
	const heroAlbum = link("oq-hero-album");
	heroMeta.append(heroTitle, heroArtists, heroAlbum);
	const progress = h("div", "oq-progress");
	const progressFill = h("i");
	progress.appendChild(progressFill);
	hero.append(heroCovers, heroTop, heroMeta, progress);

	const recent = h("section", "oq-recent");
	const recentHead = h("div", "oq-head");
	const recentTitle = h("h3", undefined, "Recently played");
	const recentDetail = h("span", "oq-head-detail");
	const recentAll = h("button", "oq-text-btn", "See all");
	recentAll.type = "button";
	recentAll.dataset.action = "history";
	recentHead.append(recentTitle, recentDetail, recentAll);
	const strip = h("div", "oq-strip");
	recent.append(recentHead, strip);

	const makeSection = (action: string, actionText: string): Section => {
		const root = h("section", "oq-section");
		const head = h("div", "oq-head");
		const title = h("h3");
		const detail = h("span", "oq-head-detail");
		const button = h("button", "oq-text-btn", actionText);
		button.type = "button";
		button.dataset.action = action;
		head.append(title, detail, button);
		const list = h("div", "oq-list");
		list.setAttribute("role", "list");
		root.append(head, list);
		return { root, title, detail, action: button, list, items: [] };
	};
	const queued = makeSection("clear-queued", "Clear");
	queued.title.textContent = "Queued by you";
	const upNext = makeSection("clear-next", "Clear");
	upNext.title.textContent = "Up next";
	const history = makeSection("next", "Back to up next");
	history.title.textContent = "History";
	history.list.classList.add("oq-list--history");
	const historyEmpty = h("p", "oq-empty", "Songs you've played show up here.");
	history.root.appendChild(historyEmpty);
	const empty = h("p", "oq-empty", "Nothing is up next. Songs you play or add to the queue show up here.");

	scroll.append(hero, recent, queued.root, upNext.root, history.root, empty);
	// Floats over the list, so it doesn't shift the layout
	const scrollbar = h("div", "oq-scrollbar");
	const thumb = h("div", "oq-thumb");
	scrollbar.appendChild(thumb);
	// Behind TIDAL's header; in the full-screen view it holds that view's buttons
	const cap = h("div", "oq-cap");
	const capButtons = h("div", "oq-cap-buttons");
	cap.appendChild(capButtons);
	panel.append(cap, ambient, scroll, mini, scrollbar);
	// #endregion

	// #region Rendering
	let mode: Mode = "next";
	let frame = 0;
	const schedule = () => {
		frame ||= requestAnimationFrame(() => {
			frame = 0;
			if (panel.classList.contains("is-open")) render();
		});
	};

	const rows = new Map<string, Row>();
	let queuedUids = new Set<string>();
	/** Hidden until TIDAL has removed them */
	const removing = new Set<string>();
	const stripItems = new Map<string, HTMLButtonElement>();

	const makeRow = (uid: string): Row => {
		const node = h("div", "oq-row");
		node.tabIndex = 0;
		node.setAttribute("role", "listitem");
		node.dataset.uid = uid;
		const coverWrap = h("span", "oq-cover-wrap");
		const coverPlay = h("span", "oq-cover-play");
		coverPlay.innerHTML = SVG(ICON.play, 16);
		const cover = h("img", "oq-cover");
		cover.alt = "";
		cover.loading = "lazy";
		cover.decoding = "async";
		cover.draggable = false;
		const text = h("div", "oq-text");
		const title = h("div", "oq-title");
		const artist = h("div", "oq-artist");
		text.append(title, artist);
		const end = h("div", "oq-end");
		const duration = h("span", "oq-dur");
		const actions = h("div", "oq-actions");
		const remove = iconButton("remove", ICON.close, "Remove from the queue", "oq-row-btn", 16);
		actions.append(remove, iconButton("more", ICON.more, "More options", "oq-row-btn", 18));
		end.append(duration, actions);
		coverWrap.append(cover, coverPlay);
		node.append(coverWrap, text, end);
		return { node, cover, title, artist, duration, remove };
	};

	const updateRow = ({ element, index, virtual }: ListItem) => {
		let row = rows.get(element.uid);
		if (row === undefined) rows.set(element.uid, (row = makeRow(element.uid)));
		row.node.dataset.index = String(index);
		if (virtual) row.node.dataset.virtual = virtual;
		else delete row.node.dataset.virtual;
		const info = trackInfo(element.mediaItemId, onLoad);
		if (info !== row.info) {
			row.info = info;
			row.title.textContent = info?.title ?? "";
			row.artist.textContent = artistNames(info);
			row.duration.textContent = formatDuration(info?.duration ?? 0);
			const src = coverUrl(info, "160");
			if (src === undefined) row.cover.removeAttribute("src");
			else if (row.cover.src !== src) row.cover.src = src;
			row.node.setAttribute("aria-label", info ? `${info.title} by ${artistNames(info)}` : "Loading song");
		}
		return row;
	};

	// Like TIDAL, only the rows in view (and a few around them) exist; the lists keep their full height
	const ROW_HEIGHT = 52;
	const OVERSCAN = 8;
	const sections = [queued, upNext, history];
	/** Rows that stay while out of view: the dragged one */
	let draggedUid: string | undefined;
	const setItems = (section: Section, items: ListItem[]) => {
		section.items = items;
		section.list.style.height = `${items.length * ROW_HEIGHT}px`;
	};
	const renderRows = () => {
		const keep = new Set<string>();
		const pinned = new Set([draggedUid, (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(".oq-row")?.dataset.uid]);
		const viewTop = scroll.getBoundingClientRect().top;
		const viewHeight = scroll.clientHeight;
		for (const section of sections) {
			const { items, list } = section;
			if (section.root.hidden || items.length === 0) continue;
			const top = list.getBoundingClientRect().top - viewTop;
			const first = Math.max(0, Math.floor(-top / ROW_HEIGHT) - OVERSCAN);
			const last = Math.min(items.length, Math.ceil((viewHeight - top) / ROW_HEIGHT) + OVERSCAN);
			const positions: number[] = [];
			for (let pos = first; pos < last; pos++) positions.push(pos);
			for (const uid of pinned) {
				const pos = uid === undefined ? -1 : items.findIndex((item) => item.element.uid === uid);
				if (pos >= 0 && (pos < first || pos >= last)) positions.push(pos);
			}
			for (const pos of positions) {
				const { node } = updateRow(items[pos]);
				node.style.top = `${pos * ROW_HEIGHT}px`;
				if (node.parentElement !== list) list.appendChild(node);
				keep.add(items[pos].element.uid);
			}
		}
		for (const [uid, row] of rows)
			if (!keep.has(uid)) {
				row.node.remove();
				rows.delete(uid);
			}
	};
	/** Scrolls a row into view (rendering it) and focuses it */
	const focusRow = (section: Section, pos: number) => {
		const uid = section.items[pos]?.element.uid;
		if (uid === undefined) return;
		if (!rows.has(uid)) {
			scroll.scrollTop += section.list.getBoundingClientRect().top + pos * ROW_HEIGHT - scroll.getBoundingClientRect().top - scroll.clientHeight / 2;
			renderRows();
		}
		rows.get(uid)?.node.focus();
	};

	const renderHero = (element: Element_ | undefined, info: TrackInfo | undefined, queue: redux.PlayQueue) => {
		hero.classList.toggle("is-empty", element === undefined);
		const sourceName = queue.sourceName?.trim();
		source.hidden = !sourceName;
		if (sourceName) {
			source.replaceChildren("Playing from ", h("b", undefined, sourceName));
			if (queue.sourceUrl) source.setAttribute("href", queue.sourceUrl);
			else source.removeAttribute("href");
		}

		const cover = coverUrl(info, panel.clientWidth * window.devicePixelRatio > 640 ? "1280" : "640");
		swapImage(heroCovers, cover, heroState, schedule);
		swapImage(ambient, coverUrl(info, "320"), ambientState, schedule);

		heroTitle.textContent = element === undefined ? "Nothing playing" : (info?.title ?? "");
		if (info) heroTitle.setAttribute("href", `/track/${info.id}`);
		else heroTitle.removeAttribute("href");
		heroArtists.replaceChildren();
		info?.artists.forEach((artist, i) => {
			if (i > 0) heroArtists.append(", ");
			const a = link("oq-hero-artist", artist.id !== undefined ? `/artist/${artist.id}` : undefined);
			a.textContent = artist.name;
			heroArtists.append(a);
		});
		heroAlbum.hidden = !info?.album?.title;
		if (info?.album) {
			heroAlbum.textContent = info.album.title;
			heroAlbum.setAttribute("href", `/album/${info.album.id}`);
		}

		miniTitle.textContent = heroTitle.textContent;
		miniArtist.textContent = artistNames(info);
		const miniSrc = coverUrl(info, "160");
		if (miniSrc === undefined) miniCover.removeAttribute("src");
		else if (miniCover.src !== miniSrc) miniCover.src = miniSrc;
	};

	// #region Played "Queued by you" songs
	/**
	 * TIDAL drops played "Queued by you" songs. They're kept with the song they followed (their anchor),
	 * shown in the history there, and requeued when playback returns to it.
	 */
	type PlayedQueued = { key: string; mediaItemId: redux.ItemId; context: Element_["context"]; anchor: string; seq: number };
	type HistoryEntry = ListItem;
	let playedQueued: PlayedQueued[] = [];
	let playedSeq = 0;
	let snapshot: { elements: Element_[]; currentIndex: number } | undefined;

	const requeue = (entries: PlayedQueued[]) => {
		const { elements, currentIndex } = PlayState.playQueue;
		const groups = new Map<string, PlayedQueued[]>();
		for (const entry of [...entries].sort((a, b) => a.seq - b.seq)) groups.set(entry.anchor, [...(groups.get(entry.anchor) ?? []), entry]);
		const ordered = [...groups]
			.map(([anchor, items]) => ({ index: elements.findIndex((element) => element.uid === anchor), items }))
			.filter(({ index }) => index >= currentIndex)
			// From the back, so earlier positions stay valid
			.sort((a, b) => b.index - a.index);
		for (const { index, items } of ordered) {
			const mediaItemIds = items.map((item) => item.mediaItemId);
			const context = items[0].context;
			if (index === currentIndex) redux.actions["playQueue/ADD_NEXT"]({ mediaItemIds, context });
			else redux.actions["playQueue/ADD_AT_INDEX"]({ index: index + 1, mediaItemIds, context });
		}
	};

	/** Finds queued songs TIDAL dropped after playing or skipping them */
	const trackPlayedQueued = (queue: redux.PlayQueue) => {
		const previous = snapshot;
		snapshot = { elements: queue.elements, currentIndex: queue.currentIndex };
		if (replaying || !previous || (previous.elements === queue.elements && previous.currentIndex === queue.currentIndex)) return;
		const present = new Set(queue.elements.map((element) => element.uid));
		const oldCurrent = previous.elements[previous.currentIndex];
		const newCurrent = queue.elements[queue.currentIndex];
		const moved = oldCurrent?.uid !== newCurrent?.uid;
		const newCurrentWasAt = newCurrent ? previous.elements.findIndex((element) => element.uid === newCurrent.uid) : -1;
		previous.elements.forEach((element, index) => {
			if (element.priority !== "priority_keep" || present.has(element.uid)) return;
			// Played or skipped, not removed by hand
			const passed = index <= previous.currentIndex || (moved && newCurrentWasAt > index);
			if (!passed) return;
			let anchor: string | undefined;
			for (let i = index - 1; i >= 0; i--)
				if (present.has(previous.elements[i].uid)) {
					anchor = previous.elements[i].uid;
					break;
				}
			if (anchor === undefined) return;
			playedSeq++;
			playedQueued.push({ key: `played-${playedSeq}`, mediaItemId: element.mediaItemId, context: element.context, anchor, seq: playedSeq });
		});
		// Anchor gone (queue replaced or cleared)
		playedQueued = playedQueued.filter((entry) => present.has(entry.anchor)).slice(-100);
		// Playback returned to their anchor
		const back = playedQueued.filter((entry) => queue.elements.findIndex((element) => element.uid === entry.anchor) >= queue.currentIndex);
		if (back.length > 0) {
			playedQueued = playedQueued.filter((entry) => !back.includes(entry));
			setTimeout(() => requeue(back));
		}
	};

	/** Most recent first, remembered songs included */
	const historyEntries = (elements: Element_[], currentIndex: number): HistoryEntry[] => {
		const entries: HistoryEntry[] = [];
		for (let index = 0; index < currentIndex; index++) {
			const element = elements[index];
			entries.push({ element, index });
			for (const entry of playedQueued.filter((played) => played.anchor === element.uid).sort((a, b) => a.seq - b.seq))
				entries.push({ element: { uid: entry.key, mediaItemId: entry.mediaItemId, priority: "priority_history", context: entry.context }, index: -1, virtual: entry.key });
		}
		return entries.reverse();
	};

	/** Resolves once `check` passes or after `timeout` (TIDAL finishes some queue changes late) */
	const waitFor = (check: () => boolean, timeout = 2500) =>
		new Promise<boolean>((resolve) => {
			if (check()) return resolve(true);
			let unsubscribe = () => {};
			const timer = setTimeout(() => {
				unsubscribe();
				resolve(false);
			}, timeout);
			unsubscribe = redux.store.subscribe(() => {
				if (!check()) return;
				unsubscribe();
				clearTimeout(timer);
				resolve(true);
			});
		});

	/** Plays a history song in one jump; what played after it, and the current song, follow as "Queued by you" */
	/** Replays in progress (or settling): TIDAL's queue changes meanwhile aren't plays */
	let replaying = 0;
	const replayFrom = async (uid: string) => {
		const queue = PlayState.playQueue;
		const history = historyEntries(queue.elements, queue.currentIndex).reverse();
		const position = history.findIndex(({ element }) => element.uid === uid);
		if (position < 0) return;
		const target = history[position];
		const current = queue.elements[queue.currentIndex];
		const replay: HistoryEntry[] = [...history.slice(position + 1), ...(current ? [{ element: current, index: queue.currentIndex }] : [])];
		const remembered = target.virtual ? playedQueued.find((entry) => entry.key === target.virtual) : undefined;
		replaying++;
		try {
			const replayed = new Set([target.virtual, ...replay.map((entry) => entry.virtual)].filter(Boolean));
			playedQueued = playedQueued.filter((entry) => !replayed.has(entry.key));

			const currentUid = () => PlayState.playQueue.elements[PlayState.playQueue.currentIndex]?.uid;
			let targetUid = target.element.uid;
			if (remembered) {
				// Gone from TIDAL's queue: added after the current song and skipped to (TIDAL drops queued songs placed
				// before the current one, and its ADD_NOW clears up next)
				const known = new Set(PlayState.playQueue.elements.map((element) => element.uid));
				redux.actions["playQueue/ADD_NEXT"]({ mediaItemIds: [remembered.mediaItemId], context: remembered.context });
				const added = () => PlayState.playQueue.elements.findIndex((element) => !known.has(element.uid));
				await waitFor(() => added() >= 0);
				const addedIndex = added();
				if (addedIndex < 0) return;
				targetUid = PlayState.playQueue.elements[addedIndex].uid;
				PlayState.moveTo(addedIndex);
				PlayState.play();
				await waitFor(() => currentUid() === targetUid);
			} else {
				const targetIndex = PlayState.playQueue.elements.findIndex((element) => element.uid === targetUid);
				if (targetIndex < 0) return;
				PlayState.moveTo(targetIndex);
				PlayState.play();
				await waitFor(() => currentUid() === targetUid);
			}

			// TIDAL's own copies (coming up, or behind a replayed remembered song) make way for the "Queued by you" ones
			const tidalUids = new Set(replay.filter((entry) => !entry.virtual).map((entry) => entry.element.uid));
			const stale = () => PlayState.playQueue.elements.filter((element) => element.uid !== targetUid && tidalUids.has(element.uid));
			for (const element of stale()) redux.actions["playQueue/REMOVE_ELEMENT"]({ uid: element.uid });
			await waitFor(() => stale().length === 0);

			if (replay.length > 0) {
				const length = PlayState.playQueue.elements.length;
				redux.actions["playQueue/ADD_NEXT"]({ mediaItemIds: replay.map(({ element }) => element.mediaItemId), context: { type: "UNKNOWN" } });
				await waitFor(() => PlayState.playQueue.elements.length >= length + replay.length);
			}
		} finally {
			settle();
		}
	};
	// TIDAL may still be settling; don't count that as plays
	const settle = () =>
		setTimeout(() => {
			if (--replaying === 0) snapshot = { elements: PlayState.playQueue.elements, currentIndex: PlayState.playQueue.currentIndex };
		}, 800);

	/** Play requests run one at a time; while one runs, only the latest click waits (fast clicking ends on the last one) */
	let running = false;
	let nextTask: (() => Promise<unknown> | void) | undefined;
	const runLatest = (task: () => Promise<unknown> | void) => {
		nextTask = task;
		if (running) return;
		running = true;
		void (async () => {
			while (nextTask) {
				const task = nextTask;
				nextTask = undefined;
				try {
					await task();
				} catch (err) {
					trace.msg.err.withContext("Couldn't play the song")(err as Error);
				}
			}
			running = false;
		})();
	};

	/** Going back from the song after an anchor plays its last remembered song, not the anchor (TIDAL's pick) */
	const rememberedBefore = () => {
		const { elements, currentIndex } = PlayState.playQueue;
		const anchor = elements[currentIndex - 1];
		return anchor && playedQueued.filter((played) => played.anchor === anchor.uid).sort((a, b) => a.seq - b.seq).pop();
	};
	let ownPrevious = false;
	const backToRemembered = () => {
		if (ownPrevious || (!running && !rememberedBefore())) return false;
		// Waits for a running request, then decides on the queue as it is by then
		runLatest(async () => {
			const entry = rememberedBefore();
			if (entry) return replayFrom(entry.key);
			const before = PlayState.playQueue.currentIndex;
			ownPrevious = true;
			try {
				redux.actions["playQueue/MOVE_PREVIOUS"]();
			} finally {
				ownPrevious = false;
			}
			await waitFor(() => PlayState.playQueue.currentIndex !== before, 1000);
		});
		return true;
	};
	redux.intercept("playQueue/MOVE_PREVIOUS", unloads, () => backToRemembered() || undefined);
	/** By uid, looked up when it runs: positions shift while TIDAL updates the queue */
	const playEntry = (node: HTMLElement) => {
		const uid = node.dataset.uid;
		const virtual = node.dataset.virtual;
		if (!uid) return;
		runLatest(async () => {
			const { elements, currentIndex } = PlayState.playQueue;
			const index = elements.findIndex((element) => element.uid === uid);
			if (virtual || (index >= 0 && index < currentIndex)) return replayFrom(uid);
			if (index < 0) return;
			play(index);
			await waitFor(() => PlayState.playQueue.elements[PlayState.playQueue.currentIndex]?.uid === uid, 1500);
		});
	};
	// #endregion

	const renderRecent = (played: HistoryEntry[]) => {
		recent.hidden = played.length === 0 || mode === "history";
		if (recent.hidden) return;
		recentDetail.textContent = songCount(played.length);
		const used = new Set<string>();
		const nodes = played.slice(0, 30).map(({ element, index, virtual }) => {
			used.add(element.uid);
			let item = stripItems.get(element.uid);
			if (item === undefined) {
				item = h("button", "oq-strip-item");
				item.type = "button";
				item.dataset.action = "play";
				const playIcon = h("span", "oq-strip-play");
				playIcon.innerHTML = SVG(ICON.play, 18);
				item.append(Object.assign(h("img"), { alt: "", loading: "lazy", decoding: "async", draggable: false }), playIcon);
				stripItems.set(element.uid, item);
			}
			item.dataset.index = String(index);
			item.dataset.uid = element.uid;
			if (virtual) item.dataset.virtual = virtual;
			else delete item.dataset.virtual;
			const info = trackInfo(element.mediaItemId, onLoad);
			const label = info ? `${info.title} – ${artistNames(info)}` : "";
			if (item.title !== label) {
				item.title = label;
				item.setAttribute("aria-label", label ? `Play ${label}` : "Play");
			}
			const img = item.firstElementChild as HTMLImageElement;
			const src = coverUrl(info, "160");
			if (src !== undefined && img.src !== src) img.src = src;
			return item;
		});
		for (const uid of stripItems.keys()) if (!used.has(uid)) stripItems.delete(uid);
		const order = played
			.slice(0, 30)
			.map(({ element }) => element.uid)
			.join();
		if (strip.dataset.order !== order) {
			strip.dataset.order = order;
			strip.replaceChildren(...nodes);
			requestAnimationFrame(() => updateStripFades());
		}
	};

	const render = () => {
		const queue = PlayState.playQueue;
		const { elements, currentIndex } = queue;
		const current = elements[currentIndex];
		const currentInfo = current ? trackInfo(current.mediaItemId, onLoad) : undefined;
		renderHero(current, currentInfo, queue);

		const played = historyEntries(elements, Math.max(currentIndex, 0));
		renderRecent(played);

		panel.dataset.mode = mode;
		history.root.hidden = mode !== "history";
		if (mode === "history") {
			queued.root.hidden = upNext.root.hidden = empty.hidden = true;
			history.detail.textContent = songCount(played.length);
			setItems(history, played);
			historyEmpty.hidden = played.length > 0;
		} else {
			const upcoming = elements
				.slice(currentIndex + 1)
				.map((element, offset) => ({ element, index: currentIndex + 1 + offset }))
				.filter(({ element }) => !removing.has(element.uid));
			if (removing.size > 0) {
				const present = new Set(elements.map((element) => element.uid));
				for (const uid of removing) if (!present.has(uid)) removing.delete(uid);
			}
			const fill = (section: Section, items: typeof upcoming) => {
				section.root.hidden = items.length === 0;
				// Length only once every song is known: looking them all up would load each one from TIDAL
				let seconds: number | undefined = 0;
				for (const { element } of items) {
					const duration = knownTrackInfo(element.mediaItemId)?.duration;
					if (duration === undefined) {
						seconds = undefined;
						break;
					}
					seconds += duration;
				}
				section.detail.textContent = seconds === undefined ? songCount(items.length) : `${songCount(items.length)}, ${formatLength(seconds)}`;
				setItems(section, items);
			};
			// "Queued by you": the queued songs right after the current one
			const firstOther = upcoming.findIndex(({ element }) => element.priority !== "priority_keep");
			const queuedItems = firstOther < 0 ? upcoming : upcoming.slice(0, firstOther);
			queuedUids = new Set(queuedItems.map(({ element }) => element.uid));
			fill(queued, queuedItems);
			fill(upNext, firstOther < 0 ? [] : upcoming.slice(firstOther));
			empty.hidden = upcoming.length > 0;
		}
		renderRows();
		updateScrollbar();
	};

	const renderProgress = () => {
		const queue = PlayState.playQueue;
		const current = queue.elements[queue.currentIndex];
		const duration = current ? (trackInfo(current.mediaItemId, onLoad)?.duration ?? 0) : 0;
		const ratio = duration > 0 ? Math.min(1, PlayState.currentTime / duration) : 0;
		progressFill.style.transform = `scaleX(${ratio})`;
	};

	const applySettings = () => {
		panel.classList.toggle("no-tint", !settings.queueTint);
		schedule();
	};
	// #endregion

	// #region Placement
	/** Dark blocks behind TIDAL's header (above the queue, and for search results), between the header and the page */
	const searchBlock = h("div", "oq-block oq-search-block");
	/** TIDAL's "View all results" row classes, reused for the hint and remembered across restarts */
	const VIEW_ALL_KEY = "Office.viewAllClasses";
	const FALLBACK_VIEW_ALL = { row: "", text: "wave-text-description-demi" };
	const loadViewAllClasses = (): typeof FALLBACK_VIEW_ALL => {
		try {
			const stored = JSON.parse(localStorage.getItem(VIEW_ALL_KEY) ?? "null");
			if (typeof stored?.row === "string" && typeof stored?.text === "string") return { row: stored.row, text: stored.text };
		} catch {}
		return FALLBACK_VIEW_ALL;
	};
	let viewAllClasses = loadViewAllClasses();
	const searchHint = h("div");
	const searchHintText = h("span", undefined, "Type to search songs, artists and more");
	searchHintText.dataset.waveColor = "textDefault";
	searchHintText.dataset.waveNumberOfLines = "1";
	searchHint.appendChild(h("div")).appendChild(searchHintText);
	const styleSearchHint = () => {
		searchHint.className = `oq-search-hint ${viewAllClasses.row}`.trim();
		searchHintText.className = viewAllClasses.text || FALLBACK_VIEW_ALL.text;
	};
	styleSearchHint();
	searchBlock.appendChild(searchHint);
	// Marks 0,0 for the blocks, which slide and can't measure themselves
	const blockProbe = h("i", "oq-probe");
	for (const block of [searchBlock, blockProbe]) block.setAttribute("aria-hidden", "true");

	const lifted = new Map<HTMLElement, string>();
	/** Lets a static TIDAL element paint above the blocks without changing its layout */
	const lift = (node: HTMLElement | null) => {
		if (!node || lifted.has(node) || node.classList.contains("oq-block") || getComputedStyle(node).position !== "static") return;
		lifted.set(node, node.style.position);
		node.style.position = "relative";
	};
	const formsStackingContext = (node: Element) => {
		const style = getComputedStyle(node);
		return (
			(style.position !== "static" && style.zIndex !== "auto") ||
			style.position === "fixed" ||
			style.position === "sticky" ||
			Number(style.opacity) < 1 ||
			style.transform !== "none" ||
			style.filter !== "none" ||
			style.isolation === "isolate" ||
			/paint|layout|strict|content/.test(style.contain)
		);
	};

	/** Sidebar, page and queue, below the title bar */
	const mainRow = () =>
		document.querySelector('[data-test="main-layout-sidebar-wrapper"]')?.parentElement ?? tidalAside()?.parentElement?.parentElement ?? undefined;

	type Anchor = { parent: Element; before: HTMLElement | null; zIndex: string };
	/** Right below TIDAL's header */
	const headerAnchor = (): Anchor | undefined => {
		const header = document.getElementById("mainHeader");
		const row = mainRow();
		if (!header || !row?.contains(header)) return;
		let root: HTMLElement = header;
		for (let node: HTMLElement | null = header; node && node !== row; node = node.parentElement) if (formsStackingContext(node)) root = node;
		lift(root);
		const zIndex = getComputedStyle(root).zIndex;
		return { parent: root.parentElement!, before: root, zIndex: zIndex === "auto" ? "" : zIndex };
	};
	/** The blocks share the queue's layer (at least above the sidebar); TIDAL's header goes one above */
	const raised = new Map<HTMLElement, string>();
	const raiseAbove = (node: HTMLElement, zIndex: number) => {
		const current = parseInt(getComputedStyle(node).zIndex);
		if (!Number.isNaN(current) && current > zIndex) return;
		if (!raised.has(node)) raised.set(node, node.style.zIndex);
		node.style.zIndex = String(zIndex + 1);
	};
	/** `floating`: over the full-screen view, one layer above it (and below the header, see layoutHeader) */
	const mountBlocks = ({ parent, before }: Anchor, zIndex: string, floating: number | undefined) => {
		if (blockProbe.parentElement !== parent || blockProbe.nextElementSibling !== before) parent.insertBefore(blockProbe, before);
		if (floating !== undefined) {
			if (searchBlock.parentElement !== document.body) document.body.appendChild(searchBlock);
			searchBlock.style.zIndex = String(floating);
			return;
		}
		if (searchBlock.parentElement !== parent || searchBlock.nextElementSibling !== blockProbe) parent.insertBefore(searchBlock, blockProbe);
		searchBlock.style.zIndex = zIndex;
	};

	/** The full-screen view on screen (TIDAL renders two) */
	const fullscreenView = () => {
		const probeAt = document.elementFromPoint(window.innerWidth * 0.2, window.innerHeight * 0.5);
		const onScreen = probeAt?.closest<HTMLElement>('[data-test="new-now-playing"]');
		if (onScreen) return onScreen;
		if (!document.getElementById("footerPlayer")?.classList.contains("nowPlayingVisible")) return;
		const visible = (view: HTMLElement) => {
			const rect = view.getBoundingClientRect();
			return Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
		};
		const buttons = HEAD_BUTTONS.map(({ test }) => `:scope > header [data-test="${test}"]`).join(", ");
		return [...document.querySelectorAll<HTMLElement>('[data-test="new-now-playing"]')]
			.filter((view) => view.getClientRects().length > 0 && view.querySelector(buttons))
			.reduce<HTMLElement | undefined>((best, view) => (best === undefined || visible(view) >= visible(best) ? view : best), undefined);
	};
	/** The title bar, if any, sits right above the main row */
	/** TIDAL drops `nowPlayingVisible` from its player bar as soon as the full-screen view starts closing (the view takes a while) */
	let sawNowPlayingClass = false;
	const nowPlayingClosing = () => {
		const footer = document.getElementById("footerPlayer");
		if (!footer) return false;
		if (footer.classList.contains("nowPlayingVisible")) sawNowPlayingClass = true;
		return sawNowPlayingClass && !footer.classList.contains("nowPlayingVisible");
	};
	const titleBarBottom = () => Math.max(0, mainRow()?.getBoundingClientRect().top ?? 0);

	/** Sets a fixed element's box, correcting for ancestors that offset fixed positioning */
	const setBox = (node: HTMLElement, left: number, top: number, width: number, height: number, origin?: DOMRect, important = false) => {
		const set = (prop: string, value: number) => node.style.setProperty(prop, `${value}px`, important ? "important" : "");
		set("width", Math.max(0, width));
		set("height", Math.max(0, height));
		if (origin) {
			set("left", left - origin.left);
			set("top", top - origin.top);
			return;
		}
		set("left", left);
		set("top", top);
		const actual = node.getBoundingClientRect();
		if (Math.abs(actual.left - left) > 0.5) set("left", 2 * left - actual.left);
		if (Math.abs(actual.top - top) > 0.5) set("top", 2 * top - actual.top);
	};

	/** Widens the search bar to start at `left`, keeping the profile picture's right margin */
	const SEARCH_STYLES = ["width", "min-width", "max-width", "flex"] as const;
	let fittedSearch: HTMLElement | undefined;
	const unfitSearch = () => {
		if (fittedSearch) for (const prop of SEARCH_STYLES) fittedSearch.style.removeProperty(prop);
		fittedSearch = undefined;
	};
	const fitSearch = (left: number) => {
		const search = document.querySelector<HTMLElement>('#mainHeader [data-test="search-popover-container"]');
		const profile = document.querySelector<HTMLElement>('#mainHeader [data-test="header-profile-menu-button"]');
		const picture = profile?.querySelector("img") ?? profile;
		if (search !== fittedSearch) unfitSearch();
		if (!search || !picture) return;
		fittedSearch = search;
		// Field and cancel button stay clickable above the results and TIDAL's close layer
		for (const node of search.querySelectorAll<HTMLElement>(':scope > [data-type="search-field"], :scope > [data-test="search-input-cancel"]')) {
			lift(node);
			if (!raised.has(node)) raised.set(node, node.style.zIndex);
			node.style.zIndex = "1001";
		}
		for (const prop of SEARCH_STYLES) search.style.removeProperty(prop);
		const right = search.getBoundingClientRect().right;
		const margin = document.documentElement.clientWidth - picture.getBoundingClientRect().right;
		// `width` may exclude padding and border
		const style = getComputedStyle(search);
		const extra =
			style.boxSizing === "border-box"
				? 0
				: ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"].reduce((sum, prop) => sum + (parseFloat(style[prop as "paddingLeft"]) || 0), 0);
		const width = `${Math.max(120, right - (left + margin) - extra)}px`;
		search.style.setProperty("width", width, "important");
		search.style.setProperty("min-width", width, "important");
		search.style.setProperty("max-width", width, "important");
		search.style.setProperty("flex", "none", "important");
		return search.getBoundingClientRect();
	};

	const POPOVER = '[data-test="search-popover-popover"]';
	const POPOVER_STYLES = ["left", "top", "width", "height"] as const;
	let styledPopover: HTMLElement | undefined;
	let stopTitles: (() => void) | undefined;
	let fittedList: HTMLElement | undefined;
	const listObserver = new ResizeObserver(() => place());
	unloads.add(() => listObserver.disconnect());
	const unstylePopover = () => {
		stopTitles?.();
		stopTitles = undefined;
		if (styledPopover) {
			styledPopover.classList.remove("oq-search-popover", "oq-over-view");
			for (const prop of POPOVER_STYLES) styledPopover.style.removeProperty(prop);
		}
		for (const prop of ["top", "height", "bottom", "max-height"]) fittedList?.style.removeProperty(prop);
		unfitRows();
		listObserver.disconnect();
		styledPopover = fittedList = undefined;
	};
	/** TIDAL blocks wheel scrolling outside its popup; if the results get blocked too, they're scrolled by hand */
	let easeTarget = 0;
	let easeFrame = 0;
	let easeList: HTMLElement | undefined;
	const easeStep = () => {
		if (!easeList) return (easeFrame = 0);
		const diff = easeTarget - easeList.scrollTop;
		if (Math.abs(diff) < 1) {
			easeList.scrollTop = easeTarget;
			return (easeFrame = 0);
		}
		easeList.scrollTop += diff * 0.25;
		easeFrame = requestAnimationFrame(easeStep);
	};
	const scrollByHand = (list: HTMLElement, delta: number) => {
		if (easeFrame === 0 || easeList !== list) easeTarget = list.scrollTop;
		easeList = list;
		easeTarget = Math.max(0, Math.min(list.scrollHeight - list.clientHeight, easeTarget + delta));
		easeFrame ||= requestAnimationFrame(easeStep);
	};
	const onResultsWheel = (e: WheelEvent) => {
		const popover = styledPopover;
		if (!popover || !(e.target instanceof Node) || !popover.contains(e.target)) return;
		const list = popover.firstElementChild as HTMLElement | null;
		if (!list) return;
		e.stopPropagation();
		const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * list.clientHeight : e.deltaY;
		setTimeout(() => e.defaultPrevented && scrollByHand(list, delta));
	};
	window.addEventListener("wheel", onResultsWheel, { capture: true, passive: false });
	unloads.add(() => {
		window.removeEventListener("wheel", onResultsWheel, { capture: true });
		cancelAnimationFrame(easeFrame);
	});

	/** Pulls in rows made for TIDAL's wider popup that would stick out */
	const fittedRows = new Set<HTMLElement>();
	const unfitRows = () => {
		for (const row of fittedRows) {
			row.style.removeProperty("max-width");
			row.style.removeProperty("margin-right");
		}
		fittedRows.clear();
	};
	const fitRows = (list: HTMLElement) => {
		const limit = list.getBoundingClientRect().right + 0.5;
		const walk = (parent: Element, depth: number) => {
			for (const child of parent.children) {
				if (!(child instanceof HTMLElement) || child.getBoundingClientRect().right <= limit) continue;
				if (!fittedRows.has(child)) {
					child.style.setProperty("max-width", "100%", "important");
					child.style.setProperty("margin-right", "0", "important");
					fittedRows.add(child);
				}
				// Still sticking out: it's something inside
				if (depth < 6 && child.getBoundingClientRect().right > limit) walk(child, depth + 1);
			}
		};
		walk(list, 0);
	};

	/** `listTop`: the list's offset in the popup. The popup fits its results, up to `maxHeight` */
	const stylePopover = (popover: HTMLElement, left: number, top: number, width: number, maxHeight: number, listTop: number) => {
		if (popover !== styledPopover) {
			unstylePopover();
			stopTitles = startMarquee(popover, TITLE_LINE);
		}
		styledPopover = popover;
		popover.classList.add("oq-search-popover");
		setBox(popover, left, top, width, maxHeight, undefined, true);
		const list = popover.firstElementChild as HTMLElement | null;
		if (list !== fittedList) {
			listObserver.disconnect();
			if (list) listObserver.observe(list);
		}
		fittedList = list ?? undefined;
		if (!list) return void popover.style.setProperty("height", "0px", "important");
		list.style.setProperty("top", `${listTop}px`, "important");
		list.style.setProperty("height", "auto", "important");
		list.style.setProperty("bottom", "auto", "important");
		list.style.setProperty("max-height", `${Math.max(0, maxHeight - listTop)}px`, "important");
		fitRows(list);
		const listHeight = list.getBoundingClientRect().height;
		popover.style.setProperty("height", `${listHeight > 0 ? Math.ceil(listTop + listHeight) : 0}px`, "important");
		const viewAll = list.querySelector<HTMLElement>('[data-test="view-all-results"]');
		const viewAllText = viewAll?.querySelector("span");
		if (viewAll && viewAllText && (viewAll.className !== viewAllClasses.row || viewAllText.className !== viewAllClasses.text)) {
			viewAllClasses = { row: viewAll.className, text: viewAllText.className };
			try {
				localStorage.setItem(VIEW_ALL_KEY, JSON.stringify(viewAllClasses));
			} catch {}
			styleSearchHint();
		}
		return list.getBoundingClientRect();
	};

	/**
	 * Full-screen view buttons: copied into the queue's top section while it's open, otherwise TIDAL's own centered
	 * over the queue's column. Without lyrics, a greyed-out Lyrics button keeps the layout.
	 */
	const HEAD_BUTTONS = [
		{ test: "toggle-similar-tracks", label: "Similar tracks" },
		{ test: "toggle-credits", label: "Credits" },
		{ test: "toggle-lyrics", label: "Lyrics" },
		{ test: "new-now-playing-expand", label: "Full screen", icon: "player__maximize", viewBox: "0 0 24 24" },
		{ test: "new-now-playing-close", label: "Close", icon: "general__arrow-down", viewBox: "0 0 16 16" },
	] as const;
	const proxies = new Map<string, HTMLButtonElement>();
	const contentGroup = h("div", "oq-cap-group");
	const actionGroup = h("div", "oq-cap-group");
	for (const def of HEAD_BUTTONS) {
		const button = h("button", "icon" in def ? "oq-cap-btn oq-cap-btn--icon" : "oq-cap-btn");
		button.type = "button";
		button.dataset.action = "proxy";
		button.dataset.proxy = def.test;
		if ("icon" in def) {
			button.setAttribute("aria-label", def.label);
			button.title = def.label;
			button.innerHTML = `<svg viewBox="${def.viewBox}" width="20" height="20" fill="currentColor" aria-hidden="true"><use href="#${def.icon}"></use></svg>`;
			actionGroup.appendChild(button);
		} else {
			button.textContent = def.label;
			contentGroup.appendChild(button);
		}
		proxies.set(def.test, button);
	}
	capButtons.append(contentGroup, actionGroup);
	/** Holds the buttons in the pinned navigation bar */
	const headerButtons = h("div", "oq-header-buttons");
	const headerPinned = () => settings.pinnedHeader && !isCompact();

	const CONTENT_TOGGLES = ["toggle-similar-tracks", "toggle-credits", "toggle-lyrics"];
	/** The header child holding the full-screen buttons */
	const buttonsRowOf = (view: HTMLElement | undefined) => {
		const header = view?.querySelector<HTMLElement>(":scope > header");
		let node = header?.querySelector<HTMLElement>(HEAD_BUTTONS.map(({ test }) => `[data-test="${test}"]`).join(", "));
		while (node && node.parentElement !== header) node = node.parentElement ?? undefined;
		return node ?? undefined;
	};
	/** Closest element holding all text buttons (Similar tracks, Credits, Lyrics) */
	const contentButtonsOf = (row: HTMLElement) => {
		const toggles = CONTENT_TOGGLES.map((test) => row.querySelector<HTMLElement>(`[data-test="${test}"]`)).filter((node): node is HTMLElement => node !== null);
		if (toggles.length === 0) return;
		if (toggles.length === 1) {
			// Just one: its part of the row, or the row itself
			let node = toggles[0];
			while (node.parentElement && node.parentElement !== row) node = node.parentElement;
			return node === toggles[0] ? row : node;
		}
		let group: HTMLElement | null = toggles[0].parentElement;
		while (group && group !== row && !toggles.every((toggle) => group!.contains(toggle))) group = group.parentElement;
		return group ?? row;
	};

	let mirroredView: HTMLElement | undefined;
	const tidalButton = (test: string) => mirroredView?.querySelector<HTMLElement>(`:scope > header [data-test="${test}"]`) ?? null;
	const updateProxies = () => {
		for (const { test } of HEAD_BUTTONS) {
			const proxy = proxies.get(test)!;
			const tidal = tidalButton(test);
			proxy.disabled = tidal === null;
			proxy.classList.toggle("is-active", tidal?.getAttribute("aria-pressed") === "true");
			if (proxy.classList.contains("oq-cap-btn--icon")) {
				// TIDAL's current icon and label (e.g. maximize/minimize)
				const tidalSvg = tidal?.querySelector("svg");
				const href = tidalSvg?.querySelector("use")?.getAttribute("href");
				const svg = proxy.querySelector("svg");
				const use = svg?.querySelector("use");
				if (href && use && use.getAttribute("href") !== href) use.setAttribute("href", href);
				const viewBox = tidalSvg?.getAttribute("viewBox");
				if (viewBox && svg && svg.getAttribute("viewBox") !== viewBox) svg.setAttribute("viewBox", viewBox);
				const label = tidal?.getAttribute("aria-label");
				if (label && proxy.title !== label) {
					proxy.title = label;
					proxy.setAttribute("aria-label", label);
				}
			} else {
				// TIDAL's wording (language)
				const text = tidal?.textContent?.trim();
				if (text && proxy.textContent !== text) proxy.textContent = text;
			}
		}
	};
	const pressTidalButton = (test: string) => tidalButton(test)?.click();
	// Outside the panel and its click handler
	headerButtons.addEventListener("click", (e) => {
		const button = (e.target as Element).closest<HTMLElement>('[data-action="proxy"]');
		if (button) pressTidalButton(button.dataset.proxy ?? "");
	});

	const placeholderOf = (row: Element) => row.querySelector<HTMLElement>(":scope .oq-lyrics-missing");
	const syncLyricsPlaceholder = (view: HTMLElement | undefined) => {
		const row = buttonsRowOf(view);
		const group = row && contentButtonsOf(row);
		document.querySelectorAll(".oq-lyrics-missing").forEach((node) => node.parentElement !== group && node.remove());
		if (!group) return;
		const lyrics = group.querySelector('[data-test="toggle-lyrics"]');
		const placeholder = placeholderOf(group);
		if (lyrics) return placeholder?.remove();
		if (placeholder) return;
		// Copies an unpressed button so it doesn't look selected
		const similar = group.querySelector<HTMLElement>('[data-test="toggle-similar-tracks"]');
		const credits = group.querySelector<HTMLElement>('[data-test="toggle-credits"]');
		const template = [credits, similar].find((node) => node && node.getAttribute("aria-pressed") !== "true") ?? credits ?? similar;
		if (!template) return;
		const copy = template.cloneNode(true) as HTMLElement;
		copy.removeAttribute("data-test");
		copy.removeAttribute("aria-pressed");
		copy.setAttribute("aria-disabled", "true");
		copy.tabIndex = -1;
		copy.classList.add("oq-lyrics-missing");
		const label = copy.querySelector("span") ?? copy;
		label.textContent = "Lyrics";
		group.appendChild(copy);
	};

	// TIDAL updates the row on song changes and toggles
	const headerObserver = new MutationObserver(() => {
		updateProxies();
		syncLyricsPlaceholder(mirroredView);
		requestAnimationFrame(place);
	});
	unloads.add(() => headerObserver.disconnect());

	let centeredButtons: HTMLElement | undefined;
	let centeredShift = 0;
	const uncenterButtons = () => {
		centeredButtons?.style.removeProperty("transform");
		centeredButtons?.classList.remove("oq-row-covered", "oq-fs-buttons");
		centeredButtons = undefined;
		centeredShift = 0;
	};
	/** Roomiest spacing that fits `available` px */
	const fitLevels = (available: number) => {
		const levels = ["is-loose", "is-snug", "is-tight", "is-tighter"];
		capButtons.classList.remove(...levels);
		capButtons.style.removeProperty("--oq-cap-extra");
		for (const level of levels) {
			capButtons.classList.add(level);
			if (capButtons.scrollWidth <= available) break;
			if (level !== "is-tighter" && level !== "is-tight") capButtons.classList.remove(level);
		}
		return capButtons.scrollWidth <= available;
	};

	/** Left of the search bar, which must be fitted first */
	const placeHeaderButtons = () => {
		const header = document.getElementById("mainHeader");
		const search = header?.querySelector<HTMLElement>('[data-test="search-popover-container"]');
		if (!header || !search) return headerButtons.style.setProperty("visibility", "hidden");
		const bar = header.getBoundingClientRect();
		const field = search.getBoundingClientRect();
		const arrows = header.querySelector('[data-test="navigation-arrows"]')?.getBoundingClientRect();
		const gap = 12;
		const right = field.left - gap;
		const fits = fitLevels(right - ((arrows?.right ?? bar.left) + gap));
		headerButtons.style.left = `${Math.round(right - capButtons.scrollWidth)}px`;
		headerButtons.style.top = `${Math.round(bar.top)}px`;
		headerButtons.style.height = `${Math.round(bar.height)}px`;
		// No room: hidden rather than over the arrows
		if (fits) headerButtons.style.removeProperty("visibility");
		else headerButtons.style.setProperty("visibility", "hidden");
	};

	/** `closing`: the view is still sliding away, the copies go right away. `inHeader`: copies go to the pinned navigation bar */
	const layoutFullscreenButtons = (view: HTMLElement | undefined, queueOpen: boolean, columnLeft: number, columnWidth: number, closing: boolean, inHeader: boolean) => {
		if (view !== mirroredView) {
			headerObserver.disconnect();
			mirroredView = view;
			const header = view?.querySelector(":scope > header");
			if (header) headerObserver.observe(header, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-pressed", "class", "href", "aria-label", "viewBox"] });
		}
		cap.classList.toggle("has-buttons", view !== undefined && queueOpen && !closing && !inHeader);
		const host = inHeader ? headerButtons : cap;
		if (capButtons.parentElement !== host) host.appendChild(capButtons);
		if (!inHeader) headerButtons.remove();
		else if (!headerButtons.isConnected) document.body.appendChild(headerButtons);
		if (view && !closing && inHeader) updateProxies();
		else if (view && queueOpen && !closing) {
			updateProxies();
			// Roomiest level that fits, with equal margins
			const margin = 12;
			fitLevels(cap.clientWidth - margin * 2);
			// Leftover room goes into the 4 gaps
			const extra = Math.floor((cap.clientWidth - capButtons.scrollWidth - margin * 2) / 4);
			if (extra > 0) capButtons.style.setProperty("--oq-cap-extra", `${Math.min(extra, 8)}px`);
		}
		syncLyricsPlaceholder(view);

		const row = buttonsRowOf(view);
		if (row !== centeredButtons) uncenterButtons();
		if (!row) return;
		centeredButtons = row;
		if (!row.classList.contains("oq-fs-buttons")) row.classList.add("oq-fs-buttons");
		// Hidden under the open queue or by the pinned navigation bar, which show copies
		row.classList.toggle("oq-row-covered", queueOpen || inHeader);
		const rect = row.getBoundingClientRect();
		// TIDAL's position without our shift
		const left = rect.left - centeredShift;
		centeredShift = Math.round(columnLeft + (columnWidth - rect.width) / 2 - left);
		row.style.transform = `translateX(${centeredShift}px)`;
	};

	/** While searching, TIDAL's click-to-close layer covers the window; the queue is cut out so it stays usable */
	const BACKDROP = '#mainHeader [data-test="search-popover-backdrop"]';
	let cutBackdrop: HTMLElement | undefined;
	const uncutBackdrop = () => {
		cutBackdrop?.style.removeProperty("clip-path");
		cutBackdrop = undefined;
	};
	const cutQueueOut = (backdrop: HTMLElement | null, hole: DOMRect | undefined) => {
		if (backdrop !== cutBackdrop) uncutBackdrop();
		if (!backdrop || !hole) return uncutBackdrop();
		cutBackdrop = backdrop;
		const box = backdrop.getBoundingClientRect();
		const [l, t, r, b] = [hole.left - box.left, hole.top - box.top, hole.right - box.left, hole.bottom - box.top].map(Math.round);
		backdrop.style.clipPath = `path(evenodd, "M0 0H${Math.ceil(box.width)}V${Math.ceil(box.height)}H0Z M${l} ${t}H${r}V${b}H${l}Z")`;
	};
	const closeSearch = () => document.querySelector<HTMLElement>(BACKDROP)?.click();

	// Remembered for when the queue is closed
	let queueWidth = 0;
	let queueTop = 0;
	let heroBottom = 0;
	const defaultQueueWidth = () =>
		parseFloat(getComputedStyle(document.querySelector(".has-footer-player") ?? document.documentElement).getPropertyValue("--playQueueWidth")) || 350;

	/** Layer for the search results: the panel's (set once the queue opens), else TIDAL's queue's, else the player bar's */
	const FALLBACK_LAYER = 100;
	const queueLayer = () => {
		const own = parseInt(panel.style.zIndex);
		if (!Number.isNaN(own)) return own;
		const aside = tidalAside();
		const tidal = [aside?.parentElement, aside].map((node) => (node ? parseInt(getComputedStyle(node).zIndex) : NaN)).find((z) => !Number.isNaN(z));
		if (tidal !== undefined) return tidal;
		const footer = document.getElementById("footerPlayer");
		return footer ? parseInt(getComputedStyle(footer).zIndex) : NaN;
	};

	/** Blocks, search bar and results, around the queue or where it would be */
	const layoutHeader = (queueRect: DOMRect | undefined) => {
		const clientWidth = document.documentElement.clientWidth;
		const top = titleBarBottom();
		if (queueRect) {
			queueWidth = clientWidth - queueRect.left;
			queueTop = queueRect.top;
			heroBottom = queueRect.top + hero.offsetHeight;
		}
		const width = queueWidth || defaultQueueWidth();
		const queueLeft = clientWidth - width;
		const view = fullscreenView();
		const closing = view !== undefined && nowPlayingClosing();
		const fullscreen = closing ? undefined : view;
		// A pinned navigation bar keeps search usable in the full-screen view
		const pinned = fullscreen !== undefined && headerPinned();
		const anchor = headerAnchor();
		if (anchor && anchor.before) {
			// Above the sidebar too: in narrow windows the results reach over it
			const sidebar = document.querySelector('[data-test="main-layout-sidebar-wrapper"]');
			const layers = [queueLayer(), sidebar ? parseInt(getComputedStyle(sidebar).zIndex) + 1 : NaN].filter((z) => !Number.isNaN(z));
			const layer = layers.length > 0 ? Math.max(...layers) : FALLBACK_LAYER;
			// Over the full-screen view: right above it; the header (holding the results) stays above that
			const viewLayer = pinned && fullscreen ? parseInt(getComputedStyle(fullscreen).zIndex) : NaN;
			const floating = Number.isNaN(viewLayer) ? undefined : viewLayer + 1;
			raiseAbove(anchor.before, Math.max(layer, floating ?? layer));
			mountBlocks(anchor, String(layer), floating);
		}
		const origin = blockProbe.getBoundingClientRect();

		const searchable = fullscreen === undefined || pinned;
		layoutFullscreenButtons(view, queueRect !== undefined, queueLeft, width, closing, pinned);

		// Search block: left of the queue, down to the end of the big cover
		const popover = searchable ? document.querySelector<HTMLElement>(POPOVER) : null;
		const searching = popover !== null && anchor !== undefined;
		const searchLeft = searching && queueRect ? queueLeft - width : queueLeft;
		const bottom = heroBottom || top + 58 + Math.min(width, window.innerHeight * 0.46);
		searchBlock.classList.toggle("is-open", searching);
		// Merges with the queue's top section
		panel.classList.toggle("is-joined", searching && queueRect !== undefined);

		if (searchable) fitSearch(searchLeft);
		if (pinned) placeHeaderButtons();
		if (searching && popover) {
			// First result lines up with the queue's big cover
			const headerBottom = document.getElementById("mainHeader")?.getBoundingClientRect().bottom ?? top;
			// Below the search bar, keeping it and the profile picture uncovered
			const popoverTop = Math.max(top, headerBottom);
			const listTop = Math.max(0, (queueTop || headerBottom) - popoverTop);
			const list = stylePopover(popover, searchLeft, popoverTop, width, bottom - popoverTop, listTop);
			// The full-screen view covers the block, so the popup gets its own background
			popover.classList.toggle("oq-over-view", pinned);
			// No results yet: the hint
			const empty = !list || list.height < 1 || popover.firstElementChild?.childElementCount === 0;
			searchHint.hidden = !empty;
			// Normally the block starts higher, behind the search bar; floating, below it
			const blockTop = pinned ? popoverTop : top;
			const hintTop = popoverTop - blockTop + listTop;
			searchHint.style.top = `${hintTop}px`;
			const blockBottom = empty ? blockTop + hintTop + searchHint.offsetHeight : list && list.height > 0 ? Math.min(bottom, list.bottom) : bottom;
			// Floating in <body>, nothing offsets it; measuring it would catch its slide-in
			setBox(searchBlock, searchLeft, blockTop, width, blockBottom - blockTop, searchBlock.parentElement === document.body ? new DOMRect() : origin);
		} else unstylePopover();
		cutQueueOut(searching ? document.querySelector<HTMLElement>(BACKDROP) : null, queueRect && open ? panel.getBoundingClientRect() : undefined);
	};

	let open = false;
	const setOpen = (value: boolean) => {
		if (value === open) return;
		open = value;
		panel.classList.toggle("is-open", value);
		if (value) render();
	};

	/** Matches the class's name part, so a new hash doesn't matter (the store value is stale in current TIDAL) */
	const isTidalQueueOpen = (aside: HTMLElement) =>
		[...aside.classList].some((name) => /^_?isOpen(?:_|$)/.test(name)) || redux.store.getState().view?.showPlayQueueAside === true;

	/** While searching TIDAL lowers its queue's layer; ours keeps the previous one */
	const isSearchActive = (wrapper: HTMLElement) => [...wrapper.classList].some((name) => /^_?searchIsActive(?:_|$)/.test(name));
	let calmZIndex = "";
	const layerOf = (wrapper: HTMLElement, aside: HTMLElement) => {
		const own = [wrapper, aside].map((node) => getComputedStyle(node).zIndex).find((z) => z !== "auto") ?? "";
		if (!isSearchActive(wrapper)) return (calmZIndex = own);
		let layer = parseInt(calmZIndex || own);
		// And stays above the full-screen view
		const view = fullscreenView();
		const viewLayer = view ? parseInt(getComputedStyle(view).zIndex) : NaN;
		if (!Number.isNaN(viewLayer) && (Number.isNaN(layer) || layer <= viewLayer)) layer = viewLayer + 1;
		return Number.isNaN(layer) ? own : String(layer);
	};

	let placeFailed = false;
	const place = () => {
		try {
			layoutHeader(placeQueue());
		} catch (err) {
			if (!placeFailed) trace.msg.err.withContext("Couldn't show the play queue")(err as Error);
			placeFailed = true;
		}
	};
	/** Layout position ignoring transforms, so the blocks don't follow TIDAL's open/close animation frame by frame */
	const layoutRect = (node: HTMLElement) => {
		let x = 0;
		let y = 0;
		for (let el: HTMLElement | null = node; el; el = el.offsetParent as HTMLElement | null) {
			x += el.offsetLeft;
			y += el.offsetTop;
			if (getComputedStyle(el).position === "fixed") break;
		}
		for (let el = node.parentElement; el && el !== document.body; el = el.parentElement) {
			x -= el.scrollLeft;
			y -= el.scrollTop;
		}
		return new DOMRect(x, y, node.offsetWidth, node.offsetHeight);
	};

	/** The queue's rect, if open */
	const placeQueue = (): DOMRect | undefined => {
		const aside = tidalAside();
		const wrapper = aside?.parentElement;
		if (!aside || !wrapper || !isTidalQueueOpen(aside)) return void setOpen(false);
		if (panel.previousElementSibling !== wrapper || probe.previousElementSibling !== panel) wrapper.after(panel, probe);
		const box = layoutRect(aside);
		if (box.width < 40 || box.height < 40) return void setOpen(false);
		const marginLeft = parseFloat(getComputedStyle(aside).marginLeft) || 0;
		const rect = new DOMRect(box.left - marginLeft, box.top, box.width + marginLeft, box.height);
		const footer = document.getElementById("footerPlayer")?.getBoundingClientRect();
		const bottom = footer && footer.height > 0 ? footer.top : window.innerHeight;
		const origin = probe.getBoundingClientRect();
		const width = document.documentElement.clientWidth - rect.left;
		const zIndex = layerOf(wrapper, aside);
		// Top section: from the title bar down to TIDAL's queue
		const titleBar = titleBarBottom();
		const top = rect.top - titleBar >= 1 ? titleBar : rect.top;
		Object.assign(panel.style, {
			left: `${rect.left - origin.left}px`,
			top: `${top - origin.top}px`,
			width: `${width}px`,
			height: `${Math.max(0, bottom - top)}px`,
			zIndex,
		});
		panel.style.setProperty("--oq-head", `${rect.top - top}px`);
		setOpen(true);
		updateScrollbar();
		return rect;
	};

	// Follows TIDAL's open/close animation for a moment
	let followUntil = 0;
	let followFrame = 0;
	const follow = () => {
		followUntil = performance.now() + 700;
		const step = () => {
			place();
			followFrame = performance.now() < followUntil ? requestAnimationFrame(step) : 0;
		};
		if (followFrame === 0) step();
	};

	const resizeObserver = new ResizeObserver(() => place());
	// Opening/closing toggles a class on TIDAL's queue
	const classObserver = new MutationObserver(() => follow());
	let watchedAside: HTMLElement | undefined;
	const watchAside = (aside: HTMLElement | null) => {
		if (!aside || aside === watchedAside) return;
		watchedAside = aside;
		resizeObserver.observe(aside);
		classObserver.disconnect();
		classObserver.observe(aside, { attributes: true, attributeFilter: ["class"] });
	};
	const watch = (node: Element | null) => node && resizeObserver.observe(node);
	watch(document.documentElement);
	watchAside(tidalAside());
	observe<HTMLElement>(unloads, "#playQueueSidebar", (aside) => {
		watchAside(aside);
		follow();
	});
	// The player bar's class flips the moment the full-screen view opens/closes: re-laid out before the next frame
	const footerObserver = new MutationObserver(() => {
		place();
		follow();
	});
	const watchFooter = (footer: Element | null) => {
		if (!footer) return;
		watch(footer);
		footerObserver.disconnect();
		footerObserver.observe(footer, { attributes: true, attributeFilter: ["class"] });
	};
	watchFooter(document.getElementById("footerPlayer"));
	unloads.add(() => footerObserver.disconnect());
	observe(unloads, "#footerPlayer", watchFooter);
	window.addEventListener("resize", place);
	// Search and full-screen view opening/closing
	observe(unloads, POPOVER, () => follow());
	// Header only, not every lyrics change
	observe(unloads, '[data-test="new-now-playing"] > header', () => follow());
	const onFocusChange = () => follow();
	document.addEventListener("focusin", onFocusChange);
	document.addEventListener("focusout", onFocusChange);
	// #endregion

	// #region Store
	let lastQueue: unknown;
	let lastItems: unknown;
	let lastView: unknown;
	snapshot = { elements: PlayState.playQueue.elements, currentIndex: PlayState.playQueue.currentIndex };
	const unsubscribe = redux.store.subscribe(() => {
		const state = redux.store.getState();
		// Queue, full-screen view or search opened/closed
		if (state.view !== lastView) {
			lastView = state.view;
			follow();
		}
		// In case TIDAL replaced its queue unnoticed
		if (!open && tidalAside() !== watchedAside) {
			watchAside(tidalAside());
			follow();
		}
		if (state.playQueue !== lastQueue || state.content.mediaItems !== lastItems) {
			const queueChanged = state.playQueue !== lastQueue;
			if (queueChanged) trackPlayedQueued(state.playQueue);
			lastQueue = state.playQueue;
			lastItems = state.content.mediaItems;
			schedule();
			// Not while TIDAL is still dispatching
			if (queueChanged && refillGuard) setTimeout(removeRefills);
		}
	});

	const ticker = setInterval(() => {
		if (!open || document.hidden) return;
		renderProgress();
	}, 500);
	// #endregion

	// #region Mini bar
	const updateMini = () => mini.classList.toggle("is-shown", scroll.scrollTop > hero.offsetHeight - 72);
	scroll.addEventListener("scroll", updateMini, { passive: true });
	// #endregion

	// #region Scrollbar
	const MINI_HEIGHT = 56;
	const MIN_THUMB = 28;
	let track = { top: 0, height: 0, thumb: 0 };
	function updateScrollbar() {
		const { scrollTop, scrollHeight, clientHeight } = scroll;
		const range = scrollHeight - clientHeight;
		// Below the cover and moving up with it, but under the compact bar
		const head = scroll.offsetTop;
		const top = head + Math.max(MINI_HEIGHT, hero.offsetHeight - scrollTop);
		const height = head + clientHeight - top;
		scrollbar.hidden = range <= 1 || height < MIN_THUMB * 2;
		if (scrollbar.hidden) return;
		const thumbHeight = Math.max(MIN_THUMB, (height * clientHeight) / scrollHeight);
		track = { top, height, thumb: thumbHeight };
		scrollbar.style.top = `${top}px`;
		scrollbar.style.height = `${height}px`;
		thumb.style.height = `${thumbHeight}px`;
		thumb.style.transform = `translateY(${(scrollTop / range) * (height - thumbHeight)}px)`;
	}
	scroll.addEventListener("scroll", updateScrollbar, { passive: true });
	scroll.addEventListener("scroll", renderRows, { passive: true });
	const contentObserver = new ResizeObserver(() => {
		updateScrollbar();
		if (open) renderRows();
	});
	contentObserver.observe(scroll);
	for (const child of scroll.children) contentObserver.observe(child);

	const scrollPerPixel = () => (scroll.scrollHeight - scroll.clientHeight) / Math.max(1, track.height - track.thumb);
	thumb.addEventListener("pointerdown", (e) => {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		thumb.setPointerCapture(e.pointerId);
		const startY = e.clientY;
		const startScroll = scroll.scrollTop;
		const perPixel = scrollPerPixel();
		scrollbar.classList.add("is-dragging");
		const move = (ev: PointerEvent) => (scroll.scrollTop = startScroll + (ev.clientY - startY) * perPixel);
		const end = () => {
			scrollbar.classList.remove("is-dragging");
			thumb.removeEventListener("pointermove", move);
			thumb.removeEventListener("pointerup", end);
			thumb.removeEventListener("pointercancel", end);
		};
		thumb.addEventListener("pointermove", move);
		thumb.addEventListener("pointerup", end);
		thumb.addEventListener("pointercancel", end);
	});
	// Clicking the track jumps there
	scrollbar.addEventListener("pointerdown", (e) => {
		if (e.button !== 0 || e.target === thumb) return;
		e.preventDefault();
		const y = e.clientY - scrollbar.getBoundingClientRect().top - track.thumb / 2;
		scroll.scrollTo({ top: y * scrollPerPixel(), behavior: "smooth" });
	});
	scrollbar.addEventListener("wheel", (e) => (scroll.scrollTop += e.deltaY), { passive: true });
	// #endregion

	// #region Interaction
	const rowOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>(".oq-row") : null);
	const elementAt = (index: number) => PlayState.playQueue.elements[index];

	const openMenu = (row: HTMLElement, x: number, y: number) => {
		const remembered = row.dataset.virtual ? playedQueued.find((played) => played.key === row.dataset.virtual) : undefined;
		if (remembered) {
			redux.actions["contextMenu/OPEN_MEDIA_ITEM"]({
				type: "MEDIA_ITEM",
				id: remembered.mediaItemId,
				position: [x, y],
				canBlock: true,
				contextMenuLocation: "none",
				sourceContext: remembered.context as redux.MediaCollectionContext,
			});
			return;
		}
		const index = Number(row.dataset.index);
		const element = elementAt(index);
		if (element === undefined) return;
		try {
			redux.actions["contextMenu/OPEN_MEDIA_ITEM"]({
				type: "MEDIA_ITEM",
				id: element.mediaItemId,
				position: [x, y],
				canBlock: true,
				contextMenuLocation: "playQueue",
				index,
				sourceContext: element.context as redux.MediaCollectionContext,
			});
		} catch (err) {
			trace.msg.err.withContext("Couldn't open the song's options")(err as Error);
		}
	};

	/** One by one like the remove button (replacing the queue stops playback), a few at a time to avoid freezes */
	const removeUids = (uids: string[]) => {
		const pending = uids.filter((uid) => !removing.has(uid));
		if (pending.length === 0) return;
		pending.forEach((uid) => removing.add(uid));
		schedule();
		const step = () => {
			for (const uid of pending.splice(0, 20)) redux.actions["playQueue/REMOVE_ELEMENT"]({ uid });
			if (pending.length > 0) setTimeout(step, 16);
		};
		step();
	};

	/**
	 * Clears upcoming songs only (TIDAL's Clear drops the history too).
	 * `endSource` also removes TIDAL's later top-ups from the same source.
	 */
	const removeAll = (filter: (element: Element_) => boolean, endSource = false) => {
		const { elements, currentIndex } = PlayState.playQueue;
		const cleared = elements.slice(currentIndex + 1).filter(filter);
		if (endSource && cleared.length > 0)
			refillGuard = { contexts: new Set(cleared.map(contextKey)), known: new Set(elements.map((element) => element.uid)) };
		removeUids(cleared.map((element) => element.uid));
	};

	/** TIDAL keeps topping up from the cleared source */
	let refillGuard: { contexts: Set<string>; known: Set<string> } | undefined;
	const contextKey = (element: Element_) => `${element.context?.type}:${element.context?.id ?? ""}`;
	const isRefill = (guard: NonNullable<typeof refillGuard>, element: Element_) =>
		!guard.known.has(element.uid) && element.priority === "priority_none" && guard.contexts.has(contextKey(element));
	/** With repeat on, TIDAL starts over as usual */
	const repeatOff = () => PlayState.repeatMode === PlayState.RepeatMode.Off;

	const removeRefills = () => {
		const guard = refillGuard;
		if (guard === undefined || !repeatOff()) return;
		const { elements, currentIndex } = PlayState.playQueue;
		// TIDAL sometimes plays a song from the cleared source when the queue runs out
		const current = elements[currentIndex];
		if (current && isRefill(guard, current)) return endQueue();
		const refills = elements.slice(currentIndex + 1).filter((element) => isRefill(guard, element));
		// Anything else (your songs, a radio) stays
		elements.forEach((element) => guard.known.add(element.uid));
		if (refills.length > 0) removeUids(refills.map((element) => element.uid));
	};
	/** Queue ran out after a Clear (TIDAL's next pick would be from the cleared playlist) */
	const atEndOfClearedQueue = () => {
		const guard = refillGuard;
		if (guard === undefined || ending || !repeatOff()) return false;
		const { elements, currentIndex } = PlayState.playQueue;
		return elements.slice(currentIndex + 1).every((element) => removing.has(element.uid) || isRefill(guard, element));
	};

	/** The song's track radio, if any */
	const trackRadioId = (trackId: redux.ItemId) =>
		new Promise<redux.ItemId | undefined>((resolve) => {
			const stored = redux.store.getState().content.mediaItems[String(trackId)]?.item as { mixes?: Record<string, string> | null } | undefined;
			const known = stored?.mixes?.TRACK_MIX;
			if (known) return resolve(known);
			let done = false;
			const finish = (mixId: redux.ItemId | undefined) => {
				if (done) return;
				done = true;
				unloadSuccess();
				unloadFail();
				clearTimeout(timeout);
				resolve(mixId);
			};
			const unloadSuccess = redux.intercept("mix/LOAD_TRACK_MIX_ID_SUCCESS", unloads, (payload) => {
				if (String(payload.trackId) === String(trackId)) finish(payload.mixId);
			});
			const unloadFail = redux.intercept("mix/LOAD_TRACK_MIX_ID_FAIL", unloads, (payload) => {
				if (String(payload.trackId) === String(trackId)) finish(undefined);
			});
			const timeout = setTimeout(() => finish(undefined), 5000);
			redux.actions["mix/LOAD_TRACK_MIX_ID"]({ id: trackId });
		});

	/** Loaded through TIDAL: playing an unloaded mix crashes its player */
	const radioTracks = (mixId: redux.ItemId) =>
		new Promise<redux.ItemId[]>((resolve) => {
			let done = false;
			const finish = (ids: redux.ItemId[]) => {
				if (done) return;
				done = true;
				unloadLoaded();
				clearTimeout(timeout);
				resolve(ids);
			};
			const unloadLoaded = redux.intercept("mix/LOAD_ALL_MIX_MEDIA_ITEMS_SUCCESS", unloads, (payload) => {
				if (String(payload.mixId) !== String(mixId)) return;
				finish(payload.mediaItems.filter((mediaItem) => mediaItem.type === "track").map((mediaItem) => mediaItem.item.id));
			});
			const timeout = setTimeout(() => finish([]), 6000);
			redux.actions["mix/LOAD_TRACK_LIST_FOR_MIX_ID"]({ mixId, failSilently: true });
		});

	/** Like TIDAL's autoplay: the song's radio, or stop */
	let ending = false;
	const endQueue = async () => {
		if (ending) return;
		ending = true;
		refillGuard = undefined;
		try {
			const { elements, currentIndex } = PlayState.playQueue;
			const current = elements[currentIndex];
			const autoPlay = redux.store.getState().settings?.autoPlay !== false;
			const mixId = autoPlay && current ? await trackRadioId(current.mediaItemId) : undefined;
			// The radio usually starts with the current song
			const tracks = mixId !== undefined ? (await radioTracks(mixId)).filter((id) => String(id) !== String(current?.mediaItemId)) : [];
			if (mixId !== undefined && tracks.length > 0) redux.actions["playQueue/ADD_NOW"]({ context: { type: "mix", id: mixId }, mediaItemIds: tracks, fromIndex: 0 });
			else redux.actions["playbackControls/STOP"]();
		} catch (err) {
			trace.msg.err.withContext("Couldn't start the song's radio")(err as Error);
			redux.actions["playbackControls/STOP"]();
		} finally {
			ending = false;
		}
	};

	// After a Clear: radio instead of TIDAL's pick from the cleared playlist
	redux.intercept(["playQueue/MOVE_NEXT", "playbackControls/SKIP_NEXT"], unloads, () => {
		if (!atEndOfClearedQueue()) return;
		endQueue();
		return true;
	});

	// Playing or queueing anything yourself ends the guard
	redux.intercept(
		[
			"playQueue/ADD_NOW",
			"playQueue/ADD_TRACK_LIST_TO_PLAY_QUEUE",
			"playQueue/ADD_NOW_REST_OF_TRACK_LIST",
			"playQueue/ADD_NEXT",
			"playQueue/ADD_LAST",
			"playQueue/ADD_AT_INDEX",
			"mix/PLAY_MIX",
		],
		unloads,
		() => {
			refillGuard = undefined;
		},
	);

	const setMode = (next: Mode) => {
		mode = next;
		render();
		if (next === "history") history.root.scrollIntoView({ block: "start" });
		else scroll.scrollTo({ top: 0 });
	};

	let suppressClick = false;
	panel.addEventListener("click", (e) => {
		const target = e.target as Element;
		const anchor = target.closest<HTMLAnchorElement>("a");
		if (anchor) {
			e.preventDefault();
			const href = anchor.getAttribute("href");
			if (href) navigate(href);
			return;
		}
		const button = target.closest<HTMLElement>("[data-action]");
		const row = rowOf(target);
		if (button) {
			switch (button.dataset.action) {
				case "proxy":
					return pressTidalButton(button.dataset.proxy ?? "");
				case "close": {
					// The store action doesn't close it in every TIDAL version
					const close = document.querySelector<HTMLElement>('#playQueueSidebar [data-test="playqueue-close-button"]');
					if (close) close.click();
					else redux.actions["view/TOGGLE_PLAY_QUEUE_VISIBILITY"]();
					return;
				}
				case "save": {
					const save = document.querySelector<HTMLElement>('#playQueueSidebar [data-test="playqueue-save-button"]');
					if (save) save.click();
					else trace.msg.warn("Couldn't find TIDAL's button for saving the queue as a playlist.");
					return;
				}
				case "top":
					return scroll.scrollTo({ top: 0, behavior: "smooth" });
				case "history":
					return setMode("history");
				case "next":
					return setMode("next");
				case "clear-queued":
					return removeAll((element) => queuedUids.has(element.uid));
				case "clear-next":
					return removeAll((element) => !queuedUids.has(element.uid), true);
				case "play":
					return playEntry(button);
				case "remove": {
					const element = row && elementAt(Number(row.dataset.index));
					if (element) redux.actions["playQueue/REMOVE_ELEMENT"]({ uid: element.uid });
					return;
				}
				case "more": {
					if (!row) return;
					const rect = button.getBoundingClientRect();
					return openMenu(row, rect.left, rect.bottom);
				}
			}
			return;
		}
		if (row && !suppressClick) playEntry(row);
	});

	panel.addEventListener("contextmenu", (e) => {
		const row = rowOf(e.target);
		if (!row) return;
		e.preventDefault();
		openMenu(row, e.clientX, e.clientY);
	});

	panel.addEventListener("keydown", (e) => {
		const row = rowOf(e.target);
		if (!row || e.target !== row) return;
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			playEntry(row);
		} else if ((e.key === "Delete" || e.key === "Backspace") && mode === "next") {
			const element = elementAt(Number(row.dataset.index));
			if (element) redux.actions["playQueue/REMOVE_ELEMENT"]({ uid: element.uid });
		} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			const all = sections.filter((section) => !section.root.hidden).flatMap((section) => section.items.map((item, pos) => ({ section, item, pos })));
			const next = all[all.findIndex(({ item }) => item.element.uid === row.dataset.uid) + (e.key === "ArrowDown" ? 1 : -1)];
			if (next) focusRow(next.section, next.pos);
		} else if (e.key === "ContextMenu") {
			e.preventDefault();
			const rect = row.getBoundingClientRect();
			openMenu(row, rect.right - 40, rect.bottom);
		}
	});

	// Fades on the sides with more covers
	const updateStripFades = () => {
		const max = strip.scrollWidth - strip.clientWidth;
		strip.classList.toggle("fade-left", strip.scrollLeft > 1);
		strip.classList.toggle("fade-right", strip.scrollLeft < max - 1);
	};
	strip.addEventListener("scroll", updateStripFades, { passive: true });
	new ResizeObserver(updateStripFades).observe(strip);

	// Vertical wheel scrolls the strip sideways
	strip.addEventListener(
		"wheel",
		(e) => {
			if (strip.scrollWidth <= strip.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
			const atStart = strip.scrollLeft <= 0 && e.deltaY < 0;
			const atEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1 && e.deltaY > 0;
			if (atStart || atEnd) return;
			e.preventDefault();
			strip.scrollLeft += e.deltaY;
		},
		{ passive: false },
	);
	// #endregion

	// #region Reordering
	type Drag = { row: HTMLElement; from: number; startY: number; pointerId: number; active: boolean; target?: HTMLElement; after?: boolean };
	let drag: Drag | undefined;
	let autoScroll = 0;
	let lastPointerY = 0;

	const clearDropMarks = () => panel.querySelectorAll(".drop-before, .drop-after").forEach((node) => node.classList.remove("drop-before", "drop-after"));

	const updateDropTarget = (x: number, y: number) => {
		if (!drag) return;
		const under = rowOf(document.elementFromPoint(x, y));
		clearDropMarks();
		drag.target = undefined;
		if (!under || under === drag.row || under.closest(".oq-list--history")) return;
		const rect = under.getBoundingClientRect();
		drag.target = under;
		drag.after = y > rect.top + rect.height / 2;
		under.classList.add(drag.after ? "drop-after" : "drop-before");
	};

	const autoScrollStep = () => {
		if (!drag?.active) return (autoScroll = 0);
		const rect = scroll.getBoundingClientRect();
		const edge = 48;
		const speed = lastPointerY < rect.top + edge ? -(rect.top + edge - lastPointerY) / 3 : lastPointerY > rect.bottom - edge ? (lastPointerY - (rect.bottom - edge)) / 3 : 0;
		if (speed !== 0) scroll.scrollTop += speed;
		autoScroll = requestAnimationFrame(autoScrollStep);
	};

	/** Any press outside the search results and field closes the search */
	const onAnyPress = (e: PointerEvent) => {
		if (!styledPopover || !(e.target instanceof Element)) return;
		const target = e.target;
		// TIDAL marks what keeps the search open, like a result's context menu
		if (styledPopover.contains(target) || target.closest('[data-prevent-search-close="true"]')) return;
		const onBackdrop = target.closest(BACKDROP) !== null;
		if (!onBackdrop && target.closest('#mainHeader [data-test="search-popover-container"]')) return;
		// TIDAL handles left clicks on its layer itself
		if (onBackdrop && e.button === 0) return;
		closeSearch();
	};
	/** Right-clicks on TIDAL's close layer go to what's under it */
	const onContextMenu = (e: MouseEvent) => {
		const backdrop = e.target instanceof Element ? e.target.closest<HTMLElement>(BACKDROP) : null;
		if (!backdrop) return;
		e.preventDefault();
		e.stopPropagation();
		backdrop.style.pointerEvents = "none";
		const under = document.elementFromPoint(e.clientX, e.clientY);
		backdrop.style.removeProperty("pointer-events");
		under?.dispatchEvent(
			new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, button: 2 }),
		);
	};
	window.addEventListener("pointerdown", onAnyPress, { capture: true });
	window.addEventListener("contextmenu", onContextMenu, { capture: true });
	unloads.add(() => {
		window.removeEventListener("pointerdown", onAnyPress, { capture: true });
		window.removeEventListener("contextmenu", onContextMenu, { capture: true });
	});

	panel.addEventListener("pointerdown", (e) => {
		if (e.button !== 0 || mode !== "next") return;
		const row = rowOf(e.target);
		if (!row || (e.target as Element).closest("button, a")) return;
		drag = { row, from: Number(row.dataset.index), startY: e.clientY, pointerId: e.pointerId, active: false };
	});
	panel.addEventListener("pointermove", (e) => {
		if (!drag || e.pointerId !== drag.pointerId) return;
		lastPointerY = e.clientY;
		if (!drag.active) {
			if (Math.abs(e.clientY - drag.startY) < 6) return;
			drag.active = true;
			draggedUid = drag.row.dataset.uid;
			panel.setPointerCapture(e.pointerId);
			drag.row.classList.add("is-dragging");
			panel.classList.add("is-dragging");
			autoScroll ||= requestAnimationFrame(autoScrollStep);
		}
		updateDropTarget(e.clientX, e.clientY);
	});
	const endDrag = (e: PointerEvent, cancelled: boolean) => {
		if (!drag || e.pointerId !== drag.pointerId) return;
		const { active, target, after, from, row } = drag;
		drag = undefined;
		draggedUid = undefined;
		if (!active) return;
		row.classList.remove("is-dragging");
		panel.classList.remove("is-dragging");
		clearDropMarks();
		cancelAnimationFrame(autoScroll);
		autoScroll = 0;
		suppressClick = true;
		setTimeout(() => (suppressClick = false));
		if (cancelled || !target) return;
		const currentIndex = PlayState.playQueue.currentIndex;
		// TIDAL inserts before `toIndex`, counted before removal
		const to = Math.max(Number(target.dataset.index) + (after ? 1 : 0), currentIndex + 1);
		// Dropped next to itself: nothing moves
		if (to !== from && to !== from + 1) redux.actions["playQueue/MOVE_TRACK"]({ fromIndex: from, toIndex: to });
	};
	panel.addEventListener("pointerup", (e) => endDrag(e, false));
	panel.addEventListener("pointercancel", (e) => endDrag(e, true));
	// #endregion

	settingsListeners.add(applySettings);
	applySettings();
	place();

	const unload: LunaUnload = () => {
		unsubscribe();
		settingsListeners.delete(applySettings);
		resizeObserver.disconnect();
		contentObserver.disconnect();
		classObserver.disconnect();
		window.removeEventListener("resize", place);
		document.removeEventListener("focusin", onFocusChange);
		document.removeEventListener("focusout", onFocusChange);
		clearInterval(ticker);
		cancelAnimationFrame(frame);
		cancelAnimationFrame(followFrame);
		cancelAnimationFrame(autoScroll);
		panel.remove();
		probe.remove();
		searchBlock.remove();
		headerButtons.remove();
		blockProbe.remove();
		unfitSearch();
		unstylePopover();
		uncenterButtons();
		uncutBackdrop();
		syncLyricsPlaceholder(undefined);
		for (const [node, position] of lifted) node.style.position = position;
		for (const [node, zIndex] of raised) node.style.zIndex = zIndex;
	};
	unloads.add(unload);
};

/** Sets up the queue; toggled by its setting */
export const setupQueue = (unloads: LunaUnloads) => {
	let active: Set<LunaUnload> | undefined;
	const disable = () => {
		active?.forEach((unload) => unload());
		active = undefined;
	};
	const sync = () => {
		const wanted = settings.queue && !isCompact();
		if (wanted === (active !== undefined)) return;
		if (!wanted) return disable();
		active = new Set();
		// Hides TIDAL's queue but keeps its space
		new StyleTag("Office-queue", active, `${styles}\n#playQueueSidebar { visibility: hidden !important; }\n${SEARCH_TITLE_CSS}`);
		try {
			createPanel(active);
		} catch (err) {
			trace.msg.err.withContext("Couldn't set up the play queue")(err as Error);
			disable();
		}
	};
	settingsListeners.add(sync);
	sync();
	unloads.add(() => {
		settingsListeners.delete(sync);
		disable();
	});
};
