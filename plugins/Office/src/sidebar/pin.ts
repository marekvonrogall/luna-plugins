import type { LunaUnload, LunaUnloads } from "@luna/core";
import { observe, StyleTag } from "@luna/lib";

import { isCompact } from "../compact";
import { settings, settingsListeners } from "../Settings";

const PINNED = "data-office-pinned";
/** On a toggle we enabled */
const ENABLED = "data-office-enabled";
const TOGGLES = '[data-test="sidebar-collapse"], [data-test="sidebar-expand"]';
const EDGE = "--office-sidebar-edge";
const VIEW = '[data-test="new-now-playing"]';
const WRAPPER = '[data-test="main-layout-sidebar-wrapper"]';

/** The full-screen view covers the whole window: it starts right of the sidebar instead */
const styles = `[${PINNED}] { left: var(${EDGE}, 0px) !important; right: 0 !important; width: auto !important; }`;

type ButtonProps = { disabled?: boolean; onClick?: (event: MouseEvent) => void };
/** React's props on a DOM node (React decides from these, not the DOM, whether a click counts) */
const reactProps = (node: Element) => {
	const key = Object.keys(node).find((name) => name.startsWith("__reactProps$"));
	return key ? ((node as unknown as Record<string, ButtonProps | undefined>)[key] ?? undefined) : undefined;
};

const pin = (unloads: LunaUnloads) => {
	new StyleTag("Office-pinned-sidebar", unloads, styles);
	const root = document.documentElement;

	const measure = () => {
		const right = document.querySelector(WRAPPER)?.getBoundingClientRect().right ?? 0;
		root.style.setProperty(EDGE, `${Math.max(0, Math.round(right))}px`);
	};
	// Only the view laid over the window (TIDAL keeps another in its separate full-screen mode)
	const scan = () => {
		for (const view of document.querySelectorAll<HTMLElement>(VIEW)) {
			if (getComputedStyle(view).position === "fixed") view.setAttribute(PINNED, "");
			else view.removeAttribute(PINNED);
		}
	};

	// TIDAL disables collapsing and expanding while the full-screen view is open
	const enableToggles = () => {
		const viewOpen = document.getElementById("footerPlayer")?.classList.contains("nowPlayingVisible") ?? false;
		const collapsed = document.querySelector('[data-test="sidebar-expand"]') !== null;
		for (const button of document.querySelectorAll<HTMLButtonElement>(TOGGLES)) {
			// Collapse button while collapsed: hidden on purpose
			const wanted = viewOpen && !(collapsed && button.dataset.test === "sidebar-collapse");
			if (!wanted) {
				button.removeAttribute(ENABLED);
				continue;
			}
			// React keeps it disabled in its props even once the DOM says otherwise
			if (!reactProps(button)?.disabled) {
				button.removeAttribute(ENABLED);
				continue;
			}
			if (button.disabled) button.disabled = false;
			if (button.getAttribute("aria-disabled") !== "false") button.setAttribute("aria-disabled", "false");
			if (!button.hasAttribute(ENABLED)) button.setAttribute(ENABLED, "");
		}
	};
	const onClick = (event: MouseEvent) => {
		const button = (event.target as Element | null)?.closest?.(`[${ENABLED}]`);
		if (!button) return;
		const props = reactProps(button);
		if (!props?.disabled) return;
		event.stopPropagation();
		props.onClick?.(event);
	};
	document.addEventListener("click", onClick, true);
	const toggleObserver = new MutationObserver(enableToggles);
	const watchAside = (aside: Element) => {
		toggleObserver.disconnect();
		toggleObserver.observe(aside, { subtree: true, attributes: true, attributeFilter: ["disabled", "aria-disabled", "data-test"] });
		enableToggles();
	};

	const resizeObserver = new ResizeObserver(measure);
	const watchWrapper = (wrapper: Element) => {
		resizeObserver.observe(wrapper);
		measure();
	};
	const footerObserver = new MutationObserver(() => {
		scan();
		enableToggles();
	});
	const watchFooter = (footer: Element) => {
		footerObserver.disconnect();
		footerObserver.observe(footer, { attributes: true, attributeFilter: ["class"] });
	};

	const wrapper = document.querySelector(WRAPPER);
	if (wrapper) watchWrapper(wrapper);
	const footer = document.getElementById("footerPlayer");
	if (footer) watchFooter(footer);
	const aside = document.getElementById("sidebar");
	if (aside) watchAside(aside);
	scan();
	observe(unloads, WRAPPER, watchWrapper);
	observe(unloads, "#sidebar", watchAside);
	observe(unloads, "#footerPlayer", watchFooter);
	observe(unloads, VIEW, scan);
	window.addEventListener("resize", measure);

	unloads.add(() => {
		resizeObserver.disconnect();
		footerObserver.disconnect();
		toggleObserver.disconnect();
		document.removeEventListener("click", onClick, true);
		window.removeEventListener("resize", measure);
		for (const button of document.querySelectorAll<HTMLButtonElement>(`[${ENABLED}]`)) {
			button.removeAttribute(ENABLED);
			if (!reactProps(button)?.disabled) continue;
			button.disabled = true;
			button.setAttribute("aria-disabled", "true");
		}
		root.style.removeProperty(EDGE);
		for (const view of document.querySelectorAll(`[${PINNED}]`)) view.removeAttribute(PINNED);
	});
};

/** Keeps the sidebar visible and usable next to the full-screen view; toggled by its setting */
export const setupPinnedSidebar = (unloads: LunaUnloads) => {
	let active: Set<LunaUnload> | undefined;
	const disable = () => {
		active?.forEach((unload) => unload());
		active = undefined;
	};
	const sync = () => {
		const wanted = settings.pinnedSidebar && !isCompact();
		if (wanted === (active !== undefined)) return;
		if (!wanted) return disable();
		active = new Set();
		pin(active);
	};
	settingsListeners.add(sync);
	sync();
	unloads.add(() => {
		settingsListeners.delete(sync);
		disable();
	});
};
