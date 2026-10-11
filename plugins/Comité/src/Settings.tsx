import { LunaButtonSetting, LunaSettings } from "@luna/ui";
import React from "react";

import { pickPlaylist } from "../../../shared/playlistPicker";
import { getUserPlaylists } from "./api";
import { unloads } from "./core";
import { loadRating } from "./ratings";
import { getRatingPlaylist, RATINGS, setRatingPlaylist, stars } from "./store";

export const Settings = () => {
	const [, rerender] = React.useReducer((n: number) => n + 1, 0);

	return (
		<LunaSettings>
			{RATINGS.map((rating) => {
				const playlist = getRatingPlaylist(rating);
				return (
					<LunaButtonSetting
						key={rating}
						title={stars(rating)}
						desc={
							playlist ? (
								<>
									Songs rated {rating}★ go to <b>{playlist.title}</b>
								</>
							) : (
								"No playlist yet. You'll be asked the first time you use this rating."
							)
						}
						children={playlist ? "Change" : "Choose playlist"}
						onClick={async () => {
							const chosen = await pickPlaylist(unloads, {
								title: `Playlist for ${stars(rating)}`,
								subtitle: "Songs with this rating are added to this playlist. Songs already rated stay in the old one.",
								loadPlaylists: getUserPlaylists,
								currentUuid: playlist?.uuid,
								allowClear: playlist !== undefined,
							});
							if (chosen === undefined) return;
							setRatingPlaylist(rating, chosen ?? undefined);
							rerender();
							await loadRating(rating).catch(() => undefined);
						}}
					/>
				);
			})}
		</LunaSettings>
	);
};
