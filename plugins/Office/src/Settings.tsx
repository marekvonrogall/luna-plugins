import { ReactiveStore } from "@luna/core";
import { LunaSettings, LunaSwitchSetting } from "@luna/ui";

import React from "react";

type Settings = {
	queue: boolean;
	queueTint: boolean;
	dockedPlayer: boolean;
	pinnedCover: boolean;
	playerBar: boolean;
	sidebar: boolean;
	sidebarTint: boolean;
	pinnedSidebar: boolean;
};
export const settings = await ReactiveStore.getPluginStorage<Settings>("Office", {
	queue: true,
	queueTint: true,
	dockedPlayer: true,
	pinnedCover: false,
	playerBar: true,
	sidebar: true,
	sidebarTint: false,
	pinnedSidebar: true,
});

export const settingsListeners = new Set<() => void>();
const changed = () => settingsListeners.forEach((listener) => listener());

/** Greys out a setting that only works with a redesign that's off */
const Needs = ({ on, children }: { on: boolean; children: React.ReactNode }) => (
	<div style={{ opacity: on ? 1 : 0.45, transition: "opacity 0.15s" }}>{children}</div>
);

export const Settings = () => {
	const [queue, setQueue] = React.useState(settings.queue);
	const [queueTint, setQueueTint] = React.useState(settings.queueTint);
	const [dockedPlayer, setDockedPlayer] = React.useState(settings.dockedPlayer);
	const [pinnedCover, setPinnedCover] = React.useState(settings.pinnedCover);
	const [playerBar, setPlayerBar] = React.useState(settings.playerBar);
	const [sidebar, setSidebar] = React.useState(settings.sidebar);
	const [sidebarTint, setSidebarTint] = React.useState(settings.sidebarTint);
	const [pinnedSidebar, setPinnedSidebar] = React.useState(settings.pinnedSidebar);

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
			<Needs on={queue}>
				<LunaSwitchSetting
					title="Tint the queue with the cover"
					desc="Colors the play queue's background with the cover of the current song"
					checked={queueTint}
					disabled={!queue}
					onChange={(_: unknown, checked: boolean) => {
						setQueueTint((settings.queueTint = checked));
						changed();
					}}
				/>
			</Needs>
			<LunaSwitchSetting
				title="Keep the player bar docked"
				desc="Stops the player bar from floating while the full-screen view is open"
				checked={dockedPlayer}
				onChange={(_: unknown, checked: boolean) => {
					setDockedPlayer((settings.dockedPlayer = checked));
					changed();
				}}
			/>
			<LunaSwitchSetting
				title="Pinned cover"
				desc="Keeps the cover in the player bar while the full-screen view is open"
				checked={pinnedCover}
				onChange={(_: unknown, checked: boolean) => {
					setPinnedCover((settings.pinnedCover = checked));
					changed();
				}}
			/>
			<LunaSwitchSetting
				title="Redesigned player bar"
				desc="Replaces TIDAL's player bar with Office's version"
				checked={playerBar}
				onChange={(_: unknown, checked: boolean) => {
					setPlayerBar((settings.playerBar = checked));
					changed();
				}}
			/>
			<LunaSwitchSetting
				title="Redesigned sidebar"
				desc="Replaces TIDAL's sidebar with Office's version"
				checked={sidebar}
				onChange={(_: unknown, checked: boolean) => {
					setSidebar((settings.sidebar = checked));
					changed();
				}}
			/>
			<Needs on={sidebar}>
				<LunaSwitchSetting
					title="Tint the sidebar with the cover"
					desc="Colors the sidebar's background with the cover of the current song"
					checked={sidebarTint}
					disabled={!sidebar}
					onChange={(_: unknown, checked: boolean) => {
						setSidebarTint((settings.sidebarTint = checked));
						changed();
					}}
				/>
			</Needs>
			<LunaSwitchSetting
				title="Pinned sidebar"
				desc="Always keeps the sidebar visible"
				checked={pinnedSidebar}
				onChange={(_: unknown, checked: boolean) => {
					setPinnedSidebar((settings.pinnedSidebar = checked));
					changed();
				}}
			/>
		</LunaSettings>
	);
};
