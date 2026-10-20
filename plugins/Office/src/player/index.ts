import type { LunaUnload, LunaUnloads } from "@luna/core";
import { observe, StyleTag } from "@luna/lib";

import styles from "file://player.css?minify";

import { settings, settingsListeners } from "../Settings";

/** TIDAL's veil behind the bar (its first child) */
const VEIL = ':scope > [aria-hidden="true"]:first-child';
const VARS = [
	"--office-dock-bottom",
	"--office-dock-left",
	"--office-dock-right",
	"--office-dock-radius",
	"--office-dock-before",
	"--office-dock-after",
	"--office-dock-after-radius",
	"--office-dock-veil",
] as const;

/** Remembers the docked bar's look, which player.css keeps while TIDAL would make it float */
const measure = (footer: HTMLElement) => {
	if (footer.classList.contains("nowPlayingVisible")) return;
	const bar = getComputedStyle(footer);
	const before = getComputedStyle(footer, "::before");
	const after = getComputedStyle(footer, "::after");
	const veil = footer.querySelector(VEIL);
	const values: Record<(typeof VARS)[number], string | undefined> = {
		"--office-dock-bottom": bar.bottom,
		"--office-dock-left": bar.left,
		"--office-dock-right": bar.right,
		"--office-dock-radius": bar.borderRadius,
		"--office-dock-before": before.opacity,
		"--office-dock-after": after.opacity,
		"--office-dock-after-radius": after.borderRadius,
		"--office-dock-veil": veil ? getComputedStyle(veil).opacity : undefined,
	};
	for (const name of VARS) if (values[name]) footer.style.setProperty(name, values[name]!);
};

/** Keeps the player bar docked while the full-screen view is open, turned on/off with its setting */
export const setupPlayer = (unloads: LunaUnloads) => {
	let active: Set<LunaUnload> | undefined;
	const disable = () => {
		active?.forEach((unload) => unload());
		active = undefined;
	};
	const sync = () => {
		if (settings.dockedPlayer === (active !== undefined)) return;
		if (!settings.dockedPlayer) return disable();
		active = new Set();
		new StyleTag("Office-player", active, styles);
		let watched: HTMLElement | undefined;
		// Measured again whenever it's docked
		const classObserver = new MutationObserver(() => watched && measure(watched));
		const watch = (footer: HTMLElement) => {
			watched = footer;
			measure(footer);
			classObserver.disconnect();
			classObserver.observe(footer, { attributes: true, attributeFilter: ["class"] });
		};
		const footer = document.getElementById("footerPlayer");
		if (footer) watch(footer);
		observe<HTMLElement>(active, "#footerPlayer", watch);
		active.add(() => {
			classObserver.disconnect();
			for (const name of VARS) watched?.style.removeProperty(name);
		});
	};
	settingsListeners.add(sync);
	sync();
	unloads.add(() => {
		settingsListeners.delete(sync);
		disable();
	});
};
