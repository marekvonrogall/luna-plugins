import { LunaButtonSetting, LunaSettings } from "@luna/ui";
import React from "react";

import { pickPlaylist } from "../../../shared/playlistPicker";
import { trace, unloads } from "./core";
import { assignRatingPlaylist, playlistsForRating } from "./ratings";
import { getRatingPlaylist, RATINGS, stars } from "./store";

/** Always five stars, filled / half-filled / empty like in the player (uses the star row styles) */
const StarDisplay = ({ rating }: { rating: number }) => (
	<span className="comite-starrow" aria-label={`${rating} stars`}>
		{[1, 2, 3, 4, 5].map((index) => (
			<span key={index} className="comite-starbtn" style={{ cursor: "default" }}>
				<span className="comite-star-base">☆</span>
				<span className="comite-star-fill" style={{ width: rating >= index ? "100%" : rating >= index - 0.5 ? "50%" : "0%" }}>
					★
				</span>
			</span>
		))}
	</span>
);

export const Settings = () => {
	const [, rerender] = React.useReducer((n: number) => n + 1, 0);

	return (
		<LunaSettings>
			{RATINGS.map((rating) => {
				const playlist = getRatingPlaylist(rating);
				return (
					<LunaButtonSetting
						key={rating}
						title={<StarDisplay rating={rating} />}
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
								subtitle: `Songs in this playlist count as rated ${rating}★. Playlists used for another rating aren't listed.`,
								loadPlaylists: playlistsForRating(rating),
								currentUuid: playlist?.uuid,
								allowClear: playlist !== undefined,
							});
							if (chosen === undefined) return;
							const done = assignRatingPlaylist(rating, chosen ?? undefined);
							rerender();
							await done.catch(trace.msg.err.withContext(`Failed to load the ${stars(rating)} playlist`));
						}}
					/>
				);
			})}
		</LunaSettings>
	);
};
