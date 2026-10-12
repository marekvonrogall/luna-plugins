import type { LunaUnloads } from "@luna/core";
import { redux } from "@luna/lib";

import { albumAverage, artistAverage, playlistAverage, type AverageResult } from "./averages";
import { trace } from "./core";
import { ratingListeners, ratingsVersion } from "./ratings";

type Kind = "playlist" | "album" | "artist";

const BADGE = "comite-cover-badge";
const TABS: Record<string, Kind> = { playlists: "playlist", albums: "album", artists: "artist" };
const LINKS: Record<Kind, RegExp> = {
	playlist: /^\/playlist\/([0-9a-f-]{36})/i,
	album: /^\/album\/(\d+)/,
	artist: /^\/artist\/(\d+)/,
};

/** Average badge in the top left of playlist / album covers and in the middle of artist pictures */
export const COVER_BADGE_CSS = `
.${BADGE} { position: absolute; top: 8px; left: 8px; z-index: 3; display: inline-flex; align-items: center; gap: 4px; padding: 2px 7px; border-radius: 6px; background: rgba(0, 0, 0, 0.72); color: #fff !important; font-size: 12px !important; font-weight: 700 !important; line-height: 18px !important; white-space: nowrap; font-variant-numeric: tabular-nums; text-transform: none; pointer-events: none; }
.${BADGE} > span { color: #fff !important; font: inherit !important; letter-spacing: normal; }
.${BADGE} > svg { display: block; flex: none; width: 1em !important; height: 1em !important; margin: 0 !important; fill: #ffd432 !important; color: #ffd432 !important; }
.${BADGE}[data-kind="artist"] { top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 13px; }
.${BADGE}[data-variant="large"] { top: 12px; left: 12px; padding: 3px 9px; font-size: 15px !important; line-height: 22px !important; }
/* Artist page: inline after "x fans" */
.${BADGE}[data-variant="inline"] { position: static; transform: none; margin-left: 10px; vertical-align: middle; font-size: 13px !important; background: rgba(255, 255, 255, 0.1); }
`;

type Variant = "grid" | "large" | "inline";
type Card = { kind: Kind; id: string; holder: HTMLElement; variant: Variant; visible: boolean; computed: number; token: number };

/** Covers on screen, keyed by the card element that links to exactly one playlist / album / artist */
const cards = new Map<HTMLElement, Card>();
/** Images already looked at (by their src), so the frequent rescans only handle new or recycled covers */
let seen = new WeakMap<HTMLImageElement, string>();
/** Covers the user shift-clicked show their average for the rest of the session, whatever the size or share rated */
const forced = new Set<string>();

type Page = { kind: Kind; detailId?: string };

