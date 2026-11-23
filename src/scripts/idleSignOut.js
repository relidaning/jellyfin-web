import { playbackManager } from 'components/playback/playbackmanager';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import Dashboard from 'utils/dashboard';

// Signs the user out after the client has been closed for a while.
//
// Jellyfin access tokens never expire, and "Remember me" keeps the token in
// localStorage, so a closed tab normally stays signed in forever. Every open
// tab stamps the time into localStorage (shared by all tabs) once a minute and
// when it is hidden or closed. On start-up, a stamp older than IDLE_LIMIT_MS
// means every tab has been gone that long: the stored tokens are revoked on the
// server and dropped before the client tries to sign in with them. A tab that
// resumes after such a gap (a suspended phone app, a laptop waking from sleep)
// signs out the same way, unless something is playing.

const STORAGE_KEY = 'jellyfin_lastActive';
const IDLE_LIMIT_MS = 30 * 60 * 1000;
const STAMP_INTERVAL_MS = 60 * 1000;

function getLastActive() {
    try {
        return parseInt(localStorage.getItem(STORAGE_KEY), 10) || null;
    } catch {
        return null;
    }
}

function stamp() {
    try {
        localStorage.setItem(STORAGE_KEY, Date.now().toString());
    } catch {
        // storage unavailable (private mode): nothing persists anyway
    }
}

function isExpired() {
    const lastActive = getLastActive();
    return lastActive !== null && Date.now() - lastActive > IDLE_LIMIT_MS;
}

function revokeToken(server) {
    const address = server.ManualAddress || server.LocalAddress || server.RemoteAddress;
    if (!address) return Promise.resolve();

    return fetch(`${address.endsWith('/') ? address.slice(0, -1) : address}/Sessions/Logout`, {
        method: 'POST',
        headers: { Authorization: `MediaBrowser Token="${server.AccessToken}"` }
    }).catch(err => console.warn('[idleSignOut] could not revoke token', err));
}

// Called before the first connection, so no ApiClient holds the tokens yet.
async function clearStoredSessions() {
    const credentialProvider = ServerConnections.credentialProvider();
    const credentials = credentialProvider.credentials();
    const servers = credentials.Servers.filter(server => server.AccessToken);
    if (!servers.length) return;

    console.info('[idleSignOut] client was closed for more than 30 minutes, signing out');
    await Promise.all(servers.map(revokeToken));

    servers.forEach(server => {
        server.UserId = null;
        server.AccessToken = null;
        server.ExchangeToken = null;
    });
    credentialProvider.credentials(credentials);
}

function checkRunningTab() {
    if (isExpired() && !playbackManager.isPlaying() && ServerConnections.currentApiClient()?.accessToken()) {
        console.info('[idleSignOut] resumed after more than 30 minutes away, signing out');
        Dashboard.logout();
    }
    stamp();
}

export async function initialize() {
    if (isExpired()) {
        await clearStoredSessions();
    }
    stamp();

    setInterval(checkRunningTab, STAMP_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            checkRunningTab();
        } else {
            stamp();
        }
    });
    window.addEventListener('pagehide', stamp);
}
