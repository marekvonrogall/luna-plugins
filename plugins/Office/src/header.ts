import type { LunaUnload, LunaUnloads } from "@luna/core";
import { observe, StyleTag } from "@luna/lib";

import { isCompact } from "./compact";
import { trace } from "./log";
import { settings, settingsListeners } from "./Settings";

/** As tall (and grey) as the sidebar's top section (--osb-head) and the queue's, so the three line up */
const HEAD = 60;
/** Set by us on the page when its top padding was raised */
const PADDED = "data-office-head-pad";

const styles = `
#mainHeader {
	box-sizing: border-box !important;
	height: ${HEAD}px !important;
	min-height: ${HEAD}px !important;
	background: #18181b !important;
}
`;

const findMain = () => document.querySelector<HTMLElement>('[data-test="main"]');

/**
 * If TIDAL lays its header over the page and pads the page for it, the padding grows with the header,
 * so nothing ends up under it. Pages meant to run under the header (no padding) stay as they are.
 */
const fitPage = () => {
	const main = findMain();
	const header = document.getElementById("mainHeader");
	if (!main || !header || main.hasAttribute(PADDED)) return;
	const pad = parseFloat(getComputedStyle(main).paddingTop) || 0;
	const page = main.getBoundingClientRect();
	const head = header.getBoundingClientRect();
	const overlap = head.bottom - (page.top + pad);
	if (pad <= 0 || head.top > page.top + 1 || overlap <= 0 || overlap > HEAD) return;
	main.style.setProperty("padding-top", `${pad + overlap}px`, "important");
	main.setAttribute(PADDED, "");
};

const unfitPage = () => {
	for (const main of document.querySelectorAll<HTMLElement>(`[${PADDED}]`)) {
		main.style.removeProperty("padding-top");
		main.removeAttribute(PADDED);
	}
};

const attach = (unloads: LunaUnloads) => {
	new StyleTag("Office-header", unloads, styles);
	let frame = 0;
	const queue = () => {
		frame ||= requestAnimationFrame(() => {
			frame = 0;
			fitPage();
		});
	};
	observe(unloads, '[data-test="main"]', queue);
	observe(unloads, "#mainHeader", queue);
	queue();
	unloads.add(() => {
		cancelAnimationFrame(frame);
		unfitPage();
	});
};

/** Header height; part of the sidebar redesign, which sets the 60px it matches */
export const setupHeader = (unloads: LunaUnloads) => {
	let active: Set<LunaUnload> | undefined;
	const disable = () => {
		active?.forEach((unload) => unload());
		active = undefined;
	};
	const sync = () => {
		const wanted = settings.sidebar && !isCompact();
		if (wanted === (active !== undefined)) return;
		if (!wanted) return disable();
		active = new Set();
		try {
			attach(active);
		} catch (err) {
			trace.msg.err.withContext("Couldn't set up the header")(err as Error);
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