/** My Collection tabs and playlist folders show grids of covers; album / playlist pages one big cover */
const currentPage = (): Page | undefined => {
	const path = redux.store.getState().router?.currentPath ?? window.location.pathname;
	const tab = /^\/my-collection\/(playlists|albums|artists)/.exec(path);
	if (tab) return { kind: TABS[tab[1]] };
	if (/^\/folder\//.test(path)) return { kind: "playlist" };
	const playlist = LINKS.playlist.exec(path);
	if (playlist) return { kind: "playlist", detailId: playlist[1] };
	const album = LINKS.album.exec(path);
	if (album) return { kind: "album", detailId: album[1] };
	const artist = LINKS.artist.exec(path);
	if (artist) return { kind: "artist", detailId: artist[1] };
	return undefined;
};

/** Walks up from a cover image to the smallest element linking to exactly one item of the tab's kind */
const findCard = (img: HTMLImageElement, kind: Kind) => {
	let node: HTMLElement | null = img;
	for (let depth = 0; node !== null && depth < 8; depth++, node = node.parentElement) {
		const ids = new Set<string>();
		const links = [...node.querySelectorAll<HTMLAnchorElement>("a[href]")];
		if (node instanceof HTMLAnchorElement) links.push(node);
		for (const link of links) {
			const match = LINKS[kind].exec(link.getAttribute("href") ?? "");
			if (match) ids.add(match[1]);
		}
		if (ids.size === 1) return { element: node, id: [...ids][0] };
		if (ids.size > 1) return undefined;
	}
	return undefined;
};

const removeBadge = (card: Card) => card.holder.querySelector(`:scope > .${BADGE}`)?.remove();

const render = (card: Card, result: AverageResult | undefined) => {
	if (result?.kind !== "average") return removeBadge(card);
	let badge = card.holder.querySelector<HTMLElement>(`:scope > .${BADGE}`);
	if (badge === null) {
		badge = document.createElement("div");
		badge.className = BADGE;
		badge.dataset.kind = card.kind;
		badge.dataset.variant = card.variant;
		if (card.variant !== "inline" && getComputedStyle(card.holder).position === "static") card.holder.style.position = "relative";
		card.holder.appendChild(badge);
	}
	// An SVG star sits exactly centred (the ★ glyph sits low) and can't be recoloured by TIDAL's button styles
	const star = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	star.setAttribute("viewBox", "2.4 1.75 19.2 19.2");
	star.innerHTML = '<path d="M12 3.2l2.6 5.5 6 .7-4.4 4.1 1.2 6L12 16.6 6.6 19.5l1.2-6-4.4-4.1 6-.7z"/>';
	const value = document.createElement("span");
	value.textContent = result.value.toFixed(2);
	badge.replaceChildren(star, value);
	badge.title = `Average of ${result.rated} rated song${result.rated === 1 ? "" : "s"}${result.total !== undefined ? ` (of ${result.total})` : ""}`;
};

const evaluate = async (card: Card, force = false) => {
	const token = ++card.token;
	const version = ratingsVersion();
	const key = `${card.kind}:${card.id}`;
	if (force) forced.add(key);
	try {
		const always = forced.has(key);
		const result =
			card.kind === "album" ? albumAverage(card.id) : card.kind === "artist" ? artistAverage(card.id, always) : await playlistAverage(card.id, always);
		if (token !== card.token || !card.holder.isConnected) return;
		card.computed = version;
		render(card, result);
		if (force && result.kind === "unrated") trace.msg.log(`None of the songs in this ${card.kind === "artist" ? "artist's catalogue" : card.kind} are rated yet`);
	} catch (err) {
		if (token === card.token) card.computed = version;
		if (force) trace.msg.err.withContext("Couldn't compute the average rating")(err as Error);
		else trace.warn.withContext(`Couldn't compute the average of ${key}`)(err as Error);
	}
};

/** Re-evaluates visible covers whose numbers are older than the latest rating change */
const refreshVisible = () => {
	for (const card of cards.values()) if (card.visible && card.computed !== ratingsVersion()) evaluate(card);
};

const visibility = new IntersectionObserver(
	(entries) => {
		for (const entry of entries) {
			for (const card of cards.values()) {
				if (card.holder !== entry.target) continue;
				card.visible = entry.isIntersecting;
				if (card.visible && card.computed !== ratingsVersion()) evaluate(card);
			}
		}
	},
	{ rootMargin: "100px" },
);

const forget = (element: HTMLElement, card: Card) => {
	card.token++;
	visibility.unobserve(card.holder);
	removeBadge(card);
	cards.delete(element);
};

let lastPage: string | undefined;

const addCard = (element: HTMLElement, img: HTMLElement, kind: Kind, id: string, variant: Variant) => {
	const parent = variant === "inline" ? img : img.parentElement;
	if (parent === null) return;
	const holder = parent instanceof HTMLPictureElement && parent.parentElement !== null ? parent.parentElement : parent;
	const card: Card = { kind, id, holder, variant, visible: false, computed: -1, token: 0 };
	cards.set(element, card);
	visibility.observe(holder);
};

/** The big cover in the header of an album / playlist page, or next to "x fans" on an artist page */
const scanDetail = (root: HTMLElement, kind: Kind, id: string) => {
	if (kind === "artist") {
		const meta = root.querySelector<HTMLElement>('[data-test="artist-meta"]');
		if (meta !== null && !cards.get(meta)?.holder.isConnected) addCard(meta, meta, kind, id, "inline");
		return;
	}
	const img = root.querySelector<HTMLImageElement>('img[data-test="cover-art"]');
	if (img === null) return;
	// On your own playlists the cover is a "Change image" button: shift-clicking anywhere on it counts
	const element = img.closest<HTMLElement>("button, a") ?? img;
	if (cards.get(element)?.holder.isConnected) return;
	addCard(element, img, kind, id, "large");
};

/** Finds new covers on the Playlists / Albums / Artists tabs of My Collection */
const scan = () => {
	const page = currentPage();
	const kind = page?.kind;
	for (const [element, card] of cards) if (!element.isConnected || !card.holder.isConnected || card.kind !== kind || (page?.detailId !== undefined && card.id !== page.detailId)) forget(element, card);
	if (page === undefined || kind === undefined) return;
	const pageKey = `${kind}:${page.detailId ?? "grid"}`;
	if (pageKey !== lastPage) seen = new WeakMap();
	lastPage = pageKey;
	const root = document.querySelector<HTMLElement>('[data-test="main"]') ?? document.querySelector<HTMLElement>("main");
	if (root === null) return;
	if (page.detailId !== undefined) return scanDetail(root, kind, page.detailId);
	for (const img of root.querySelectorAll<HTMLImageElement>("img")) {
		const src = img.currentSrc || img.src;
		if (seen.get(img) === src) continue;
		seen.set(img, src);
		const found = findCard(img, kind);
		if (found === undefined) continue;
		const existing = cards.get(found.element);
		if (existing !== undefined) {
			if (existing.id === found.id) continue;
			forget(found.element, existing);
		}
		addCard(found.element, img, kind, found.id, "grid");
	}
};

export const setupCoverBadges = (unloads: LunaUnloads) => {
	let frame = 0;
	const queueScan = () => {
		frame ||= requestAnimationFrame(() => {
			frame = 0;
			scan();
		});
	};
	const observer = new MutationObserver(queueScan);
	observer.observe(document.body, { childList: true, subtree: true });

	let refreshTimer: ReturnType<typeof setTimeout> | undefined;
	const onRatings = () => {
		clearTimeout(refreshTimer);
		refreshTimer = setTimeout(refreshVisible, 300);
	};
	ratingListeners.add(onRatings);

	// Shift-click on a cover always shows its average: any size, any share of songs rated
	const onClick = (e: MouseEvent) => {
		if (!e.shiftKey || !(e.target instanceof Node)) return;
		for (const [element, card] of cards) {
			if (!element.contains(e.target)) continue;
			e.preventDefault();
			e.stopImmediatePropagation();
			evaluate(card, true);
			return;
		}
	};
	document.addEventListener("click", onClick, true);
	queueScan();

	unloads.add(() => {
		observer.disconnect();
		visibility.disconnect();
		cancelAnimationFrame(frame);
		clearTimeout(refreshTimer);
		ratingListeners.delete(onRatings);
		document.removeEventListener("click", onClick, true);
		for (const [element, card] of cards) forget(element, card);
	});
};
