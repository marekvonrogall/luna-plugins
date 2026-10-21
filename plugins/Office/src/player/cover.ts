import type { LunaUnload, LunaUnloads } from "@luna/core";
import { redux, StyleTag } from "@luna/lib";

import { isCompact } from "../compact";
import { settings, settingsListeners } from "../Settings";

/** TIDAL hides the cover while the full-screen view is open, and animates it back in afterwards: both are overruled */
const COVER = '#footerPlayer [data-test="player-details-toggle-now-playing"]';
const styles = `
${COVER} {
	transform: none !important;
	filter: none !important;
	opacity: 1 !important;
	visibility: visible !important;
	pointer-events: auto !important;
	transition: transform 0.2s ease;
}
/* TIDAL's hover, which it also sets inline */
${COVER}:hover {
	transform: scale(1.08) !important;
}
/* The song's text would slide into its place */
#footerPlayer [data-test="track-info"] > :has([data-test="footer-track-title"]) {
	transform: none !important;
}`;

/** TIDAL only toggles once its animation has finished; this goes by where the view is headed instead */
const onClick = (event: MouseEvent) => {
	if (!(event.target as Element | null)?.closest?.(COVER)) return;
	event.preventDefault();
	event.stopPropagation();
	if (redux.store.getState().view?.showNowPlaying) redux.actions["view/EXIT_NOWPLAYING"]();
	else redux.actions["view/ENTER_NOWPLAYING"]();
};

/** Keeps the cover in the player bar while the full-screen view is open; toggled by its setting */
export const setupPinnedCover = (unloads: LunaUnloads) => {
	let active: Set<LunaUnload> | undefined;
	const sync = () => {
		const wanted = settings.pinnedCover && !isCompact();
		if (wanted === (active !== undefined)) return;
		if (!wanted) {
			active?.forEach((unload) => unload());
			active = undefined;
			return;
		}
		active = new Set();
		new StyleTag("Office-cover", active, styles);
		document.addEventListener("click", onClick, true);
		active.add(() => document.removeEventListener("click", onClick, true));
	};
	settingsListeners.add(sync);
	sync();
	unloads.add(() => {
		settingsListeners.delete(sync);
		active?.forEach((unload) => unload());
		active = undefined;
	});
};
