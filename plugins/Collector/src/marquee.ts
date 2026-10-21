// Text scrolling as in Office's player bar; lines need the `marqueeLine` styles

const MARQUEE_ATTR = "data-collector-marquee";
const MARQUEE_FADE = 10;

/** Clipped and faded at the end from the start, so long text never shows "…" */
export const marqueeLine = `
	overflow: hidden;
	white-space: nowrap;
	--collector-fade-left: 0px;
	--collector-fade-right: ${MARQUEE_FADE}px;
	text-overflow: clip !important;
	-webkit-mask-image: linear-gradient(90deg, transparent, #000 var(--collector-fade-left), #000 calc(100% - var(--collector-fade-right)), transparent);
	mask-image: linear-gradient(90deg, transparent, #000 var(--collector-fade-left), #000 calc(100% - var(--collector-fade-right)), transparent);
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

/** Scrolls overflowing `selector` lines under `roots` while visible; returns a stop function */
export const startMarquee = (roots: Element[], selector: string) => {
	const lines = new Map<HTMLElement, { distance: number; start: number }>();
	const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
	let frame = 0;
	let lastScan = -Infinity;

	/** `fits` also drops the end fade */
	const stop = (line: HTMLElement, fits: boolean) => {
		lines.delete(line);
		line.removeAttribute(MARQUEE_ATTR);
		line.style.setProperty("--collector-fade-left", "0px");
		if (fits) line.style.setProperty("--collector-fade-right", "0px");
		else line.style.removeProperty("--collector-fade-right");
		line.scrollLeft = 0;
	};
	// Rescanned regularly: submenus open, close and refill
	const scan = () => {
		for (const line of roots.flatMap((root) => [...root.querySelectorAll<HTMLElement>(selector)])) {
			// Hidden ones can't be measured
			if (line.offsetParent === null) continue;
			// Padding included, so the end comes fully into view
			const overflow = Math.max(line.scrollWidth - line.clientWidth, textWidth(line) - line.getBoundingClientRect().width - 0.25);
			const distance = Math.ceil(Math.max(0, overflow));
			const known = lines.get(line);
			if (distance <= 0 || still) {
				if (distance <= 0) line.style.setProperty("--collector-fade-right", "0px");
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
			line.style.setProperty("--collector-fade-left", `${Math.round(Math.min(MARQUEE_FADE, x))}px`);
			line.style.setProperty("--collector-fade-right", `${Math.round(Math.min(MARQUEE_FADE, distance - x))}px`);
		}
		frame = requestAnimationFrame(tick);
	};
	frame = requestAnimationFrame(tick);
	return () => {
		cancelAnimationFrame(frame);
		for (const line of [...lines.keys()]) stop(line, false);
	};
};

