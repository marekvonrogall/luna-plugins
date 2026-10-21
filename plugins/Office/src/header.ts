import type { LunaUnload, LunaUnloads } from "@luna/core";
import { observe, StyleTag } from "@luna/lib";

import { isCompact } from "./compact";
import { trace } from "./log";
import { settings, settingsListeners } from "./Settings";

/** Matches the sidebar's (--osb-head) and the queue's top sections */
const HEAD = 60;
/** On the page while we raised its top padding */
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

/** Where TIDAL pads the page for its header, the padding grows with it; unpadded pages stay as they are */
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

/** Part of the sidebar redesign, whose 60px it matches */
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
