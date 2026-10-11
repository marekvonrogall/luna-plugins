# [TidaLuna](https://github.com/Inrixia/TidaLuna) Plugins

Plugins for [TidaLuna Client](https://github.com/Inrixia/TidaLuna) forked from [Inrixia](https://github.com/Inrixia).

## Librarian

An enhanced version of the SongDownloader plugin.

### New features
- Live download status in the context menu button:
	- Current track index in queue (e.g. `3/14`)
	- Artist + track label for the active download
- Smart skip logic for existing files:
	- Scans your selected download folder once
	- Skips tracks already present in your library
	- Shows a final summary with downloaded vs skipped

### Preview

<img width="241" height="396" alt="Screenshot 2026-02-28 183205" src="https://github.com/user-attachments/assets/8acac7ba-dc8e-484a-8be8-17c7957bad7a" />

## Collector

Right-click a playlist, an album, a single song or a selection of songs and choose **Collect**.

For your favorite (hearted) tracks, use the **...** button next to the title on the Tracks page in My Collection and choose **Collect**.

On an artist page, open the **...** menu and choose **Collect** to add every album, EP and single of that artist.

In My Collection, the **...** menu on the **Albums** tab collects every saved album, and on the **Artists** tab every album, EP and single of the artists you follow (untick any you want to leave out).

- Pick one of your playlists from a searchable list
- For every selected song, the whole album it belongs to is added to that playlist
- Songs already in the target playlist are skipped
- Songs and albums TIDAL labels as AI-generated are never collected
- Optionally tick exclusion playlists: songs already in them are not collected
- When the playlist hits TIDAL's 20,000 song limit, collecting continues in `{name}-2`, `{name}-3`, … (created if needed, without repeating songs)
- Each album is only fetched once, even if several selected songs come from it
- Progress bar with a cancel button, summary notification when done

## Installation

**Install the plugin by adding my store to TidaLuna!**

<img width="818" height="199" alt="image" src="https://github.com/user-attachments/assets/ab72ec3b-2515-4cf9-a24d-17ee235b8f40" />

Luna Settings > Plugin Store > Install from URL > "https://github.com/marekvonrogall/luna-plugins/releases/download/latest/store.json"
