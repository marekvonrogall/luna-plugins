import type { LunaUnloads } from "@luna/core";
import { ContentBase } from "@luna/lib";

import { button, checklist, emptyMessage, errorText, itemCount, list, matches, openModal, playlistCover, row, searchField } from "../../../shared/playlistPicker";
import type { ArtistInfo, PlaylistInfo } from "./api";

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
		const modal = openModal<TargetChoice>(unloads, resolve);
		const targetSubtitle = `${subtitle} Songs already in the playlist are skipped.`;
		let playlists: PlaylistInfo[] = [];
		let choices: PlaylistInfo[] = [];
		let enterAction: (() => void) | undefined;
		modal.onKey((e) => {
			if (e.key === "Enter" && enterAction) {
				e.preventDefault();
				enterAction();
			}
		});

		const showTargets = () => {
			modal.setHeader("Collect into playlist", targetSubtitle);
			modal.setFooter();
			const { field, input } = searchField();
			const rows = list();
			modal.body.replaceChildren(field, rows);

			let shown: PlaylistInfo[] = [];
			const render = () => {
				shown = choices.filter((p) => matches(p.title, input.value));
				rows.replaceChildren();
				if (shown.length === 0) rows.appendChild(emptyMessage(choices.length === 0 ? "You don't have any playlists yet." : "No matching playlists."));
				for (const playlist of shown) {
					const node = row({ title: playlist.title, detail: itemCount(playlist.numberOfTracks), imageUrl: playlistCover(playlist) });
					node.addEventListener("click", () => showExclusions(playlist));
					rows.appendChild(node);
				}
			};
			enterAction = () => document.activeElement === input && shown.length > 0 && showExclusions(shown[0]);
			input.addEventListener("input", render);
			render();
			input.focus();
		};

		const showExclusions = (target: PlaylistInfo) => {
			modal.setHeader(`Collect into “${target.title}”`, "Songs that are in any ticked playlist won't be collected.");
			const options = choices.filter((p) => p.uuid !== target.uuid);
			const checked = new Set([...lastExclusions].filter((id) => options.some((p) => p.uuid === id)));
			const { nodes, input, counter } = checklist(
				options.map((p) => ({ id: p.uuid, title: p.title, detail: itemCount(p.numberOfTracks), imageUrl: playlistCover(p) })),
				checked,
				false,
				() => updateCounter(),
			);
			const updateCounter = () => (counter.textContent = checked.size === 0 ? "No playlists excluded" : `${checked.size} excluded`);
			updateCounter();
			modal.body.replaceChildren(...nodes);

			const back = button("Back");
			back.addEventListener("click", showTargets);
			const start = button("Start collecting", true);
			const finish = () => {
				lastExclusions.clear();
				for (const id of checked) lastExclusions.add(id);
				modal.close({ target, exclusions: options.filter((p) => checked.has(p.uuid)), playlists });
			};
			start.addEventListener("click", finish);
			enterAction = finish;
			modal.setFooter(back, start);
			input.focus();
		};

		modal.setHeader("Collect into playlist", targetSubtitle);
		modal.body.appendChild(emptyMessage("Loading playlists…"));
		loadPlaylists()
			.then((result) => {
				playlists = result;
				choices = result.filter((p) => p.uuid !== hideUuid);
				showTargets();
			})
			.catch((err) => modal.body.replaceChildren(emptyMessage(`Failed to load playlists: ${errorText(err)}`)));
	});

/** Checklist of followed artists, all ticked by default. Resolves the ticked ones, or undefined on cancel */
export const pickArtists = (unloads: LunaUnloads, loadArtists: () => Promise<ArtistInfo[]>): Promise<ArtistInfo[] | undefined> =>
	new Promise((resolve) => {
		const modal = openModal<ArtistInfo[]>(unloads, resolve);
		modal.setHeader("Collect followed artists", "Every album and single of the ticked artists will be added. Untick the ones you want to leave out.");
		modal.body.appendChild(emptyMessage("Loading artists…"));

		loadArtists()
			.then((artists) => {
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
