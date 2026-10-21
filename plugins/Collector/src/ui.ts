import type { LunaUnloads } from "@luna/core";
import { ContentBase } from "@luna/lib";

import {
	button,
	checklist,
	el,
	emptyMessage,
	errorText,
	itemCount,
	list,
	matches,
	openModal,
	playlistCover,
	row,
	searchField,
	toggleMark,
} from "../../../shared/playlistPicker";
import type { ArtistInfo, PlaylistInfo } from "./api";
import { marqueeLine, startMarquee } from "./marquee";
import { scanPlaylists } from "./membership";

export interface TargetChoice {
	targets: PlaylistInfo[];
	exclusions: PlaylistInfo[];
	/** All user playlists, for overflow playlists */
	playlists: PlaylistInfo[];
}

/** Last exclusions, kept until restart */
const lastExclusions = new Set<string>();

const playlistItem = (p: PlaylistInfo) => ({ id: p.uuid, title: p.title, detail: itemCount(p.numberOfTracks), imageUrl: playlistCover(p) });

/** One or more targets, exclusions optional on a second page. Undefined on cancel */
export const pickCollectTargets = (
	unloads: LunaUnloads,
	loadPlaylists: () => Promise<PlaylistInfo[]>,
	subtitle: string,
	hideUuid?: string,
): Promise<TargetChoice | undefined> =>
	new Promise((resolve) => {
		const modal = openModal<TargetChoice>(unloads, resolve);
		let playlists: PlaylistInfo[] = [];
		let choices: PlaylistInfo[] = [];
		const targets = new Set<string>();
		const exclusions = new Set<string>();
		let exclusionsVisited = false;
		let onEnter: (() => void) | undefined;
		modal.onKey((e) => {
			if (e.key === "Enter" && onEnter) {
				e.preventDefault();
				onEnter();
			}
		});

		const start = () => {
			if (targets.size === 0) return;
			const excluded = choices.filter((p) => exclusions.has(p.uuid) && !targets.has(p.uuid));
			if (exclusionsVisited) {
				lastExclusions.clear();
				for (const p of excluded) lastExclusions.add(p.uuid);
			}
			modal.close({ targets: choices.filter((p) => targets.has(p.uuid)), exclusions: excluded, playlists });
		};

		const showTargets = () => {
			modal.setHeader("Collect into playlists", subtitle);
			const startButton = button("Start Collecting", true);
			const exclusionButton = button("Select Exclusion Playlists");
			const { nodes, input, counter } = checklist(choices.map(playlistItem), targets, false, () => update());
			const update = () => {
				counter.textContent = targets.size === 0 ? "No playlist selected" : `${targets.size} selected`;
				startButton.disabled = targets.size === 0;
				// Every playlist is a target: none left to exclude
				exclusionButton.disabled = choices.every((p) => targets.has(p.uuid));
				const excludedCount = [...exclusions].filter((id) => !targets.has(id)).length;
				exclusionButton.textContent = excludedCount > 0 ? `Exclusion Playlists (${excludedCount})` : "Select Exclusion Playlists";
			};
			update();
			startButton.addEventListener("click", start);
			exclusionButton.addEventListener("click", showExclusions);
			onEnter = start;
			modal.body.replaceChildren(...nodes);
			modal.setFooter(exclusionButton, startButton);
			input.focus();
		};

		const showExclusions = () => {
			if (!exclusionsVisited) {
				exclusionsVisited = true;
				for (const id of lastExclusions) if (choices.some((p) => p.uuid === id)) exclusions.add(id);
			}
			// A target can't exclude itself
			for (const id of targets) exclusions.delete(id);
			modal.setHeader("Exclusion playlists", "Songs that are in any ticked playlist won't be collected.");
			const options = choices.filter((p) => !targets.has(p.uuid));
			const { nodes, input, counter } = checklist(options.map(playlistItem), exclusions, false, () => update());
			const update = () => (counter.textContent = exclusions.size === 0 ? "No playlists excluded" : `${exclusions.size} excluded`);
			update();
			const back = button("Back");
			back.addEventListener("click", showTargets);
			const startButton = button("Start Collecting", true);
			// Targets are picked on the first page
			startButton.disabled = targets.size === 0;
			startButton.addEventListener("click", start);
			onEnter = start;
			modal.body.replaceChildren(...nodes);
			modal.setFooter(back, startButton);
			input.focus();
		};

		modal.setHeader("Collect into playlists", subtitle);
		modal.body.appendChild(emptyMessage("Loading playlists…"));
		loadPlaylists()
			.then((result) => {
				playlists = result;
				choices = result.filter((p) => p.uuid !== hideUuid);
				showTargets();
			})
			.catch((err) => modal.body.replaceChildren(emptyMessage(`Failed to load playlists: ${errorText(err)}`)));
	});

