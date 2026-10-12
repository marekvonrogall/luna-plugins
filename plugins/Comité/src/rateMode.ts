import { ContentBase, MediaItem, PlayState, redux } from "@luna/lib";

import { fetchPlaylistItems } from "../../../shared/playlistItems";
import { pickPlaylist } from "../../../shared/playlistPicker";
import { getAlbumItems, getArtistAlbumIds, getFavoriteTrackItems, getMixItems } from "./api";
import { trace, unloads } from "./core";
import { applyRating, assignRatingPlaylist, playlistsForRating, ratingOf, refreshRatings, sameSongRatings, songKey } from "./ratings";
import { fetchCoverBase64 } from "./cover.native";
import { createStarRow } from "./starRow";
import { getRatingPlaylist, settings, stars } from "./store";

export type RateSource = { type: "album" | "playlist" | "favorites" | "artist" | "mix"; id: string; title?: string };

type Song = { id: string; title: string; artist: string; artistIds: string[]; songKey: string; album: string; cover?: string; duration: number };

const OVERLAY = "comite-rate-mode";
/** Star / Shuffle colour when the cover has no usable colour: a soft pastel yellow */
const FALLBACK_ACCENT = "#f2dc8f";
/** Where each song starts (share of its length), set in the plugin settings */
const startAt = () => Math.min(Math.max(settings.rateStartAt ?? 30, 0), 90) / 100;

export const RATE_MODE_CSS = `
#${OVERLAY} { position: fixed; inset: 0; z-index: 99990; display: flex; flex-direction: column; overflow: hidden; background: #0b0b0d; color: #fff; user-select: none; }
.comite-rm-backdrop { position: absolute; inset: -60px; background: center / cover no-repeat; filter: blur(60px) saturate(1.3); opacity: 0.35; transition: background-image 0.4s; }
.comite-rm-top, .comite-rm-center, .comite-rm-bottom { position: relative; }
.comite-rm-top { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 28px; }
.comite-rm-heading { min-width: 0; font-size: 14px; color: #c8c8d0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.comite-rm-heading b { color: #fff; }
.comite-rm-actions { display: flex; align-items: center; gap: 10px; }
.comite-rm-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 999px; background: rgba(255, 255, 255, 0.06); color: #fff; font-size: 13px; cursor: pointer; }
.comite-rm-chip[aria-pressed="true"] { border-color: var(--comite-accent, ${FALLBACK_ACCENT}); color: var(--comite-accent, ${FALLBACK_ACCENT}); transition: color 0.3s, border-color 0.3s; }
.comite-rm-chip svg { width: 16px; height: 16px; fill: currentColor; }
/* Drawn on a 16-unit grid (close icon: 24), so it needs a smaller box to look the same size */
.comite-rm-chip svg.comite-rm-shuffle-icon { width: 11px; height: 11px; position: relative; top: 1px; }
.comite-rm-chip:hover { background: rgba(255, 255, 255, 0.12); }
.comite-rm-center { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 0 24px; min-height: 0; }
.comite-rm-cover { width: min(300px, 38vh); aspect-ratio: 1; border-radius: 12px; background: #222 center / cover no-repeat; box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6); }
.comite-rm-title { max-width: min(640px, 90vw); font-size: 24px; font-weight: 700; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.comite-rm-sub { max-width: min(640px, 90vw); margin-top: -8px; font-size: 14px; color: #b0b0b8; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.comite-rm-stars { margin-top: 10px; --star-size: 56px; --star-gap: 14px; --star-color: var(--comite-accent, ${FALLBACK_ACCENT}); --star-dim-color: rgba(255, 255, 255, 0.35); --star-dim-opacity: 1; }
.comite-rm-stars .comite-starbtn:hover { transform: scale(1.12); }
.comite-rm-stars.rated .comite-starbtn:not([data-fill="0"]) { animation: comite-pop 0.3s ease-out; }
@keyframes comite-pop { 50% { transform: scale(1.3); } }
.comite-rm-same { max-width: min(640px, 90vw); padding: 6px 14px; border-radius: 8px; background: rgba(255, 255, 255, 0.1); color: #dcdce2; font-weight: 600; font-size: 13px; text-align: center; }
.comite-rm-same[hidden] { display: none; }
.comite-rm-message { min-height: 18px; font-size: 13px; color: #b0b0b8; text-align: center; }
.comite-rm-bottom { display: flex; flex-direction: column; gap: 10px; padding: 0 28px 24px; }
.comite-rm-progress { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #b0b0b8; font-variant-numeric: tabular-nums; }
.comite-rm-bar { flex: 1; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, 0.15); cursor: pointer; }
.comite-rm-fill { width: 0%; height: 100%; border-radius: 2px; background: #fff; }
.comite-rm-controls { position: relative; display: flex; align-items: center; justify-content: space-between; }
.comite-rm-play { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; border: none; border-radius: 50%; background: #fff; color: #000; cursor: pointer; }
.comite-rm-play svg { width: 18px; height: 18px; fill: currentColor; }
.comite-rm-left { display: flex; align-items: center; gap: 14px; }
.comite-rm-volume { display: flex; align-items: center; gap: 8px; }
.comite-rm-mute { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: none; background: none; color: #fff; cursor: pointer; }
.comite-rm-mute svg { width: 24px; height: 24px; fill: currentColor; }
.comite-rm-slider { -webkit-appearance: none; appearance: none; width: 110px; height: 24px; margin: 0; background: transparent; cursor: pointer; outline: none; }
.comite-rm-slider::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: linear-gradient(to right, #fff var(--volume-percentage, 0%), rgba(255, 255, 255, 0.3) var(--volume-percentage, 0%)); }
.comite-rm-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 4px; height: 14px; margin-top: -5px; border-radius: 2px; background: #fff; }
.comite-rm-hint { position: absolute; top: 50%; transform: translateY(-50%); font-size: 12px; color: #7c7c86; white-space: nowrap; }
.comite-rm-skip { padding: 10px 18px; border: none; border-radius: 999px; background: rgba(255, 255, 255, 0.12); color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
.comite-rm-skip:hover, .comite-rm-play:hover { filter: brightness(0.9); }
`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
	const node = document.createElement(tag);
	node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

