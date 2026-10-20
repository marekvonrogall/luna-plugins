import type { LunaUnloads } from "@luna/core";
import { observe } from "@luna/lib";

import { settingsListeners } from "./Settings";

/** TIDAL switches to its mobile layout at this width */
const MOBILE = matchMedia("(max-width: 576px)");
const detect = () => document.querySelector(".is-compact-mode") !== null || MOBILE.matches;

/** TIDAL's own layouts, the mini player (compact mode) and the mobile one: Office leaves them exactly as TIDAL made them */
let compact = detect();
export const isCompact = () => compact;

/** Turns Office's parts off in those layouts and back on after (through their settings listeners) */
export const watchCompact = (unloads: LunaUnloads) => {
	const check = () => {
		const now = detect();
		if (now === compact) return;
		compact = now;
		settingsListeners.forEach((listener) => listener());
	};
	// TIDAL switches the mini player's class on its app container
	const classObserver = new MutationObserver(check);
	let watched: Element | undefined;
	const watch = (app: Element) => {
		if (app !== watched) {
			watched = app;
			classObserver.disconnect();
			classObserver.observe(app, { attributes: true, attributeFilter: ["class"] });
		}
		check();
	};
	const app = document.querySelector(".is-desktop-app");
	if (app) watch(app);
	observe(unloads, ".is-desktop-app", watch);
	MOBILE.addEventListener("change", check);
	unloads.add(() => {
		classObserver.disconnect();
		MOBILE.removeEventListener("change", check);
	});
};
