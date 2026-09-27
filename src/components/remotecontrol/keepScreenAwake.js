// Keeps the phone screen on while it is used as a remote control.
// The Wake Lock API only exists in secure contexts (HTTPS), so over plain HTTP
// on the LAN we fall back to looping a tiny silent video, which iOS/Android
// treat as "media playing" and won't auto-lock during.

// 2s of 16x16 black H.264 (baseline), no audio track
const SILENT_VIDEO = 'data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMrbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAB9AAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAlV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAB9AAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAfQAAAAAAABAAAAAAHNbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAgABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABeG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAThzdGJsAAAAuHN0c2QAAAAAAAAAAQAAAKhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAALmF2Y0MBQsAK/+EAFmdCwArZHsBEAAADAAQAAAMACDxImSABAAVoy4PLIAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAApAAAAKQAAAABhzdHRzAAAAAAAAAAEAAAACAABAAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAACAAAAAQAAABxzdHN6AAAAAAAAAAAAAAACAAAChgAAAAoAAAAUc3RjbwAAAAAAAAABAAADWwAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNjAuMTYuMTAwAAAACGZyZWUAAAKYbWRhdAAAAnAGBf//bNxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjQgcjMxMDggMzFlMTlmOSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjMgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0wIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDE6MHgxMTEgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTI1MCBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAOZYiEBb///w9FAAFPf4AAAAAGQZo4CvqA';

let active = false;
let wakeLock = null;
let video = null;

async function requestWakeLock() {
    try {
        // eslint-disable-next-line compat/compat -- feature-detected in acquire()
        const lock = await navigator.wakeLock.request('screen');
        if (!active) {
            // disabled while the request was pending
            lock.release().catch(() => { /* no-op */ });
            return true;
        }
        wakeLock = lock;
        wakeLock.addEventListener('release', () => {
            wakeLock = null;
        });
        return true;
    } catch {
        return false;
    }
}

function playSilentVideo() {
    if (!video) {
        video = document.createElement('video');
        video.muted = true;
        video.loop = true;
        video.setAttribute('muted', '');
        video.setAttribute('playsinline', '');
        video.setAttribute('aria-hidden', 'true');
        video.src = SILENT_VIDEO;
        video.style.cssText = 'position:fixed;width:1px;height:1px;left:0;bottom:0;opacity:0.01;pointer-events:none;';
        document.body.appendChild(video);
    }

    if (!video.paused) return;

    // Autoplay may be refused until the first tap; onGesture() retries
    video.play().catch(() => { /* no-op */ });
}

async function acquire() {
    if (!active || document.visibilityState !== 'visible' || wakeLock) return;

    if (window.isSecureContext && navigator.wakeLock && await requestWakeLock()) return;

    if (active) playSilentVideo();
}

function onGesture() {
    acquire();
}

export function enableKeepScreenAwake() {
    if (active) return;
    active = true;
    // The OS drops the lock / pauses the video when the page is hidden
    document.addEventListener('visibilitychange', acquire);
    document.addEventListener('pointerdown', onGesture, true);
    acquire();
}

export function disableKeepScreenAwake() {
    if (!active) return;
    active = false;
    document.removeEventListener('visibilitychange', acquire);
    document.removeEventListener('pointerdown', onGesture, true);

    wakeLock?.release().catch(() => { /* no-op */ });
    wakeLock = null;

    if (video) {
        video.pause();
        video.remove();
        video = null;
    }
}
