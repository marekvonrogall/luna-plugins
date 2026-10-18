// Google Translate language codes
const CODES = [
	"af", "sq", "am", "ar", "hy", "az", "eu", "be", "bn", "bs", "bg", "ca", "ceb", "zh-CN", "zh-TW", "co", "hr", "cs", "da", "nl", "en",
	"eo", "et", "fil", "fi", "fr", "fy", "gl", "ka", "de", "el", "gu", "ht", "ha", "haw", "he", "hi", "hmn", "hu", "is", "ig", "id", "ga",
	"it", "ja", "jv", "kn", "kk", "km", "rw", "ko", "ku", "ky", "lo", "la", "lv", "lt", "lb", "mk", "mg", "ms", "ml", "mt", "mi", "mr",
	"mn", "my", "ne", "no", "ny", "or", "ps", "fa", "pl", "pt", "pa", "ro", "ru", "sm", "gd", "sr", "st", "sn", "sd", "si", "sk", "sl",
	"so", "es", "su", "sw", "sv", "tg", "ta", "tt", "te", "th", "tr", "tk", "uk", "ur", "ug", "uz", "vi", "cy", "xh", "yi", "yo", "zu",
];

const NAMES: Record<string, string> = { "zh-CN": "Chinese (Simplified)", "zh-TW": "Chinese (Traditional)", hmn: "Hmong", haw: "Hawaiian" };
const displayNames = new Intl.DisplayNames(["en"], { type: "language" });
const nameOf = (code: string) => {
	try {
		return NAMES[code] ?? displayNames.of(code) ?? code;
	} catch {
		return code;
	}
};

export const LANGUAGES = CODES.map((code) => ({ code, name: nameOf(code) })).sort((a, b) => a.name.localeCompare(b.name));
export const languageName = (code: string) => LANGUAGES.find((language) => language.code === code)?.name ?? nameOf(code);

// Legacy codes Google still returns
const ALIASES: Record<string, string> = { iw: "he", jw: "jv", tl: "fil", "zh-cn": "zh-CN", "zh-tw": "zh-TW", zh: "zh-CN" };
export const normalizeCode = (code: string) => ALIASES[code.toLowerCase()] ?? ALIASES[code] ?? code;

// Ignores the region ("zh-CN" = "zh-TW")
export const sameLanguage = (a: string, b: string) => normalizeCode(a).split("-")[0].toLowerCase() === normalizeCode(b).split("-")[0].toLowerCase();

export const defaultTarget = () => {
	const base = (navigator.language ?? "en").split("-")[0];
	return CODES.find((code) => code === base) ?? "en";
};
