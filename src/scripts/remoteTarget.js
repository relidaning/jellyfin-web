import { playbackManager } from 'components/playback/playbackmanager';
import { appRouter } from 'components/router/appRouter';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import Events from 'utils/events.ts';

// Keeps a phone used as a remote attached to the device it controls.
//
// Stock autocast remembers the target's *session* id, which changes whenever
// the controlled browser reloads or reconnects, so the phone silently falls
// back to itself. This remembers the target's *device* id instead and
// reattaches to whatever session that device has now: on start-up, when the
// page becomes visible again, and while the target is gone. Only an explicit
// "disconnect" in the cast menu forgets it.

const STORAGE_KEY = 'remoteTargetDeviceId';
const RETRY_MS = 5000;

let retryTimer = null;
let openedRemoteOnStart = false;

function getStoredDeviceId() {
    try {
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

function setStoredDeviceId(deviceId) {
    try {
        if (deviceId) {
            localStorage.setItem(STORAGE_KEY, deviceId);
        } else {
            localStorage.removeItem(STORAGE_KEY);
        }
    } catch {
        // storage unavailable (private mode): the remote just won't reconnect
    }
}

/** Called by the cast menus' "disconnect": stop reattaching to the device. */
export function forgetRemoteTarget() {
    setStoredDeviceId(null);
    stopRetrying();
}

function isSignedIn() {
    return ServerConnections.getApiClients().some(c => c.accessToken());
}

function isControllingRemote() {
    const info = playbackManager.getPlayerInfo();
    return !!info && !info.isLocalPlayer;
}

function stopRetrying() {
    clearInterval(retryTimer);
    retryTimer = null;
}

async function reconnect() {
    const deviceId = getStoredDeviceId();
    if (!deviceId || !isSignedIn() || isControllingRemote()) {
        if (!deviceId || isControllingRemote()) stopRetrying();
        return;
    }

    const targets = await playbackManager.getTargets();
    const target = targets.find(t => t.deviceId === deviceId);
    if (!target) return;

    console.debug('[remoteTarget] reattaching to', target.name, target.id);
    playbackManager.trySetActivePlayer(target.playerName, target);

    // Opening the site while the remembered device is playing goes straight
    // to the remote (only once per page load, so browsing isn't hijacked)
    if (!openedRemoteOnStart && target.nowPlayingName) {
        openedRemoteOnStart = true;
        const path = window.location.hash.replace(/^#!?/, '').split('?')[0];
        if (path === '' || path === '/' || path === '/home') {
            appRouter.showNowPlaying();
        }
    }
}

function startRetrying() {
    if (retryTimer) return;
    retryTimer = setInterval(() => {
        if (document.visibilityState === 'visible') {
            reconnect().catch(err => console.debug('[remoteTarget] reconnect failed', err));
        }
    }, RETRY_MS);
}

function onPlayerChange(e, player, target) {
    if (player && !player.isLocalPlayer && target?.deviceId) {
        setStoredDeviceId(target.deviceId);
        stopRetrying();
    } else if (getStoredDeviceId()) {
        // dropped back to this device without a "disconnect": the target's
        // session went away (reload, network blip) - keep trying to reattach
        openedRemoteOnStart = true;
        startRetrying();
    }
}

function onStart() {
    reconnect().catch(err => console.debug('[remoteTarget] reconnect failed', err));
}

export function initialize() {
    Events.on(playbackManager, 'playerchange', onPlayerChange);
    Events.on(ServerConnections, 'localusersignedin', onStart);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') onStart();
    });

    if (isSignedIn()) onStart();
}
