import type { LunaUnloads } from "@luna/core";
import { redux } from "@luna/lib";

import { navigate } from "./navigate";
import { setupSidebarLink } from "./sidebar";
import { createView, type View } from "./view";

/** Not a TIDAL page: the view is drawn over whatever TIDAL shows for it */
export const ROUTE = "/my-activity";

const currentPath = () => (redux.store.getState().router?.currentPath ?? window.location.pathname).split(/[?#]/)[0].replace(/\/+$/, "") || "/";

export const setupRoute = (unloads: LunaUnloads) => {
	let view: View | undefined;
	let openedAt = 0;

	const open = () => {
		view ??= createView(() => {
			openedAt = 0;
			close();
		});
		view.show();
		link.setActive(true);
	};
	const close = () => {
		view?.hide();
		link.setActive(false);
	};

	const link = setupSidebarLink(unloads, ROUTE, () => {
		openedAt = Date.now();
		open();
		if (currentPath() !== ROUTE) navigate(ROUTE);
	});

	const sync = () => {
		if (currentPath() === ROUTE) return open();
		// Should TIDAL send unknown pages elsewhere right away, stay open until the next navigation
		if (openedAt !== 0 && Date.now() - openedAt < 1500) {
			openedAt = 0;
			return;
		}
		close();
	};

	// The path is updated after the action, so read it a frame later
	redux.intercept("router/NAVIGATED", unloads, () => {
		requestAnimationFrame(sync);
	});

	// Clicking a link to the page TIDAL thinks is open doesn't navigate: close for any link outside the view
	const onClick = (e: MouseEvent) => {
		if (!view?.visible) return;
		const anchor = (e.target as Element | null)?.closest?.("a[href]");
		if (anchor === null || anchor === undefined || anchor.hasAttribute("data-activity-link") || view.contains(anchor)) return;
		openedAt = 0;
		close();
	};
	document.addEventListener("click", onClick, true);

	sync();

	unloads.add(() => {
		document.removeEventListener("click", onClick, true);
		view?.destroy();
	});
};
