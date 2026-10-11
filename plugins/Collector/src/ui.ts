import type { LunaUnloads } from "@luna/core";
import { ContentBase } from "@luna/lib";

import type { ArtistInfo, PlaylistInfo } from "./api";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Overlay + dialog shell shared by all pickers; `close` resolves the promise once */
const openModal = <T>(unloads: LunaUnloads, resolve: (value: T | undefined) => void) => {
	const overlay = el("div", "collector-overlay");
	const modal = el("div", "collector-modal");
	overlay.appendChild(modal);

	let settled = false;
	const keyHandlers: ((e: KeyboardEvent) => void)[] = [];
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			e.stopPropagation();
			close(undefined);
		} else for (const handler of keyHandlers) handler(e);
	};
	const close = (value: T | undefined) => {
		if (settled) return;
		settled = true;
		document.removeEventListener("keydown", onKey, true);
		overlay.remove();
		unloads.delete(unload);
		resolve(value);
	};
	const unload = () => close(undefined);
	unloads.add(unload);

	overlay.addEventListener("mousedown", (e) => {
		if (e.target === overlay) close(undefined);
	});
	document.addEventListener("keydown", onKey, true);
	document.body.appendChild(overlay);

	return { modal, close, onKey: (handler: (e: KeyboardEvent) => void) => keyHandlers.push(handler) };
};

const searchInput = (placeholder: string) => {
	const search = el("input", "collector-search");
	search.type = "text";
	search.placeholder = placeholder;
	return search;
};

const matches = (text: string, query: string) => text.toLowerCase().includes(query.trim().toLowerCase());

const row = (tag: "button" | "label", title: string, meta: string | undefined, imageUrl: string | undefined, round = false) => {
	const node = el(tag, "collector-row");
	const cover = el("div", round ? "collector-cover collector-cover-round" : "collector-cover");
	if (imageUrl) cover.style.backgroundImage = `url("${imageUrl}")`;
	const text = el("div", "collector-row-text");
	text.appendChild(el("div", "collector-row-title", title));
	if (meta) text.appendChild(el("div", "collector-row-meta", meta));
	node.append(cover, text);
	return node;
};

const playlistCover = (p: PlaylistInfo) => ContentBase.formatCoverUrl(p.squareImage ?? p.image, { res: "160" });

interface CheckItem {
	id: string;
	title: string;
	meta?: string;
	imageUrl?: string;
}

/** Searchable list of checkboxes with select all / none for the visible entries */
const checklist = (items: CheckItem[], checked: Set<string>, placeholder: string, round: boolean, onChange: () => void) => {
	const wrapper = el("div", "collector-checklist");
	const search = searchInput(placeholder);
	const tools = el("div", "collector-tools");
	const all = el("button", "collector-link", "Select all");
	const none = el("button", "collector-link", "Select none");
	tools.append(all, none);
	const list = el("div", "collector-list");
	wrapper.append(search, tools, list);

	const visible = () => items.filter((item) => matches(item.title, search.value));
	const render = () => {
		list.replaceChildren();
		const shown = visible();
		if (shown.length === 0) list.appendChild(el("div", "collector-empty", items.length === 0 ? "Nothing here." : "No matches."));
		for (const item of shown) {
			const node = row("label", item.title, item.meta, item.imageUrl, round);
			const box = el("input", "collector-checkbox");
			box.type = "checkbox";
			box.checked = checked.has(item.id);
			box.addEventListener("change", () => {
				if (box.checked) checked.add(item.id);
				else checked.delete(item.id);
				onChange();
			});
			node.appendChild(box);
			list.appendChild(node);
		}
	};
	const setVisible = (value: boolean) => {
		for (const item of visible()) value ? checked.add(item.id) : checked.delete(item.id);
		render();
		onChange();
	};
	all.addEventListener("click", () => setVisible(true));
	none.addEventListener("click", () => setVisible(false));
	search.addEventListener("input", render);
	render();
	return { wrapper, search };
};

export interface TargetChoice {
	target: PlaylistInfo;
	exclusions: PlaylistInfo[];
	/** All of the user's playlists, for finding overflow playlists */
	playlists: PlaylistInfo[];
}

/** Exclusions picked last time, kept until TIDAL restarts */
const lastExclusions = new Set<string>();