const toSong = (item: redux.MediaItem): Song | undefined => {
	if (item.type !== "track") return undefined;
	const track = item.item as redux.Track;
	// Unplayable songs would stall the mode
	if (track.allowStreaming === false || track.streamReady === false) return undefined;
	return {
		id: String(track.id),
		title: track.version ? `${track.title} (${track.version})` : track.title,
		artist: track.artists?.map((a) => a.name).join(", ") || track.artist?.name || "",
		artistIds: (track.artists ?? []).map((a) => String(a.id)),
		songKey: songKey(track.title ?? "", track.version),
		album: track.album?.title ?? "",
		cover: ContentBase.formatCoverUrl(track.album?.cover ?? undefined, { res: "640" }),
		duration: track.duration ?? 0,
	};
};

const shuffled = <T>(items: T[]) => {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[result[i], result[j]] = [result[j], result[i]];
	}
	return result;
};

/** RGB (0-255) to HSL (0-1) */
const toHsl = (r: number, g: number, b: number) => {
	r /= 255;
	g /= 255;
	b /= 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 2;
	if (max === min) return { h: 0, s: 0, l };
	const d = max - min;
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
	const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return { h: h / 6, s, l };
};

const coverColors = new Map<string, Promise<string | undefined>>();

/**
 * Most prominent colourful hue of a cover, brightened so stars stay visible on the dark overlay.
 * Undefined for grey covers or if the image couldn't be loaded (then the stars stay gold).
 */
