// Scrolling like the player bar's, for lines Office doesn't own (search results); lines need `marqueeLine`

const MARQUEE_ATTR = "data-office-scrolling";
const MARQUEE_FADE = 10;

/** Clipped and faded instead of "…" */
export const marqueeLine = `
	overflow: hidden !important;
	white-space: nowrap !important;
	text-overflow: clip !important;
	--office-fade-left: 0px;
	--office-fade-right: ${MARQUEE_FADE}px;
	-webkit-mask-image: linear-gradient(90deg, transparent, #000 var(--office-fade-left), #000 calc(100% - var(--office-fade-right)), transparent);
	mask-image: linear-gradient(90deg, transparent, #000 var(--office-fade-left), #000 calc(100% - var(--office-fade-right)), transparent);
`;

/** px/s, shortest trip, pause at each end */
const MARQUEE_SPEED = 30;
const MARQUEE_MIN_TIME = 4000;
const MARQUEE_HOLD = 1500;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** Unrounded text width */
const textWidth = (node: Element) => {
	const range = document.createRange();
	range.selectNodeContents(node);
	return range.getBoundingClientRect().width;
};

/** Scrolls overflowing `selector` lines under `root` while visible; returns a stop function */
export const startMarquee = (root: Element, selector: string) => {
	const lines = new Map<HTMLElement, { distance: number; start: number }>();
	const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
	let frame = 0;
	let lastScan = -Infinity;

	/** `fits` also drops the end fade */
	const stop = (line: HTMLElement, fits: boolean) => {
		lines.delete(line);
		line.removeAttribute(MARQUEE_ATTR);
		line.style.setProperty("--office-fade-left", "0px");
		if (fits) line.style.setProperty("--office-fade-right", "0px");
		else line.style.removeProperty("--office-fade-right");
		line.scrollLeft = 0;
	};
	// Rescanned: results change while typing
	const scan = () => {
		for (const line of root.querySelectorAll<HTMLElement>(selector)) {
			// Hidden ones can't be measured
			if (line.offsetParent === null) continue;
			// Including padding, so the end comes fully into view
			const overflow = Math.max(line.scrollWidth - line.clientWidth, textWidth(line) - line.getBoundingClientRect().width - 0.25);
			const distance = Math.ceil(Math.max(0, overflow));
			const known = lines.get(line);
			if (distance <= 0 || still) {
				if (distance <= 0) line.style.setProperty("--office-fade-right", "0px");
				if (known || line.hasAttribute(MARQUEE_ATTR)) stop(line, distance <= 0);
				continue;
			}
			if (known?.distance === distance) continue;
			lines.set(line, { distance, start: performance.now() });
			line.setAttribute(MARQUEE_ATTR, "");
		}
		for (const line of [...lines.keys()]) if (!line.isConnected) lines.delete(line);
	};
	const tick = (now: number) => {
		if (now - lastScan > 300) {
			lastScan = now;
			scan();
		}
		for (const [line, { distance, start }] of lines) {
			const move = Math.max(MARQUEE_MIN_TIME, (distance / MARQUEE_SPEED) * 1000);
			const t = (now - start) % (2 * (MARQUEE_HOLD + move));
			let progress: number;
			if (t < MARQUEE_HOLD) progress = 0;
			else if (t < MARQUEE_HOLD + move) progress = ease((t - MARQUEE_HOLD) / move);
			else if (t < 2 * MARQUEE_HOLD + move) progress = 1;
			else progress = 1 - ease((t - 2 * MARQUEE_HOLD - move) / move);
			const x = progress * distance;
			line.scrollLeft = x;
			// Fade only where text is hidden
			line.style.setProperty("--office-fade-left", `${Math.round(Math.min(MARQUEE_FADE, x))}px`);
			line.style.setProperty("--office-fade-right", `${Math.round(Math.min(MARQUEE_FADE, distance - x))}px`);
		}
		frame = requestAnimationFrame(tick);
	};
	frame = requestAnimationFrame(tick);
	return () => {
		cancelAnimationFrame(frame);
		for (const line of [...lines.keys()]) stop(line, false);
	};
};
