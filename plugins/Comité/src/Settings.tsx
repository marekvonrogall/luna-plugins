import { LunaButtonSetting, LunaNumber, LunaSettings, LunaTitle } from "@luna/ui";
import React from "react";

import { pickPlaylist } from "../../../shared/playlistPicker";
import { trace, unloads } from "./core";
import { assignRatingPlaylist, playlistsForRating } from "./ratings";
import { getRatingPlaylist, RATINGS, settings, stars } from "./store";

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
	const [startAt, setStartAt] = React.useState(settings.rateStartAt ?? 30);

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
						// Same width as the number field below (128px), so the right column lines up
						sx={{ width: 128 }}
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
			{/* Own row: in LunaNumberSetting the field doesn't move to the right edge like the buttons above */}
			<div style={{ display: "flex", alignItems: "center", width: "100%" }}>
				<LunaTitle variant="h8" title="Rating mode: start at (%)" desc="Where each song starts, in % of its length (0 = from the beginning)" />
				<div style={{ marginLeft: "auto", marginRight: 16, flexShrink: 0 }}>
					<LunaNumber
						size="small"
						label={null}
						min={0}
						max={90}
						value={startAt}
						onNumber={(value: number) => {
							setStartAt(value);
							settings.rateStartAt = value;
						}}
					/>
				</div>
			</div>
		</LunaSettings>
	);
};
