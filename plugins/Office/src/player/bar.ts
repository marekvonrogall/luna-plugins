import type { LunaUnload, LunaUnloads } from "@luna/core";
import { observe, PlayState, redux, StyleTag } from "@luna/lib";

// Watch mode doesn't track bar.css: save this file to rebuild
import styles from "file://bar.css?minify";

import { trace } from "../log";
import { isCompact } from "../compact";
import { settings, settingsListeners } from "../Settings";

/** Volume change per wheel notch, and with Shift held */
const WHEEL_STEP = 10;
const FINE_STEP = 1;
/** The layout's column gap (bar.css) */
const RIGHT_GAP = 24;
/** A menu button's width plus gap */
const MENU_STEP = 36;
/** Scrolling text: px per second, shortest one-way trip in seconds */
const MARQUEE_SPEED = 30;
const MARQUEE_MIN_TIME = 4;

/** Given up to fit the window, in order: the audio quality, the toolbar's buttons (into ⋯), the volume slider (into a popup) */
const COMPACT = "data-office-compact";
const LEVELS = ["", "badge", "badge menu", "badge menu volume"];
/** On toolbar buttons that go into the menu */
const IN_MENU = "data-office-in-menu";
/** On the toolbar: "menu" or "volume" while that popup is open */
const OPEN = "data-office-open";

const SVG = (d: string) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
const MORE = "M6.5 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm7.5 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm7.5 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z";

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, Math.round(value)));
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
	const node = document.createElement(tag);
	node.className = className;
	return node;
};

const footer = () => document.getElementById("footerPlayer") ?? undefined;
const toolbar = () => document.querySelector<HTMLElement>('#footerPlayer [data-test="play-queue-button"]')?.parentElement ?? undefined;
const volumeButton = () => document.querySelector<HTMLElement>('#footerPlayer [data-test="volume"]') ?? undefined;
const isOurs = (node: Element) => [...node.classList].some((name) => name.startsWith("opb-"));

const MARQUEE = "data-office-marquee";
/** Title, artist and playing-from lines */
const textLines = () => [
	...document.querySelectorAll<HTMLElement>(
		'#footerPlayer :is([data-test="footer-track-title"] > a, [data-test="footer-artist-name"], [data-test="source-type-icon"] + span)',
	),
];
/** Unrounded width the text needs, whatever its box */
const textWidth = (node: Element) => {
	const range = document.createRange();
	range.selectNodeContents(node);
	return range.getBoundingClientRect().width;
};
/** Cut lines slide to their end and back by scroll position: unlike moving the text, it leaves the measured layout alone */
const HOLD = 1500;
/** Fade width on a side with hidden text */
const FADE = 10;
const scrolling = new Map<HTMLElement, { distance: number; start: number }>();
let marqueeFrame = 0;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const tickMarquee = (now: number) => {
	marqueeFrame = 0;
	for (const [line, { distance, start }] of scrolling) {
		if (!line.isConnected) {
			scrolling.delete(line);
			continue;
		}
		const move = Math.max(MARQUEE_MIN_TIME, distance / MARQUEE_SPEED) * 1000;
		const t = (now - start) % (2 * (HOLD + move));
		let progress: number;
		if (t < HOLD) progress = 0;
		else if (t < HOLD + move) progress = ease((t - HOLD) / move);
		else if (t < 2 * HOLD + move) progress = 1;
		else progress = 1 - ease((t - 2 * HOLD - move) / move);
		const x = progress * distance;
		line.scrollLeft = x;
		// Fades only where text is hidden
		const left = `${Math.round(Math.min(FADE, x))}px`;
		const right = `${Math.round(Math.min(FADE, distance - x))}px`;
		if (line.style.getPropertyValue("--opb-fade-left") !== left) line.style.setProperty("--opb-fade-left", left);
		if (line.style.getPropertyValue("--opb-fade-right") !== right) line.style.setProperty("--opb-fade-right", right);
	}
	if (scrolling.size > 0) marqueeFrame = requestAnimationFrame(tickMarquee);
};
const stopScrolling = (line: HTMLElement) => {
	scrolling.delete(line);
	line.removeAttribute(MARQUEE);
	line.style.removeProperty("--opb-fade-left");
	line.style.removeProperty("--opb-fade-right");
	line.scrollLeft = 0;
};
/** Scrolls cut lines, by exactly as much as they're cut */
const updateMarquee = () => {
	const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
	for (const line of textLines()) {
		// Cut by a fraction of a pixel already shows …
		const distance = still ? 0 : Math.ceil(Math.max(0, textWidth(line) - line.getBoundingClientRect().width - 0.25));
		if (distance <= 0) {
			if (line.hasAttribute(MARQUEE)) stopScrolling(line);
			continue;
		}
		const current = scrolling.get(line);
		// Unchanged: keeps its position
		if (current && current.distance === distance) continue;
		scrolling.set(line, { distance, start: performance.now() });
		line.setAttribute(MARQUEE, "");
	}
	if (scrolling.size > 0 && !marqueeFrame) marqueeFrame = requestAnimationFrame(tickMarquee);
};
const clearMarquee = () => {
	if (marqueeFrame) cancelAnimationFrame(marqueeFrame);
	marqueeFrame = 0;
	for (const line of [...scrolling.keys()]) stopScrolling(line);
	for (const line of document.querySelectorAll<HTMLElement>(`[${MARQUEE}]`)) stopScrolling(line);
};

