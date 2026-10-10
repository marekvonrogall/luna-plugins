import type { LunaUnloads } from "@luna/core";
import { ContentBase } from "@luna/lib";

import type { PlaylistInfo } from "./api";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

/** Playlist picker modal, resolves undefined on cancel */
export const pickPlaylist = (
	unloads: LunaUnloads,
	loadPlaylists: () => Promise<PlaylistInfo[]>,
	subtitle: string,
): Promise<PlaylistInfo | undefined> =>
	new Promise((resolve) => {
		const overlay = el("div", "collector-overlay");
		const modal = el("div", "collector-modal");
		overlay.appendChild(modal);

		modal.appendChild(el("div", "collector-title", "Add full albums to playlist"));
		modal.appendChild(el("div", "collector-subtitle", subtitle));

		const search = el("input", "collector-search");
		search.type = "text";
		search.placeholder = "Search your playlists…";
		search.disabled = true;
		modal.appendChild(search);

		const list = el("div", "collector-list");
		list.appendChild(el("div", "collector-empty", "Loading playlists…"));
		modal.appendChild(list);

		const footer = el("div", "collector-footer");
		const cancelBtn = el("button", "collector-btn", "Cancel");
		footer.appendChild(cancelBtn);
		modal.appendChild(footer);

		let settled = false;
		const close = (result?: PlaylistInfo) => {
			if (settled) return;
			settled = true;
			document.removeEventListener("keydown", onKey, true);
			overlay.remove();
			unloads.delete(unload);
			resolve(result);
		};
		const unload = () => close(undefined);
		unloads.add(unload);

		let playlists: PlaylistInfo[] = [];
		let filtered: PlaylistInfo[] = [];

		const render = () => {
			const query = search.value.trim().toLowerCase();
			filtered = query === "" ? playlists : playlists.filter((p) => p.title.toLowerCase().includes(query));
			list.replaceChildren();
			if (filtered.length === 0) {
				list.appendChild(el("div", "collector-empty", playlists.length === 0 ? "You don't have any playlists yet." : "No matching playlists."));
				return;
			}
			for (const playlist of filtered) {
				const row = el("button", "collector-row");
				const coverUrl = ContentBase.formatCoverUrl(playlist.squareImage ?? playlist.image, { res: "160" });
				const cover = el("div", "collector-cover");
				if (coverUrl) cover.style.backgroundImage = `url("${coverUrl}")`;
				row.appendChild(cover);
				const text = el("div", "collector-row-text");
				text.appendChild(el("div", "collector-row-title", playlist.title));
				text.appendChild(el("div", "collector-row-meta", `${playlist.numberOfTracks} tracks`));
				row.appendChild(text);
				row.addEventListener("click", () => close(playlist));
				list.appendChild(row);
			}
		};

		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				close(undefined);
			} else if (e.key === "Enter" && document.activeElement === search && filtered.length > 0) {
				e.preventDefault();
				close(filtered[0]);
			}
		};

		search.addEventListener("input", render);
		cancelBtn.addEventListener("click", () => close(undefined));
		overlay.addEventListener("mousedown", (e) => {
			if (e.target === overlay) close(undefined);
		});
		document.addEventListener("keydown", onKey, true);
		document.body.appendChild(overlay);

		loadPlaylists()
			.then((result) => {
				playlists = result;
				search.disabled = false;
				search.focus();
				render();
			})
			.catch((err) => {
				list.replaceChildren(el("div", "collector-empty collector-error", `Failed to load playlists: ${err instanceof Error ? err.message : String(err)}`));
			});
	});

/** Floating progress box with a cancel button */
export class ProgressToast {
	private readonly root = el("div", "collector-toast");
	private readonly label = el("div", "collector-toast-label");
	private readonly detail = el("div", "collector-toast-detail");
	private readonly bar = el("div", "collector-toast-bar");
	private readonly fill = el("div", "collector-toast-fill");
	private readonly cancelBtn = el("button", "collector-btn collector-btn-small", "Cancel");

	public cancelled = false;

	constructor(private readonly unloads: LunaUnloads) {
		this.bar.appendChild(this.fill);
		const head = el("div", "collector-toast-head");
		head.append(this.label, this.cancelBtn);
		this.root.append(head, this.detail, this.bar);
		this.cancelBtn.addEventListener("click", () => {
			this.cancelled = true;
			this.cancelBtn.disabled = true;
			this.cancelBtn.textContent = "Cancelling…";
		});
		document.body.appendChild(this.root);
		unloads.add(this.remove);
	}

	public update(label: string, detail = "", progress?: number) {
		this.label.textContent = label;
		this.detail.textContent = detail;
		this.bar.style.display = progress === undefined ? "none" : "";
		if (progress !== undefined) this.fill.style.width = `${Math.max(0, Math.min(1, progress)) * 100}%`;
	}

	public readonly remove = () => {
		this.root.remove();
		this.unloads.delete(this.remove);
	};
}
