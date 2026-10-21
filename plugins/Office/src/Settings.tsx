import { ReactiveStore } from "@luna/core";
import { LunaSettings, LunaSwitchSetting } from "@luna/ui";

import React from "react";

type Settings = {
	queue: boolean;
	search: boolean;
	playerBar: boolean;
	sidebar: boolean;
	dockedPlayer: boolean;
	pinnedCover: boolean;
	pinnedSidebar: boolean;
	pinnedHeader: boolean;
	queueTint: boolean;
	sidebarTint: boolean;
};
export const settings = await ReactiveStore.getPluginStorage<Settings>("Office", {
	queue: true,
	search: true,
	playerBar: true,
	sidebar: true,
	dockedPlayer: true,
	pinnedCover: false,
	pinnedSidebar: true,
	pinnedHeader: true,
	queueTint: true,
	sidebarTint: false,
});

export const settingsListeners = new Set<() => void>();
const changed = () => settingsListeners.forEach((listener) => listener());

/** Greys out a setting that only works with a redesign that's off */
const Needs = ({ on, children }: { on: boolean; children: React.ReactNode }) => (
	<div style={{ opacity: on ? 1 : 0.45, transition: "opacity 0.15s" }}>{children}</div>
);

export const Settings = () => {
	const [queue, setQueue] = React.useState(settings.queue);
	const [search, setSearch] = React.useState(settings.search);
	const [playerBar, setPlayerBar] = React.useState(settings.playerBar);
	const [sidebar, setSidebar] = React.useState(settings.sidebar);
	const [dockedPlayer, setDockedPlayer] = React.useState(settings.dockedPlayer);
	const [pinnedCover, setPinnedCover] = React.useState(settings.pinnedCover);
	const [pinnedSidebar, setPinnedSidebar] = React.useState(settings.pinnedSidebar);
	const [pinnedHeader, setPinnedHeader] = React.useState(settings.pinnedHeader);
	const [queueTint, setQueueTint] = React.useState(settings.queueTint);
	const [sidebarTint, setSidebarTint] = React.useState(settings.sidebarTint);

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
					title="Redesigned search"
					desc="Replaces TIDAL's search bar with Office's version"
					checked={search}
					disabled={!queue}
					onChange={(_: unknown, checked: boolean) => {
						setSearch((settings.search = checked));
						changed();
					}}
				/>
			</Needs>
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
			<LunaSwitchSetting
				title="Pinned player bar"
				desc="Stops the player bar from floating while the full-screen view is open"
				checked={dockedPlayer}
				onChange={(_: unknown, checked: boolean) => {
					setDockedPlayer((settings.dockedPlayer = checked));
					changed();
				}}
			/>
			<LunaSwitchSetting
				title="Pinned cover"
				desc="Keeps the album artwork in the player bar while the full-screen view is open"
				checked={pinnedCover}
				onChange={(_: unknown, checked: boolean) => {
					setPinnedCover((settings.pinnedCover = checked));
					changed();
				}}
			/>
			<LunaSwitchSetting
				title="Pinned sidebar"
				desc="Always keeps the sidebar visible"
				checked={pinnedSidebar}
				onChange={(_: unknown, checked: boolean) => {
					setPinnedSidebar((settings.pinnedSidebar = checked));
					changed();
				}}
			/>
			<LunaSwitchSetting
				title="Pinned navigation bar"
				desc="Always keeps the navbar visible"
				checked={pinnedHeader}
				onChange={(_: unknown, checked: boolean) => {
					setPinnedHeader((settings.pinnedHeader = checked));
					changed();
				}}
			/>
			<Needs on={queue}>
				<LunaSwitchSetting
					title="Queue background tint"
					desc="Colors the play queue's background with the cover of the current song"
					checked={queueTint}
					disabled={!queue}
					onChange={(_: unknown, checked: boolean) => {
						setQueueTint((settings.queueTint = checked));
						changed();
					}}
				/>
			</Needs>
			<Needs on={sidebar}>
				<LunaSwitchSetting
					title="Sidebar background tint"
					desc="Colors the sidebar's background with the cover of the current song"
					checked={sidebarTint}
					disabled={!sidebar}
					onChange={(_: unknown, checked: boolean) => {
						setSidebarTint((settings.sidebarTint = checked));
						changed();
					}}
				/>
			</Needs>
		</LunaSettings>
	);
};
