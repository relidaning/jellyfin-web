import escapeHtml from 'escape-html';

import { getImageUrl } from 'apps/legacy/features/playback/utils/image';
import { getItemTextLines } from 'apps/legacy/features/playback/utils/itemText';
import { AppFeature } from 'constants/appFeature';
import { ItemAction } from 'constants/itemAction';

import datetime from '../../scripts/datetime';
import { clearBackdrop, setBackdrops } from '../backdrop/backdrop';
import listView from '../listview/listview';
import imageLoader from '../images/imageLoader';
import { playbackManager } from '../playback/playbackmanager';
import Events from '../../utils/events.ts';
import { appHost } from '../apphost';
import globalize from '../../lib/globalize';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import layoutManager from '../layoutManager';
import * as userSettings from '../../scripts/settings/userSettings';
import itemContextMenu from '../itemContextMenu';
import toast from '../toast/toast';
import { appRouter } from '../router/appRouter';
import { getDefaultBackgroundClass } from '../cardbuilder/utils/builder';
import { enableKeepScreenAwake, disableKeepScreenAwake } from './keepScreenAwake';

import '../cardbuilder/card.scss';
import '../../elements/emby-button/emby-button';
import '../../elements/emby-button/paper-icon-button-light';
import '../../elements/emby-itemscontainer/emby-itemscontainer';
import './remotecontrol.scss';
import '../../elements/emby-ratingbutton/emby-ratingbutton';
import '../../elements/emby-slider/emby-slider';

let showMuteButton = true;
let showVolumeSlider = true;

function showAudioMenu(context, player, button) {
    const currentIndex = playbackManager.getAudioStreamIndex(player);
    const streams = playbackManager.audioTracks(player);
    const menuItems = streams.map(function (s) {
        const menuItem = {
            name: s.DisplayTitle,
            id: s.Index
        };

        if (s.Index == currentIndex) {
            menuItem.selected = true;
        }

        return menuItem;
    });

    import('../actionSheet/actionSheet').then((actionsheet) => {
        actionsheet.show({
            items: menuItems,
            positionTo: button,
            callback: function (id) {
                playbackManager.setAudioStreamIndex(parseInt(id, 10), player);
            }
        }).catch(() => { /* closed without choosing */ });
    });
}

function showSubtitleMenu(context, player, button) {
    const currentIndex = playbackManager.getSubtitleStreamIndex(player);
    const streams = playbackManager.subtitleTracks(player);
    const menuItems = streams.map(function (s) {
        const menuItem = {
            name: s.DisplayTitle,
            id: s.Index
        };

        if (s.Index == currentIndex) {
            menuItem.selected = true;
        }

        return menuItem;
    });
    menuItems.unshift({
        id: -1,
        name: globalize.translate('Off'),
        selected: currentIndex == null
    });

    import('../actionSheet/actionSheet').then((actionsheet) => {
        actionsheet.show({
            items: menuItems,
            positionTo: button,
            callback: function (id) {
                playbackManager.setSubtitleStreamIndex(parseInt(id, 10), player);
            }
        }).catch(() => { /* closed without choosing */ });
    });
}

function updateNowPlayingInfo(context, state, serverId) {
    const item = state.NowPlayingItem;
    const displayName = item ?
        getItemTextLines(item).map(escapeHtml).join(' - ') :
        '';
    if (item) {
        const nowPlayingServerId = (item.ServerId || serverId);
        if (item.Type == 'AudioBook' || item.Type == 'Audio' || item.MediaStreams?.[0]?.Type == 'Audio') {
            let artistsSeries = '';
            let albumName = '';
            if (item.Artists != null) {
                if (item.ArtistItems != null) {
                    for (const artist of item.ArtistItems) {
                        artistsSeries += `<a class="button-link" is="emby-linkbutton" href="#/details?id=${artist.Id}&serverId=${nowPlayingServerId}">${escapeHtml(artist.Name)}</a>`;
                        if (artist !== item.ArtistItems.slice(-1)[0]) {
                            artistsSeries += ', ';
                        }
                    }
                } else if (item.Artists) {
                    // For some reason, Chromecast Player doesn't return a item.ArtistItems object, so we need to fallback
                    // to normal item.Artists item.
                    // TODO: Normalise fields returned by all the players
                    for (const artist of item.Artists) {
                        artistsSeries += `<a>${escapeHtml(artist)}</a>`;
                        if (artist !== item.Artists.slice(-1)[0]) {
                            artistsSeries += ', ';
                        }
                    }
                }
            }
            if (item.Album != null) {
                albumName = '<a class="button-link" is="emby-linkbutton" href="#/details?id=' + item.AlbumId + `&serverId=${nowPlayingServerId}">` + escapeHtml(item.Album) + '</a>';
            }
            context.querySelector('.nowPlayingAlbum').innerHTML = albumName;
            context.querySelector('.nowPlayingArtist').innerHTML = artistsSeries;
            context.querySelector('.nowPlayingSongName').innerText = item.Name;
        } else if (item.Type == 'Episode') {
            if (item.SeasonName != null) {
                const seasonName = item.SeasonName;
                context.querySelector('.nowPlayingSeason').innerHTML = '<a class="button-link" is="emby-linkbutton" href="#/details?id=' + item.SeasonId + `&serverId=${nowPlayingServerId}">${escapeHtml(seasonName)}</a>`;
            }
            if (item.SeriesName != null) {
                const seriesName = item.SeriesName;
                if (item.SeriesId != null) {
                    context.querySelector('.nowPlayingSerie').innerHTML = '<a class="button-link" is="emby-linkbutton" href="#/details?id=' + item.SeriesId + `&serverId=${nowPlayingServerId}">${escapeHtml(seriesName)}</a>`;
                } else {
                    context.querySelector('.nowPlayingSerie').innerText = seriesName;
                }
            }
            context.querySelector('.nowPlayingEpisode').innerText = item.Name;
        } else {
            context.querySelector('.nowPlayingPageTitle').innerHTML = displayName;
        }

        if (displayName.length > 0 && item.Type != 'Audio' && item.Type != 'Episode') {
            context.querySelector('.nowPlayingPageTitle').classList.remove('hide');
        } else {
            context.querySelector('.nowPlayingPageTitle').classList.add('hide');
        }

        const url = getImageUrl(item, {
            maxHeight: 300
        });

        let contextButton = context.querySelector('.btnToggleContextMenu');
        // We remove the previous event listener by replacing the item in each update event
        const autoFocusContextButton = document.activeElement === contextButton;
        const contextButtonClone = contextButton.cloneNode(true);
        contextButton.parentNode.replaceChild(contextButtonClone, contextButton);
        contextButton = context.querySelector('.btnToggleContextMenu');
        if (autoFocusContextButton) {
            contextButton.focus();
        }
        const options = {
            play: false,
            queue: false,
            stopPlayback: true,
            clearQueue: true,
            openAlbum: false,
            positionTo: contextButton
        };
        const apiClient = ServerConnections.getApiClient(item.ServerId);
        apiClient.getItem(apiClient.getCurrentUserId(), item.Id).then(function (fullItem) {
            apiClient.getCurrentUser().then(function (user) {
                contextButton.addEventListener('click', function () {
                    itemContextMenu.show(Object.assign({
                        item: fullItem,
                        user: user,
                        isMobile: layoutManager.mobile
                    }, options))
                        .catch(() => { /* no-op */ });
                });
            });
        });
        setImageUrl(context, state, url);
        setBackdrops([item]);
        apiClient.getItem(apiClient.getCurrentUserId(), item.Id).then(function (fullItem) {
            const userData = fullItem.UserData || {};
            const likes = userData.Likes == null ? '' : userData.Likes;
            context.querySelector('.nowPlayingPageUserDataButtonsTitle').innerHTML = '<button is="emby-ratingbutton" type="button" class="paper-icon-button-light" data-id="' + fullItem.Id + '" data-serverid="' + fullItem.ServerId + '" data-itemtype="' + fullItem.Type + '" data-likes="' + likes + '" data-isfavorite="' + userData.IsFavorite + '"><span class="material-icons favorite" aria-hidden="true"></span></button>';
            context.querySelector('.nowPlayingPageUserDataButtons').innerHTML = '<button is="emby-ratingbutton" type="button" class="paper-icon-button-light" data-id="' + fullItem.Id + '" data-serverid="' + fullItem.ServerId + '" data-itemtype="' + fullItem.Type + '" data-likes="' + likes + '" data-isfavorite="' + userData.IsFavorite + '"><span class="material-icons favorite" aria-hidden="true"></span></button>';
        });
    } else {
        clearBackdrop();
        context.querySelector('.nowPlayingPageUserDataButtons').innerHTML = '';
    }
}

