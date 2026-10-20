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

const BUTTON = "comite-rate-button";
const POPOVER = "comité-popover";
/** Outline star; filled through CSS once the song is rated */
const STAR = '<path d="M12 3.2l2.6 5.5 6 .7-4.4 4.1 1.2 6L12 16.6 6.6 19.5l1.2-6-4.4-4.1 6-.7z" stroke-width="1.6" stroke-linejoin="round"/>';

new StyleTag(
	"Comité",
	unloads,
	`${STAR_ROW_CSS}
#${BUTTON} { position: relative; }
#${BUTTON} svg path { fill: none; stroke: currentColor; }
#${BUTTON}[data-rated="true"] svg path { fill: #ffd432; stroke: #ffd432; }
#${BUTTON} .comite-rate-value { position: absolute; right: -2px; bottom: -1px; padding: 0 3px; border-radius: 4px; background: rgba(16, 16, 18, 0.92); color: #fff; font-size: 9px; font-weight: 700; line-height: 12px; font-variant-numeric: tabular-nums; pointer-events: none; }
#${BUTTON} .comite-rate-value:empty { display: none; }
#${POPOVER} { position: fixed; z-index: 100000; display: flex; padding: 8px 10px; border-radius: 8px; background: #1c1c1f; color: #fff; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5); --star-size: 22px; --star-gap: 6px; }
`,
);
addPlaylistPickerStyles("Comité", unloads);
new StyleTag("Comité-rate-mode", unloads, RATE_MODE_CSS + FAVORITES_RATE_CSS + RATING_COLUMN_CSS + COVER_BADGE_CSS);

let currentTrackId: string | undefined;

/** The popover's star row, while open */
let row: StarRow | undefined;

const button = document.createElement("button");
button.id = BUTTON;
button.type = "button";
button.setAttribute("aria-haspopup", "true");
button.setAttribute("aria-expanded", "false");
button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${STAR}</svg><span class="comite-rate-value"></span>`;
const value = button.querySelector<HTMLElement>(".comite-rate-value")!;

const render = () => {
	const rating = currentTrackId === undefined ? 0 : shownRating(currentTrackId);
	button.disabled = currentTrackId === undefined;
	button.dataset.rated = String(rating > 0);
	value.textContent = rating > 0 ? String(rating) : "";
	const label = rating > 0 ? `Rated ${stars(rating)} (${rating})` : "Rate this song";
	button.title = label;
	button.setAttribute("aria-label", label);
	if (row && !row.element.isConnected) row = undefined;
	row?.setValue(rating);
	row?.setDisabled(currentTrackId === undefined || isSaving(currentTrackId));
};

const rate = (rating: number) => {
	if (currentTrackId !== undefined) rateTrack(currentTrackId, rating);
};

let closeListeners: (() => void) | undefined;
const closePopover = () => {
	document.getElementById(POPOVER)?.remove();
	row = undefined;
	button.setAttribute("aria-expanded", "false");
	closeListeners?.();
	closeListeners = undefined;
};

/** The five stars, above the button */
const openPopover = () => {
	closePopover();
	const popover = document.createElement("div");
	popover.id = POPOVER;
	row = createStarRow((rating) => {
		closePopover();
		rate(rating);
	});
	popover.appendChild(row.element);
	document.body.appendChild(popover);
	const rect = button.getBoundingClientRect();
	const left = rect.left + rect.width / 2 - popover.offsetWidth / 2;
	popover.style.left = `${Math.max(8, Math.min(left, window.innerWidth - popover.offsetWidth - 8))}px`;
	popover.style.top = `${Math.max(8, rect.top - popover.offsetHeight - 8)}px`;
	button.setAttribute("aria-expanded", "true");
	render();

	const onOutside = (e: MouseEvent) => {
		if (!popover.contains(e.target as Node) && !button.contains(e.target as Node)) closePopover();
	};
	const onKey = (e: KeyboardEvent) => e.key === "Escape" && closePopover();
	document.addEventListener("mousedown", onOutside, true);
	document.addEventListener("keydown", onKey, true);
	window.addEventListener("resize", closePopover);
	closeListeners = () => {
		document.removeEventListener("mousedown", onOutside, true);
		document.removeEventListener("keydown", onKey, true);
		window.removeEventListener("resize", closePopover);
	};
};
button.addEventListener("click", () => (document.getElementById(POPOVER) ? closePopover() : openPopover()));

/** Right after the queue button among the player bar's buttons (TIDAL's, or Office's) */
const mountButton = () => {
	const queue = document.querySelector('#footerPlayer [data-test="play-queue-button"]');
	if (!queue?.parentElement || button.parentElement === queue.parentElement) return;
	// Sized like its neighbours' icons
	const icon = queue.querySelector("svg")?.getAttribute("class");
	if (icon) button.querySelector("svg")!.setAttribute("class", icon);
	queue.after(button);
};

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
observe(unloads, '#footerPlayer [data-test="play-queue-button"]', mountButton);
mountButton();
MediaItem.onMediaTransition(unloads, onTrack);
MediaItem.fromPlaybackContext()
	.then(onTrack)
	.catch(trace.err.withContext("Failed to read the current song"));
// Pick up renamed / deleted rating playlists first, then load their songs
validateRatingPlaylists().finally(refreshRatings);

unloads.add(() => {
	closePopover();
	button.remove();
	ratingListeners.clear();
});
