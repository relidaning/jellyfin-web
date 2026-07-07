# CLAUDE.md

Notes on non-obvious architecture/mechanisms in this Jellyfin Web fork.

## Playback time caching (`src/plugins/htmlVideoPlayer/plugin.js`)
`currentTime()` (getter) prefers a cached `#currentTime` field over the live
`mediaElement.currentTime`. That cache only refreshes on the native
`timeupdate` event, which fires rarely while paused and lags right after a
programmatic seek. Any code that sets `mediaElement.currentTime` directly
(e.g. `seekToSubtitleCue()`) must also update `#currentTime` synchronously,
or a second rapid read (like double-pressing a seek hotkey) will compute from
a stale pre-seek position.

## Audio-only playback
Video items can be played back audio-only (e.g. for language-shadowing use)
via a "Play audio only" context-menu entry. Mechanism: a `playAudioOnly` flag
is threaded through `playbackmanager.js`'s `play()`/`executeCommand()` and
`getPlaybackInfo`, which overrides `item.MediaType` to `'Audio'` and routes
the request through the existing `Audio/{id}/universal` endpoint so the
server never transcodes/sends video. The shared audio device profile forces
HLS, which throws a server-side `NullReferenceException` for non-audio-native
sources — audio-only playback instead uses a dedicated progressive
(`http`/mp3) stream URL. Enabling this path also exposes latent bugs in code
that assumed `item.MediaStreams[0].Type` is always audio-native (e.g.
`remotecontrol.js`'s Now Playing page) — guard such accesses with optional
chaining rather than assuming `MediaType === 'Audio'` implies a native audio
source.
