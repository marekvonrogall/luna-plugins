import { ReactiveStore } from "@luna/core";
import { LunaSettings, LunaSwitchSetting } from "@luna/ui";

import React from "react";

type Settings = {
	queue: boolean;
	queueTint: boolean;
};
export const settings = await ReactiveStore.getPluginStorage<Settings>("Office", {
	queue: true,
	queueTint: true,
});

export const settingsListeners = new Set<() => void>();
const changed = () => settingsListeners.forEach((listener) => listener());

export const Settings = () => {
	const [queue, setQueue] = React.useState(settings.queue);
	const [queueTint, setQueueTint] = React.useState(settings.queueTint);

	return (
		<LunaSettings>
			<LunaSwitchSetting
				title="Redesigned play queue"
				desc="Replaces TIDAL's play queue with Office's version"
				checked={queue}
				onChange={(_: unknown, checked: boolean) => {
					setQueue((settings.queue = checked));
					changed();
				}}
			/>
			<LunaSwitchSetting
				title="Tint the queue with the cover"
				desc="Colors the play queue's background with the cover of the current song"
				checked={queueTint}
				onChange={(_: unknown, checked: boolean) => {
					setQueueTint((settings.queueTint = checked));
					changed();
				}}
			/>
		</LunaSettings>
	);
};
