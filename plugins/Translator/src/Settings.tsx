import { ReactiveStore } from "@luna/core";
import { LunaSelectItem, LunaSelectSetting, LunaSettings } from "@luna/ui";

import React from "react";

import { defaultTarget, LANGUAGES, languageName } from "./languages";

type SelectChange<T> = { target: { value: T | string } };

type Settings = {
	targetLanguage: string;
	neverTranslate: string[];
};
export const settings = await ReactiveStore.getPluginStorage<Settings>("Translator", {
	targetLanguage: defaultTarget(),
	neverTranslate: [],
});
settings.neverTranslate ??= [];

export const settingsListeners = new Set<() => void>();
const changed = () => settingsListeners.forEach((listener) => listener());

export const Settings = () => {
	const [targetLanguage, setTargetLanguage] = React.useState(settings.targetLanguage);
	const [neverTranslate, setNeverTranslate] = React.useState(settings.neverTranslate);

	return (
		<LunaSettings>
			<LunaSelectSetting
				title="Target language"
				desc="The language the lyrics are translated into"
				value={targetLanguage}
				onChange={(e: SelectChange<string>) => {
					setTargetLanguage((settings.targetLanguage = e.target.value));
					changed();
				}}
			>
				{LANGUAGES.map(({ code, name }) => (
					<LunaSelectItem key={code} value={code} children={name} />
				))}
			</LunaSelectSetting>
			<LunaSelectSetting<string[]>
				title="Never translate"
				desc="Songs in these languages stay as they are (songs already in the target language are never translated)"
				multiple
				displayEmpty
				value={neverTranslate}
				renderValue={(codes: string[]) => (codes.length === 0 ? "None" : codes.map(languageName).join(", "))}
				onChange={(e: SelectChange<string[]>) => {
					const value = e.target.value;
					const codes = typeof value === "string" ? value.split(",") : value;
					setNeverTranslate((settings.neverTranslate = [...codes]));
					changed();
				}}
			>
				{LANGUAGES.map(({ code, name }) => (
					<LunaSelectItem key={code} value={code} children={name} />
				))}
			</LunaSelectSetting>
		</LunaSettings>
	);
};