function setImageUrl(context, state, url) {
    const item = state.NowPlayingItem;
    const imgContainer = context.querySelector('.nowPlayingPageImageContainer');

    if (url) {
        imgContainer.innerHTML = '<img class="nowPlayingPageImage" src="' + url + '" />';

        context.querySelector('.nowPlayingPageImage').classList.toggle('nowPlayingPageImageAudio', item.Type === 'Audio');
        context.querySelector('.nowPlayingPageImage').classList.toggle('nowPlayingPageImagePoster', item.Type !== 'Audio');
    } else {
        imgContainer.innerHTML = `<div class="nowPlayingPageImageContainerNoAlbum"><button data-action="${ItemAction.Link}" class="cardImageContainer coveredImage ${getDefaultBackgroundClass(item.Name)} cardContent cardContent-shadow itemAction"><span class="cardImageIcon material-icons album" aria-hidden="true"></span></button></div>`;
    }
}

function buttonVisible(btn, enabled) {
    if (enabled) {
        btn.classList.remove('hide');
    } else {
        btn.classList.add('hide');
    }
}

function updateSupportedCommands(context, commands) {
    const all = context.querySelectorAll('.btnCommand');

    for (let i = 0, length = all.length; i < length; i++) {
        const enableButton = commands.indexOf(all[i].getAttribute('data-command')) !== -1;
        all[i].disabled = !enableButton;
    }
}