export interface PickArtistsOptions {
	title: string;
	subtitle: string;
	/** Skip the dialog for a single artist */
	skipSingle?: boolean;
}

/** Artist checklist, all ticked. Undefined on cancel */
export const pickArtists = (unloads: LunaUnloads, loadArtists: () => Promise<ArtistInfo[]>, options: PickArtistsOptions): Promise<ArtistInfo[] | undefined> =>
	new Promise((resolve) => {
		const modal = openModal<ArtistInfo[]>(unloads, resolve);
		modal.setHeader(options.title, options.subtitle);
		modal.body.appendChild(emptyMessage("Loading artists…"));

		loadArtists()
			.then((artists) => {
				if (artists.length === 0) {
					modal.body.replaceChildren(emptyMessage("No artists found."));
					return;
				}
				if (options.skipSingle && artists.length === 1) {
					modal.close(artists);
					return;
				}
				const checked = new Set(artists.map((a) => a.id));
				const next = button("Continue", true);
				const { nodes, input, counter } = checklist(
					artists.map((a) => ({ id: a.id, title: a.name, imageUrl: ContentBase.formatCoverUrl(a.picture, { res: "160" }) })),
					checked,
					true,
					() => update(),
				);
				const update = () => {
					counter.textContent = `${checked.size} of ${artists.length} selected`;
					next.disabled = checked.size === 0;
				};
				update();

				const done = () => checked.size > 0 && modal.close(artists.filter((a) => checked.has(a.id)));
				next.addEventListener("click", done);
				modal.onKey((e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						done();
					}
				});
				modal.body.replaceChildren(...nodes);
				modal.setFooter(next);
				input.focus();
			})
			.catch((err) => modal.body.replaceChildren(emptyMessage(`Failed to load artists: ${errorText(err)}`)));
	});

export interface PickPlaylistsOptions {
	title: string;
	subtitle?: string;
	/** "remove": only playlists with (some of) the songs */
	mode: "add" | "remove";
	trackIds: () => Promise<string[]>;
	hideUuid?: string;
}

export interface PlaylistChanges {
	add: PlaylistInfo[];
	remove: PlaylistInfo[];
}

/** Long detail lines scroll */
export const PICKER_CSS = `[data-collector-picker] .luna-dialog-row-detail { ${marqueeLine} }`;

/** "mixed": some of the songs */
type TickState = "true" | "false" | "mixed";

