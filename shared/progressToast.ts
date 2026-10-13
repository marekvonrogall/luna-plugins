import type { LunaUnloads } from "@luna/core";
import { StyleTag } from "@luna/lib";

/**
 * Progress box with label, detail line (or several lines, e.g. one per running download), bar and cancel button.
 * Shared by several plugins: all boxes live in one stack container, so they never overlap
 * and move up when one disappears.
 */

const STACK_ID = "luna-progress-stack";

const CSS = `
.luna-progress-toast {
	display: flex;
	flex-direction: column;
	gap: 6px;
	width: 320px;
	padding: 12px 14px;
	border-radius: 10px;
	background: #1c1c1f;
	color: #fff;
	box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
	pointer-events: auto;
}
.luna-progress-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}
.luna-progress-label {
	font-size: 13px;
	font-weight: 600;
}
.luna-progress-detail {
	overflow: hidden;
	font-size: 12px;
	white-space: nowrap;
	text-overflow: ellipsis;
	color: #a0a0a8;
}
.luna-progress-lines {
	display: flex;
	flex-direction: column;
	gap: 3px;
	white-space: normal;
}
.luna-progress-line {
	display: flex;
	gap: 8px;
}
.luna-progress-line-text {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}
.luna-progress-line-value {
	flex: none;
	font-variant-numeric: tabular-nums;
}
.luna-progress-bar {
	height: 4px;
	overflow: hidden;
	border-radius: 2px;
	background: #333;
}
.luna-progress-fill {
	width: 0%;
	height: 100%;
	background: #32f4ff;
	transition: width 0.15s ease-out;
}
.luna-progress-cancel {
	flex: none;
	padding: 4px 10px;
	border: none;
	border-radius: 8px;
	background: #2b2b30;
	color: #fff;
	font-size: 12px;
	cursor: pointer;
}
.luna-progress-cancel:hover:not(:disabled) {
	background: #3a3a40;
}
.luna-progress-cancel:disabled {
	opacity: 0.6;
	cursor: default;
}
`;

/** Each plugin adds the styles under its own id, so unloading one plugin doesn't unstyle the other's boxes */
export const addProgressToastStyles = (pluginName: string, unloads: LunaUnloads) => new StyleTag(`${pluginName}-progress-toast`, unloads, CSS);

/** The shared container, styled inline so it doesn't depend on any plugin's styles */
const getStack = () => {
	let stack = document.getElementById(STACK_ID);
	if (stack === null) {
		stack = document.createElement("div");
		stack.id = STACK_ID;
		Object.assign(stack.style, {
			position: "fixed",
			right: "24px",
			bottom: "110px",
			zIndex: "100000",
			display: "flex",
			flexDirection: "column-reverse",
			gap: "8px",
			pointerEvents: "none",
		});
		document.body.appendChild(stack);
	}
	return stack;
};

const el = (tag: string, className: string, text?: string) => {
	const node = document.createElement(tag);
	node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

/** One line of the detail area: text (cut with … if too long) and an optional value aligned to the right */
export type ProgressLine = { text: string; value?: string };

export class ProgressToast {
	private readonly root = el("div", "luna-progress-toast");
	private readonly label = el("div", "luna-progress-label");
	private readonly detail = el("div", "luna-progress-detail");
	private readonly bar = el("div", "luna-progress-bar");
	private readonly fill = el("div", "luna-progress-fill");
	private readonly cancelBtn = el("button", "luna-progress-cancel", "Cancel") as HTMLButtonElement;

	public cancelled = false;

	constructor(private readonly unloads: LunaUnloads) {
		this.bar.appendChild(this.fill);
		const head = el("div", "luna-progress-head");
		head.append(this.label, this.cancelBtn);
		this.root.append(head, this.detail, this.bar);
		this.cancelBtn.addEventListener("click", () => {
			this.cancelled = true;
			this.cancelBtn.disabled = true;
			this.cancelBtn.textContent = "Cancelling…";
		});
		getStack().appendChild(this.root);
		unloads.add(this.remove);
	}

	/** `detail` is one line of text, or several lines that each get their own row (the box grows with them) */
	public update(label: string, detail: string | ProgressLine[] = "", progress?: number) {
		this.label.textContent = label;
		if (typeof detail === "string") {
			this.detail.className = "luna-progress-detail";
			this.detail.textContent = detail;
		} else {
			this.detail.className = "luna-progress-detail luna-progress-lines";
			this.detail.replaceChildren(
				...detail.map(({ text, value }) => {
					const line = el("div", "luna-progress-line");
					line.append(el("span", "luna-progress-line-text", text));
					if (value !== undefined) line.append(el("span", "luna-progress-line-value", value));
					return line;
				}),
			);
		}
		this.bar.style.display = progress === undefined ? "none" : "";
		if (progress !== undefined) this.fill.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
	}

	public readonly remove = () => {
		const stack = this.root.parentElement;
		this.root.remove();
		if (stack?.id === STACK_ID && stack.childElementCount === 0) stack.remove();
		this.unloads.delete(this.remove);
	};
}
