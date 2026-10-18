import { Tracer, type LunaUnload } from "@luna/core";
import { StyleTag } from "@luna/lib";

import { getSongTranslation, showLine } from "./lyrics";
import { settingsListeners } from "./Settings";

export const { errSignal, trace } = Tracer("[Translator]");
export const unloads = new Set<LunaUnload>();
export { Settings } from "./Settings";

const LINE = '[data-test="lyrics-line"]';
const TRANSLATION = "luna-translator-line";

// Placed after the line (not inside it) and unblurred: TIDAL blurs everything but the current line
new StyleTag(
	"Translator",
	unloads,
	`
[data-test="lyrics-text"] > .${TRANSLATION} {
	display: block !important;
	font-size: 0.6em !important;
	font-weight: 500 !important;
	line-height: 1.3 !important;
	color: inherit !important;
	-webkit-text-fill-color: currentColor !important;
	filter: none !important;
	text-shadow: none !important;
	transform: none !important;
	opacity: 0.55 !important;
	cursor: pointer;
	transition: opacity 0.3s !important;
}
[data-test="lyrics-text"] > .${TRANSLATION}[data-current] {
	opacity: 0.9 !important;
}
`,
);

const comparable = (text: string) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const lineSpacing = (line: HTMLElement) => {
	const parent = line.parentElement;
	const parentStyle = parent ? getComputedStyle(parent) : undefined;
	const gap = parentStyle && /flex|grid/.test(parentStyle.display) ? parseFloat(parentStyle.rowGap) || 0 : 0;
	return { margin: Math.round(parseFloat(getComputedStyle(line).marginBottom) || 0), gap: Math.round(gap) };
};

const translationOf = new WeakMap<HTMLElement, HTMLElement>();

const removeTranslations = (root: ParentNode = document) => root.querySelectorAll(`.${TRANSLATION}`).forEach((node) => node.remove());

const setTranslation = (line: HTMLElement, text: string | undefined) => {
	let node = translationOf.get(line);
	if (text === undefined) {
		node?.remove();
		translationOf.delete(line);
		return;
	}
	if (node === undefined) {
		node = document.createElement("div");
		node.className = TRANSLATION;
		// Seek to the line
		node.addEventListener("click", () => line.click());
		translationOf.set(line, node);
	}
	if (line.nextElementSibling !== node) line.after(node);
	if (node.textContent !== text) node.textContent = text;
	// Directly under the line, keeping the spacing to the next one
	const { margin, gap } = lineSpacing(line);
	const marginTop = `${2 - margin - gap}px`;
	const marginBottom = `${margin}px`;
	if (node.style.marginTop !== marginTop) node.style.marginTop = marginTop;
	if (node.style.marginBottom !== marginBottom) node.style.marginBottom = marginBottom;
	const current = line.hasAttribute("data-current");
	if (node.hasAttribute("data-current") !== current) node.toggleAttribute("data-current", current);
};

let failedNotified = false;
const onError = (err: unknown) => {
	// Strip the "Error invoking remote method …" prefix
	const message = (err instanceof Error ? err.message : String(err)).replace(/^.*?Error: /, "");
	trace.warn.withContext("Couldn't translate the lyrics")(err as Error);
	if (!failedNotified) trace.msg.warn(`Couldn't translate the lyrics: ${message}. Trying again later.`);
	failedNotified = true;
};

// The current line changes by attribute, not by child nodes
let watchedContainer: HTMLElement | undefined;
const lineStates = new MutationObserver(() => queueUpdate());

const update = () => {
	const container = document.querySelector<HTMLElement>('[data-test="lyrics-text"]');
	if (container !== watchedContainer) {
		lineStates.disconnect();
		watchedContainer = container ?? undefined;
		if (container !== null) lineStates.observe(container, { attributes: true, subtree: true, attributeFilter: ["data-current"] });
	}
	if (container === null) return;

	const lineElements = [...container.querySelectorAll<HTMLElement>(LINE)];
	const texts = lineElements.map((line) => (line.textContent ?? "").trim());
	const unique = [...new Set(texts.filter((text) => text !== ""))];

	const shown = new Set<HTMLElement>();
	if (unique.length > 0) {
		const song = getSongTranslation(unique, queueUpdate, onError);
		lineElements.forEach((line, index) => {
			const translation = song.lines.get(texts[index]);
			// Skip lines in a skipped language and lines that came back unchanged
			const text =
				translation !== undefined && showLine(song, translation) && comparable(translation.text) !== comparable(texts[index]) ? translation.text : undefined;
			setTranslation(line, text);
			const node = translationOf.get(line);
			if (node !== undefined) shown.add(node);
		});
	}
	// Remove translations of lines that are gone
	container.querySelectorAll<HTMLElement>(`:scope > .${TRANSLATION}`).forEach((node) => shown.has(node) || node.remove());
};

let frame = 0;
const queueUpdate = () => {
	frame ||= requestAnimationFrame(() => {
		frame = 0;
		update();
	});
};

const observer = new MutationObserver(queueUpdate);
observer.observe(document.body, { childList: true, subtree: true });
settingsListeners.add(queueUpdate);
queueUpdate();

unloads.add(() => {
	observer.disconnect();
	lineStates.disconnect();
	cancelAnimationFrame(frame);
	settingsListeners.delete(queueUpdate);
	removeTranslations();
});
