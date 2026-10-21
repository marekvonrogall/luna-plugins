import { TidalApi } from "@luna/lib";

// Removing via v1 leaves the v2 track count and duration (playlist page, sidebar) stale, so v2 is used

const OPENAPI = "https://openapi.tidal.com/v2";
/** Max items per DELETE */
const CHUNK = 20;

type ItemRef = { id: string; type: string; meta?: { itemId?: string } };

const headers = async (json = false): Promise<Record<string, string>> => {
	const { Authorization } = await TidalApi.getAuthHeaders();
	return { Authorization, Accept: "application/vnd.api+json", ...(json ? { "Content-Type": "application/vnd.api+json" } : {}) };
};

const countryCode = () => new URLSearchParams(TidalApi.queryArgs()).get("countryCode") ?? "US";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const send = async (url: string, init: RequestInit = {}): Promise<Response> => {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, { cache: "no-store", ...init });
		if (res.ok || attempt >= 3 || (res.status !== 429 && res.status < 500)) return res;
		const retryAfter = Number(res.headers.get("retry-after"));
		await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * (attempt + 1));
	}
};

/** All playlist entries with their item ids */
const getItemRefs = async (uuid: string): Promise<ItemRef[]> => {
	const refs: ItemRef[] = [];
	let url: string | undefined = `${OPENAPI}/playlists/${uuid}/relationships/items?countryCode=${countryCode()}`;
	while (url !== undefined) {
		const res = await send(url, { headers: await headers() });
		if (!res.ok) throw new Error(`Failed to load playlist items (${res.status} ${res.statusText})`);
		const page = (await res.json()) as { data?: ItemRef[]; links?: { next?: string } };
		refs.push(...(page.data ?? []));
		const next = page.links?.next;
		url = next ? (next.startsWith("http") ? next : `${OPENAPI}${next.startsWith("/") ? "" : "/"}${next}`) : undefined;
	}
	return refs;
};

/** Removes every copy of the tracks; undefined if v2 failed before removing anything */
export const removeFromPlaylistV2 = async (uuid: string, trackIds: Set<string>): Promise<{ removed: number; remaining: Set<string> } | undefined> => {
	let refs: ItemRef[];
	try {
		refs = await getItemRefs(uuid);
	} catch {
		return undefined;
	}
	const doomed = refs.filter((ref) => trackIds.has(String(ref.id)));
	if (doomed.some((ref) => !ref.meta?.itemId)) return undefined;
	const remaining = new Set(refs.filter((ref) => !trackIds.has(String(ref.id))).map((ref) => String(ref.id)));

	let removed = 0;
	for (let i = 0; i < doomed.length; i += CHUNK) {
		const chunk = doomed.slice(i, i + CHUNK);
		const res = await send(`${OPENAPI}/playlists/${uuid}/relationships/items`, {
			method: "DELETE",
			headers: await headers(true),
			body: JSON.stringify({ data: chunk.map(({ id, type, meta }) => ({ id: String(id), type, meta: { itemId: meta!.itemId } })) }),
		});
		if (!res.ok) {
			if (removed === 0) return undefined;
			throw new Error(`Failed to remove songs (${res.status} ${res.statusText})`);
		}
		removed += chunk.length;
	}
	return { removed, remaining };
};