/** Step 1: pick the target playlist, step 2: pick exclusion playlists. Resolves undefined on cancel */
export const pickTarget = (
	unloads: LunaUnloads,
	loadPlaylists: () => Promise<PlaylistInfo[]>,
	subtitle: string,
	hideUuid?: string,
): Promise<TargetChoice | undefined> =>
	new Promise((resolve) => {
		const { modal, close, onKey } = openModal<TargetChoice>(unloads, resolve);
		let playlists: PlaylistInfo[] = [];
		let choices: PlaylistInfo[] = [];
		let enterAction: (() => void) | undefined;
		onKey((e) => {
			if (e.key === "Enter" && enterAction) {
				e.preventDefault();
				enterAction();
			}
		});

		const header = (title: string, text: string) => {
			modal.replaceChildren(el("div", "collector-title", title), el("div", "collector-subtitle", text));
		};
		const footer = (...buttons: HTMLButtonElement[]) => {
			const node = el("div", "collector-footer");
			node.append(...buttons);
			modal.appendChild(node);
		};
		const cancelButton = () => {
			const button = el("button", "collector-btn", "Cancel");
			button.addEventListener("click", () => close(undefined));
			return button;
		};

		const showTargets = () => {
			header("Collect into playlist", `${subtitle} Songs already in the playlist are skipped.`);
			const search = searchInput("Search your playlists…");
			const list = el("div", "collector-list");
			modal.append(search, list);
			footer(cancelButton());

			let shown: PlaylistInfo[] = [];
			const render = () => {
				shown = choices.filter((p) => matches(p.title, search.value));
				list.replaceChildren();
				if (shown.length === 0) list.appendChild(el("div", "collector-empty", choices.length === 0 ? "You don't have any playlists yet." : "No matching playlists."));
				for (const playlist of shown) {
					const node = row("button", playlist.title, `${playlist.numberOfTracks} tracks`, playlistCover(playlist));
					node.addEventListener("click", () => showExclusions(playlist));
					list.appendChild(node);
				}
			};
			enterAction = () => document.activeElement === search && shown.length > 0 && showExclusions(shown[0]);
			search.addEventListener("input", render);
			render();
			search.focus();
		};

		const showExclusions = (target: PlaylistInfo) => {
			header(`Collect into “${target.title}”`, "Songs that are in any ticked playlist won't be collected.");
			const options = choices.filter((p) => p.uuid !== target.uuid);
			const checked = new Set([...lastExclusions].filter((id) => options.some((p) => p.uuid === id)));
			const counter = el("div", "collector-counter");
			const updateCounter = () => (counter.textContent = checked.size === 0 ? "No exclusion playlists" : `${checked.size} excluded`);
			const { wrapper, search } = checklist(
				options.map((p) => ({ id: p.uuid, title: p.title, meta: `${p.numberOfTracks} tracks`, imageUrl: playlistCover(p) })),
				checked,
				"Search playlists to exclude…",
				false,
				updateCounter,
			);
			updateCounter();
			modal.append(wrapper, counter);

			const back = el("button", "collector-btn", "Back");
			back.addEventListener("click", showTargets);
			const start = el("button", "collector-btn collector-btn-primary", "Start collecting");
			const finish = () => {
				lastExclusions.clear();
				for (const id of checked) lastExclusions.add(id);
				close({ target, exclusions: options.filter((p) => checked.has(p.uuid)), playlists });
			};
			start.addEventListener("click", finish);
			enterAction = finish;
			footer(back, start);
			search.focus();
		};

		header("Collect into playlist", "Loading playlists…");
		footer(cancelButton());
		loadPlaylists()
			.then((result) => {
				playlists = result;
				choices = result.filter((p) => p.uuid !== hideUuid);
				showTargets();
			})
			.catch((err) => header("Collect into playlist", `Failed to load playlists: ${errorText(err)}`));
	});

/** Checklist of followed artists, all ticked by default. Resolves the ticked ones, or undefined on cancel */
export const pickArtists = (unloads: LunaUnloads, loadArtists: () => Promise<ArtistInfo[]>): Promise<ArtistInfo[] | undefined> =>
	new Promise((resolve) => {
		const { modal, close, onKey } = openModal<ArtistInfo[]>(unloads, resolve);
		modal.append(el("div", "collector-title", "Collect followed artists"), el("div", "collector-subtitle", "Loading artists…"));

		const cancel = el("button", "collector-btn", "Cancel");
		cancel.addEventListener("click", () => close(undefined));

		loadArtists()
			.then((artists) => {
				const checked = new Set(artists.map((a) => a.id));
				const next = el("button", "collector-btn collector-btn-primary", "Continue");
				const counter = el("div", "collector-counter");
				const update = () => {
					counter.textContent = `${checked.size} of ${artists.length} artists selected`;
					next.disabled = checked.size === 0;
				};
				const { wrapper, search } = checklist(
					artists.map((a) => ({ id: a.id, title: a.name, imageUrl: ContentBase.formatCoverUrl(a.picture, { res: "160" }) })),
					checked,
					"Search your artists…",
					true,
					update,
				);
				update();

				const done = () => checked.size > 0 && close(artists.filter((a) => checked.has(a.id)));
				next.addEventListener("click", done);
				onKey((e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						done();
					}
				});

				const footer = el("div", "collector-footer");
				footer.append(cancel, next);
				modal.replaceChildren(
					el("div", "collector-title", "Collect followed artists"),
					el("div", "collector-subtitle", "Every album and single of the ticked artists will be added. Untick the ones you want to leave out."),
					wrapper,
					counter,
					footer,
				);
				search.focus();
			})
			.catch((err) => {
				const footer = el("div", "collector-footer");
				footer.append(cancel);
				modal.replaceChildren(el("div", "collector-title", "Collect followed artists"), el("div", "collector-subtitle", `Failed to load artists: ${errorText(err)}`), footer);
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