/** Tick = has the songs, dash = some. Tick adds, untick removes every copy, all on "Apply". Undefined on cancel */
export const pickPlaylists = (unloads: LunaUnloads, loadPlaylists: () => Promise<PlaylistInfo[]>, options: PickPlaylistsOptions): Promise<PlaylistChanges | undefined> =>
	new Promise((resolve) => {
		let closed = false;
		let stopMarquee = () => {};
		const modal = openModal<PlaylistChanges>(unloads, (value) => {
			closed = true;
			stopMarquee();
			resolve(value);
		});
		modal.setHeader(options.title, options.subtitle);
		modal.body.setAttribute("data-collector-picker", "");
		stopMarquee = startMarquee([modal.body], ".luna-dialog-row-detail");

		const { field, input } = searchField();
		const tools = el("div", "luna-dialog-tools");
		const status = el("div", "luna-dialog-counter");
		const reset = el("button", "luna-dialog-link", "Undo changes");
		tools.append(status, reset);
		const rows = list();
		rows.appendChild(emptyMessage("Loading playlists…"));
		modal.body.append(field, tools, rows);

		const apply = button("Apply", true);
		modal.setFooter(apply);

		let playlists: PlaylistInfo[] = [];
		let songCount = 0;
		/** Songs per playlist; undefined if unreadable */
		const counts = new Map<string, number | undefined>();
		/** Ticks changed by the user */
		const changed = new Map<string, TickState>();
		let scanned = 0;
		const nodes = new Map<string, HTMLButtonElement>();

		const initial = (uuid: string): TickState | undefined => {
			if (!counts.has(uuid)) return undefined;
			const count = counts.get(uuid);
			if (count === undefined) return undefined;
			return count === 0 ? "false" : count === songCount ? "true" : "mixed";
		};
		const current = (uuid: string) => changed.get(uuid) ?? initial(uuid);

		const listed = () =>
			playlists.filter((p) => {
				if (!matches(p.title, input.value)) return false;
				// Only playlists with something to remove
				if (options.mode === "remove") return (counts.get(p.uuid) ?? 0) > 0;
				return true;
			});

		const describe = (p: PlaylistInfo) => {
			const base = itemCount(p.numberOfTracks);
			if (!counts.has(p.uuid)) return `${base} · checking…`;
			const count = counts.get(p.uuid);
			if (count === undefined) return `${base} · couldn't be checked`;
			const parts = [base];
			if (songCount > 1 && count > 0) parts.push(count === songCount ? `has all ${songCount} songs` : `has ${count} of ${songCount} songs`);
			const state = changed.get(p.uuid);
			if (state === "true") parts.push(count === 0 ? "will be added" : "missing songs will be added");
			if (state === "false") parts.push(songCount === 1 ? "will be removed" : "songs will be removed");
			return parts.join(" · ");
		};

		const pending = () => {
			const add: PlaylistInfo[] = [];
			const remove: PlaylistInfo[] = [];
			for (const p of playlists) {
				const state = changed.get(p.uuid);
				if (state === "true") add.push(p);
				else if (state === "false") remove.push(p);
			}
			return { add, remove };
		};

		const updateStatus = () => {
			const { add, remove } = pending();
			status.textContent = scanned < playlists.length ? `Checking playlists… ${scanned}/${playlists.length}` : "";
			apply.disabled = add.length + remove.length === 0;
			reset.style.visibility = changed.size > 0 ? "visible" : "hidden";
		};

		const showRow = (p: PlaylistInfo) => {
			const node = nodes.get(p.uuid);
			if (!node) return;
			const state = current(p.uuid);
			node.setAttribute("aria-checked", state ?? "false");
			node.toggleAttribute("data-collector-pending", state === undefined);
			const detail = node.querySelector(".luna-dialog-row-detail");
			if (detail) detail.textContent = describe(p);
		};

		/** Mixed rows cycle some → all → none */
		const toggle = (p: PlaylistInfo) => {
			const start = initial(p.uuid);
			if (start === undefined) return;
			const now = current(p.uuid)!;
			const next: TickState = start === "mixed" ? (now === "mixed" ? "true" : now === "true" ? "false" : "mixed") : now === "true" ? "false" : "true";
			if (next === start) changed.delete(p.uuid);
			else changed.set(p.uuid, next);
			showRow(p);
			updateStatus();
		};

		const render = () => {
			rows.replaceChildren();
			nodes.clear();
			const shown = listed();
			if (shown.length === 0) {
				let text = "No matching playlists.";
				if (playlists.length === 0) text = "You don't have any playlists yet.";
				else if (options.mode === "remove" && input.value.trim() === "") {
					const what = songCount === 1 ? "this song" : "any of these songs";
					text = scanned < playlists.length ? `Looking for playlists with ${what}…` : `None of your playlists has ${what}.`;
				}
				rows.appendChild(emptyMessage(text));
			}
			for (const playlist of shown) {
				const node = row({ title: playlist.title, detail: " ", imageUrl: playlistCover(playlist), trailing: toggleMark() });
				node.setAttribute("role", "checkbox");
				node.addEventListener("click", () => toggle(playlist));
				nodes.set(playlist.uuid, node);
				showRow(playlist);
				rows.appendChild(node);
			}
			updateStatus();
		};

		reset.addEventListener("click", () => {
			changed.clear();
			render();
		});
		input.addEventListener("input", render);
		apply.addEventListener("click", () => {
			const changes = pending();
			if (changes.add.length + changes.remove.length > 0) modal.close(changes);
		});
		modal.onKey((e) => {
			if (e.key !== "Enter" || document.activeElement !== input) return;
			e.preventDefault();
			apply.click();
		});
		input.focus();

		Promise.all([loadPlaylists(), options.trackIds()])
			.then(([result, trackIds]) => {
				if (closed) return;
				playlists = result.filter((p) => p.uuid !== options.hideUuid);
				songCount = trackIds.length;
				render();
				scanPlaylists(
					playlists,
					trackIds,
					(playlist, count) => {
						counts.set(playlist.uuid, count);
						scanned++;
						// The list itself changes
						if (options.mode === "remove") {
							if ((count ?? 0) > 0 || scanned === playlists.length) render();
							else updateStatus();
						} else {
							showRow(playlist);
							updateStatus();
						}
					},
					() => closed,
				);
			})
			.catch((err) => rows.replaceChildren(emptyMessage(`Failed to load playlists: ${errorText(err)}`)));
	});
