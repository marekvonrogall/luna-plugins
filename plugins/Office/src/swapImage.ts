/** Crossfades a container to a new image once it has loaded; `onFail` retries a bit later */
export const swapImage = (container: HTMLElement, url: string | undefined, state: { url?: string }, onFail?: () => void) => {
	if (url === state.url) return;
	state.url = url;
	if (url === undefined) {
		container.replaceChildren();
		return;
	}
	const img = new Image();
	img.alt = "";
	img.draggable = false;
	img.decoding = "async";
	img.onload = () => {
		if (state.url !== url) return;
		container.appendChild(img);
		requestAnimationFrame(() => img.classList.add("is-in"));
		// Only older images go: a newer one may have arrived meanwhile
		setTimeout(() => {
			while (img.isConnected && img.previousElementSibling) img.previousElementSibling.remove();
		}, 700);
	};
	img.onerror = () => {
		if (state.url !== url) return;
		state.url = undefined;
		setTimeout(() => onFail?.(), 2000);
	};
	img.src = url;
};
