import { MediaItem, observe, StyleTag } from "@luna/lib";

import { addPlaylistPickerStyles, pickPlaylist } from "../../../shared/playlistPicker";
import { trace, unloads } from "./core";
import { RATE_MODE_CSS, startRatingMode } from "./rateMode";
import { FAVORITES_RATE_CSS, setupRateButton } from "./rateButton";
import { applyRating, assignRatingPlaylist, playlistsForRating, ratingListeners, ratingOf, refreshRatings, refreshRatingsIfStale, validateRatingPlaylists } from "./ratings";
import { createStarRow, STAR_ROW_CSS, type StarRow } from "./starRow";
import { getRatingPlaylist, stars } from "./store";

export { errSignal, trace, unloads } from "./core";
export { Settings } from "./Settings";

const COMITÉ = "comité-controls";
const POPOVER = "comité-popover";
/** Below this width of the track info, the five stars collapse into one button so title and artist stay readable */
const COMPACT_BELOW = 320;

new StyleTag(
	"Comité",
	unloads,
	`${STAR_ROW_CSS}
#${COMITÉ} { display: inline-flex; flex: none; align-items: center; }
.comite-compact { display: none; padding: 0 4px; border: none; background: none; color: inherit; font-size: 15px; white-space: nowrap; cursor: pointer; opacity: 0.7; }
.comite-compact[data-rated="true"] { opacity: 1; }
#${COMITÉ}.comite-compact-mode .comite-starrow { display: none; }
#${COMITÉ}.comite-compact-mode .comite-compact { display: inline-flex; }
#${POPOVER} { position: fixed; z-index: 100000; display: flex; padding: 8px 10px; border-radius: 8px; background: #1c1c1f; color: #fff; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5); --star-gap: 6px; }
`,
);
addPlaylistPickerStyles("Comité", unloads);
new StyleTag("Comité-rate-mode", unloads, RATE_MODE_CSS + FAVORITES_RATE_CSS);

let currentTrackId: string | undefined;
let currentRating = 0;
let busy = false;

/** Star rows on screen: the player bar and, while open, the compact popover */
const rows = new Set<StarRow>();

const render = () => {
	for (const row of rows) {
		if (!row.element.isConnected) {
			rows.delete(row);
			continue;
		}
		row.setValue(currentRating);
		row.setDisabled(busy || currentTrackId === undefined);
	}
	const compact = document.querySelector<HTMLButtonElement>(`#${COMITÉ} .comite-compact`);
	if (compact) {
		compact.textContent = currentRating > 0 ? `★ ${currentRating}` : "☆";
		compact.dataset.rated = String(currentRating > 0);
		compact.title = currentRating > 0 ? `Rated ${stars(currentRating)}` : "Rate this song";
	}
};

const closePopover = () => document.getElementById(POPOVER)?.remove();

/** The five stars, shown above the compact button */
const openPopover = (anchor: HTMLElement) => {
	closePopover();
	const popover = document.createElement("div");
	popover.id = POPOVER;
	const row = createStarRow((value) => {
		closePopover();
		rate(value);
	});
	rows.add(row);
	popover.appendChild(row.element);
	document.body.appendChild(popover);
	const rect = anchor.getBoundingClientRect();
	popover.style.left = `${Math.max(8, rect.left)}px`;
	popover.style.top = `${rect.top - popover.offsetHeight - 8}px`;
	render();

	const onOutside = (e: MouseEvent) => {
		if (popover.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
		closePopover();
		document.removeEventListener("mousedown", onOutside, true);
	};
	document.addEventListener("mousedown", onOutside, true);
};

const rate = async (rating: number) => {
	const trackId = currentTrackId;
	if (busy || trackId === undefined) return;
	const previous = ratingOf(trackId);
	// Clicking the current rating again removes it
	const next = previous === rating ? 0 : rating;

	busy = true;
	currentRating = next;
	render();
	try {
		// First use of this rating: ask for its playlist, cancelling keeps the old rating
		if (next !== 0 && getRatingPlaylist(next) === undefined) {
			const chosen = await pickPlaylist(unloads, {
				title: `Playlist for ${stars(next)}`,
				subtitle: `Songs you rate ${next}★ are added to this playlist. Playlists used for another rating aren't listed.`,
				loadPlaylists: playlistsForRating(next),
			});
			if (!chosen) return;
			await assignRatingPlaylist(next, chosen);
		}
		await applyRating(trackId, next);
	} catch (err) {
		trace.msg.err.withContext("Failed to save the rating")(err as Error);
	} finally {
		busy = false;
		currentRating = currentTrackId === undefined ? 0 : ratingOf(currentTrackId);
		render();
	}
};

let resizeObserver: ResizeObserver | undefined;

function loadComité(): void {
	if (document.getElementById(COMITÉ)) return;

	const trackInfo = document.querySelector('[data-test="track-info"]');
	if (!trackInfo) return;
	const trackContent = trackInfo.querySelector<HTMLElement>('div[class*="_trackContent_"]');
	if (!trackContent) return;

	const wrapper = document.createElement("div");
	wrapper.id = COMITÉ;

	const row = createStarRow(rate);
	rows.add(row);

	const compact = document.createElement("button");
	compact.className = "comite-compact";
	compact.addEventListener("click", () => (document.getElementById(POPOVER) ? closePopover() : openPopover(compact)));

	wrapper.append(row.element, compact);
	trackContent.appendChild(wrapper);

	// Collapse to the compact button when the player gets narrow
	resizeObserver?.disconnect();
	resizeObserver = new ResizeObserver(() => {
		wrapper.classList.toggle("comite-compact-mode", trackInfo.getBoundingClientRect().width < COMPACT_BELOW);
	});
	resizeObserver.observe(trackInfo);
	render();
}

const onTrack = (mediaItem?: MediaItem) => {
	currentTrackId = mediaItem === undefined ? undefined : String(mediaItem.id);
	currentRating = currentTrackId === undefined ? 0 : ratingOf(currentTrackId);
	closePopover();
	render();
	refreshRatingsIfStale();
};

ratingListeners.add(() => {
	if (busy) return;
	currentRating = currentTrackId === undefined ? 0 : ratingOf(currentTrackId);
	render();
});

setupRateButton(unloads, startRatingMode);
observe(unloads, "#footerPlayer", loadComité);
loadComité();
MediaItem.onMediaTransition(unloads, onTrack);
MediaItem.fromPlaybackContext()
	.then(onTrack)
	.catch(trace.err.withContext("Failed to read the current song"));
// Pick up renamed / deleted rating playlists first, then load their songs
validateRatingPlaylists().finally(refreshRatings);

unloads.add(() => {
	resizeObserver?.disconnect();
	closePopover();
	document.getElementById(COMITÉ)?.remove();
	ratingListeners.clear();
	rows.clear();
});
