import { artistPicture, getTimeline, getTopArtists, HttpError, isRunningMonth, type Note, type StreamedArtist, type Timeline, type TopArtists } from "./api";
import { navigate } from "./navigate";
import { trace } from "./trace";

const P = "luna-activity";

export interface View {
	readonly visible: boolean;
	show(): void;
	hide(): void;
	contains(node: Node): boolean;
	destroy(): void;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
};

const numbers = new Intl.NumberFormat();
const plural = (count: number, one: string, many: string) => `${numbers.format(count)} ${count === 1 ? one : many}`;

const money = (info: StreamedArtist["royalty"]) => {
	if (!info) return undefined;
	if (info.text) return info.text;
	try {
		return new Intl.NumberFormat(undefined, { style: "currency", currency: info.currency }).format(info.amount);
	} catch {
		return `${info.amount} ${info.currency}`;
	}
};

const monthLabel = (month: Timeline) => {
	if (month.title) return month.title;
	const date = new Date(month.year, month.month - 1, 1);
	return date.toLocaleDateString(undefined, { month: "long", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};

const sameMonth = (a?: Timeline, b?: Timeline) => a !== undefined && b !== undefined && a.month === b.month && a.year === b.year;

/** TIDAL's page background, so the view blends in */
const backgroundOf = (node: HTMLElement | null) => {
	for (let el = node; el !== null; el = el.parentElement) {
		const color = getComputedStyle(el).backgroundColor;
		if (color && color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color)) return color;
	}
	return "#101012";
};

const findMain = () => document.querySelector<HTMLElement>('[data-test="main"]') ?? document.querySelector<HTMLElement>("main");

/** `onLeave` runs when the view opens a TIDAL page itself (an artist) */
export const createView = (onLeave: () => void): View => {
	const root = h("section", P);
	root.setAttribute("aria-label", "My Activity");
	const scroller = h("div", `${P}-scroll`);
	root.append(scroller);

	let visible = false;
	/** Picked by the user; otherwise the running month */
	let selected: Timeline | undefined;
	let timeline: Timeline[] = [];
	const shownMonth = () => selected ?? timeline.find(isRunningMonth) ?? timeline[0];
	let loadToken = 0;
	let loaded = false;

	// Placed over TIDAL's content area, below its header (back / forward, search)
	const place = () => {
		const main = findMain();
		if (main === null) return root.style.setProperty("display", "none");
		const rect = main.getBoundingClientRect();
		let top = rect.top;
		const header = document.getElementById("mainHeader")?.getBoundingClientRect();
		if (header && header.height > 0 && header.top <= top + 4 && header.bottom > top && header.bottom < rect.bottom && header.left < rect.right && header.right > rect.left) top = header.bottom;
		const footer = document.getElementById("footerPlayer")?.getBoundingClientRect();
		let bottom = Math.min(rect.bottom, window.innerHeight);
		if (footer && footer.height > 0 && footer.top > top) bottom = Math.min(bottom, footer.top);
		root.style.removeProperty("display");
		root.style.left = `${rect.left}px`;
		root.style.top = `${top}px`;
		root.style.width = `${rect.width}px`;
		root.style.height = `${Math.max(0, bottom - top)}px`;
		root.style.setProperty("--la-bg", backgroundOf(main));
	};
	let interval = 0;
	const resized = new ResizeObserver(place);

	const selectMonth = (month: Timeline | undefined) => {
		selected = month;
		load();
	};

	const renderTabs = () => {
		const tabs = h("nav", `${P}-tabs`);
		tabs.setAttribute("role", "tablist");
		const current = shownMonth();
		for (const month of timeline) {
			const tab = h("button", `${P}-tab`, monthLabel(month));
			tab.type = "button";
			tab.setAttribute("role", "tab");
			const isSelected = sameMonth(month, current);
			tab.setAttribute("aria-selected", String(isSelected));
			tab.addEventListener("click", () => !isSelected && selectMonth(isRunningMonth(month) ? undefined : month));
			tabs.append(tab);
		}
		return tabs;
	};

	const renderHero = (data?: TopArtists) => {
		const hero = h("header", `${P}-hero`);
		const art = h("div", `${P}-hero-art`);
		const activity = data?.activity;
		const images = activity?.images ?? [];
		const image = images.find((img) => img.orientation === "LANDSCAPE") ?? images[0];
		const url = image?.url ?? artistPicture(data?.artists?.[0]?.artist.picture, 750);
		if (url) {
			hero.classList.add("has-art");
			const img = new Image();
			img.decoding = "async";
			img.onload = () => art.classList.add("is-loaded");
			img.src = url;
			art.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
		}
		const text = h("div", `${P}-hero-text`);
		const month = shownMonth();
		text.append(
			h("div", `${P}-kicker`, activity?.header || (month ? monthLabel(month) : "My Activity")),
			h("h1", `${P}-title`, activity?.title || "Your top artists"),
		);
		if (activity?.subtitle) text.append(h("p", `${P}-subtitle`, activity.subtitle));
		if (data !== undefined) {
			const stats = h("div", `${P}-stats`);
			const artists = data.artists?.length ?? 0;
			const streams = data.totalNrOfStreams ?? (data.artists ?? []).reduce((sum, artist) => sum + (artist.nrOfStreams ?? 0), 0);
			stats.append(h("span", `${P}-stat`, plural(streams, "stream", "streams")), h("span", `${P}-stat`, plural(artists, "artist", "artists")));
			const daysLeft = activity?.nrOfDaysLeft ?? 0;
			if (month !== undefined && isRunningMonth(month) && daysLeft > 0) stats.append(h("span", `${P}-stat ${P}-stat-muted`, `${plural(daysLeft, "day", "days")} left this month`));
			text.append(stats);
		}
		hero.append(art, text);
		return hero;
	};

	const renderRow = (entry: StreamedArtist, index: number, max: number) => {
		const row = h("li", `${P}-row`);
		row.tabIndex = 0;
		row.setAttribute("role", "link");
		if (index < 3) row.classList.add(`${P}-row-top`);
		const open = () => {
			onLeave();
			navigate(`/artist/${entry.artist.id}`);
		};
		row.addEventListener("click", open);
		row.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open()));

		const avatar = h("div", `${P}-avatar`);
		const picture = artistPicture(entry.artist.picture, 320);
		if (picture) {
			const img = h("img");
			img.loading = "lazy";
			img.alt = "";
			img.src = picture;
			avatar.append(img);
		} else avatar.textContent = entry.artist.name.slice(0, 1).toUpperCase();

		const main = h("div", `${P}-row-main`);
		const meter = h("div", `${P}-meter`);
		const fill = h("div", `${P}-meter-fill`);
		fill.style.width = `${max > 0 ? Math.max(2, (entry.nrOfStreams / max) * 100) : 0}%`;
		meter.append(fill);
		main.append(h("div", `${P}-name`, entry.artist.name), meter);

		const count = h("div", `${P}-count`);
		const streams = h("div", `${P}-streams`);
		streams.append(h("b", undefined, numbers.format(entry.nrOfStreams)), h("span", undefined, entry.nrOfStreams === 1 ? " stream" : " streams"));
		count.append(streams);
		const royalty = money(entry.royalty);
		if (royalty) {
			const paid = h("small", `${P}-royalty`, royalty);
			paid.title = "Royalties from your streams";
			count.append(paid);
		}

		row.append(h("span", `${P}-rank`, String(index + 1)), avatar, main, count);
		return row;
	};

	const renderNote = (note: Note | null | undefined, title?: string | null) => {
		if (!note || !(note.text || note.subtitle || title)) return undefined;
		const card = h("div", `${P}-note`);
		if (title) card.append(h("b", undefined, title));
		if (note.text) card.append(h("p", undefined, note.text));
		if (note.subtitle) card.append(h("p", `${P}-note-sub`, note.subtitle));
		if (note.url) {
			const link = h("a", `${P}-note-link`, "Learn more");
			link.href = note.url;
			link.target = "_blank";
			link.rel = "noreferrer";
			card.append(link);
		}
		return card;
	};

	const render = (data: TopArtists) => {
		const artists = [...(data.artists ?? [])].sort((a, b) => b.nrOfStreams - a.nrOfStreams);
		const body = h("div", `${P}-body`);
		if (artists.length === 0) {
			const month = shownMonth();
			const when = month === undefined || isRunningMonth(month) ? "this month" : `in ${monthLabel(month)}`;
			body.append(h("p", `${P}-empty`, `No streams ${when} yet. Play some music and check back later.`));
		}
		else {
			const list = h("ol", `${P}-list`);
			const max = artists[0].nrOfStreams;
			artists.forEach((entry, index) => list.append(renderRow(entry, index, max)));
			body.append(list);
		}
		const payout = data.directArtistPayout;
		const notes = [
			renderNote(data.fanCenteredRoyalties),
			renderNote(payout, payout?.artistName && money(payout.payout) ? `${payout.artistName} · ${money(payout.payout)}` : payout?.artistName),
			...(data.disclaimers ?? []).map((note) => renderNote(note)),
		].filter((note) => note !== undefined);
		if (notes.length > 0) {
			const aside = h("aside", `${P}-notes`);
			aside.append(...notes);
			body.append(aside);
		}
		scroller.replaceChildren(renderHero(data), ...(timeline.length > 1 ? [renderTabs()] : []), body);
	};

	const renderLoading = () => {
		const body = h("div", `${P}-body`);
		const list = h("ol", `${P}-list ${P}-loading`);
		for (let i = 0; i < 8; i++) {
			const row = h("li", `${P}-row`);
			row.append(h("span", `${P}-rank`), h("div", `${P}-avatar`), h("div", `${P}-row-main`), h("div", `${P}-count`));
			list.append(row);
		}
		body.append(list);
		scroller.replaceChildren(renderHero(), ...(timeline.length > 1 ? [renderTabs()] : []), body);
	};

	const renderError = (err: unknown) => {
		const body = h("div", `${P}-body ${P}-error`);
		const unavailable = err instanceof HttpError && [401, 403, 404].includes(err.status);
		body.append(
			h("p", undefined, unavailable ? "My Activity isn't available for your account or region." : "Couldn't load your activity."),
			h("small", undefined, err instanceof Error ? err.message : String(err)),
		);
		const retry = h("button", `${P}-button`, "Try again");
		retry.type = "button";
		retry.addEventListener("click", () => load(true));
		body.append(retry);
		scroller.replaceChildren(renderHero(), ...(timeline.length > 1 ? [renderTabs()] : []), body);
	};

	const load = (force = false) => {
		const token = ++loadToken;
		renderLoading();
		// The server only answers for a given month, so the list of months comes first
		getTimeline(force)
			.then((months) => {
				if (token !== loadToken) return;
				const hadTabs = timeline.length > 1;
				timeline = months;
				if (!hadTabs && timeline.length > 1) renderLoading();
				return getTopArtists(shownMonth(), force);
			})
			.then((data) => {
				if (token !== loadToken || data === undefined) return;
				loaded = true;
				render(data);
			})
			.catch((err) => {
				if (token !== loadToken) return;
				trace.warn.withContext("Couldn't load My Activity")(err as Error);
				renderError(err);
			});
	};

	return {
		get visible() {
			return visible;
		},
		show() {
			if (!root.isConnected) document.body.append(root);
			const main = findMain();
			resized.disconnect();
			if (main) resized.observe(main);
			place();
			if (!visible) {
				visible = true;
				window.addEventListener("resize", place);
				// TIDAL may swap its content area or resize it without a resize event
				interval = window.setInterval(place, 400);
				scroller.scrollTop = 0;
				// Keeps the chosen month, but picks up new streams of the running one
				if (!loaded || selected === undefined || isRunningMonth(selected)) load();
			}
		},
		hide() {
			if (!visible) return;
			visible = false;
			window.removeEventListener("resize", place);
			clearInterval(interval);
			resized.disconnect();
			root.remove();
		},
		contains: (node) => root.contains(node),
		destroy() {
			this.hide();
			loadToken++;
		},
	};
};
