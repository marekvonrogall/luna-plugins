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
/* Artist pictures have their play button in the middle: step aside while hovering */
.${BADGE}[data-kind="artist"] { transition: opacity 0.15s; }
:is([data-test^="artist-card-"], a[data-test="cell-cover"]):hover .${BADGE}[data-kind="artist"] { opacity: 0; }
/* Some cover wrappers (artist page cards) stretch every child over the image: keep the badge a small pill */
.${BADGE} { width: auto !important; height: auto !important; min-width: 0 !important; min-height: 0 !important; max-width: calc(100% - 16px); right: auto !important; bottom: auto !important; display: inline-flex !important; box-sizing: border-box; object-fit: initial; }
.${BADGE} > span { color: #fff !important; font: inherit !important; letter-spacing: normal; }
.${BADGE} > svg.comite-badge-star { display: block; flex: none; width: 1em !important; height: 1em !important; margin: 0 !important; fill: #ffd432 !important; color: #ffd432 !important; }
.${BADGE}[data-kind="artist"] { top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 13px; }
.${BADGE}[data-variant="large"] { top: 12px; left: 12px; padding: 3px 9px; font-size: 15px !important; line-height: 22px !important; }
/* Artist page: inline after "x fans" */
.${BADGE}[data-role="solo"] > svg.comite-badge-star { fill: #ff8cc6 !important; color: #ff8cc6 !important; }
.${BADGE}[data-variant="inline"] { position: relative; top: auto; left: auto; transform: none; margin-left: 10px; vertical-align: middle; font-size: 13px !important; background: rgba(255, 255, 255, 0.1); }
/* Loading: the pill's border fills clockwise with the share of the playlist read */
.${BADGE} > svg.comite-badge-ring { position: absolute; inset: 0; width: 100% !important; height: 100% !important; overflow: visible; fill: none !important; pointer-events: none; }
.comite-badge-ring rect { width: calc(100% - 1.5px); height: calc(100% - 1.5px); stroke-width: 1.5px; }
.comite-badge-ring .track { stroke: rgba(255, 255, 255, 0.18); }
.comite-badge-ring .bar { stroke: #ffd432; stroke-dasharray: 100; transition: stroke-dashoffset 0.25s linear; }
`;

type Variant = "grid" | "large" | "inline";
/** `page`: the page the card was found on, so cards of a previous page are dropped */
type Card = { kind: Kind; id: string; holder: HTMLElement; variant: Variant; page: string; visible: boolean; computed: number; token: number };

/** Covers on screen, keyed by the card element that links to exactly one playlist / album / artist */
const cards = new Map<HTMLElement, Card>();
/** Images already looked at (by their src), so the frequent rescans only handle new or recycled covers */
let seen = new WeakMap<HTMLElement, string>();

/** Covers are images, or videos for animated album covers */
const COVER = "img, video";
const coverSource = (cover: HTMLElement) =>
	cover instanceof HTMLVideoElement ? cover.poster || cover.currentSrc : cover instanceof HTMLImageElement ? cover.currentSrc || cover.src : "";
/** Covers the user shift-clicked show their average for the rest of the session, whatever the size or share rated */
const forced = new Set<string>();

/** `cardsOnly`: only album / EP / single cards get badges (artist "View all" pages) */
type Page = { kind: Kind; key: string; detailId?: string; cardsOnly?: boolean };

/** My Collection tabs and playlist folders show grids of covers; album / playlist pages one big cover */
const currentPage = (): Page | undefined => {
	const path = redux.store.getState().router?.currentPath ?? window.location.pathname;
	const tab = /^\/my-collection\/(playlists|albums|artists)/.exec(path);
	if (tab) return { kind: TABS[tab[1]], key: path };
	if (/^\/folder\//.test(path)) return { kind: "playlist", key: path };
	const playlist = LINKS.playlist.exec(path);
	if (playlist) return { kind: "playlist", key: path, detailId: playlist[1] };
	const album = LINKS.album.exec(path);
	if (album) return { kind: "album", key: path, detailId: album[1] };
	const artist = LINKS.artist.exec(path);
	if (artist) return { kind: "artist", key: path, detailId: artist[1] };
	// Any other page ("View all" of albums, EPs & singles, related albums / artists, home, search…):
	// album and artist covers only, since those cost no requests
	return { kind: "album", key: `${path}${window.location.search}`, cardsOnly: true };
};

/** Walks up from a cover image to the smallest element linking to exactly one item of the tab's kind */
const findCard = (img: HTMLElement, kind: Kind) => {
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

const removeBadge = (card: Card, role?: BadgeRole) =>
	card.holder.querySelectorAll(`:scope > .${BADGE}${role ? `[data-role="${role}"]` : ""}`).forEach((badge) => badge.remove());

/** "main": all rated songs (yellow star); "solo": artist page only, songs by the artist alone (pink star) */
type BadgeRole = "main" | "solo";

const SVG = "http://www.w3.org/2000/svg";

const ensureBadge = (card: Card, role: BadgeRole = "main") => {
	let badge = card.holder.querySelector<HTMLElement>(`:scope > .${BADGE}[data-role="${role}"]`);
	if (badge === null) {
		badge = document.createElement("div");
		badge.className = BADGE;
		badge.dataset.kind = card.kind;
		badge.dataset.variant = card.variant;
		badge.dataset.role = role;
		if (card.variant !== "inline" && getComputedStyle(card.holder).position === "static") card.holder.style.position = "relative";
		// The pink badge always sits right of the yellow one
		const solo = role === "main" ? card.holder.querySelector(`:scope > .${BADGE}[data-role="solo"]`) : null;
		card.holder.insertBefore(badge, solo);
	}
	return badge;
};

/** An SVG star sits exactly centred (the ★ glyph sits low) and can't be recoloured by TIDAL's button styles */
const createStar = () => {
	const star = document.createElementNS(SVG, "svg");
	star.classList.add("comite-badge-star");
	star.setAttribute("viewBox", "2.4 1.75 19.2 19.2");
	star.innerHTML = '<path d="M12 3.2l2.6 5.5 6 .7-4.4 4.1 1.2 6L12 16.6 6.6 19.5l1.2-6-4.4-4.1 6-.7z"/>';
	return star;
};

/** Pill with "…" whose border fills clockwise (starting top left) as pages are read */
const showLoading = (card: Card) => {
	const badge = ensureBadge(card);
	const value = document.createElement("span");
	value.textContent = "...";
	const ring = document.createElementNS(SVG, "svg");
	ring.classList.add("comite-badge-ring");
	// pathLength 100 makes the dash offset a percentage of the rounded outline
	const rect = (className: string) =>
		`<rect class="${className}" x="0.75" y="0.75" rx="5.25" ry="5.25" pathLength="100"${className === "bar" ? ' stroke-dashoffset="100"' : ""}/>`;
	ring.innerHTML = rect("track") + rect("bar");
	badge.replaceChildren(createStar(), value, ring);
	badge.title = "Computing the average rating…";
	return (fraction: number) => ring.querySelector(".bar")?.setAttribute("stroke-dashoffset", String(100 - Math.round(fraction * 100)));
};

const fillBadge = (badge: HTMLElement, value: number, title: string) => {
	const text = document.createElement("span");
	text.textContent = value.toFixed(2);
	badge.replaceChildren(createStar(), text);
	badge.title = title;
};

const songs = (count: number) => `${count} rated song${count === 1 ? "" : "s"}`;

const render = (card: Card, result: AverageResult | undefined) => {
	if (result?.kind !== "average") return removeBadge(card);
	// Artist page: pink = songs by the artist alone; yellow (all songs) only if rated collaborations make it differ
	const artistPage = card.kind === "artist" && card.variant === "inline";
	const solo = artistPage ? result.solo : undefined;
	const showMain = solo === undefined || (result.collabRated ?? 0) > 0;
	if (showMain) {
		const total = result.total !== undefined ? ` (of ${result.total})` : "";
		fillBadge(ensureBadge(card), result.value, `Average of ${songs(result.rated)}${total}${artistPage ? ", including songs with other artists" : ""}`);
	} else removeBadge(card, "main");
	if (solo !== undefined) fillBadge(ensureBadge(card, "solo"), solo.value, `Average of ${songs(solo.rated)} by this artist alone (no features or collaborations)`);
	else removeBadge(card, "solo");
};

const evaluate = async (card: Card, force = false) => {
	const token = ++card.token;
	const version = ratingsVersion();
	const key = `${card.kind}:${card.id}`;
	if (force) forced.add(key);
	try {
		const always = forced.has(key);
		// Only a shift-click on a playlist can mean many requests: show the pill right away and fill its border as pages arrive
		let setProgress: ((fraction: number) => void) | undefined;
		const onProgress = (fraction: number) => {
			if (token !== card.token) return;
			setProgress ??= showLoading(card);
			setProgress(fraction);
		};
		const result =
			card.kind === "album"
				? albumAverage(card.id)
				: card.kind === "artist"
					? artistAverage(card.id)
					: await playlistAverage(card.id, always, force ? onProgress : undefined);
		if (setProgress !== undefined) {
			// Let the border close before the number appears
			setProgress(1);
			await new Promise((resolve) => setTimeout(resolve, 300));
		}
		if (token !== card.token || !card.holder.isConnected) return;
		card.computed = version;
		render(card, result);
		if (force && result.kind === "unrated") trace.msg.log(`None of the songs in this ${card.kind === "artist" ? "artist's catalogue" : card.kind} are rated yet`);
	} catch (err) {
		if (token === card.token) card.computed = version;
		if (force) {
			if (token === card.token) removeBadge(card);
			trace.msg.err.withContext("Couldn't compute the average rating")(err as Error);
		}
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
	if (lastPage === undefined) return;
	const parent = variant === "inline" ? img : img.parentElement;
	if (parent === null) return;
	const holder = parent instanceof HTMLPictureElement && parent.parentElement !== null ? parent.parentElement : parent;
	const card: Card = { kind, id, holder, variant, page: lastPage, visible: false, computed: -1, token: 0 };
	cards.set(element, card);
	visibility.observe(holder);
};

/** Album / EP / single and artist cards ("Fans also like"): free, their averages come from the loaded ratings */
const scanAlbumCards = (root: HTMLElement) => {
	for (const card of root.querySelectorAll<HTMLElement>('[data-test^="album-card-"], [data-test^="artist-card-"]')) {
		const match = /^(album|artist)-card-(\d+)$/.exec(card.dataset.test ?? "");
		const img = card.querySelector<HTMLElement>(COVER);
		if (match === null || img === null) continue;
		const [, kind, id] = match as unknown as [string, Kind, string];
		const existing = cards.get(card);
		if (existing?.id === id && existing.holder.isConnected) continue;
		if (existing !== undefined) forget(card, existing);
		addCard(card, img, kind, id, "grid");
	}
};

/** "Related albums" / "Related artists" cells (cover links); playlists are skipped since they would need requests */
const scanCells = (root: HTMLElement) => {
	for (const link of root.querySelectorAll<HTMLAnchorElement>('a[data-test="cell-cover"]')) {
		const href = link.getAttribute("href") ?? "";
		const album = LINKS.album.exec(href);
		const artist = album ? null : LINKS.artist.exec(href);
		const kind: Kind | undefined = album ? "album" : artist ? "artist" : undefined;
		const id = album?.[1] ?? artist?.[1];
		const img = link.querySelector<HTMLElement>(COVER);
		if (kind === undefined || id === undefined || img === null) continue;
		const existing = cards.get(link);
		if (existing?.id === id && existing.holder.isConnected) continue;
		if (existing !== undefined) forget(link, existing);
		addCard(link, img, kind, id, "grid");
	}
};

/** Everything on artist pages and their "View all" pages that only needs the loaded ratings */
const scanFreeCards = (root: HTMLElement) => {
	scanAlbumCards(root);
	scanCells(root);
};

/** The big cover in the header of an album / playlist page, or next to "x fans" on an artist page */
const scanDetail = (root: HTMLElement, kind: Kind, id: string) => {
	if (kind === "artist") {
		const meta = root.querySelector<HTMLElement>('[data-test="artist-meta"]');
		if (meta !== null && !cards.get(meta)?.holder.isConnected) addCard(meta, meta, kind, id, "inline");
		scanFreeCards(root);
		return;
	}
	// Album pages: "More by" / related albums and artists further down
	if (kind === "album") scanFreeCards(root);
	// Albums: the image (or, for animated covers, the video) in the header's cover art container; playlists: img[data-test="cover-art"].
	// Never the small copy in the header that appears when scrolling (it comes first when the big cover is a video)
	const img =
		root.querySelector<HTMLElement>('[class*="_coverArtContainer_"] :is(img, video)') ??
		[...root.querySelectorAll<HTMLElement>('img[data-test="cover-art"]')].find((cover) => !cover.closest('[class*="_smallHeader_"]')) ??
		null;
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
	const pageKey = page?.key;
	for (const [element, card] of cards) if (!element.isConnected || !card.holder.isConnected || card.page !== pageKey) forget(element, card);
	if (page === undefined || kind === undefined || pageKey === undefined) return;
	if (pageKey !== lastPage) seen = new WeakMap();
	lastPage = pageKey;
	const root = document.querySelector<HTMLElement>('[data-test="main"]') ?? document.querySelector<HTMLElement>("main");
	if (root === null) return;
	if (page.cardsOnly) return scanFreeCards(root);
	if (page.detailId !== undefined) return scanDetail(root, kind, page.detailId);
	for (const img of root.querySelectorAll<HTMLElement>(COVER)) {
		const src = coverSource(img);
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