const coverColor = (url: string) => {
	let promise = coverColors.get(url);
	if (promise !== undefined) return promise;
	promise = new Promise<string | undefined>((resolve) => {
		const img = new Image();
		img.onerror = () => resolve(undefined);
		img.onload = () => {
			try {
				const size = 24;
				const canvas = document.createElement("canvas");
				canvas.width = canvas.height = size;
				const context = canvas.getContext("2d");
				if (context === null) return resolve(undefined);
				context.drawImage(img, 0, 0, size, size);
				const data = context.getImageData(0, 0, size, size).data;
				// 12 hue buckets, weighted towards saturated mid-tones
				const buckets = Array.from({ length: 12 }, () => ({ r: 0, g: 0, b: 0, weight: 0 }));
				for (let i = 0; i < data.length; i += 4) {
					const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
					const { h, s, l } = toHsl(r, g, b);
					if (s < 0.2 || l < 0.12 || l > 0.92) continue;
					const weight = s * (1 - Math.abs(l - 0.5) * 2);
					const bucket = buckets[Math.min(11, Math.floor(h * 12))];
					bucket.r += r * weight;
					bucket.g += g * weight;
					bucket.b += b * weight;
					bucket.weight += weight;
				}
				const best = buckets.reduce((a, b) => (b.weight > a.weight ? b : a));
				// Too little colour (black & white covers): keep gold
				if (best.weight < size * size * 0.03) return resolve(undefined);
				const { h, s, l } = toHsl(best.r / best.weight, best.g / best.weight, best.b / best.weight);
				resolve(`hsl(${Math.round(h * 360)}, ${Math.round(Math.max(s, 0.5) * 100)}%, ${Math.round(Math.min(Math.max(l, 0.62), 0.75) * 100)}%)`);
			} catch {
				resolve(undefined);
			}
		};
		// Loaded as a data URL so the canvas may read its pixels
		fetchCoverBase64(url)
			.then((base64) => (base64 === undefined ? resolve(undefined) : (img.src = `data:image/jpeg;base64,${base64}`)))
			.catch(() => resolve(undefined));
	});
	coverColors.set(url, promise);
	return promise;
};

const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

let active = false;

