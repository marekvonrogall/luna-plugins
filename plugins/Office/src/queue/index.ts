import type { LunaUnload, LunaUnloads } from "@luna/core";
import { observe, PlayState, redux, StyleTag } from "@luna/lib";

import styles from "file://styles.css?minify";

import { trace } from "../log";
import { settings, settingsListeners } from "../Settings";
import { artistNames, coverUrl, formatDuration, formatLength, songCount, trackInfo, type TrackInfo } from "./data";

type Element_ = redux.PlayQueueElement;
type Mode = "next" | "history";

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

const tidalAside = () => document.getElementById("playQueueSidebar");

/** Fades a new image in over the old ones once it has loaded */
const swapImage = (container: HTMLElement, url: string | undefined, state: { url?: string }) => {
	if (url === state.url) return;
	state.url = url;
	if (url === undefined) {
		container.replaceChildren();
		return;
	}
	const img = new Image();
	img.alt = "";
	img.draggable = false;
	img.decoding = "async";
	img.onload = () => {
		if (state.url !== url) return;
		container.appendChild(img);
		requestAnimationFrame(() => img.classList.add("is-in"));
		setTimeout(() => {
			for (const old of [...container.children]) if (old !== img) old.remove();
		}, 700);
	};
	img.src = url;
};

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
	order: string;
}

