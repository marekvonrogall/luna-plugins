import { ReactiveStore } from "@luna/core";
import { LunaSelectItem, LunaSelectSetting, LunaSettings, LunaSwitchSetting } from "@luna/ui";

import React from "react";

type SelectChange<T> = { target: { value: T | string } };

export type QueueGutter = "time" | "position";

type Settings = {
	queue: boolean;
	queueGutter: QueueGutter;
	queueTint: boolean;
};
export const settings = await ReactiveStore.getPluginStorage<Settings>("Office", {
	queue: true,
	queueGutter: "time",
	queueTint: true,
});

export const settingsListeners = new Set<() => void>();
const changed = () => settingsListeners.forEach((listener) => listener());

export const Settings = () => {
	const [queue, setQueue] = React.useState(settings.queue);
	const [queueGutter, setQueueGutter] = React.useState(settings.queueGutter);
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
			<LunaSelectSetting
				title="Next to upcoming songs"
				desc="What the play queue shows in front of each upcoming song"
				value={queueGutter}
				onChange={(e: SelectChange<QueueGutter>) => {
					setQueueGutter((settings.queueGutter = e.target.value as QueueGutter));
					changed();
				}}
			>
				<LunaSelectItem value="time" children="When it starts playing" />
				<LunaSelectItem value="position" children="Its position in the queue" />
			</LunaSelectSetting>
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
