import { MediaItem, observe, StyleTag } from "@luna/lib";

import { addPlaylistPickerStyles } from "../../../shared/playlistPicker";
import { trace, unloads } from "./core";
import { RATE_MODE_CSS, startRatingMode } from "./rateMode";
import { FAVORITES_RATE_CSS, setupRateButton } from "./rateButton";
import { COVER_BADGE_CSS, setupCoverBadges } from "./coverBadges";
import { RATING_COLUMN_CSS, setupRatingColumn } from "./ratingColumn";
import { isSaving, rateTrack, ratingListeners, refreshRatings, refreshRatingsIfStale, shownRating, validateRatingPlaylists } from "./ratings";
import { createStarRow, STAR_ROW_CSS, type StarRow } from "./starRow";
import { stars } from "./store";

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
new StyleTag("Comité-rate-mode", unloads, RATE_MODE_CSS + FAVORITES_RATE_CSS + RATING_COLUMN_CSS + COVER_BADGE_CSS);

let currentTrackId: string | undefined;

/** Star rows on screen: the player bar and, while open, the compact popover */
const rows = new Set<StarRow>();

const render = () => {
	const currentRating = currentTrackId === undefined ? 0 : shownRating(currentTrackId);
	const disabled = currentTrackId === undefined || isSaving(currentTrackId);
	for (const row of rows) {
		if (!row.element.isConnected) {
			rows.delete(row);
			continue;
		}
		row.setValue(currentRating);
		row.setDisabled(disabled);
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

const rate = (rating: number) => {
	if (currentTrackId !== undefined) rateTrack(currentTrackId, rating);
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
	closePopover();
	render();
	refreshRatingsIfStale();
};

ratingListeners.add(render);

setupRateButton(unloads, startRatingMode);
setupRatingColumn(unloads);
setupCoverBadges(unloads);
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
