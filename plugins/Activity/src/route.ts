import type { LunaUnloads } from "@luna/core";
import { redux } from "@luna/lib";

import { navigate } from "./navigate";
import { setupSidebarLink } from "./sidebar";
import { createView, type View } from "./view";

/** Unknown to TIDAL: the view covers its "page not found" */
export const ROUTE = "/my-activity";

const currentPath = () => (redux.store.getState().router?.currentPath ?? window.location.pathname).split(/[?#]/)[0].replace(/\/+$/, "") || "/";

export const setupRoute = (unloads: LunaUnloads) => {
	let view: View | undefined;
	let openedAt = 0;

	const open = () => {
		view ??= createView(() => (openedAt = 0));
		view.show();
		link.setActive(true);
	};
	const close = () => {
		view?.hide();
		link.setActive(false);
	};
	/** Hidden once the next page has replaced TIDAL's "page not found" for our path */
	const leave = (frames = 0) => {
		if (currentPath() === ROUTE) return open();
		if (frames < 30 && document.querySelector('[data-test="page-not-found"]')) return void requestAnimationFrame(() => leave(frames + 1));
		close();
	};

	const link = setupSidebarLink(unloads, ROUTE, () => {
		openedAt = Date.now();
		open();
		if (currentPath() !== ROUTE) navigate(ROUTE);
	});

	const sync = () => {
		if (currentPath() === ROUTE) return open();
		// TIDAL may redirect the unknown path once: stay open
		if (openedAt !== 0 && Date.now() - openedAt < 1500) {
			openedAt = 0;
			return;
		}
		leave();
	};

	// The path updates after the action
	redux.intercept("router/NAVIGATED", unloads, () => {
		requestAnimationFrame(sync);
	});

	// Links to the page TIDAL thinks is open don't navigate
	const onClick = (e: MouseEvent) => {
		if (!view?.visible) return;
		const anchor = (e.target as Element | null)?.closest?.("a[href]");
		if (anchor === null || anchor === undefined || anchor.hasAttribute("data-activity-link") || view.contains(anchor)) return;
		openedAt = 0;
		leave();
	};
	document.addEventListener("click", onClick, true);

	sync();

	unloads.add(() => {
		document.removeEventListener("click", onClick, true);
		view?.destroy();
	});
};