export default function () {
    function toggleRepeat() {
        switch (playbackManager.getRepeatMode()) {
            case 'RepeatAll':
                playbackManager.setRepeatMode('RepeatOne');
                break;
            case 'RepeatOne':
                playbackManager.setRepeatMode('RepeatNone');
                break;
            case 'RepeatNone':
                playbackManager.setRepeatMode('RepeatAll');
        }
    }

    function updatePlayerState(player, context, state) {
        lastPlayerState = state;
        const item = state.NowPlayingItem;
        const playerInfo = playbackManager.getPlayerInfo();
        const supportedCommands = playerInfo.supportedCommands;
        currentPlayerSupportedCommands = supportedCommands;
        const playState = state.PlayState || {};
        const isSupportedCommands = supportedCommands.includes('DisplayMessage') || supportedCommands.includes('SendString') || supportedCommands.includes('Select');
        buttonVisible(context.querySelector('.btnToggleFullscreen'), item && item.MediaType == 'Video' && supportedCommands.includes('ToggleFullscreen'));
        updateAudioTracksDisplay(player, context);
        updateSubtitleTracksDisplay(player, context);

        if (supportedCommands.includes('DisplayMessage') && !currentPlayer.isLocalPlayer) {
            context.querySelector('.sendMessageSection').classList.remove('hide');
        } else {
            context.querySelector('.sendMessageSection').classList.add('hide');
        }

        if (supportedCommands.includes('SendString') && !currentPlayer.isLocalPlayer) {
            context.querySelector('.sendTextSection').classList.remove('hide');
        } else {
            context.querySelector('.sendTextSection').classList.add('hide');
        }

        if (supportedCommands.includes('Select') && !currentPlayer.isLocalPlayer) {
            context.querySelector('.navigationSection').classList.remove('hide');
        } else {
            context.querySelector('.navigationSection').classList.add('hide');
        }

        if (isSupportedCommands && !currentPlayer.isLocalPlayer) {
            context.querySelector('.remoteControlSection').classList.remove('hide');
        } else {
            context.querySelector('.remoteControlSection').classList.add('hide');
        }

        updateRemotePad(player, context, item);

        buttonVisible(context.querySelector('.btnLyrics'), item?.Type === 'Audio' && !layoutManager.mobile);
        buttonVisible(context.querySelector('.btnStop'), item != null);
        buttonVisible(context.querySelector('.btnNextTrack'), item != null);
        buttonVisible(context.querySelector('.btnPreviousTrack'), item != null);
        if (layoutManager.mobile) {
            const playingVideo = playbackManager.isPlayingVideo() && item != null;
            const playingAudio = !playbackManager.isPlayingVideo() && item != null;
            const playingAudioBook = playingAudio && item.Type == 'AudioBook';
            buttonVisible(context.querySelector('.btnRepeat'), playingAudio && !playingAudioBook);
            buttonVisible(context.querySelector('.btnShuffleQueue'), playingAudio && !playingAudioBook);
            buttonVisible(context.querySelector('.btnRewind'), playingVideo || playingAudioBook);
            buttonVisible(context.querySelector('.btnFastForward'), playingVideo || playingAudioBook);
            buttonVisible(context.querySelector('.nowPlayingSecondaryButtons .btnShuffleQueue'), playingVideo);
            buttonVisible(context.querySelector('.nowPlayingSecondaryButtons .btnRepeat'), playingVideo);
        } else {
            buttonVisible(context.querySelector('.btnRewind'), item != null);
            buttonVisible(context.querySelector('.btnFastForward'), item != null);
        }
        const positionSlider = context.querySelector('.nowPlayingPositionSlider');

        if (positionSlider && item && item.RunTimeTicks) {
            positionSlider.setKeyboardSteps(userSettings.skipBackLength() * 1000000 / item.RunTimeTicks,
                userSettings.skipForwardLength() * 1000000 / item.RunTimeTicks);
        }

        if (positionSlider && !positionSlider.dragging) {
            positionSlider.disabled = !playState.CanSeek;
            const isProgressClear = state.MediaSource && state.MediaSource.RunTimeTicks == null;
            positionSlider.setIsClear(isProgressClear);
        }

        updatePlayPauseState(playState.IsPaused, item != null);
        updateTimeDisplay(playState.PositionTicks, item ? item.RunTimeTicks : null);
        updatePlayerVolumeState(context, playState.IsMuted, playState.VolumeLevel);

        if (item && item.MediaType == 'Video') {
            context.classList.remove('hideVideoButtons');
        } else {
            context.classList.add('hideVideoButtons');
        }

        updateRepeatModeDisplay(playbackManager.getRepeatMode());
        onShuffleQueueModeChange(false);
        updateNowPlayingInfo(context, state);
    }

    // Remote pad: the default layout of this page, for controlling another
    // session and for video on this device. Only music playing on this device
    // keeps the stock player (a ring of subtitle/episode buttons is no use there).
    function updateRemotePad(player, context, item) {
        const isLocalMusic = currentPlayer?.isLocalPlayer && item?.MediaType === 'Audio';
        const padMode = !isLocalMusic;
        context.classList.toggle('remotePadMode', padMode);
        context.querySelector('.remotePad').classList.toggle('hide', !padMode);
        context.querySelector('.remotePadBackdrop').classList.toggle('hide', !padMode);
        placeProgressBar(context, padMode);

        if (!padMode) {
            leavePadMode();
            return;
        }

        if (!inPadMode) {
            inPadMode = true;
            enableKeepScreenAwake();
            // more room for the remote; double-tap empty space brings the bar back
            document.body.classList.add('remotePadHeaderHidden');
            lockViewport(true);
        }

        // nothing playing (or not reported yet): show the menu bar so there's
        // a way to go somewhere else
        if (!item) {
            document.body.classList.remove('remotePadHeaderHidden');
            return;
        }

        if (item.Id !== padItemId) {
            padItemId = item.Id;
            setBackdrop(context, item);
            loadAdjacentEpisodes(context, item);
        }

        const supportedCommands = currentPlayerSupportedCommands;
        const isVideo = item.MediaType == 'Video';
        buttonVisible(context.querySelector('.btnRemotePadSubtitles'), isVideo && supportedCommands.includes('SetSubtitleStreamIndex'));
        context.querySelector('.btnRemotePadSubtitles').disabled = !playbackManager.subtitleTracks(player).length;
        buttonVisible(context.querySelector('.btnRemotePadAudio'), supportedCommands.includes('SetAudioStreamIndex'));
        context.querySelector('.btnRemotePadAudio').disabled = playbackManager.audioTracks(player).length < 2;
        buttonVisible(context.querySelector('.btnRemotePadFullscreen'), isVideo && supportedCommands.includes('ToggleFullscreen'));
    }

    function leavePadMode() {
        if (inPadMode) {
            inPadMode = false;
            padItemId = null;
            disableKeepScreenAwake();
            document.body.classList.remove('remotePadHeaderHidden');
            lockViewport(false);
        }
    }

    // A remote shouldn't zoom or scroll under the thumb. iOS Safari ignores the
    // page's user-scalable=no, so pinch (gesturestart) and stray touchmoves are
    // cancelled while the pad is up; the progress slider and open menus still
    // get theirs.

    function preventDefault(e) {
        e.preventDefault();
    }

    function preventPageScroll(e) {
        if (!e.target.closest?.('.sliderContainer, .dialogContainer, .actionSheet')) {
            e.preventDefault();
        }
    }

    function lockViewport(lock) {
        if (lock) {
            document.documentElement.classList.add('remotePadLocked');
            document.addEventListener('gesturestart', preventDefault, { passive: false });
            document.addEventListener('touchmove', preventPageScroll, { passive: false });
        } else {
            document.documentElement.classList.remove('remotePadLocked');
            document.removeEventListener('gesturestart', preventDefault);
            document.removeEventListener('touchmove', preventPageScroll);
        }
    }

    // The pad shows the progress bar under the ring; move the stock one there
    // (and back) so its existing bindings keep working
    function placeProgressBar(context, padMode) {
        const bar = context.querySelector('.nowPlayingPositionSlider').closest('.sliderContainer');
        if (!progressBarHome) {
            progressBarHome = { parent: bar.parentNode, next: bar.nextSibling };
        }
        if (padMode) {
            context.querySelector('.remotePadProgress').appendChild(bar);
        } else if (bar.parentNode !== progressBarHome.parent) {
            progressBarHome.parent.insertBefore(bar, progressBarHome.next);
        }
    }

    function getRingIcon(context, action) {
        return context.querySelector(`.remoteRingIcon[data-icon-for="${action}"] .material-icons`);
    }

    function setRingButtonEnabled(context, action, enabled) {
        context.querySelector(`.remoteRingButton[data-action="${action}"]`).classList.toggle('disabled', !enabled);
        context.querySelector(`.remoteRingIcon[data-icon-for="${action}"]`).classList.toggle('disabled', !enabled);
    }

    // Blurred artwork behind the pad. The session's NowPlayingItem often lacks
    // image tags (episodes especially), so look the full item up.
    function setBackdrop(context, item) {
        const elem = context.querySelector('.remotePadBackdrop');
        elem.style.setProperty('--remotepad-art', 'none');
        const apiClient = ServerConnections.getApiClient(item.ServerId);
        apiClient.getItem(apiClient.getCurrentUserId(), item.Id).then(full => {
            if (full.Id !== padItemId) return;
            const image = (id, type, tag) => apiClient.getScaledImageUrl(id, { type, tag, maxWidth: 720 });
            let url = null;
            if (full.BackdropImageTags?.length) {
                url = image(full.Id, 'Backdrop', full.BackdropImageTags[0]);
            } else if (full.ParentBackdropItemId && full.ParentBackdropImageTags?.length) {
                url = image(full.ParentBackdropItemId, 'Backdrop', full.ParentBackdropImageTags[0]);
            } else if (full.ImageTags?.Primary) {
                url = image(full.Id, 'Primary', full.ImageTags.Primary);
            } else if (full.SeriesId && full.SeriesPrimaryImageTag) {
                url = image(full.SeriesId, 'Primary', full.SeriesPrimaryImageTag);
            }
            elem.style.setProperty('--remotepad-art', url ? `url("${url}")` : 'none');
        }).catch(err => {
            console.error('[remotecontrol] failed to load artwork', err);
        });
    }

    // Previous/next episode come from the series' episode order, so they work
    // even when the laptop's play queue only holds the current episode
    function loadAdjacentEpisodes(context, item) {
        adjacentEpisodes = {};
        setRingButtonEnabled(context, 'previousEpisode', false);
        setRingButtonEnabled(context, 'nextEpisode', false);
        if (item.Type !== 'Episode' || !item.SeriesId) return;

        const apiClient = ServerConnections.getApiClient(item.ServerId);
        apiClient.getEpisodes(item.SeriesId, {
            UserId: apiClient.getCurrentUserId(),
            AdjacentTo: item.Id
        }).then(result => {
            if (item.Id !== padItemId) return;
            const episodes = result.Items || [];
            const index = episodes.findIndex(e => e.Id === item.Id);
            adjacentEpisodes = {
                previous: index > 0 ? episodes[index - 1] : null,
                next: index !== -1 ? episodes[index + 1] : null
            };
            setRingButtonEnabled(context, 'previousEpisode', !!adjacentEpisodes.previous);
            setRingButtonEnabled(context, 'nextEpisode', !!adjacentEpisodes.next);
        }).catch(err => {
            console.error('[remotecontrol] failed to load adjacent episodes', err);
        });
    }

    function playOnTarget(item) {
        playbackManager.play({ ids: [item.Id], serverId: item.ServerId });
        toast(item.Name);
    }

    function playEpisode(which) {
        const episode = adjacentEpisodes[which];
        if (episode) {
            playOnTarget({ Id: episode.Id, Name: episode.Name, ServerId: lastPlayerState.NowPlayingItem.ServerId });
        }
    }

    // Random item from the same place: another episode of the same series, or
    // for anything else another item of the same type from the same library
    async function playRandom() {
        const item = lastPlayerState?.NowPlayingItem;
        if (!item) return;

        const apiClient = ServerConnections.getApiClient(item.ServerId);
        const userId = apiClient.getCurrentUserId();
        let parentId = item.SeriesId;
        if (item.Type !== 'Episode' || !parentId) {
            const ancestors = await apiClient.getAncestorItems(item.Id, userId);
            parentId = ancestors.find(a => a.Type === 'CollectionFolder')?.Id;
        }

        const result = await apiClient.getItems(userId, {
            ParentId: parentId,
            Recursive: true,
            IncludeItemTypes: item.Type,
            ExcludeItemIds: item.Id,
            SortBy: 'Random',
            Limit: 1
        });
        const pick = result.Items?.[0];
        if (pick) {
            playOnTarget({ Id: pick.Id, Name: pick.Name, ServerId: item.ServerId });
        } else {
            toast('Nothing else to play here');
        }
    }

    function showSpeedMenu(button) {
        const speeds = [0.5, 0.75, 1, 1.25, 1.5];
        import('../actionSheet/actionSheet').then(({ default: actionsheet }) => actionsheet.show({
            title: 'Playback speed',
            items: speeds.map(rate => ({ name: rate + 'x', id: String(rate), selected: rate === playbackRate })),
            positionTo: button
        })).then(id => {
            if (id) {
                playbackRate = parseFloat(id);
                sendPlayerKey('SetPlaybackRate', { Rate: id });
            }
        }).catch(() => { /* closed */ });
    }

    function showSettingsMenu(context, button) {
        import('../actionSheet/actionSheet').then(({ default: actionsheet }) => actionsheet.show({
            title: globalize.translate('Settings'),
            items: [
                { name: `Playback speed (${playbackRate}x)`, id: 'speed', icon: 'speed' },
                { name: document.body.classList.contains('remotePadHeaderHidden') ? 'Show menu bar' : 'Hide menu bar', id: 'header', icon: 'web_asset' },
                { name: 'Jellyfin settings', id: 'app', icon: 'settings' }
            ],
            positionTo: button
        })).then(id => {
            if (id === 'speed') {
                showSpeedMenu(button);
            } else if (id === 'header') {
                document.body.classList.toggle('remotePadHeaderHidden');
            } else if (id === 'app') {
                appRouter.showSettings();
            }
        }).catch(() => { /* closed */ });
    }

    // Double-tap on empty space (not a control) toggles the top bar
    function bindHeaderDoubleTap(context) {
        let lastTap = null;
        context.addEventListener('pointerup', (e) => {
            if (!inPadMode || e.target.closest('button, a, input, .remoteRingButton, .sliderContainer')) {
                lastTap = null;
                return;
            }
            const now = Date.now();
            if (lastTap && now - lastTap.time < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
                document.body.classList.toggle('remotePadHeaderHidden');
                lastTap = null;
            } else {
                lastTap = { time: now, x: e.clientX, y: e.clientY };
            }
        });
    }

    // Volume in big steps with an instant readout. The player's own volumeUp/Down
    // move 2% (inaudible), and a remote session only reports the new level back
    // ~1s later, so taps set an absolute level computed from the last one sent.
    const VOLUME_STEP = 10;

    function stepVolume(context, delta) {
        const reported = lastPlayerState?.PlayState?.VolumeLevel;
        const base = Date.now() < pendingVolumeUntil ? pendingVolume : (reported ?? 100);
        pendingVolume = Math.min(100, Math.max(0, Math.round(base + delta)));
        pendingVolumeUntil = Date.now() + 2500;
        playbackManager.setVolume(pendingVolume, currentPlayer);
        showVolumeBubble(context, pendingVolume);
    }

    function showVolumeBubble(context, level) {
        const bubble = context.querySelector('.remotePadVolumeBubble');
        const icon = bubble.querySelector('.remotePadVolumeIcon');
        icon.classList.toggle('volume_off', level === 0);
        icon.classList.toggle('volume_up', level !== 0);
        bubble.querySelector('.remotePadVolumeValue').textContent = level + '%';
        bubble.querySelector('.remotePadVolumeFill').style.width = level + '%';
        bubble.classList.add('visible');
        clearTimeout(volumeBubbleTimer);
        volumeBubbleTimer = setTimeout(() => bubble.classList.remove('visible'), 1200);
    }

    // SendKey commands this fork's video player understands (serverNotifications.js)
    // (for this device's own player the same actions are called directly)
    function sendPlayerKey(key, args = {}) {
        if (currentPlayer?.isLocalPlayer) {
            if (key === 'SetPlaybackRate') {
                playbackManager.setPlaybackRate(parseFloat(args.Rate), currentPlayer);
            } else {
                const method = key.charAt(0).toLowerCase() + key.slice(1);
                currentPlayer[method]?.();
            }
            return;
        }

        playbackManager.sendCommand({
            Name: 'SendKey',
            Arguments: { Key: key, ...args }
        }, currentPlayer);
    }

    function updateAudioTracksDisplay(player, context) {
        const supportedCommands = currentPlayerSupportedCommands;
        buttonVisible(context.querySelector('.btnAudioTracks'), playbackManager.audioTracks(player).length > 1 && supportedCommands.indexOf('SetAudioStreamIndex') != -1);
    }

    function updateSubtitleTracksDisplay(player, context) {
        const supportedCommands = currentPlayerSupportedCommands;
        buttonVisible(context.querySelector('.btnSubtitles'), playbackManager.subtitleTracks(player).length && supportedCommands.indexOf('SetSubtitleStreamIndex') != -1);
    }

    function updateRepeatModeDisplay(repeatMode) {
        const context = dlg;
        const toggleRepeatButtons = context.querySelectorAll('.repeatToggleButton');
        const cssClass = 'buttonActive';
        let innHtml = '<span class="material-icons repeat" aria-hidden="true"></span>';
        let repeatOn = true;

        switch (repeatMode) {
            case 'RepeatAll':
                break;
            case 'RepeatOne':
                innHtml = '<span class="material-icons repeat_one" aria-hidden="true"></span>';
                break;
            case 'RepeatNone':
            default:
                repeatOn = false;
                break;
        }

        for (const toggleRepeatButton of toggleRepeatButtons) {
            toggleRepeatButton.classList.toggle(cssClass, repeatOn);
            toggleRepeatButton.innerHTML = innHtml;
        }
    }

    function updatePlayerVolumeState(context, isMuted, volumeLevel) {
        const view = context;
        const supportedCommands = currentPlayerSupportedCommands;

        if (supportedCommands.indexOf('Mute') === -1) {
            showMuteButton = false;
        }

        if (supportedCommands.indexOf('SetVolume') === -1) {
            showVolumeSlider = false;
        }

        if (currentPlayer.isLocalPlayer && appHost.supports(AppFeature.PhysicalVolumeControl)) {
            showMuteButton = false;
            showVolumeSlider = false;
        }

        const buttonMute = view.querySelector('.buttonMute');
        const buttonMuteIcon = buttonMute.querySelector('.material-icons');

        buttonMuteIcon.classList.remove('volume_off', 'volume_up');

        if (isMuted) {
            buttonMute.setAttribute('title', globalize.translate('Unmute'));
            buttonMuteIcon.classList.add('volume_off');
        } else {
            buttonMute.setAttribute('title', globalize.translate('Mute'));
            buttonMuteIcon.classList.add('volume_up');
        }

        if (!showMuteButton && !showVolumeSlider) {
            context.querySelector('.volumecontrol').classList.add('hide');
        } else {
            buttonMute.classList.toggle('hide', !showMuteButton);

            const nowPlayingVolumeSlider = context.querySelector('.nowPlayingVolumeSlider');
            const nowPlayingVolumeSliderContainer = context.querySelector('.nowPlayingVolumeSliderContainer');

            if (nowPlayingVolumeSlider) {
                nowPlayingVolumeSliderContainer.classList.toggle('hide', !showVolumeSlider);

                if (!nowPlayingVolumeSlider.dragging) {
                    nowPlayingVolumeSlider.value = volumeLevel || 0;
                }
            }
        }
    }

    function updatePlayPauseState(isPaused, isActive) {
        const context = dlg;
        const btnPlayPause = context.querySelector('.btnPlayPause');
        const btnPlayPauseIcon = btnPlayPause.querySelector('.material-icons');

        btnPlayPauseIcon.classList.remove('play_circle_filled', 'pause_circle_filled');
        btnPlayPauseIcon.classList.add(isPaused ? 'play_circle_filled' : 'pause_circle_filled');

        const padPlayIcon = getRingIcon(context, 'playPause');
        padPlayIcon.classList.toggle('play_arrow', !!isPaused);
        padPlayIcon.classList.toggle('pause', !isPaused);

        const playlistIndicator = context.querySelector('.playlistIndexIndicatorImage');
        if (playlistIndicator) {
            playlistIndicator.classList.toggle('playlistIndexIndicatorPausedImage', isPaused);
        }

        buttonVisible(btnPlayPause, isActive);
    }

    function updateTimeDisplay(positionTicks, runtimeTicks) {
        const context = dlg;
        const positionSlider = context.querySelector('.nowPlayingPositionSlider');

        if (positionSlider && !positionSlider.dragging) {
            if (runtimeTicks) {
                let pct = positionTicks / runtimeTicks;
                pct *= 100;
                positionSlider.value = pct;
            } else {
                positionSlider.value = 0;
            }
        }

        const arc = context.querySelector('.remoteRingArc');
        const arcPct = runtimeTicks ? Math.min(100, Math.max(0, positionTicks / runtimeTicks * 100)) : 0;
        arc.setAttribute('stroke-dasharray', `${arcPct} 100`);

        context.querySelector('.positionTime').innerHTML = Number.isFinite(positionTicks) ? datetime.getDisplayRunningTime(positionTicks) : '--:--';
        context.querySelector('.runtime').innerHTML = Number.isFinite(runtimeTicks) ? datetime.getDisplayRunningTime(runtimeTicks) : '--:--';
    }

    function getPlaylistItems(player) {
        return playbackManager.getPlaylist(player);
    }

    function loadPlaylist(context, player) {
        getPlaylistItems(player).then(function (items) {
            if (items.length === 0) {
                return;
            }

            let html = '';
            let favoritesEnabled = true;
            if (layoutManager.mobile) {
                if (items.length > 0) {
                    context.querySelector('.btnTogglePlaylist').classList.remove('hide');
                } else {
                    context.querySelector('.btnTogglePlaylist').classList.add('hide');
                }
                favoritesEnabled = false;
            }

            html += listView.getListViewHtml({
                items: items,
                smallIcon: true,
                action: 'setplaylistindex',
                enableUserDataButtons: favoritesEnabled,
                rightButtons: [{
                    icon: 'remove_circle_outline',
                    title: globalize.translate('ButtonRemove'),
                    id: 'remove'
                }],
                dragHandle: true
            });

            const itemsContainer = context.querySelector('.playlist');
            let focusedItemPlaylistId = itemsContainer.querySelector('button:focus');
            itemsContainer.innerHTML = html;
            if (focusedItemPlaylistId !== null) {
                focusedItemPlaylistId = focusedItemPlaylistId.getAttribute('data-playlistitemid');
                const newFocusedItem = itemsContainer.querySelector(`button[data-playlistitemid="${focusedItemPlaylistId}"]`);
                if (newFocusedItem !== null) {
                    newFocusedItem.focus();
                }
            }

            const playlistItemId = playbackManager.getCurrentPlaylistItemId(player);

            if (playlistItemId) {
                const img = itemsContainer.querySelector(`.listItem[data-playlistItemId="${playlistItemId}"] .listItemImage`);

                if (img) {
                    img.classList.remove('lazy');
                    img.classList.add('playlistIndexIndicatorImage');
                    img.classList.toggle('playlistIndexIndicatorPausedImage', playbackManager.paused());
                }
            }

            imageLoader.lazyChildren(itemsContainer);
        });
    }

    function onPlaybackStart(e, state) {
        console.debug('remotecontrol event: ' + e.type);
        const player = this;
        onStateChanged.call(player, e, state);
    }

    function onRepeatModeChange() {
        updateRepeatModeDisplay(playbackManager.getRepeatMode());
    }

    function onShuffleQueueModeChange(updateView = true) {
        const shuffleMode = playbackManager.getQueueShuffleMode(this);
        const context = dlg;
        const cssClass = 'buttonActive';
        const shuffleButtons = context.querySelectorAll('.btnShuffleQueue');

        for (const shuffleButton of shuffleButtons) {
            switch (shuffleMode) {
                case 'Shuffle':
                    shuffleButton.classList.add(cssClass);
                    break;
                case 'Sorted':
                default:
                    shuffleButton.classList.remove(cssClass);
                    break;
            }
        }

        if (updateView) {
            onPlaylistUpdate();
        }
    }

    function onPlaylistUpdate() {
        loadPlaylist(dlg, this);
    }

    function onPlaylistItemRemoved(e, info) {
        const context = dlg;
        if (info !== undefined) {
            const playlistItemIds = info.playlistItemIds;

            for (let i = 0, length = playlistItemIds.length; i < length; i++) {
                const listItem = context.querySelector('.listItem[data-playlistItemId="' + playlistItemIds[i] + '"]');

                if (listItem) {
                    listItem.parentNode.removeChild(listItem);
                }
            }
        } else {
            onPlaylistUpdate();
        }
    }

    function onPlaybackStopped(e, state) {
        console.debug('remotecontrol event: ' + e.type);
        const player = this;

        if (!state.NextMediaType) {
            updatePlayerState(player, dlg, {});
            appRouter.back();
        }
    }

    function onPlayPauseStateChanged() {
        updatePlayPauseState(this.paused(), true);
    }

    function onStateChanged(event, state) {
        const player = this;
        updatePlayerState(player, dlg, state);
        onPlaylistUpdate();
    }

    function onTimeUpdate() {
        const now = new Date().getTime();

        if (now - lastUpdateTime >= 700) {
            lastUpdateTime = now;
            const player = this;
            currentRuntimeTicks = playbackManager.duration(player);
            updateTimeDisplay(playbackManager.currentTime(player) * 10000, currentRuntimeTicks);
        }
    }

    function onVolumeChanged() {
        const player = this;
        updatePlayerVolumeState(dlg, player.isMuted(), player.getVolume());
    }

    function releaseCurrentPlayer() {
        const player = currentPlayer;

        if (player) {
            Events.off(player, 'playbackstart', onPlaybackStart);
            Events.off(player, 'statechange', onStateChanged);
            Events.off(player, 'repeatmodechange', onRepeatModeChange);
            Events.off(player, 'shufflequeuemodechange', onShuffleQueueModeChange);
            Events.off(player, 'playlistitemremove', onPlaylistItemRemoved);
            Events.off(player, 'playlistitemmove', onPlaylistUpdate);
            Events.off(player, 'playlistitemadd', onPlaylistUpdate);
            Events.off(player, 'playbackstop', onPlaybackStopped);
            Events.off(player, 'volumechange', onVolumeChanged);
            Events.off(player, 'pause', onPlayPauseStateChanged);
            Events.off(player, 'unpause', onPlayPauseStateChanged);
            Events.off(player, 'timeupdate', onTimeUpdate);
            currentPlayer = null;
        }
    }

    function bindToPlayer(context, player) {
        releaseCurrentPlayer();
        currentPlayer = player;

        if (player) {
            const state = playbackManager.getPlayerState(player);
            onStateChanged.call(player, {
                type: 'init'
            }, state);
            Events.on(player, 'playbackstart', onPlaybackStart);
            Events.on(player, 'statechange', onStateChanged);
            Events.on(player, 'repeatmodechange', onRepeatModeChange);
            Events.on(player, 'shufflequeuemodechange', onShuffleQueueModeChange);
            Events.on(player, 'playlistitemremove', onPlaylistItemRemoved);
            Events.on(player, 'playlistitemmove', onPlaylistUpdate);
            Events.on(player, 'playlistitemadd', onPlaylistUpdate);
            Events.on(player, 'playbackstop', onPlaybackStopped);
            Events.on(player, 'volumechange', onVolumeChanged);
            Events.on(player, 'pause', onPlayPauseStateChanged);
            Events.on(player, 'unpause', onPlayPauseStateChanged);
            Events.on(player, 'timeupdate', onTimeUpdate);
            const playerInfo = playbackManager.getPlayerInfo();
            const supportedCommands = playerInfo.supportedCommands;
            currentPlayerSupportedCommands = supportedCommands;
            updateSupportedCommands(context, supportedCommands);
        }
    }

    function onBtnCommandClick() {
        if (currentPlayer) {
            if (this.classList.contains('repeatToggleButton')) {
                toggleRepeat();
            } else {
                playbackManager.sendCommand({
                    Name: this.getAttribute('data-command')
                }, currentPlayer);
            }
        }
    }

    function getSaveablePlaylistItems() {
        return getPlaylistItems(currentPlayer).then(function (items) {
            return items.filter(function (i) {
                return i.Id && i.ServerId;
            });
        });
    }

    function savePlaylist() {
        import('../playlisteditor/playlisteditor').then(({ default: PlaylistEditor }) => {
            getSaveablePlaylistItems().then(function (items) {
                const serverId = items.length ? items[0].ServerId : ServerConnections.currentApiClient().serverId();
                const playlistEditor = new PlaylistEditor();
                playlistEditor.show({
                    items: items.map(function (i) {
                        return i.Id;
                    }),
                    serverId: serverId,
                    enableAddToPlayQueue: false,
                    defaultValue: 'new'
                }).catch(() => {
                    // Dialog closed
                });
            });
        }).catch(err => {
            console.error('[savePlaylist] failed to load playlist editor', err);
        });
    }

    function bindRemotePadEvents(context) {
        const ringActions = {
            volumeUp: () => stepVolume(context, VOLUME_STEP),
            volumeDown: () => stepVolume(context, -VOLUME_STEP),
            previousSubtitle: () => sendPlayerKey('PreviousSubtitleCue'),
            repeatSubtitle: () => sendPlayerKey('RepeatSubtitleCue'),
            nextSubtitle: () => sendPlayerKey('NextSubtitleCue'),
            rewind: () => playbackManager.rewind(currentPlayer),
            fastForward: () => playbackManager.fastForward(currentPlayer),
            playPause: () => playbackManager.playPause(currentPlayer),
            previousEpisode: () => playEpisode('previous'),
            nextEpisode: () => playEpisode('next')
        };

        for (const btn of context.querySelectorAll('.remoteRingButton')) {
            btn.addEventListener('pointerdown', () => btn.classList.add('pressed'));
            for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
                btn.addEventListener(type, () => btn.classList.remove('pressed'));
            }
            btn.addEventListener('click', () => {
                if (currentPlayer) {
                    ringActions[btn.getAttribute('data-action')]();
                }
            });
            btn.addEventListener('keydown', (e) => {
                if ((e.key === 'Enter' || e.key === ' ') && currentPlayer) {
                    e.preventDefault();
                    ringActions[btn.getAttribute('data-action')]();
                }
            });
        }

        const onClick = (selector, fn) => {
            context.querySelector(selector).addEventListener('click', function (e) {
                if (currentPlayer) {
                    fn(e);
                }
            });
        };

        onClick('.btnRemotePadStop', () => playbackManager.stop(currentPlayer));
        onClick('.btnRemotePadShuffle', () => {
            playRandom().catch(err => {
                console.error('[remotecontrol] failed to pick a random item', err);
            });
        });
        onClick('.btnRemotePadSettings', (e) => showSettingsMenu(context, e.currentTarget));
        bindHeaderDoubleTap(context);
        onClick('.btnRemotePadFullscreen', () => playbackManager.toggleFullscreen(currentPlayer));
        onClick('.btnRemotePadSubtitles', (e) => {
            if (lastPlayerState?.NowPlayingItem) {
                showSubtitleMenu(context, currentPlayer, e.currentTarget);
            }
        });
        onClick('.btnRemotePadAudio', (e) => {
            if (lastPlayerState?.NowPlayingItem) {
                showAudioMenu(context, currentPlayer, e.currentTarget);
            }
        });
    }

    function bindEvents(context) {
        const btnCommand = context.querySelectorAll('.btnCommand');
        const positionSlider = context.querySelector('.nowPlayingPositionSlider');

        for (let i = 0, length = btnCommand.length; i < length; i++) {
            btnCommand[i].addEventListener('click', onBtnCommandClick);
        }

        context.querySelector('.btnToggleFullscreen').addEventListener('click', function () {
            if (currentPlayer) {
                playbackManager.toggleFullscreen(currentPlayer);
            }
        });
        context.querySelector('.btnAudioTracks').addEventListener('click', function (e) {
            if (currentPlayer && lastPlayerState?.NowPlayingItem) {
                showAudioMenu(context, currentPlayer, e.target);
            }
        });
        context.querySelector('.btnSubtitles').addEventListener('click', function (e) {
            if (currentPlayer && lastPlayerState?.NowPlayingItem) {
                showSubtitleMenu(context, currentPlayer, e.target);
            }
        });
        context.querySelector('.btnStop').addEventListener('click', function () {
            if (currentPlayer) {
                playbackManager.stop(currentPlayer);
            }
        });
        context.querySelector('.btnPlayPause').addEventListener('click', function () {
            if (currentPlayer) {
                playbackManager.playPause(currentPlayer);
            }
        });
        context.querySelector('.btnNextTrack').addEventListener('click', function () {
            if (currentPlayer) {
                playbackManager.nextTrack(currentPlayer);
            }
        });
        context.querySelector('.btnRewind').addEventListener('click', function () {
            if (currentPlayer) {
                playbackManager.rewind(currentPlayer);
            }
        });
        context.querySelector('.btnFastForward').addEventListener('click', function () {
            if (currentPlayer) {
                playbackManager.fastForward(currentPlayer);
            }
        });
        bindRemotePadEvents(context);

        context.querySelector('.btnLyrics').addEventListener('click', function () {
            appRouter.show('lyrics');
        });

        for (const shuffleButton of context.querySelectorAll('.btnShuffleQueue')) {
            shuffleButton.addEventListener('click', function () {
                if (currentPlayer) {
                    playbackManager.toggleQueueShuffleMode(currentPlayer);
                }
            });
        }

        context.querySelector('.btnPreviousTrack').addEventListener('click', function (e) {
            if (currentPlayer) {
                if (playbackManager.isPlayingAudio(currentPlayer)) {
                    // Cancel this event if doubleclick is fired. The actual previousTrack will be processed by the 'dblclick' event
                    if (e.detail > 1 ) {
                        return;
                    }

                    // Return to start of track, unless we are already (almost) at the beginning. In the latter case, continue and move
                    // to the previous track, unless we are at the first track so no previous track exists.
                    // currentTime is in msec.

                    if (playbackManager.currentTime(currentPlayer) >= 5 * 1000 || playbackManager.getCurrentPlaylistIndex(currentPlayer) <= 0) {
                        playbackManager.seekPercent(0, currentPlayer);
                        // This is done automatically by playbackManager, however, setting this here gives instant visual feedback.
                        // TODO: Check why seekPercent doesn't reflect the changes inmmediately, so we can remove this workaround.
                        positionSlider.value = 0;
                        return;
                    }
                }
                playbackManager.previousTrack(currentPlayer);
            }
        });

        context.querySelector('.btnPreviousTrack').addEventListener('dblclick', function () {
            if (currentPlayer) {
                playbackManager.previousTrack(currentPlayer);
            }
        });
        positionSlider.addEventListener('change', function () {
            const value = this.value;

            if (currentPlayer) {
                const newPercent = parseFloat(value);
                playbackManager.seekPercent(newPercent, currentPlayer);
            }
        });

        positionSlider.getBubbleText = function (value) {
            const state = lastPlayerState;

            if (!state?.NowPlayingItem || !currentRuntimeTicks) {
                return '--:--';
            }

            let ticks = currentRuntimeTicks;
            ticks /= 100;
            ticks *= value;
            return datetime.getDisplayRunningTime(ticks);
        };

        context.querySelector('.nowPlayingVolumeSlider').addEventListener('input', (e) => {
            playbackManager.setVolume(e.target.value, currentPlayer);
        });

        context.querySelector('.buttonMute').addEventListener('click', function () {
            playbackManager.toggleMute(currentPlayer);
        });
        const playlistContainer = context.querySelector('.playlist');
        playlistContainer.addEventListener('action-remove', function (e) {
            playbackManager.removeFromPlaylist([e.detail.playlistItemId], currentPlayer);
        });
        playlistContainer.addEventListener('itemdrop', function (e) {
            const newIndex = e.detail.newIndex;
            const playlistItemId = e.detail.playlistItemId;
            playbackManager.movePlaylistItem(playlistItemId, newIndex, currentPlayer);
        });
        context.querySelector('.btnSavePlaylist').addEventListener('click', savePlaylist);
        context.querySelector('.btnTogglePlaylist').addEventListener('click', function () {
            if (context.querySelector('.playlist').classList.contains('hide')) {
                context.querySelector('.playlist').classList.remove('hide');
                context.querySelector('.btnSavePlaylist').classList.remove('hide');
                context.querySelector('.volumecontrol').classList.add('hide');
                if (layoutManager.mobile) {
                    context.querySelector('.playlistSectionButton').classList.remove('playlistSectionButtonTransparent');
                }
            } else {
                context.querySelector('.playlist').classList.add('hide');
                context.querySelector('.btnSavePlaylist').classList.add('hide');
                if (showMuteButton || showVolumeSlider) {
                    context.querySelector('.volumecontrol').classList.remove('hide');
                }
                if (layoutManager.mobile) {
                    context.querySelector('.playlistSectionButton').classList.add('playlistSectionButtonTransparent');
                }
            }
        });
    }

    function onPlayerChange() {
        bindToPlayer(dlg, playbackManager.getCurrentPlayer());
    }

    function onMessageSubmit(e) {
        const form = e.target;
        playbackManager.sendCommand({
            Name: 'DisplayMessage',
            Arguments: {
                Header: form.querySelector('#txtMessageTitle').value,
                Text: form.querySelector('#txtMessageText', form).value
            }
        }, currentPlayer);
        form.querySelector('input').value = '';

        toast(globalize.translate('MessageSent'));

        e.preventDefault();
        e.stopPropagation();
        return false;
    }

    function onSendStringSubmit(e) {
        const form = e.target;
        playbackManager.sendCommand({
            Name: 'SendString',
            Arguments: {
                String: form.querySelector('#txtTypeText', form).value
            }
        }, currentPlayer);
        form.querySelector('input').value = '';

        toast(globalize.translate('TextSent'));

        e.preventDefault();
        e.stopPropagation();
        return false;
    }

    function init(ownerView, context) {
        let volumecontrolHtml = '<div class="volumecontrol flex align-items-center flex-wrap-wrap justify-content-center">';
        volumecontrolHtml += `<button is="paper-icon-button-light" class="buttonMute autoSize" title=${globalize.translate('Mute')}><span class="xlargePaperIconButton material-icons volume_up" aria-hidden="true"></span></button>`;
        volumecontrolHtml += '<div class="sliderContainer nowPlayingVolumeSliderContainer"><input is="emby-slider" type="range" step="1" min="0" max="100" value="0" class="nowPlayingVolumeSlider"/></div>';
        volumecontrolHtml += '</div>';
        const optionsSection = context.querySelector('.playlistSectionButton');
        if (!layoutManager.mobile) {
            context.querySelector('.nowPlayingSecondaryButtons').insertAdjacentHTML('beforeend', volumecontrolHtml);
            optionsSection.classList.remove('align-items-center', 'justify-content-center');
            optionsSection.classList.add('align-items-right', 'justify-content-flex-end');
            context.querySelector('.playlist').classList.remove('hide');
            context.querySelector('.btnSavePlaylist').classList.remove('hide');
            context.classList.add('padded-bottom');
        } else {
            optionsSection.querySelector('.btnTogglePlaylist').insertAdjacentHTML('afterend', volumecontrolHtml);
            optionsSection.classList.add('playlistSectionButtonTransparent');
            context.querySelector('.btnTogglePlaylist').classList.remove('hide');
            context.querySelector('.playlistSectionButton').classList.remove('justify-content-center');
            context.querySelector('.playlistSectionButton').classList.add('justify-content-space-between');
        }

        bindEvents(context);
        // the pad is the default layout, so the progress bar starts under the ring
        placeProgressBar(context, true);
        context.querySelector('.sendMessageForm').addEventListener('submit', onMessageSubmit);
        context.querySelector('.typeTextForm').addEventListener('submit', onSendStringSubmit);

        if (layoutManager.tv) {
            const positionSlider = context.querySelector('.nowPlayingPositionSlider');
            positionSlider.classList.add('focusable');
            positionSlider.enableKeyboardDragging();
        }
    }

    function onDialogClosed() {
        leavePadMode();
        releaseCurrentPlayer();
        Events.off(playbackManager, 'playerchange', onPlayerChange);
        lastPlayerState = null;
    }

    function onShow(context) {
        // Subscribe here, not in init(): init runs once per node but hide/show repeat.
        Events.off(playbackManager, 'playerchange', onPlayerChange);
        Events.on(playbackManager, 'playerchange', onPlayerChange);
        bindToPlayer(context, playbackManager.getCurrentPlayer());
    }

    let dlg;
    let currentPlayer;
    let lastPlayerState;
    let currentPlayerSupportedCommands = [];
    let lastUpdateTime = 0;
    let currentRuntimeTicks = 0;
    let progressBarHome;
    let padItemId;
    let inPadMode = false;
    let adjacentEpisodes = {};
    let playbackRate = 1;
    let pendingVolume = 100;
    let pendingVolumeUntil = 0;
    let volumeBubbleTimer;
    const self = this;

    self.init = function (ownerView, context) {
        dlg = context;
        init(ownerView, dlg);
    };

    self.onShow = function () {
        onShow(dlg);
    };

    self.destroy = function () {
        onDialogClosed();
    };
}
