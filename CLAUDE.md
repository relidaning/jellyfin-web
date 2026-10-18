# CLAUDE.md

Notes on non-obvious architecture/mechanisms in this Jellyfin Web fork.

## Server list in `config.json` — IMPORTANT (causes ~1min loading hang)
On boot the web client probes **every** URL in `config.json`'s `servers`
list, and an unreachable entry stalls the loading splash for a long
connect/proxy timeout. The user reaches everything over WireGuard at
`192.168.255.6` (phone is `192.168.255.3`), so the list must be exactly
`["http://192.168.255.6:8096"]`. Never add `localhost` (on the phone that is
the phone itself) or LAN IPs like `192.168.1.8` (dead) — this regression has
happened twice. `src/config.json` is what the dev server (`:8099`) serves; the
deployed container instead mounts `/data/apps/mynextcloud/nginx-conf/config.json`
(fixed in mynextcloud commit `dec733f`). Keep both in sync.

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

## Hotkey choice constraint
The user browses with Vimium (stock config). Any single-letter player hotkey
bound to a Vimium default (d, u, j, k, f, x, r, t, o, b, p, y, i, v, h, l, g,
m, n, /, ?) is swallowed by Vimium's content script before page listeners run
— no app-side workaround exists. Current cue-navigation keys: `a` and `s` are
safe; `d` requires a Vimium exclusion rule on the user's side. Prefer unbound
letters (a, s, e, w, q, c, z) for new hotkeys.

## Phone remote pad (`src/components/remotecontrol/`)
The Now Playing page (`#/queue`) opens in `.remotePadMode` by default (set in
the markup, so the stock layout never flashes); `remotecontrol.js` only drops
back to the stock layout for music playing on this device. The pad shows
`.remotePad` (tool pills, an SVG 8-wedge ring with split center, random /
settings pills, the stock progress bar moved under the ring) instead of the
stock layout, and hides the top bar (`body.remotePadHeaderHidden`; double-tap
empty space toggles it). Actions the server has no command for travel as the
stock `SendKey` general command, key in `Arguments.Key`, extra args alongside
(the server rejects unknown command *names* but passes arguments through):
`PreviousSubtitleCue`/`RepeatSubtitleCue`/`NextSubtitleCue`, and
`SetPlaybackRate` + `Rate`. The receiving client maps them in
`serverNotifications.js`, so both ends need this fork's build. Previous/next
episode and "Random" are resolved on the phone via the API (`AdjacentTo`,
`SortBy=Random`) and sent as a normal PlayNow. `keepScreenAwake.js` uses the
Wake Lock API when available, but the LAN server is plain HTTP (not a secure
context), so the real path on the phone is the looping silent-video fallback.

## Remote target persistence (`src/scripts/remoteTarget.js`)
Stock autocast remembers the controlled *session* id, which changes when the
controlled browser reloads/reconnects, so the phone silently fell back to
itself ("the remote timed out"). `remoteTarget.js` stores the target's
*device* id (`localStorage.remoteTargetDeviceId`, targets carry `deviceId`
from `sessionPlayer.getTargets()`) and reattaches on start-up, on
`visibilitychange`, and every 5s while dropped; on a fresh load it opens the
remote if that device is playing. Only the cast menus' Disconnect
(`forgetRemoteTarget()`) clears it. Remote volume uses absolute `SetVolume` in
10% steps with an optimistic on-phone readout; the stock `.iconOsd` is hidden
in pad mode because it only reacts after the ~1s session round-trip.

## Idle sign-out (`src/scripts/idleSignOut.js`)
The fork signs a client out once it has been closed/hidden for 30 minutes,
tracked via `localStorage.jellyfin_lastActive` (refreshed once a minute while
the tab runs). It only exists in the fork (`:8097`, reports version
`12.0.0`); devices on the stock `:8096/web/` client (`10.11.8`) are never
evicted, so "login wasn't evicted" reports should first check which client
the device uses in the server's device list.

## Deployed nginx caching (`/data/apps/mynextcloud/nginx-conf/default.conf`)
Since mynextcloud commit `76c909b` (2026-10-07) the config marks only URLs
that change with every build as `max-age=31536000, immutable` (a content hash
in the name, or `*.bundle.js?<build hash>`); everything else
(`themes/<id>/theme.css`, `libraries/*`, `index.html`, `config.json`) is
`no-cache`, and `gzip.conf` also compresses `application/wasm`. The config
files are bind-mounted, so the running container on `:8097` keeps the old
copy until it is recreated: `docker compose up -d --force-recreate
jellyfin-web` in `/data/apps/mynextcloud` (a recreate, not a plain restart,
is also what applies compose changes such as the `logging` cap). If a browser
shows a stale theme or subtitle worker, first `curl -sI` the asset on `:8097`
— unhashed names must answer `Cache-Control: no-cache` — and fix it in that
nginx config or by recreating, not with fork-side version queries.