const tucked = (feature: string) => footer()?.getAttribute(COMPACT)?.split(" ").includes(feature) ?? false;
/** Toolbar buttons that can go into the menu: TIDAL's and other plugins', not mute */
const menuItems = (bar: HTMLElement) =>
	[...bar.children].filter(
		(node): node is HTMLElement =>
			node instanceof HTMLElement &&
			!isOurs(node) &&
			!node.querySelector('[data-test="volume"]') &&
			!node.matches(".horizontal-volume-slider, .horizontal-volume-slider + input"),
	);

/** One for the bar, one for the popup: nothing moves while fitting */
const volumeSlider = () => {
	const slider = element("input", "opb-volume");
	slider.type = "range";
	slider.min = "0";
	slider.max = "100";
	slider.step = "1";
	slider.setAttribute("aria-label", "Volume");
	const value = element("span", "opb-volume-value");
	value.setAttribute("aria-hidden", "true");
	return { slider, value };
};

/** Volume sliders, menu button and popups in the player bar */
const controls = (unloads: LunaUnloads) => {
	const inBar = volumeSlider();
	const inPopup = volumeSlider();
	const sliders = [inBar, inPopup];

	const more = element("button", "opb-more");
	more.type = "button";
	more.title = "More";
	more.setAttribute("aria-label", "More");
	more.setAttribute("aria-haspopup", "true");
	more.setAttribute("aria-expanded", "false");
	more.innerHTML = SVG(MORE);
	const menu = element("div", "opb-menu");
	menu.setAttribute("aria-hidden", "true");

	const popup = element("div", "opb-popup");
	const mute = element("button", "opb-mute");
	mute.type = "button";
	mute.setAttribute("aria-label", "Mute");
	popup.append(mute, inPopup.slider, inPopup.value);
	/** Ours in the toolbar */
	const ours = [more, menu, popup, inBar.slider, inBar.value];

	// #region Volume
	let shownIcon: string | undefined;
	const show = (volume: number, muted: boolean) => {
		const shown = muted ? 0 : clamp(volume);
		for (const { slider, value } of sliders) {
			if (slider.value !== String(shown)) slider.value = String(shown);
			slider.style.setProperty("--opb-value", `${shown}%`);
			slider.classList.toggle("is-muted", muted);
			slider.title = muted ? "Muted" : `Volume ${shown}%`;
			if (value.textContent !== String(shown)) value.textContent = String(shown);
		}
		mute.title = muted ? "Unmute" : "Mute";
		mute.setAttribute("aria-pressed", String(muted));
		// Picked from the volume: TIDAL redraws its own icon a moment later
		const icon = shown === 0 ? "player__volume-mute" : shown < 50 ? "player__volume-mid" : "player__volume";
		if (icon !== shownIcon) {
			shownIcon = icon;
			// TIDAL colors its icons through a class
			mute.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><use href="#${icon}"></use></svg>`;
		}
	};
	const sync = () => {
		const { volume, muted } = PlayState.playbackControls;
		show(volume, muted);
	};
	const setVolume = (volume: number) => {
		const level = clamp(volume);
		if (PlayState.playbackControls.muted && level > 0) redux.actions["playbackControls/SET_MUTE"](false);
		redux.actions["playbackControls/SET_VOLUME"]({ volume: level });
		show(level, false);
	};
	const onWheel = (event: WheelEvent) => {
		event.preventDefault();
		// Once per notch: the popup listens too
		event.stopPropagation();
		// With Shift, Windows scrolls sideways
		const delta = event.deltaY || event.deltaX;
		if (delta === 0) return;
		const step = event.shiftKey ? FINE_STEP : WHEEL_STEP;
		const { volume, muted } = PlayState.playbackControls;
		setVolume((muted ? 0 : volume) + (delta < 0 ? step : -step));
	};
	for (const { slider, value } of sliders) {
		slider.addEventListener("input", () => setVolume(Number(slider.value)));
		for (const node of [slider, value]) node.addEventListener("wheel", onWheel, { passive: false });
	}
	popup.addEventListener("wheel", onWheel, { passive: false });
	mute.addEventListener("click", () => redux.actions["playbackControls/TOGGLE_MUTE"]());
	// The volume button scrolls too
	const onToolbarWheel = (event: WheelEvent) => {
		if ((event.target as Element | null)?.closest?.('[data-test="volume"]')) onWheel(event);
	};
	// #endregion

	// #region Popups
	let open: "menu" | "volume" | undefined;
	const place = () => {
		const bar = toolbar();
		const top = footer()?.getBoundingClientRect().top;
		if (!bar || top === undefined) return;
		const y = top - 8 - 44;
		if (open === "menu") {
			const count = Number(bar.style.getPropertyValue("--opb-count")) || 0;
			const width = count * MENU_STEP + 8;
			const x = clamp(more.getBoundingClientRect().left - 6, 8, window.innerWidth - width - 8);
			bar.style.setProperty("--opb-menu-x", `${x}px`);
			bar.style.setProperty("--opb-menu-y", `${y}px`);
		} else if (open === "volume") {
			const anchor = volumeButton()?.getBoundingClientRect();
			if (!anchor) return;
			const width = popup.offsetWidth;
			const x = clamp(anchor.left + anchor.width / 2 - width / 2, 8, window.innerWidth - width - 8);
			bar.style.setProperty("--opb-popup-x", `${x}px`);
			bar.style.setProperty("--opb-popup-y", `${y}px`);
		}
	};
	const setOpen = (next: typeof open) => {
		if (next === open) return;
		open = next;
		const bar = toolbar();
		if (next) bar?.setAttribute(OPEN, next);
		else bar?.removeAttribute(OPEN);
		more.setAttribute("aria-expanded", String(next === "menu"));
		place();
	};
	more.addEventListener("click", () => setOpen(open === "menu" ? undefined : "menu"));

	const onClick = (event: MouseEvent) => {
		const target = event.target as Element | null;
		if (!target?.closest) return;
		// With the slider tucked away, the volume button opens it instead of muting
		if (tucked("volume") && target.closest('#footerPlayer [data-test="volume"]')) {
			event.preventDefault();
			event.stopPropagation();
			setOpen(open === "volume" ? undefined : "volume");
			return;
		}
		// A menu button was used (one opening its own menu keeps ours open)
		const item = target.closest<HTMLElement>(`[${IN_MENU}]`);
		if (open === "menu" && item && !item.matches('[aria-haspopup="true"], :has([aria-haspopup="true"])')) setTimeout(() => setOpen(undefined));
	};
	const onPointerDown = (event: PointerEvent) => {
		if (!open) return;
		const target = event.target as Element | null;
		if (!target?.closest) return;
		if (target.closest(`.opb-menu, .opb-more, .opb-popup, [${IN_MENU}], #footerPlayer [data-test="volume"]`)) return;
		setOpen(undefined);
	};
	const onKey = (event: KeyboardEvent) => {
		if (event.key === "Escape" && open) setOpen(undefined);
	};
	document.addEventListener("click", onClick, true);
	document.addEventListener("pointerdown", onPointerDown, true);
	document.addEventListener("keydown", onKey);

	/** Disabled buttons in the bar and menu do nothing, however a plugin listens (on the window: first in line) */
	const DISABLED = '#footerPlayer :is(button:disabled, [aria-disabled="true"])';
	const blockDisabled = (event: Event) => {
		const target = event.target as Element | null;
		if (!target?.closest?.(DISABLED)) return;
		if (event instanceof KeyboardEvent && event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		event.stopImmediatePropagation();
	};
	const BLOCKED = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "keydown"] as const;
	for (const type of BLOCKED) window.addEventListener(type, blockDisabled, true);
	// #endregion

	// #region Fitting the window
	/** Marks the buttons that go into the menu, in order */
	const markMenu = (bar: HTMLElement) => {
		const items = menuItems(bar);
		items.forEach((node, index) => {
			if (!node.hasAttribute(IN_MENU)) node.setAttribute(IN_MENU, "");
			if (node.style.getPropertyValue("--opb-i") !== String(index)) node.style.setProperty("--opb-i", String(index));
		});
		if (bar.style.getPropertyValue("--opb-count") !== String(items.length)) bar.style.setProperty("--opb-count", String(items.length));
	};
	/** Only an attribute: trying levels never changes the DOM */
	const setLevel = (player: HTMLElement, level: number) => {
		if (level > 0) player.setAttribute(COMPACT, LEVELS[level]);
		else player.removeAttribute(COMPACT);
	};
	/** The least compact layout in which the right side fits */
	const fit = () => {
		const bar = toolbar();
		const player = footer();
		const song = player?.querySelector('[data-test="track-info"]');
		if (!bar || !player || !song) return;
		markMenu(bar);
		// Controls stay centered, so each side has its half: the song's side narrows its title instead
		const center = player.querySelector('[data-test="track-info"] ~ :has(> [data-test="play-controls"])');
		const right = bar.parentElement;
		const content = song.parentElement;
		const rightFits = () => {
			if (!center || !right || !content) return true;
			const box = content.getBoundingClientRect();
			const room = box.right - (parseFloat(getComputedStyle(content).paddingRight) || 0) - center.getBoundingClientRect().right - RIGHT_GAP;
			return right.getBoundingClientRect().width <= room + 1;
		};
		let level = 0;
		for (; level < LEVELS.length - 1; level++) {
			setLevel(player, level);
			if (rightFits()) break;
		}
		setLevel(player, level);
		updateMarquee();
		// Popups this layout doesn't have
		if ((open === "menu" && !tucked("menu")) || (open === "volume" && !tucked("volume"))) setOpen(undefined);
		else place();
	};
	let frame = 0;
	const scheduleFit = () => {
		if (!frame)
			frame = requestAnimationFrame(() => {
				frame = 0;
				fit();
			});
	};
	// Width changes only
	let lastWidth = 0;
	const resizeObserver = new ResizeObserver((entries) => {
		const width = entries[0]?.contentRect.width ?? 0;
		if (Math.abs(width - lastWidth) < 0.5) return;
		lastWidth = width;
		scheduleFit();
	});
	// Another song: its title may need to scroll
	const songObserver = new MutationObserver(scheduleFit);
	// Buttons TIDAL or other plugins add or remove (not our own)
	const toolbarObserver = new MutationObserver((records) => {
		const changed = records.some((record) => [...record.addedNodes, ...record.removedNodes].some((node) => !(node instanceof Element && isOurs(node))));
		if (changed) scheduleFit();
	});
	// #endregion

	// Among TIDAL's buttons, placed by bar.css
	let mounted: HTMLElement | undefined;
	const mount = () => {
		const bar = toolbar();
		const player = footer();
		if (!bar || !player) return;
		let changed = false;
		if (bar !== mounted) {
			mounted?.removeEventListener("wheel", onToolbarWheel);
			mounted = bar;
			toolbarObserver.disconnect();
			toolbarObserver.observe(bar, { childList: true });
			resizeObserver.disconnect();
			lastWidth = 0;
			resizeObserver.observe(player);
			songObserver.disconnect();
			const song = player.querySelector('[data-test="track-info"] :has(> [data-test="footer-track-title"])');
			if (song) songObserver.observe(song, { childList: true, characterData: true, subtree: true });
			bar.addEventListener("wheel", onToolbarWheel, { passive: false });
			changed = true;
		}
		const missing = ours.filter((node) => node.parentElement !== bar);
		if (missing.length > 0) {
			bar.append(...missing);
			changed = true;
		}
		if (changed) {
			sync();
			scheduleFit();
		}
	};
	mount();
	observe(unloads, '#footerPlayer [data-test="play-queue-button"]', mount);
	window.addEventListener("resize", place);

	let last: unknown;
	const unsubscribe = redux.store.subscribe(() => {
		const playback = redux.store.getState().playbackControls;
		if (!more.isConnected || !inBar.slider.isConnected) mount();
		if (playback === last) return;
		last = playback;
		sync();
	});

	unloads.add(() => {
		unsubscribe();
		if (frame) cancelAnimationFrame(frame);
		resizeObserver.disconnect();
		toolbarObserver.disconnect();
		songObserver.disconnect();
		clearMarquee();
		mounted?.removeEventListener("wheel", onToolbarWheel);
		document.removeEventListener("click", onClick, true);
		document.removeEventListener("pointerdown", onPointerDown, true);
		document.removeEventListener("keydown", onKey);
		for (const type of BLOCKED) window.removeEventListener(type, blockDisabled, true);
		window.removeEventListener("resize", place);
		for (const node of ours) node.remove();
		footer()?.removeAttribute(COMPACT);
		const bar = toolbar();
		if (!bar) return;
		bar.removeAttribute(OPEN);
		for (const name of ["--opb-count", "--opb-menu-x", "--opb-menu-y", "--opb-popup-x", "--opb-popup-y"]) bar.style.removeProperty(name);
		for (const node of bar.querySelectorAll<HTMLElement>(`[${IN_MENU}]`)) {
			node.removeAttribute(IN_MENU);
			node.style.removeProperty("--opb-i");
		}
	});
};

/** Clicking anywhere on the progress bar jumps there (TIDAL only reacts on its thin line) */
const clickToSeek = (unloads: LunaUnloads) => {
	const onClick = (event: MouseEvent) => {
		const bar = (event.target as Element | null)?.closest?.<HTMLElement>("#footerPlayer #progressBar");
		if (!bar || event.button !== 0) return;
		const duration = Number(bar.getAttribute("aria-valuemax"));
		const rect = bar.getBoundingClientRect();
		if (!(duration > 0) || rect.width <= 0) return;
		const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
		PlayState.seek(fraction * duration);
	};
	document.addEventListener("click", onClick, true);
	unloads.add(() => document.removeEventListener("click", onClick, true));
};

/** Sets up the player bar redesign; toggled by its setting */
export const setupBar = (unloads: LunaUnloads) => {
	let active: Set<LunaUnload> | undefined;
	const disable = () => {
		active?.forEach((unload) => unload());
		active = undefined;
	};
	const sync = () => {
		const wanted = settings.playerBar && !isCompact();
		if (wanted === (active !== undefined)) return;
		if (!wanted) return disable();
		active = new Set();
		new StyleTag("Office-bar", active, styles);
		try {
			controls(active);
			clickToSeek(active);
		} catch (err) {
			trace.msg.err.withContext("Couldn't set up the player bar")(err as Error);
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
