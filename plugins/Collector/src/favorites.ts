import type { LunaUnloads } from "@luna/core";
import { observe, redux } from "@luna/lib";

const BUTTON_ID = "collector-favorites-more";
const MENU_ID = "collector-favorites-menu";
const FAVORITES_PATH = /^\/my-collection\/tracks\/?$/;

const DOTS_SVG =
	'<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';

const isFavoritesPage = () => {
	const path = redux.store.getState().router?.currentPath ?? window.location.pathname;
	return FAVORITES_PATH.test(path);
};

/** Page title to attach the button to, if TIDAL rendered one */
const findHeading = () =>
	document.querySelector<HTMLElement>('[data-test="main"] h1') ??
	document.querySelector<HTMLElement>("main h1") ??
	document.querySelector<HTMLElement>('[data-test="main"] h2');

const closeMenu = () => document.getElementById(MENU_ID)?.remove();

export interface FavoritesAction {
	label: string;
	onClick: () => void;
}

const openMenu = (button: HTMLElement, actions: FavoritesAction[]) => {
	closeMenu();
	const menu = document.createElement("div");
	menu.id = MENU_ID;
	menu.className = "collector-menu";

	for (const { label, onClick } of actions) {
		const item = document.createElement("button");
		item.className = "collector-menu-item";
		item.textContent = label;
		item.addEventListener("click", () => {
			closeMenu();
			onClick();
		});
		menu.appendChild(item);
	}

	const rect = button.getBoundingClientRect();
	menu.style.top = `${rect.bottom + 6}px`;
	menu.style.left = `${rect.left}px`;
	document.body.appendChild(menu);

	const onOutside = (e: MouseEvent) => {
		if (menu.contains(e.target as Node) || button.contains(e.target as Node)) return;
		closeMenu();
	};
	const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeMenu();
	document.addEventListener("mousedown", onOutside, true);
	document.addEventListener("keydown", onKey, true);
	// Listeners go away together with the menu
	new MutationObserver((_, obs) => {
		if (menu.isConnected) return;
		document.removeEventListener("mousedown", onOutside, true);
		document.removeEventListener("keydown", onKey, true);
		obs.disconnect();
	}).observe(document.body, { childList: true });
};

const createButton = (actions: FavoritesAction[]) => {
	const button = document.createElement("button");
	button.id = BUTTON_ID;
	button.className = "collector-more";
	button.title = "More";
	button.innerHTML = DOTS_SVG;
	button.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (document.getElementById(MENU_ID)) closeMenu();
		else openMenu(button, actions);
	});
	return button;
};

/** Adds a "..." menu with the collect actions to the favorite tracks page */
export const setupFavoritesButton = (unloads: LunaUnloads, actions: FavoritesAction[]) => {
	let queued = false;

	const ensureButton = () => {
		queued = false;
		const existing = document.getElementById(BUTTON_ID);
		if (!isFavoritesPage()) {
			existing?.remove();
			closeMenu();
			return;
		}

		const heading = findHeading();
		if (existing?.isConnected && (heading === null || heading.contains(existing))) return;

		const button = existing ?? createButton(actions);
		if (heading !== null) {
			button.classList.remove("collector-more-floating");
			heading.appendChild(button);
		} else {
			// No title found, pin it to the top right instead
			button.classList.add("collector-more-floating");
			document.body.appendChild(button);
		}
	};

	// TIDAL re-renders a lot, so batch checks to once per frame
	const queueCheck = () => {
		if (queued) return;
		queued = true;
		requestAnimationFrame(ensureButton);
	};

	redux.intercept("router/NAVIGATED", unloads, () => {
		queueCheck();
	});
	observe(unloads, "h1", queueCheck);
	queueCheck();

	unloads.add(() => {
		document.getElementById(BUTTON_ID)?.remove();
		closeMenu();
	});
};
