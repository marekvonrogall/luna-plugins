import type { LunaUnloads } from "@luna/core";
import { observe } from "@luna/lib";

const LINK_ATTR = "data-activity-link";
/** TIDAL's own top entries (Home, Explore, …) */
const LINKS = "#sidebar-content > a[data-test]";
const LABEL = "My Activity";
const ICON =
	'<path d="M4 20h16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
	'<path d="M6.5 16.5v-5M10.5 16.5V5M14.5 16.5v-8M18.5 16.5v-3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>';

export interface SidebarLink {
	setActive(active: boolean): void;
}

/**
 * Adds "My Activity" below TIDAL's top sidebar entries, cloned from one of them so it looks native.
 * TIDAL marks the open page with extra (hashed) classes: they're learned by comparing the entries, never hardcoded.
 */
export const setupSidebarLink = (unloads: LunaUnloads, href: string, onOpen: () => void): SidebarLink => {
	let link: HTMLAnchorElement | undefined;
	let activeClasses: string[] = [];
	let active = false;

	/** The classes only the current entry has */
	const learnActiveClasses = (links: HTMLAnchorElement[]) => {
		if (links.length < 2) return;
		const sets = links.map((node) => new Set(node.classList));
		const shared = [...sets[0]].filter((name) => sets.every((set) => set.has(name)));
		const extras = sets.map((set) => [...set].filter((name) => !shared.includes(name))).filter((names) => names.length > 0);
		if (extras.length === 1) activeClasses = extras[0];
	};

	const apply = () => {
		if (link === undefined) return;
		for (const name of activeClasses) link.classList.toggle(name, active);
		if (active) link.setAttribute("aria-current", "page");
		else link.removeAttribute("aria-current");
	};

	const build = (source: HTMLAnchorElement) => {
		const node = source.cloneNode(true) as HTMLAnchorElement;
		for (const attr of [...node.attributes]) if (attr.name.startsWith("data-") || attr.name.startsWith("aria-")) node.removeAttribute(attr.name);
		for (const child of node.querySelectorAll("[data-test]")) child.removeAttribute("data-test");
		for (const name of activeClasses) node.classList.remove(name);
		node.setAttribute(LINK_ATTR, "");
		node.setAttribute("href", href);
		node.setAttribute("aria-label", LABEL);
		node.title = LABEL;

		const svg = node.querySelector(":scope > svg");
		if (svg !== null) {
			svg.setAttribute("viewBox", "0 0 24 24");
			svg.innerHTML = ICON;
		}
		// The innermost element holding the label, or a bare text node
		const label = [...node.querySelectorAll<HTMLElement>(":not(svg):not(svg *)")].reverse().find((el) => el.children.length === 0 && el.textContent?.trim());
		if (label !== undefined) label.textContent = LABEL;
		else {
			const text = [...node.childNodes].find((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
			if (text !== undefined) text.textContent = LABEL;
			else node.append(LABEL);
		}

		node.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			onOpen();
		});
		return node;
	};

	const ensure = () => {
		const links = [...document.querySelectorAll<HTMLAnchorElement>(LINKS)];
		if (links.length === 0) return;
		learnActiveClasses(links);
		const last = links[links.length - 1];
		if (link?.isConnected && link.previousElementSibling === last) return apply();
		link?.remove();
		const source = links.find((node) => !node.hasAttribute("aria-current") && !activeClasses.some((name) => node.classList.contains(name))) ?? last;
		link = build(source);
		last.after(link);
		apply();
	};

	let frame = 0;
	const queue = () => {
		frame ||= requestAnimationFrame(() => {
			frame = 0;
			ensure();
		});
	};
	observe(unloads, "#sidebar-content", queue);
	queue();

	unloads.add(() => {
		cancelAnimationFrame(frame);
		link?.remove();
		document.querySelectorAll(`[${LINK_ATTR}]`).forEach((node) => node.remove());
	});

	return {
		setActive(value) {
			active = value;
			queue();
		},
	};
};
