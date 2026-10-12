/** Cover images fetched from the main process: TIDAL's service worker refuses the CORS request a canvas would need */
export const fetchCoverBase64 = async (url: string): Promise<string | undefined> => {
	if (!/^https:\/\/resources\.tidal\.com\/images\/[\w/]+\/\d+x\d+\.jpg$/.test(url)) return undefined;
	const res = await fetch(url);
	if (!res.ok) return undefined;
	return Buffer.from(await res.arrayBuffer()).toString("base64");
};
