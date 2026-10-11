import type { LunaUnloads } from "@luna/core";
import { ContentBase, StyleTag } from "@luna/lib";

export interface PickablePlaylist {
	uuid: string;
	title: string;
	numberOfTracks: number;
	squareImage?: string;
	image?: string;
}

const CSS = `
.luna-picker-overlay { position: fixed; inset: 0; z-index: 100000; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.6); }
.luna-picker-modal { display: flex; flex-direction: column; gap: 12px; width: min(460px, calc(100vw - 32px)); max-height: min(640px, calc(100vh - 64px)); padding: 20px; border-radius: 12px; background: #1c1c1f; color: #fff; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5); }
.luna-picker-title { font-size: 18px; font-weight: 700; }
.luna-picker-subtitle { margin-top: -6px; font-size: 13px; color: #a0a0a8; }
.luna-picker-search { padding: 10px 12px; border: 1px solid #3a3a40; border-radius: 8px; background: #111113; color: #fff; font-size: 14px; outline: none; }
.luna-picker-search:focus { border-color: #32f4ff; }
.luna-picker-list { display: flex; flex-direction: column; gap: 2px; min-height: 120px; overflow-y: auto; }
.luna-picker-row { display: flex; align-items: center; gap: 12px; width: 100%; padding: 6px 8px; border: none; border-radius: 8px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.luna-picker-row:hover, .luna-picker-row:focus-visible { background: #2b2b30; outline: none; }
.luna-picker-row-current { box-shadow: inset 0 0 0 1px #32f4ff; }
.luna-picker-cover { flex: none; width: 40px; height: 40px; border-radius: 4px; background: #333 center / cover no-repeat; }
.luna-picker-row-text { min-width: 0; }
.luna-picker-row-title { overflow: hidden; font-size: 14px; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
.luna-picker-row-meta { font-size: 12px; color: #a0a0a8; }
.luna-picker-empty { padding: 24px 8px; font-size: 14px; text-align: center; color: #a0a0a8; }
.luna-picker-footer { display: flex; justify-content: flex-end; gap: 8px; }
.luna-picker-btn { padding: 8px 16px; border: none; border-radius: 8px; background: #2b2b30; color: #fff; font-size: 14px; cursor: pointer; }
.luna-picker-btn:hover { background: #3a3a40; }
`;

/** Each plugin adds the styles under its own id, so unloading one plugin doesn't unstyle the other */
export const addPlaylistPickerStyles = (pluginName: string, unloads: LunaUnloads) => new StyleTag(`${pluginName}-playlist-picker`, unloads, CSS);

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
	const node = document.createElement(tag);
	node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

export interface PickPlaylistOptions {
	title: string;
	subtitle?: string;
	loadPlaylists: () => Promise<PickablePlaylist[]>;
	/** Highlighted as the current choice */
	currentUuid?: string;
	/** Shows a "Remove" button that resolves null */
	allowClear?: boolean;
}

/** Searchable playlist picker. Resolves the playlist, null for "Remove", or undefined when cancelled */
export const pickPlaylist = (unloads: LunaUnloads, options: PickPlaylistOptions): Promise<PickablePlaylist | null | undefined> =>
	new Promise((resolve) => {
		const overlay = el("div", "luna-picker-overlay");
		const modal = el("div", "luna-picker-modal");
		overlay.appendChild(modal);
		modal.appendChild(el("div", "luna-picker-title", options.title));
		if (options.subtitle) modal.appendChild(el("div", "luna-picker-subtitle", options.subtitle));

		const search = el("input", "luna-picker-search");
		search.type = "text";
		search.placeholder = "Search your playlists…";
		const list = el("div", "luna-picker-list");
		list.appendChild(el("div", "luna-picker-empty", "Loading playlists…"));
		const footer = el("div", "luna-picker-footer");
		modal.append(search, list, footer);

		let settled = false;
		const close = (value: PickablePlaylist | null | undefined) => {
			if (settled) return;
			settled = true;
			document.removeEventListener("keydown", onKey, true);
			overlay.remove();
			unloads.delete(unload);
			resolve(value);
		};
		const unload = () => close(undefined);
		unloads.add(unload);

		if (options.allowClear) {
			const clear = el("button", "luna-picker-btn", "Remove");
			clear.addEventListener("click", () => close(null));
			footer.appendChild(clear);
		}
		const cancel = el("button", "luna-picker-btn", "Cancel");
		cancel.addEventListener("click", () => close(undefined));
		footer.appendChild(cancel);

		let playlists: PickablePlaylist[] = [];
		let shown: PickablePlaylist[] = [];
		const render = () => {
			const query = search.value.trim().toLowerCase();
			shown = query === "" ? playlists : playlists.filter((p) => p.title.toLowerCase().includes(query));
			list.replaceChildren();
			if (shown.length === 0) list.appendChild(el("div", "luna-picker-empty", playlists.length === 0 ? "You don't have any playlists yet." : "No matching playlists."));
			for (const playlist of shown) {
				const row = el("button", playlist.uuid === options.currentUuid ? "luna-picker-row luna-picker-row-current" : "luna-picker-row");
				const cover = el("div", "luna-picker-cover");
				const coverUrl = ContentBase.formatCoverUrl(playlist.squareImage ?? playlist.image, { res: "160" });
				if (coverUrl) cover.style.backgroundImage = `url("${coverUrl}")`;
				const text = el("div", "luna-picker-row-text");
				text.append(el("div", "luna-picker-row-title", playlist.title), el("div", "luna-picker-row-meta", `${playlist.numberOfTracks} tracks`));
				row.append(cover, text);
				row.addEventListener("click", () => close(playlist));
				list.appendChild(row);
			}
		};

		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				close(undefined);
			} else if (e.key === "Enter" && document.activeElement === search && shown.length > 0) {
				e.preventDefault();
				close(shown[0]);
			}
		};
		search.addEventListener("input", render);
		overlay.addEventListener("mousedown", (e) => {
			if (e.target === overlay) close(undefined);
		});
		document.addEventListener("keydown", onKey, true);
		document.body.appendChild(overlay);

		options
			.loadPlaylists()
			.then((result) => {
				playlists = result;
				render();
				search.focus();
			})
			.catch((err) => list.replaceChildren(el("div", "luna-picker-empty", `Failed to load playlists: ${err instanceof Error ? err.message : String(err)}`)));
	});
