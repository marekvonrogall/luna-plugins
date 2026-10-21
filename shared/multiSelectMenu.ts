import type { LunaUnloads } from "@luna/core";
import { MediaItems, observe, redux } from "@luna/lib";

// TIDAL handles the playlist multi-select menu itself, without a redux action, so Luna's onMediaItem never fires for it

export const MULTI_SELECT_MENU = '[data-test="playlist-item-multi-select-menu"]';
const LIST = `${MULTI_SELECT_MENU} > [data-type="list-container__context-menu"]`;

type SelectionLike = { items: { itemId: redux.ItemId; itemType?: string }[] };
const isSelection = (value: unknown): value is SelectionLike =>
	typeof value === "object" &&
	value !== null &&
	Array.isArray((value as { items?: unknown }).items) &&
	(value as SelectionLike).items.length > 0 &&
	(value as SelectionLike).items.every((item) => typeof item === "object" && item !== null && "itemId" in item && "itemType" in item);

/** From TIDAL's store (key varies by version), else the highlighted rows */
export const selectedTrackIds = (): string[] => {
	const state = redux.store.getState() as unknown as Record<string, unknown>;
	const selection = [state.selection, state.selections, ...Object.values(state)].find(isSelection);
	const fromStore = selection?.items.filter((item) => item.itemType === "track").map((item) => String(item.itemId)) ?? [];
	if (fromStore.length > 0) return [...new Set(fromStore)];
	// Class matched by name, without TIDAL's hash
	const rows = document.querySelectorAll<HTMLElement>('[data-test="tracklist-row"][data-track-id]');
	const selected = [...rows].filter((row) => [...row.classList].some((name) => name.startsWith("_tableRowSelected_")));
	return [...new Set(selected.map((row) => row.dataset.trackId!))];
};

export type MultiSelectMenuEvent = { mediaCollection: MediaItems; contextMenu: Element };

/** ContextMenu.onMediaItem for the multi-select menu; once per menu and selection */
export const onMultiSelectMenu = (unloads: LunaUnloads, callback: (event: MultiSelectMenuEvent) => unknown) => {
	const handled = new WeakMap<Element, string>();
	observe<HTMLElement>(unloads, LIST, (list) => {
		const ids = selectedTrackIds();
		if (ids.length === 0) return;
		const key = ids.join(",");
		if (handled.get(list) === key) return;
		handled.set(list, key);
		Promise.resolve(callback({ mediaCollection: MediaItems.fromIds(ids), contextMenu: list })).catch((err) => console.error("Multi-select menu", err));
	});
};