/** Full-screen, quick-fire rating of all unrated songs of an album or playlist */
export const startRatingMode = async (source: RateSource) => {
	if (active) return;
	active = true;

	// #region UI
	const overlay = el("div", "");
	overlay.id = OVERLAY;
	const backdrop = el("div", "comite-rm-backdrop");

	const top = el("div", "comite-rm-top");
	const heading = el("div", "comite-rm-heading");
	heading.append("Rating ", el("b", "", source.title ?? source.type));
	const counter = el("span", "", "");
	heading.append(counter);
	const actions = el("div", "comite-rm-actions");
	const shuffleBtn = el("button", "comite-rm-chip");
	// TIDAL's own shuffle icon
	shuffleBtn.innerHTML = '<svg class="comite-rm-shuffle-icon" viewBox="0 0 16 16"><use href="#player__shuffle"></use></svg><span>Shuffle</span>';
	const exitBtn = el("button", "comite-rm-chip");
	// TIDAL's own close icon
	exitBtn.innerHTML = '<svg viewBox="0 0 24 24"><use href="#general__close"></use></svg><span>Exit</span>';
	actions.append(shuffleBtn, exitBtn);
	top.append(heading, actions);

	const center = el("div", "comite-rm-center");
	const cover = el("div", "comite-rm-cover");
	const title = el("div", "comite-rm-title", "Loading songs…");
	const sub = el("div", "comite-rm-sub", "");
	// Left half of a star = half rating
	const starRow = createStarRow((value) => rate(value), "★");
	const starsRow = starRow.element;
	starsRow.classList.add("comite-rm-stars");
	// Same song already rated on another release (single vs. album)
	const sameHint = el("div", "comite-rm-same", "");
	sameHint.hidden = true;
	const message = el("div", "comite-rm-message", "");
	center.append(cover, title, sub, starsRow, sameHint, message);

	const bottom = el("div", "comite-rm-bottom");
	const progress = el("div", "comite-rm-progress");
	const time = el("span", "", "0:00");
	const bar = el("div", "comite-rm-bar");
	const fill = el("div", "comite-rm-fill");
	bar.appendChild(fill);
	const total = el("span", "", "0:00");
	progress.append(time, bar, total);
	const controls = el("div", "comite-rm-controls");
	const playBtn = el("button", "comite-rm-play");
	// TIDAL's own play / pause icons
	const setPlayIcon = (playing: boolean) => {
		const icon = playing ? "pause" : "play";
		if (playBtn.dataset.icon === icon) return;
		playBtn.dataset.icon = icon;
		playBtn.innerHTML = `<svg class="_icon_77f3f89" data-test="icon--player__${icon}" viewBox="0 0 24 24"><use href="#player__${icon}"></use></svg>`;
		playBtn.ariaLabel = playing ? "Pause" : "Play";
	};
	setPlayIcon(true);
	const volume = el("div", "comite-rm-volume");
	const muteBtn = el("button", "comite-rm-mute");
	muteBtn.title = "Mute";
	muteBtn.innerHTML = '<svg viewBox="0 0 24 24"><use href="#player__volume"></use></svg>';
	const muteIcon = muteBtn.querySelector("use")!;
	// Styled like TIDAL's: white up to the knob (via --volume-percentage), gray after it
	const volumeSlider = el("input", "comite-rm-slider");
	volumeSlider.type = "range";
	volumeSlider.min = "0";
	volumeSlider.max = "100";
	volumeSlider.step = "1";
	volumeSlider.setAttribute("aria-label", "Volume");
	volume.append(muteBtn, volumeSlider);
	const left = el("div", "comite-rm-left");
	left.append(playBtn, volume);
	const hint = el("div", "comite-rm-hint", "1-5: Rate · Shift: +½ · S: Skip");
	const skipBtn = el("button", "comite-rm-skip", "Skip ⏭");
	controls.append(left, hint, skipBtn);
	bottom.append(progress, controls);

	overlay.append(backdrop, top, center, bottom);
	document.body.appendChild(overlay);

	/** Hint centred on the page, pushed right to keep 15px from the volume slider, hidden if it would get closer than 15px to Skip */
	const HINT_GAP = 15;
	const layoutHint = () => {
		hint.style.display = "";
		const bounds = controls.getBoundingClientRect();
		const width = hint.offsetWidth;
		let x = bounds.width / 2 - width / 2;
		x = Math.max(x, left.getBoundingClientRect().right - bounds.left + HINT_GAP);
		if (x + width > skipBtn.getBoundingClientRect().left - bounds.left - HINT_GAP) {
			hint.style.display = "none";
			return;
		}
		hint.style.left = `${x}px`;
	};
	const hintObserver = new ResizeObserver(layoutHint);
	hintObserver.observe(controls);

	// #endregion

	// #region State
	let original: Song[] = [];
	let order: Song[] = [];
	let index = -1;
	let rated = 0;
	let skipped = 0;
	let failed = 0;
	let picking = false;
	let advancing = false;
	/** Our song has actually started playing (so a change of song afterwards means it ended) */
	let started = false;
	let generation = 0;
	let saving: Promise<void> = Promise.resolve();
	const current = () => order[index] as Song | undefined;
	// #endregion

	const updateShuffle = () => {
		shuffleBtn.ariaPressed = String(settings.rateShuffle);
		shuffleBtn.title = settings.rateShuffle ? "Random order (click for album/playlist order)" : "Album/playlist order (click for random)";
	};

	/** Starts the song and jumps to the configured start point once it's actually playing */
	const playCurrent = async () => {
		const song = current();
		if (song === undefined) return;
		const myGeneration = ++generation;
		// TIDAL only queues songs it has loaded; long lists (e.g. favorites) load lazily, so load it first
		const mediaItem = await MediaItem.fromId(song.id).catch(() => undefined);
		if (myGeneration !== generation || !active) return;
		if (mediaItem === undefined) {
			message.textContent = "Can't play this song, skipping…";
			trace.warn(`Skipped “${song.title}” (track ${song.id}) in rating mode: couldn't load it`);
			skipped++;
			setTimeout(() => myGeneration === generation && active && next(), 600);
			return;
		}
		mediaItem.play();
		// Preload the next song so it starts without delay
		const upcoming = order[index + 1];
		if (upcoming) MediaItem.fromId(upcoming.id).catch(() => undefined);
		const startedAt = Date.now();
		const seekWhenReady = () => {
			if (myGeneration !== generation || !active) return;
			const playing = String(PlayState.playbackContext?.actualProductId) === song.id && PlayState.currentTime > 0;
			if (playing) {
				started = true;
				if (song.duration > 0 && startAt() > 0) PlayState.seek(Math.floor(song.duration * startAt()));
				return;
			}
			if (Date.now() - startedAt < 10_000) setTimeout(seekWhenReady, 150);
		};
		setTimeout(seekWhenReady, 150);
	};

	const show = () => {
		const song = current();
		if (song === undefined) return;
		counter.textContent = ` · ${index + 1} / ${order.length}`;
		backdrop.style.backgroundImage = song.cover ? `url("${song.cover}")` : "";
		cover.style.backgroundImage = song.cover ? `url("${song.cover}")` : "";
		// Stars and the Shuffle chip take the cover's main colour (gold until it's known, or if the cover has none)
		overlay.style.removeProperty("--comite-accent");
		if (song.cover) {
			const shownId = song.id;
			coverColor(song.cover.replace(/\d+x\d+(\.\w+)$/, "80x80$1")).then((color) => {
				if (color !== undefined && current()?.id === shownId) overlay.style.setProperty("--comite-accent", color);
			});
		}
		title.textContent = song.title;
		sub.textContent = [song.artist, song.album].filter(Boolean).join(" · ");
		const same = sameSongRatings(song.id, song.songKey, song.artistIds);
		sameHint.hidden = same.length === 0;
		sameHint.textContent = same
			.slice(0, 3)
			// Name the version when it differs, e.g. rating "Song 1 (Live)" while "Song 1" is rated
			.map(({ rating, albumTitle, title }) => {
				const version = title.toLowerCase() !== song.title.toLowerCase() ? ` as “${title}”` : "";
				return `Rated ${stars(rating)} (${rating})${version} on ${albumTitle ? `“${albumTitle}”` : "another release"}`;
			})
			.join(" · ");
		sameHint.title = "You already rated this song, or another version of it (live, remix, piano…), on another release";
		message.textContent = "";
		starsRow.classList.remove("rated");
		started = false;
		starRow.setValue(0);
		starRow.setInteractive(true);
		total.textContent = formatTime(song.duration);
		playCurrent();
	};

	const next = () => {
		advancing = false;
		index++;
		if (index >= order.length) return finish();
		show();
	};

	const finish = async (early = false) => {
		if (!active) return;
		active = false;
		generation++;
		cleanup();
		await saving;
		const parts = [`Rated ${rated} song${rated === 1 ? "" : "s"} in “${source.title ?? source.type}”.`];
		if (skipped > 0) parts.push(`Skipped ${skipped}.`);
		if (early && index < order.length - 1) parts.push(`${order.length - index - 1} left unrated.`);
		if (failed > 0) parts.push(`${failed} rating${failed === 1 ? "" : "s"} couldn't be saved (see console).`);
		if (!early && skipped === 0 && failed === 0) parts.push("All songs are rated now.");
		if (failed > 0) trace.msg.warn(parts.join(" "));
		else if (rated + skipped > 0 || early) trace.msg.log(parts.join(" "));
	};

	const rate = async (rating: number) => {
		const song = current();
		if (song === undefined || picking || advancing) return;
		// First use of this rating: ask for its playlist, cancelling keeps you on the song
		if (getRatingPlaylist(rating) === undefined) {
			picking = true;
			const chosen = await pickPlaylist(unloads, {
				title: `Playlist for ${stars(rating)}`,
				subtitle: `Songs you rate ${rating}★ are added to this playlist. Playlists used for another rating aren't listed.`,
				loadPlaylists: playlistsForRating(rating),
			});
			picking = false;
			if (!chosen || !active) return;
			await assignRatingPlaylist(rating, chosen).catch(trace.err.withContext(`Failed to load the ${stars(rating)} playlist`));
		}
		advancing = true;
		rated++;
		// Keep the chosen stars lit while the next song loads
		starRow.setInteractive(false);
		starRow.setValue(rating);
		starsRow.classList.add("rated");
		message.textContent = `Saved as ${stars(rating)}`;
		// Saved in order in the background, so the next song starts right away
		saving = saving
			.then(() => applyRating(song.id, rating))
			.catch((err) => {
				failed++;
				trace.err.withContext(`Failed to save the rating for “${song.title}” (track ${song.id})`)(err as Error);
			});
		setTimeout(next, 280);
	};

	const skip = () => {
		if (current() === undefined || picking || advancing) return;
		skipped++;
		next();
	};

	const togglePlay = () => (PlayState.playing ? PlayState.pause() : PlayState.play());

	const toggleShuffle = () => {
		settings.rateShuffle = !settings.rateShuffle;
		updateShuffle();
		// Reorders only the songs still to come
		const rest = order.slice(index + 1);
		const ordered = settings.rateShuffle ? shuffled(rest) : original.filter((song) => rest.includes(song));
		order = [...order.slice(0, index + 1), ...ordered];
		counter.textContent = current() ? ` · ${index + 1} / ${order.length}` : "";
	};

	const isTyping = (target: EventTarget | null) =>
		(target instanceof HTMLInputElement && target.type !== "range") || target instanceof HTMLTextAreaElement;
	// Space is left to TIDAL, which already toggles play/pause
	// By key position, so Shift+number works on every keyboard layout (Shift+3 is "*" on Swiss German)
	const digitOf = (e: KeyboardEvent) => {
		const match = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
		return match ? Number(match[1]) : undefined;
	};
	const ourKey = (e: KeyboardEvent) => digitOf(e) !== undefined || e.code === "KeyS" || e.key === "ArrowRight" || e.key === "Escape";

	const onKey = (e: KeyboardEvent) => {
		// The playlist picker handles its own keys
		if (picking || isTyping(e.target) || !ourKey(e)) return;
		// Window capture runs before TIDAL's own shortcuts, so they don't fire as well
		e.preventDefault();
		e.stopImmediatePropagation();
		if (e.type !== "keydown" || e.repeat) return;
		const digit = digitOf(e);
		if (digit !== undefined) {
			// Shift adds a half star (Shift+3 = 3.5)
			const value = digit + (e.shiftKey ? 0.5 : 0);
			if (value <= 5) rate(value);
		} else if (e.key === "Escape") finish(true);
		else skip();
	};

	// #region Volume: drive TIDAL's own slider and mute button, which control the actual audio
	const inPlayer = <E extends Element>(selector: string) =>
		[...document.querySelectorAll<E>(selector)].find((node) => !overlay.contains(node));
	const tidalSlider = () => inPlayer<HTMLInputElement>("input.horizontal-volume-slider");
	const tidalVolumeIcon = () => inPlayer<SVGElement>('[data-test^="icon--player__volume"]');
	const setNativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

	const setVolume = (value: number) => {
		const slider = tidalSlider();
		if (slider === undefined) return redux.actions["playbackControls/SET_VOLUME"]({ volume: value });
		// Set it like a user drag, so TIDAL's own handlers run
		setNativeValue.call(slider, String(value));
		slider.dispatchEvent(new Event("input", { bubbles: true }));
		slider.dispatchEvent(new Event("change", { bubbles: true }));
	};
	const toggleMute = () => {
		const button = tidalVolumeIcon()?.closest("button");
		if (button) button.click();
		else redux.actions["playbackControls/SET_MUTE"](!PlayState.playbackControls.muted);
	};
	/** Mirrors TIDAL's slider and icon */
	const syncVolume = () => {
		const slider = tidalSlider();
		const value = slider ? Number(slider.value) : PlayState.playbackControls.muted ? 0 : PlayState.playbackControls.volume;
		if (document.activeElement !== volumeSlider) volumeSlider.value = String(value);
		volumeSlider.style.setProperty("--volume-percentage", `${volumeSlider.value}%`);
		const icon = tidalVolumeIcon()?.getAttribute("data-test")?.replace("icon--", "");
		const fallback = value === 0 ? "player__volume-mute" : value < 50 ? "player__volume-mid" : "player__volume";
		muteIcon.setAttribute("href", `#${icon ?? fallback}`);
	};
	// #endregion

	const tick = setInterval(() => {
		const song = current();
		if (song === undefined) return;

		// Song ran to its end: TIDAL moved on to its own queue (or stopped). Count it as skipped and play our next one
		if (started && !advancing && !picking) {
			const movedOn = String(PlayState.playbackContext?.actualProductId) !== song.id;
			const finished = !PlayState.playing && song.duration > 0 && PlayState.currentTime >= song.duration - 1;
			if (movedOn || finished) {
				started = false;
				skipped++;
				next();
				return;
			}
		}

		const position = String(PlayState.playbackContext?.actualProductId) === song.id ? PlayState.currentTime : 0;
		time.textContent = formatTime(position);
		fill.style.width = `${song.duration > 0 ? Math.min(100, (position / song.duration) * 100) : 0}%`;
		setPlayIcon(PlayState.playing);
		syncVolume();
	}, 250);

	const cleanup = () => {
		clearInterval(tick);
		hintObserver.disconnect();
		window.removeEventListener("keydown", onKey, true);
		window.removeEventListener("keyup", onKey, true);
		overlay.remove();
		unloads.delete(unload);
	};
	const unload = () => {
		active = false;
		cleanup();
	};
	unloads.add(unload);

	skipBtn.addEventListener("click", skip);
	exitBtn.addEventListener("click", () => finish(true));
	shuffleBtn.addEventListener("click", toggleShuffle);
	playBtn.addEventListener("click", togglePlay);
	muteBtn.addEventListener("click", toggleMute);
	volumeSlider.addEventListener("input", () => {
		setVolume(Number(volumeSlider.value));
		volumeSlider.style.setProperty("--volume-percentage", `${volumeSlider.value}%`);
	});
	// Give focus back so the shortcuts work right after using the slider
	volumeSlider.addEventListener("change", () => volumeSlider.blur());
	// Clicked buttons must not keep focus, or Space would "click" them again on top of TIDAL's play/pause
	for (const button of overlay.querySelectorAll("button")) button.addEventListener("mousedown", (e) => e.preventDefault());
	bar.addEventListener("click", (e) => {
		const song = current();
		if (song === undefined || song.duration <= 0) return;
		const rect = bar.getBoundingClientRect();
		PlayState.seek(Math.floor(((e.clientX - rect.left) / rect.width) * song.duration));
	});
	window.addEventListener("keydown", onKey, true);
	window.addEventListener("keyup", onKey, true);
	updateShuffle();

	// #region Load songs
	try {
		/** All songs of an artist's releases, a few albums at a time, in release order */
		const loadArtist = async () => {
			const albumIds = await getArtistAlbumIds(source.id);
			const results: redux.MediaItem[][] = new Array(albumIds.length);
			let nextIndex = 0;
			let done = 0;
			const worker = async () => {
				while (nextIndex < albumIds.length && active) {
					const i = nextIndex++;
					results[i] = await getAlbumItems(albumIds[i]).catch((err) => {
						trace.warn.withContext(`Rating mode: couldn't load album ${albumIds[i]}`)(err as Error);
						return [];
					});
					title.textContent = `Loading songs… (${++done}/${albumIds.length} releases)`;
				}
			};
			await Promise.all(Array.from({ length: Math.min(4, albumIds.length) }, worker));
			return results.flat();
		};
		const loadItems = () => {
			if (source.type === "album") return getAlbumItems(source.id);
			if (source.type === "artist") return loadArtist();
			if (source.type === "favorites") return getFavoriteTrackItems();
			if (source.type === "mix") return getMixItems(source.id);
			return fetchPlaylistItems(source.id);
		};
		const [items] = await Promise.all([loadItems(), refreshRatings()]);
		if (!active) return;
		const seen = new Set<string>();
		original = items
			.map(toSong)
			.filter((song): song is Song => song !== undefined && !seen.has(song.id) && (seen.add(song.id), true))
			.filter((song) => ratingOf(song.id) === 0);
		if (original.length === 0) {
			active = false;
			cleanup();
			trace.msg.log(`All songs in “${source.title ?? source.type}” already have a rating.`);
			return;
		}
		order = settings.rateShuffle ? shuffled(original) : [...original];
		next();
	} catch (err) {
		active = false;
		cleanup();
		trace.msg.err.withContext("Couldn't start rating mode")(err as Error);
	}
	// #endregion
};