const createPanel = (unloads: LunaUnloads) => {
	const onLoad = () => schedule();

	// #region Structure
	const panel = h("div", "oq-panel");
	panel.setAttribute("role", "complementary");
	panel.setAttribute("aria-label", "Play queue");
	// Zero-size sibling at 0,0 to find the panel's containing block (in case an ancestor is transformed)
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
		return { root, title, detail, action: button, list, order: "" };
	};
	const queued = makeSection("clear-queued", "Clear");
	queued.title.textContent = "Queued by you";
	const upNext = makeSection("clear-next", "Clear");
	upNext.title.textContent = "Up next";
	const history = makeSection("next", "Back to up next");
	history.title.textContent = "History";
	history.list.classList.add("oq-list--history");
	const empty = h("p", "oq-empty", "Nothing is up next. Songs you play or add to the queue show up here.");

	scroll.append(hero, recent, queued.root, upNext.root, history.root, empty);
	// Own scrollbar: floats over the list (no layout jump when it appears/disappears) and never covers the big cover
	const scrollbar = h("div", "oq-scrollbar");
	const thumb = h("div", "oq-thumb");
	scrollbar.appendChild(thumb);
	// Top section of the queue, up to the title bar: behind TIDAL's header (search bar, profile picture), and in the
	// full-screen view it shows that view's buttons (TIDAL's own are under the queue there)
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
	/** Songs being cleared, hidden until TIDAL has removed them */
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

	const updateRow = (element: Element_, index: number, used: Set<string>) => {
		used.add(element.uid);
		let row = rows.get(element.uid);
		if (row === undefined) rows.set(element.uid, (row = makeRow(element.uid)));
		row.node.dataset.index = String(index);
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
		return row.node;
	};

	/** Only moves rows around when the order changed */
	const fillSection = (section: Section, nodes: HTMLElement[], order: string) => {
		if (section.order === order && section.list.childElementCount === nodes.length) return;
		section.order = order;
		section.list.replaceChildren(...nodes);
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
		swapImage(heroCovers, cover, heroState);
		swapImage(ambient, coverUrl(info, "320"), ambientState);

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

	const renderRecent = (played: { element: Element_; index: number }[]) => {
		recent.hidden = played.length === 0 || mode === "history";
		if (recent.hidden) return;
		recentDetail.textContent = songCount(played.length);
		const used = new Set<string>();
		const nodes = played.slice(0, 30).map(({ element, index }) => {
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
		const order = nodes.map((node) => node.dataset.index).join();
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

		const played = elements
			.slice(0, Math.max(currentIndex, 0))
			.map((element, index) => ({ element, index }))
			.reverse();
		renderRecent(played);

		const used = new Set<string>();
		panel.dataset.mode = mode;
		history.root.hidden = mode !== "history";
		if (mode === "history") {
			queued.root.hidden = upNext.root.hidden = empty.hidden = true;
			history.detail.textContent = songCount(played.length);
			const nodes = played.map(({ element, index }) => updateRow(element, index, used));
			fillSection(history, nodes, played.map((p) => p.element.uid).join());
			if (played.length === 0) history.list.replaceChildren(h("p", "oq-empty", "Songs you've played show up here."));
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
				const seconds = items.reduce((sum, { element }) => sum + (trackInfo(element.mediaItemId, onLoad)?.duration ?? 0), 0);
				section.detail.textContent = `${songCount(items.length)}, ${formatLength(seconds)}`;
				const nodes = items.map(({ element, index }) => updateRow(element, index, used));
				fillSection(section, nodes, items.map((item) => item.element.uid).join());
			};
			fill(
				queued,
				upcoming.filter(({ element }) => element.priority === "priority_keep"),
			);
			fill(
				upNext,
				upcoming.filter(({ element }) => element.priority !== "priority_keep"),
			);
			empty.hidden = upcoming.length > 0;
		}
		for (const uid of rows.keys()) if (!used.has(uid)) rows.delete(uid);
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
	/**
	 * Dark blocks behind TIDAL's header: one above the queue (so it seems to run up to the title bar) and one for search results.
	 * They sit right below whatever TIDAL keeps on top there, so the header (or the full-screen view's buttons) stays above them
	 * and the page underneath stays below.
	 */
	const searchBlock = h("div", "oq-block oq-search-block");
	// Zero-size marker at 0,0 next to the blocks (they slide, so they can't measure themselves)
	const blockProbe = h("i", "oq-probe");
	for (const block of [searchBlock, blockProbe]) block.setAttribute("aria-hidden", "true");

	const lifted = new Map<HTMLElement, string>();
	/** Positions a static element of TIDAL's so it paints above the blocks (doesn't change its layout) */
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

	type Anchor = { parent: Element; before: HTMLElement | null; zIndex: string };
	/** Right below TIDAL's header (in the full-screen view it holds the Similar tracks/Credits/Lyrics buttons) */
	const headerAnchor = (): Anchor | undefined => {
		const header = document.getElementById("mainHeader");
		const row = header?.closest('div[class^="_containerRow"]');
		if (!header || !row) return;
		let root: HTMLElement = header;
		for (let node: HTMLElement | null = header; node && node !== row; node = node.parentElement) if (formsStackingContext(node)) root = node;
		lift(root);
		const zIndex = getComputedStyle(root).zIndex;
		return { parent: root.parentElement!, before: root, zIndex: zIndex === "auto" ? "" : zIndex };
	};
	/**
	 * The blocks share the queue's layer (TIDAL keeps the queue above the full-screen view's background), and TIDAL's header
	 * is lifted one layer above that so its buttons and search bar stay on top
	 */
	const raised = new Map<HTMLElement, string>();
	const raiseAbove = (node: HTMLElement, zIndex: number) => {
		const current = parseInt(getComputedStyle(node).zIndex);
		if (!Number.isNaN(current) && current > zIndex) return;
		if (!raised.has(node)) raised.set(node, node.style.zIndex);
		node.style.zIndex = String(zIndex + 1);
	};
	const mountBlocks = ({ parent, before }: Anchor, zIndex: string) => {
		if (searchBlock.parentElement !== parent || searchBlock.nextElementSibling !== blockProbe || blockProbe.nextElementSibling !== before) {
			parent.insertBefore(searchBlock, before);
			parent.insertBefore(blockProbe, before);
		}
		searchBlock.style.zIndex = zIndex;
	};

	/** TIDAL's full-screen view (song, lyrics, credits…) when it's showing. TIDAL has two elements with its id: the one on screen is the real view */
	const fullscreenView = () => {
		const probeAt = document.elementFromPoint(window.innerWidth * 0.2, window.innerHeight * 0.5);
		return probeAt?.closest<HTMLElement>('[data-test="new-now-playing"]') ?? undefined;
	};
	const titleBarBottom = () => {
		const bar = document.querySelector<HTMLElement>('div[class^="_mainContainer"] > div[class^="_bar"]')?.getBoundingClientRect();
		return bar && bar.height > 0 ? bar.bottom : 0;
	};

	/**
	 * Sets a fixed element's box, correcting for ancestors that move fixed elements: by `origin` (where 0,0 ends up),
	 * or by measuring the element itself.
	 */
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

	/** The search bar starts `margin` right of `left`, `margin` being the profile picture's distance to the window's right edge */
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
		// The field and its cancel button stay clickable above the results box and TIDAL's close-on-click-outside layer
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

	/** TIDAL's search results, moved into the search block */
	const POPOVER = '[data-test="search-popover-popover"]';
	const POPOVER_STYLES = ["left", "top", "width", "height"] as const;
	let styledPopover: HTMLElement | undefined;
	let fittedList: HTMLElement | undefined;
	// The search block follows the list's height as results come and go
	const listObserver = new ResizeObserver(() => place());
	unloads.add(() => listObserver.disconnect());
	const unstylePopover = () => {
		if (styledPopover) {
			styledPopover.classList.remove("oq-search-popover");
			for (const prop of POPOVER_STYLES) styledPopover.style.removeProperty(prop);
		}
		for (const prop of ["top", "height", "max-height"]) fittedList?.style.removeProperty(prop);
		listObserver.disconnect();
		styledPopover = fittedList = undefined;
	};
	/**
	 * TIDAL blocks wheel scrolling outside where it expects its results. Its blocker doesn't get to see wheel events over the
	 * results, so the list scrolls natively. If something blocks it anyway, the list is scrolled by hand (eased, like native).
	 */
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

	/** `listTop`: where TIDAL's list inside starts, below the search bar */
	const stylePopover = (popover: HTMLElement, left: number, top: number, width: number, height: number, listTop: number) => {
		if (popover !== styledPopover) unstylePopover();
		styledPopover = popover;
		popover.classList.add("oq-search-popover");
		setBox(popover, left, top, width, height, undefined, true);
		const list = popover.firstElementChild as HTMLElement | null;
		if (list !== fittedList) {
			listObserver.disconnect();
			if (list) listObserver.observe(list);
		}
		fittedList = list ?? undefined;
		if (!list) return;
		// As tall as its content, at most down to the end of the block
		list.style.setProperty("top", `${listTop}px`, "important");
		list.style.setProperty("height", "auto", "important");
		list.style.setProperty("max-height", `calc(100% - ${listTop}px)`, "important");
		return list.getBoundingClientRect();
	};

	/**
	 * The full-screen view's buttons (Similar tracks, Credits, Lyrics, full screen, close).
	 * Queue open: copies in the queue's top section (TIDAL's own are under the queue), mirroring TIDAL's state and pressing
	 * TIDAL's buttons. Queue closed: TIDAL's own, centered where the queue would be.
	 * A song without lyrics gets a greyed-out Lyrics button instead of none, so the row keeps its layout.
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

	let mirroredView: HTMLElement | undefined;
	const tidalButton = (test: string) => mirroredView?.querySelector<HTMLElement>(`:scope > header [data-test="${test}"]`) ?? null;
	const updateProxies = () => {
		for (const { test } of HEAD_BUTTONS) {
			const proxy = proxies.get(test)!;
			const tidal = tidalButton(test);
			proxy.disabled = tidal === null;
			proxy.classList.toggle("is-active", tidal?.getAttribute("aria-pressed") === "true");
			// TIDAL's wording (language)
			const text = tidal?.textContent?.trim();
			if (text && !proxy.classList.contains("oq-cap-btn--icon") && proxy.textContent !== text) proxy.textContent = text;
		}
	};
	const pressTidalButton = (test: string) => tidalButton(test)?.click();

	/** Queue closed: a greyed-out Lyrics button in TIDAL's own row when the song has no lyrics */
	const placeholderOf = (row: Element) => row.querySelector<HTMLElement>(":scope .oq-lyrics-missing");
	const syncLyricsPlaceholder = (view: HTMLElement | undefined) => {
		const group = view?.querySelector<HTMLElement>(':scope > header div[class^="_contentButtons"]');
		document.querySelectorAll(".oq-lyrics-missing").forEach((node) => node.parentElement !== group && node.remove());
		if (!group) return;
		const lyrics = group.querySelector('[data-test="toggle-lyrics"]');
		const placeholder = placeholderOf(group);
		if (lyrics) return placeholder?.remove();
		if (placeholder) return;
		const credits = group.querySelector<HTMLElement>('[data-test="toggle-credits"]');
		if (!credits) return;
		const copy = credits.cloneNode(true) as HTMLElement;
		copy.removeAttribute("data-test");
		copy.removeAttribute("aria-pressed");
		copy.setAttribute("aria-disabled", "true");
		copy.tabIndex = -1;
		copy.classList.add("oq-lyrics-missing");
		for (const name of [...copy.classList]) if (name.startsWith("_toggleButtonActive")) copy.classList.remove(name);
		const label = copy.querySelector("span") ?? copy;
		label.textContent = "Lyrics";
		group.appendChild(copy);
	};

	// TIDAL changes the row on song changes and toggles: mirror and re-apply right away
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
		centeredButtons?.classList.remove("oq-row-covered");
		centeredButtons = undefined;
		centeredShift = 0;
	};
	const layoutFullscreenButtons = (view: HTMLElement | undefined, queueOpen: boolean, columnLeft: number, columnWidth: number) => {
		if (view !== mirroredView) {
			headerObserver.disconnect();
			mirroredView = view;
			const header = view?.querySelector(":scope > header");
			if (header) headerObserver.observe(header, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-pressed", "class"] });
		}
		cap.classList.toggle("has-buttons", view !== undefined && queueOpen);
		if (view && queueOpen) {
			updateProxies();
			// As roomy as fits the queue's width (with the same space left and right)
			const levels = ["is-loose", "is-snug", "is-tight", "is-tighter"];
			const margin = 12;
			capButtons.classList.remove(...levels);
			capButtons.style.removeProperty("--oq-cap-extra");
			for (const level of levels) {
				capButtons.classList.add(level);
				if (cap.clientWidth - capButtons.scrollWidth >= margin * 2) break;
				if (level !== "is-tighter" && level !== "is-tight") capButtons.classList.remove(level);
			}
			// Whatever room is left goes into the 4 gaps between the buttons, in whole pixels
			const extra = Math.floor((cap.clientWidth - capButtons.scrollWidth - margin * 2) / 4);
			if (extra > 0) capButtons.style.setProperty("--oq-cap-extra", `${Math.min(extra, 8)}px`);
		}
		syncLyricsPlaceholder(view);

		const row = view?.querySelector<HTMLElement>(':scope > header > div[class^="_buttons"]');
		if (row !== centeredButtons) uncenterButtons();
		if (!row) return;
		centeredButtons = row;
		// Under the queue anyway, the copies in the queue take over
		row.classList.toggle("oq-row-covered", queueOpen);
		const rect = row.getBoundingClientRect();
		// Where TIDAL put it, without our shift
		const left = rect.left - centeredShift;
		centeredShift = Math.round(columnLeft + (columnWidth - rect.width) / 2 - left);
		row.style.transform = `translateX(${centeredShift}px)`;
	};

	// Remembered for when the queue is closed
	let queueWidth = 0;
	let queueTop = 0;
	let heroBottom = 0;
	const defaultQueueWidth = () =>
		parseFloat(getComputedStyle(document.querySelector(".has-footer-player") ?? document.documentElement).getPropertyValue("--playQueueWidth")) || 350;

	/** Blocks, search bar and search results, around the queue (`queueRect`) or where it would be */
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
		const fullscreen = fullscreenView();
		const anchor = headerAnchor();
		if (anchor && anchor.before) {
			const queueLayer = parseInt(panel.style.zIndex);
			if (!Number.isNaN(queueLayer)) raiseAbove(anchor.before, queueLayer);
			mountBlocks(anchor, Number.isNaN(queueLayer) ? anchor.zIndex : String(queueLayer));
		}
		const origin = blockProbe.getBoundingClientRect();

		layoutFullscreenButtons(fullscreen, queueRect !== undefined, queueLeft, width);

		// Searching: a block left of the queue (or where the queue would be), down to the end of the big cover
		const popover = fullscreen ? null : document.querySelector<HTMLElement>(POPOVER);
		const searching = popover !== null && anchor !== undefined;
		const searchLeft = searching && queueRect ? queueLeft - width : queueLeft;
		const bottom = heroBottom || top + 58 + Math.min(width, window.innerHeight * 0.46);
		searchBlock.classList.toggle("is-open", searching);
		// One surface with the queue's top section, no line between them
		panel.classList.toggle("is-joined", searching && queueRect !== undefined);

		if (!fullscreen) fitSearch(searchLeft);
		// Exactly the search block, TIDAL's content fills it (and leaves room for the search bar itself)
		if (searching && popover) {
			// The first result lines up with the top of the queue's big cover
			const headerBottom = document.getElementById("mainHeader")?.getBoundingClientRect().bottom ?? top;
			const listTop = Math.max(0, (queueTop || headerBottom) - top);
			const list = stylePopover(popover, searchLeft, top, width, bottom - top, listTop);
			// Shorter when there are only a few results
			const blockBottom = list && list.height > 0 ? Math.min(bottom, list.bottom) : bottom;
			setBox(searchBlock, searchLeft, top, width, blockBottom - top, origin);
		} else unstylePopover();
	};

	let open = false;
	const setOpen = (value: boolean) => {
		if (value === open) return;
		open = value;
		panel.classList.toggle("is-open", value);
		if (value) render();
	};

	/** TIDAL marks its open queue with an `_isOpen_…` class */
	const isTidalQueueOpen = (aside: HTMLElement) => {
		const hasOpenClass = [...aside.classList].some((name) => name.startsWith("_isOpen"));
		// Fall back on the store if TIDAL ever drops the class
		return hasOpenClass || redux.store.getState().view?.showPlayQueueAside === true;
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
	/**
	 * Where an element sits in the layout, ignoring transforms: TIDAL animates its queue when it opens/closes,
	 * and following that frame by frame made the blocks jump around
	 */
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

	/** Returns where the queue is, if it's open */
	const placeQueue = (): DOMRect | undefined => {
		const aside = tidalAside();
		const wrapper = aside?.parentElement;
		if (!aside || !wrapper || !isTidalQueueOpen(aside)) return void setOpen(false);
		if (panel.previousElementSibling !== wrapper || probe.previousElementSibling !== panel) wrapper.after(panel, probe);
		const rect = layoutRect(aside);
		if (rect.width < 40 || rect.height < 40) return void setOpen(false);
		const footer = document.getElementById("footerPlayer")?.getBoundingClientRect();
		const bottom = footer && footer.height > 0 ? footer.top : window.innerHeight;
		const origin = probe.getBoundingClientRect();
		const width = document.documentElement.clientWidth - rect.left;
		const zIndex = [wrapper, aside].map((node) => getComputedStyle(node).zIndex).find((z) => z !== "auto") ?? "";
		// The top section runs from the title bar down to where TIDAL's queue starts
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

	// Follow TIDAL's own open/close animation for a moment
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
	watch(document.getElementById("footerPlayer"));
	watchAside(tidalAside());
	observe<HTMLElement>(unloads, "#playQueueSidebar", (aside) => {
		watchAside(aside);
		follow();
	});
	observe(unloads, "#footerPlayer", (footer) => watch(footer));
	window.addEventListener("resize", place);
	// Search results opening/closing, the full-screen view opening/closing
	observe(unloads, POPOVER, () => follow());
	// Only when the full-screen view's header appears, not on every lyrics change inside it
	observe(unloads, '[data-test="new-now-playing"] > header', () => follow());
	const onFocusChange = () => follow();
	document.addEventListener("focusin", onFocusChange);
	document.addEventListener("focusout", onFocusChange);
	// #endregion

	// #region Store
	let lastQueue: unknown;
	let lastItems: unknown;
	let lastView: unknown;
	const unsubscribe = redux.store.subscribe(() => {
		const state = redux.store.getState();
		// Queue, full-screen view or search opened/closed
		if (state.view !== lastView) {
			lastView = state.view;
			follow();
		}
		// In case TIDAL replaced its queue without us noticing
		if (!open && tidalAside() !== watchedAside) {
			watchAside(tidalAside());
			follow();
		}
		if (state.playQueue !== lastQueue || state.content.mediaItems !== lastItems) {
			const queueChanged = state.playQueue !== lastQueue;
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
		// Starts below the cover and moves up with it, but stays below the compact bar (and the top section)
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
	const contentObserver = new ResizeObserver(() => updateScrollbar());
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

	/**
	 * Songs are removed one by one like the remove button (replacing the whole queue makes TIDAL stop the song),
	 * a few at a time so TIDAL doesn't freeze on long queues. They disappear from the list right away.
	 */
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
	 * Removes upcoming songs only, history and the current song stay (TIDAL's own Clear drops the history too).
	 * With `endSource`, TIDAL's later top-ups from the same playlist/album are removed too, so the queue really ends.
	 */
	const removeAll = (filter: (element: Element_) => boolean, endSource = false) => {
		const { elements, currentIndex } = PlayState.playQueue;
		const cleared = elements.slice(currentIndex + 1).filter(filter);
		if (endSource && cleared.length > 0)
			refillGuard = { contexts: new Set(cleared.map(contextKey)), known: new Set(elements.map((element) => element.uid)) };
		removeUids(cleared.map((element) => element.uid));
	};

	/** TIDAL keeps topping up the queue from where it was playing from, even after it was cleared */
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
		// TIDAL sometimes puts a song from the playlist straight into play when the queue runs out
		const current = elements[currentIndex];
		if (current && isRefill(guard, current)) return endQueue();
		const refills = elements.slice(currentIndex + 1).filter((element) => isRefill(guard, element));
		// Anything else that shows up (songs you add, a radio) stays
		elements.forEach((element) => guard.known.add(element.uid));
		if (refills.length > 0) removeUids(refills.map((element) => element.uid));
	};
	/** Nothing left to play after a Clear: what TIDAL would play next is a song from the cleared playlist */
	const atEndOfClearedQueue = () => {
		const guard = refillGuard;
		if (guard === undefined || ending || !repeatOff()) return false;
		const { elements, currentIndex } = PlayState.playQueue;
		return elements.slice(currentIndex + 1).every((element) => removing.has(element.uid) || isRefill(guard, element));
	};

	/** The current song's track radio from TIDAL, if it has one */
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

	/** The radio's songs, loaded through TIDAL (playing a mix TIDAL hasn't loaded yet crashes its player) */
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

	/** Like TIDAL's autoplay: the current song's radio, or stop if there is none (or autoplay is off) */
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
			// The radio usually starts with the current song itself
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

	// Skipping or a song ending after a Clear: radio instead of TIDAL's pick from the cleared playlist
	redux.intercept(["playQueue/MOVE_NEXT", "playbackControls/SKIP_NEXT"], unloads, () => {
		if (!atEndOfClearedQueue()) return;
		endQueue();
		return true;
	});

	// Playing or queueing something yourself ends the guard
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
					// TIDAL's own close button, the store action doesn't close it in every TIDAL version
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
					return removeAll((element) => element.priority === "priority_keep");
				case "clear-next":
					return removeAll((element) => element.priority !== "priority_keep", true);
				case "play":
					return play(Number(button.dataset.index));
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
		if (row && !suppressClick) play(Number(row.dataset.index));
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
			play(Number(row.dataset.index));
		} else if ((e.key === "Delete" || e.key === "Backspace") && mode === "next") {
			const element = elementAt(Number(row.dataset.index));
			if (element) redux.actions["playQueue/REMOVE_ELEMENT"]({ uid: element.uid });
		} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault();
			const all = [...panel.querySelectorAll<HTMLElement>(".oq-section:not([hidden]) .oq-row")];
			all[all.indexOf(row) + (e.key === "ArrowDown" ? 1 : -1)]?.focus();
		} else if (e.key === "ContextMenu") {
			e.preventDefault();
			const rect = row.getBoundingClientRect();
			openMenu(row, rect.right - 40, rect.bottom);
		}
	});

	// Fades on the side(s) with more covers
	const updateStripFades = () => {
		const max = strip.scrollWidth - strip.clientWidth;
		strip.classList.toggle("fade-left", strip.scrollLeft > 1);
		strip.classList.toggle("fade-right", strip.scrollLeft < max - 1);
	};
	strip.addEventListener("scroll", updateStripFades, { passive: true });
	new ResizeObserver(updateStripFades).observe(strip);

	// Vertical scrolling over the recently played strip scrolls it sideways
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
		// TIDAL inserts before `toIndex`, counted before the song is taken out
		const to = Math.max(Number(target.dataset.index) + (after ? 1 : 0), currentIndex + 1);
		// Dropped right above or below itself: nothing moves
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
		blockProbe.remove();
		unfitSearch();
		unstylePopover();
		uncenterButtons();
		syncLyricsPlaceholder(undefined);
		for (const [node, position] of lifted) node.style.position = position;
		for (const [node, zIndex] of raised) node.style.zIndex = zIndex;
	};
	unloads.add(unload);
};

/** Sets up the redesigned queue and turns it on/off with its setting */
export const setupQueue = (unloads: LunaUnloads) => {
	let active: Set<LunaUnload> | undefined;
	const disable = () => {
		active?.forEach((unload) => unload());
		active = undefined;
	};
	const sync = () => {
		if (settings.queue === (active !== undefined)) return;
		if (!settings.queue) return disable();
		active = new Set();
		// Hide TIDAL's queue but keep the space it takes up
		new StyleTag("Office-queue", active, `${styles}\n#playQueueSidebar { visibility: hidden !important; }`);
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
