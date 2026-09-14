var EventEmitter = require('eventemitter3');
var cloneDeep = require('lodash.clonedeep');
var deepFreeze = require('deep-freeze');
var ERROR = require('../error');

var SUBS_SCALE_FACTOR = 0.0066;
var EOF_END_TOLERANCE = 60000;
var EXTRA_SUBTITLE_TITLE_PREFIX = 'STREMIO_EXTRA_SUBTITLE:';
var nativeExtraSubtitleProps = [
    'extraSubtitlesTracks',
    'selectedExtraSubtitlesTrackId',
    'selectedSecondarySubtitlesTrackId',
    'selectedSecondaryExtraSubtitlesTrackId',
    'extraSubtitlesDelay',
    'secondarySubtitlesDelay',
    'extraSubtitlesSize',
    'extraSubtitlesOffset',
    'extraSubtitlesTextColor',
    'extraSubtitlesBackgroundColor',
    'extraSubtitlesOutlineColor',
];

var stremioToMPVProps = {
    'loaded': 'loaded',
    'stream': null,
    'paused': 'pause',
    'time': 'time-pos',
    'duration': 'duration',
    'buffering': 'buffering',
    'buffered': 'demuxer-cache-time',
    'volume': 'volume',
    'muted': 'mute',
    'playbackSpeed': 'speed',
    'audioTracks': 'audioTracks',
    'selectedAudioTrackId': 'aid',
    'subtitlesTracks': 'subtitlesTracks',
    'selectedSubtitlesTrackId': 'sid',
    'subtitlesSize': 'sub-scale',
    'subtitlesOffset': 'sub-pos',
    'subtitlesDelay': 'sub-delay',
    'subtitlesTextColor': 'sub-color',
    'subtitlesBackgroundColor': 'sub-back-color',
    'subtitlesOutlineColor': 'sub-border-color',
    'assSubtitlesStylingActive': null,
    'hdrInfo': null,
    'videoScale': null,
};

function parseVersion(version) {
    return version.split('.').slice(0, 2).map(function (v) { return parseInt(v); });
}

function versionGTE(a, b) {
    var versionA = parseVersion(a);
    var versionB = parseVersion(b);
    if (versionA[0] > versionB[0]) return true;
    if (versionA[0] < versionB[0]) return false;
    return versionA[1] >= versionB[1];
}

function ShellVideo(options) {
    options = options || {};

    var ipc = options.shellTransport;
    var observedProps = {};
    var props = {};
    var stremioProps = {};
    Object.keys(stremioToMPVProps).forEach(function(key) {
        if(stremioToMPVProps[key]) {
            stremioProps[stremioToMPVProps[key]] = key;
        }
    });
    var resolveMPVVersion;
    var waitForMPVVersion = new Promise(function (resolve) {
        resolveMPVVersion = resolve;
    });
    command('unload');

    ipc.send('mpv-command', ['stop']);
    ipc.send('mpv-observe-prop', 'path');

    ipc.send('mpv-observe-prop', 'time-pos');
    ipc.send('mpv-observe-prop', 'volume');
    ipc.send('mpv-observe-prop', 'pause');
    ipc.send('mpv-observe-prop', 'seeking');
    ipc.send('mpv-observe-prop', 'eof-reached');

    ipc.send('mpv-observe-prop', 'duration');
    ipc.send('mpv-observe-prop', 'metadata');
    ipc.send('mpv-observe-prop', 'video-params'); // video width/height
    ipc.send('mpv-observe-prop', 'track-list');

    ipc.send('mpv-observe-prop', 'paused-for-cache');
    ipc.send('mpv-observe-prop', 'cache-buffering-state');
    ipc.send('mpv-observe-prop', 'demuxer-cache-time');

    ipc.send('mpv-observe-prop', 'aid');
    ipc.send('mpv-observe-prop', 'vid');
    ipc.send('mpv-observe-prop', 'sid');
    ipc.send('mpv-observe-prop', 'secondary-sid');
    ipc.send('mpv-observe-prop', 'secondary-sub-delay');
    ipc.send('mpv-observe-prop', 'sub-scale');
    ipc.send('mpv-observe-prop', 'sub-pos');
    ipc.send('mpv-observe-prop', 'sub-delay');
    ipc.send('mpv-observe-prop', 'speed');

    ipc.send('mpv-observe-prop', 'mpv-version');
    ipc.send('mpv-observe-prop', 'ffmpeg-version');

    var events = new EventEmitter();
    var destroyed = false;
    var stream = null;
    var assSubtitlesStylingEnabled = false;
    var pendingExtraSubtitleTracks = Object.create(null);
    var appliedPrimaryExtraMpvId = null;
    var appliedSecondaryExtraMpvId = null;

    var avgDuration = 0;
    var durationReady = false;
    var minClipDuration = 30;
    var activeVideoReadyLoadId = null;
    var videoReadyEventsSupported = false;

    function setBackground(visible) {
        // This is a bit of a hack but there is no better way so far
        var bg = visible ? '' : 'transparent';
        for(var container = options.containerElement; container; container = container.parentElement) {
            container.style.background = bg;
        }
        if (((window || {}).document || {}).getElementsByTagName) {
            var body = window.document.getElementsByTagName('body');
            if ((body || [])[0]) {
                body[0].style.background = bg;
            }
        }
    }
    // Preserve loading for legacy shells that do not emit mpv-event-video-ready.
    function updateLoaded() {
        if (!videoReadyEventsSupported && !props.loaded && durationReady && props['video-params'] && props['paused-for-cache'] === false) {
            props.loaded = true;
            setBackground(false);
            onPropChanged('loaded');
        }
    }
    function logProp(args) {
        // eslint-disable-next-line no-console
        console.log(args.name+': '+args.data);
    }
    function embeddedProp(args) {
        return args.data && args.data !== 'no' ? 'EMBEDDED_' + args.data.toString() : null;
    }
    function getSelectedSubtitleTrack() {
        if (typeof props.sid !== 'string' || !props.sid.startsWith('EMBEDDED_') || !Array.isArray(props['track-list'])) {
            return null;
        }

        var selectedId = props.sid.slice('EMBEDDED_'.length);
        return props['track-list'].find(function(track) {
            return track.type === 'sub' && String(track.id) === selectedId;
        }) || null;
    }
    function applySubtitleStyle() {
        if (stream === null) {
            return;
        }

        if (props.assSubtitlesStylingActive) {
            ipc.send('mpv-set-prop', ['sub-scale', 1]);
            ipc.send('mpv-set-prop', ['sub-pos', 100]);
            return;
        }
        if (typeof props.subtitlesSize === 'number') {
            ipc.send('mpv-set-prop', ['sub-scale', props.subtitlesSize * SUBS_SCALE_FACTOR]);
        }
        if (typeof props.subtitlesOffset === 'number') {
            ipc.send('mpv-set-prop', ['sub-pos', 100 - props.subtitlesOffset]);
        }
    }
    function updateASSSubtitlesStylingActive() {
        var track = getSelectedSubtitleTrack();
        var codec = track && typeof track.codec === 'string' ? track.codec.toLowerCase() : null;
        var active = assSubtitlesStylingEnabled && (codec === 'ass' || codec === 'ssa');
        if (props.assSubtitlesStylingActive !== active) {
            props.assSubtitlesStylingActive = active;
            applySubtitleStyle();
            onPropChanged('assSubtitlesStylingActive');
        }
    }
    function getNativeExtraTrack(id) {
        return Array.isArray(props.extraSubtitlesTracks) ? props.extraSubtitlesTracks.find(function(track) {
            return track.id === id;
        }) || null : null;
    }
    function getExtraTrackIdFromMpvTrack(track) {
        if (!track || track.type !== 'sub' || typeof track.title !== 'string' || !track.title.startsWith(EXTRA_SUBTITLE_TITLE_PREFIX)) {
            return null;
        }
        try {
            return decodeURIComponent(track.title.slice(EXTRA_SUBTITLE_TITLE_PREFIX.length));
        } catch (_) {
            return null;
        }
    }
    function getExtraTrackIdByMpvId(mpvId) {
        if (mpvId === null || mpvId === undefined || !Array.isArray(props['track-list'])) {
            return null;
        }
        var mpvIdString = String(mpvId);
        var track = props['track-list'].find(function(item) {
            return item.type === 'sub' && String(item.id) === mpvIdString;
        });
        return getExtraTrackIdFromMpvTrack(track);
    }
    function getExtraMpvTrackId(id) {
        if (!id || !Array.isArray(props['track-list'])) {
            return null;
        }
        var track = props['track-list'].find(function(item) {
            return getExtraTrackIdFromMpvTrack(item) === id;
        });
        return track ? track.id : null;
    }
    function hasSecondarySubtitleSelection() {
        return typeof props.selectedSecondarySubtitlesTrackId === 'string' ||
            typeof props.selectedSecondaryExtraSubtitlesTrackId === 'string';
    }
    function getGlobalSubtitleDelay() {
        return typeof props.extraSubtitlesDelay === 'number' && isFinite(props.extraSubtitlesDelay) ? props.extraSubtitlesDelay : 0;
    }
    function getSecondarySubtitleDelay() {
        return typeof props.secondarySubtitlesDelay === 'number' && isFinite(props.secondarySubtitlesDelay) ? props.secondarySubtitlesDelay : 0;
    }
    function applySharedSubtitleDelay() {
        if (stream === null) {
            return;
        }
        var globalDelay = getGlobalSubtitleDelay();
        ipc.send('mpv-set-prop', ['sub-delay', globalDelay / 1000]);
        if (hasSecondarySubtitleSelection()) {
            ipc.send('mpv-set-prop', ['secondary-sub-delay', (globalDelay + getSecondarySubtitleDelay()) / 1000]);
        }
    }
    function clearSecondarySubtitleDelay() {
        if (stream !== null) {
            ipc.send('mpv-set-prop', ['secondary-sub-delay', 0]);
        }
    }
    function ensureGlobalSubtitleDelay() {
        if (props.extraSubtitlesDelay === null || props.extraSubtitlesDelay === undefined) {
            props.extraSubtitlesDelay = 0;
            onPropChanged('extraSubtitlesDelay');
        }
    }

    function ensureExtraSubtitleLoaded(id) {
        if (stream === null || !id || pendingExtraSubtitleTracks[id] || getExtraMpvTrackId(id) !== null) {
            return;
        }
        var track = getNativeExtraTrack(id);
        if (!track || typeof track.url !== 'string') {
            return;
        }
        pendingExtraSubtitleTracks[id] = true;
        var title = EXTRA_SUBTITLE_TITLE_PREFIX + encodeURIComponent(track.id);
        var lang = typeof track.lang === 'string' && track.lang.length > 0 ? track.lang : 'und';
        // eslint-disable-next-line no-console
        console.log('[TwinCue native-subtitles] Web -> shell sub-add', { id: track.id, url: track.url, flags: 'auto', title: title, lang: lang });
        ipc.send('mpv-command', [
            'sub-add',
            track.url,
            'auto',
            title,
            lang,
        ]);
    }
    function applyExtraSubtitleSelection(secondary) {
        var propName = secondary ? 'selectedSecondaryExtraSubtitlesTrackId' : 'selectedExtraSubtitlesTrackId';
        var mpvPropName = secondary ? 'secondary-sid' : 'sid';
        var selectedId = props[propName];
        if (typeof selectedId !== 'string') {
            return;
        }
        var mpvId = getExtraMpvTrackId(selectedId);
        if (mpvId === null) {
            ensureExtraSubtitleLoaded(selectedId);
            return;
        }
        var appliedId = secondary ? appliedSecondaryExtraMpvId : appliedPrimaryExtraMpvId;
        if (String(appliedId) === String(mpvId)) {
            return;
        }
        // mpv track ids arrive from track-list as JSON numbers, but shell-ng's generic
        // numeric IPC value is a double. sid/secondary-sid are integer properties, so
        // send the id as a string just like the existing embedded subtitle path does.
        var mpvIdValue = String(mpvId);
        // eslint-disable-next-line no-console
        console.log('[TwinCue native-subtitles] Web -> shell select', { role: secondary ? 'secondary' : 'primary', extraId: selectedId, mpvProperty: mpvPropName, mpvId: mpvIdValue });
        ipc.send('mpv-set-prop', [mpvPropName, mpvIdValue]);
        if (secondary) {
            appliedSecondaryExtraMpvId = mpvId;
            ensureGlobalSubtitleDelay();
            applySharedSubtitleDelay();
            events.emit('secondaryExtraSubtitlesTrackLoaded', getNativeExtraTrack(selectedId));
        } else {
            appliedPrimaryExtraMpvId = mpvId;
            events.emit('extraSubtitlesTrackLoaded', getNativeExtraTrack(selectedId));
        }
    }
    function syncExtraSubtitleSelections() {
        applyExtraSubtitleSelection(false);
        applyExtraSubtitleSelection(true);
    }

    var last_time = 0;
    ipc.on('mpv-prop-change', function(args) {
        switch (args.name) {
            case 'mpv-version':
                resolveMPVVersion(args.data);
                props[args.name] = logProp(args);
                break;
            case 'ffmpeg-version': {
                props[args.name] = logProp(args);
                break;
            }
            case 'duration': {
                var intDuration = args.data | 0;
                // Accumulate average duration over time. if it is greater than minClipDuration
                // and equal to the currently reported duration, it is returned as video length.
                // If the reported duration changes over time the average duration is always
                // smaller than the currently reported one so we set the video length to 0 as
                // this is a live stream.
                props[args.name] = args.data >= minClipDuration && (!avgDuration || intDuration === avgDuration) ? Math.round(args.data * 1000) : null;
                // The average duration is calculated using right bit shifting by one of the sum of
                // the previous average and the currently reported value. This method is not very precise
                // as we get integer value but we avoid floating point errors. JS uses 32 bit values
                // for bitwise maths so the maximum supported video duration is 1073741823 (2 ^ 30 - 1)
                // which is around 34 years of playback time.
                avgDuration = avgDuration ? (avgDuration + intDuration) >> 1 : intDuration;
                durationReady = intDuration > 0;
                updateLoaded();
                break;
            }
            case 'time-pos': {
                props[args.name] = Math.round(args.data*1000);
                break;
            }
            case 'sub-scale': {
                props[args.name] = Math.round(args.data / SUBS_SCALE_FACTOR);
                if (!props.assSubtitlesStylingActive) {
                    props.subtitlesSize = props[args.name];
                }
                break;
            }
            case 'sub-pos': {
                props[args.name] = 100 - args.data;
                if (!props.assSubtitlesStylingActive) {
                    props.subtitlesOffset = props[args.name];
                }
                break;
            }
            case 'sub-delay': {
                props[args.name] = Math.round(args.data*1000);
                break;
            }
            case 'secondary-sub-delay': {
                props[args.name] = Math.round(args.data*1000);
                break;
            }
            case 'volume': {
                if (typeof args.data === 'number' && isFinite(args.data)) {
                    props[args.name] = args.data;
                    onPropChanged('volume');
                }
                break;
            }
            case 'paused-for-cache':
            case 'seeking':
            {
                if (args.name === 'paused-for-cache') {
                    props[args.name] = args.data;
                    updateLoaded();
                }
                if(props.buffering !== args.data) {
                    props.buffering = args.data;
                    onPropChanged('buffering');
                }
                break;
            }
            case 'demuxer-cache-time': {
                var cacheTime = args.data || 0;
                props[args.name] = cacheTime > 0 ? Math.floor(cacheTime * 1000) : null;
                onPropChanged('buffered');
                break;
            }
            case 'aid':
            case 'vid': {
                props[args.name] = embeddedProp(args);
                break;
            }
            case 'sid': {
                props['mpv-sid'] = args.data;
                props.sid = getExtraTrackIdByMpvId(args.data) === null ? embeddedProp(args) : null;
                // eslint-disable-next-line no-console
                console.log('[TwinCue native-subtitles] shell -> Web sid', args.data);
                updateASSSubtitlesStylingActive();
                break;
            }
            case 'secondary-sid': {
                props['secondary-sid'] = args.data;
                props.selectedSecondarySubtitlesTrackId = getExtraTrackIdByMpvId(args.data) === null ? embeddedProp(args) : null;
                // eslint-disable-next-line no-console
                console.log('[TwinCue native-subtitles] shell -> Web secondary-sid', args.data);
                onPropChanged('selectedSecondarySubtitlesTrackId');
                break;
            }
            case 'video-params': {
                props[args.name] = args.data;
                updateLoaded();
                var params = args.data || {};
                var gamma = typeof params.gamma === 'string' ? params.gamma : null;
                if (gamma === 'pq' || gamma === 'hlg') {
                    props.hdrInfo = {
                        gamma: gamma,
                        primaries: typeof params.primaries === 'string' ? params.primaries : null,
                        maxCll: typeof params['max-cll'] === 'number' ? params['max-cll'] : null,
                        maxLuma: typeof params['max-luma'] === 'number' ? params['max-luma'] : null,
                    };
                } else {
                    props.hdrInfo = null;
                }
                onPropChanged('hdrInfo');
                break;
            }
            // In that case onPropChanged() is manually invoked as track-list contains all
            // the tracks but we have different event for each track type
            case 'track-list': {
                props['track-list'] = Array.isArray(args.data) ? args.data : [];
                var nativeExternalTracks = props['track-list'].filter(function(track) {
                    return getExtraTrackIdFromMpvTrack(track) !== null;
                }).map(function(track) {
                    return { id: track.id, title: track.title, lang: track.lang, codec: track.codec, selected: track.selected, external: track.external };
                });
                if (nativeExternalTracks.length > 0) {
                    // eslint-disable-next-line no-console
                    console.log('[TwinCue native-subtitles] shell -> Web track-list', nativeExternalTracks);
                }
                props['track-list'].forEach(function(track) {
                    var extraId = getExtraTrackIdFromMpvTrack(track);
                    if (extraId !== null) {
                        delete pendingExtraSubtitleTracks[extraId];
                    }
                });
                if (getExtraTrackIdByMpvId(props['mpv-sid']) !== null && props.sid !== null) {
                    props.sid = null;
                    onPropChanged('selectedSubtitlesTrackId');
                }
                props.audioTracks = props['track-list'].filter(function(x) { return x.type === 'audio'; })
                    .map(function(x, index) {
                        return {
                            id: 'EMBEDDED_' + x.id,
                            lang: x.lang === undefined ? 'Track' + (index + 1) : x.lang,
                            label: x.title === undefined || x.lang === undefined ? '' : x.title || x.lang,
                            origin: 'EMBEDDED',
                            embedded: true,
                            mode: x.id === props.aid ? 'showing' : 'disabled',
                        };
                    });
                onPropChanged('audioTracks');

                props.subtitlesTracks = props['track-list']
                    .filter(function(x) { return x.type === 'sub' && getExtraTrackIdFromMpvTrack(x) === null; })
                    .map(function(x, index) {
                        return {
                            id: 'EMBEDDED_' + x.id,
                            lang: x.lang === undefined ? 'Track ' + (index + 1) : x.lang,
                            label: x.title === undefined || x.lang === undefined ? '' : x.title || x.lang,
                            origin: 'EMBEDDED',
                            embedded: true,
                            mode: props.sid === 'EMBEDDED_' + x.id ? 'showing' : 'disabled',
                        };
                    });
                onPropChanged('subtitlesTracks');
                updateASSSubtitlesStylingActive();
                syncExtraSubtitleSelections();
                break;
            }
            default: {
                props[args.name] = args.data;
                break;
            }
        }

        // Cap time update to update only when a second passes
        var current_time = args.name === 'time-pos' ? Math.floor(props['time-pos'] / 1000) : null;
        if((!current_time || last_time !== current_time)&& stremioProps[args.name]) {
            if(current_time) {
                last_time = current_time;
            }
            onPropChanged(stremioProps[args.name]);
        }
    });
    ipc.on('mpv-event-ended', function(args) {
        // older shells report 'other' for every non-error reason, including eof
        if (args.error) onError(args.error);
        else if (!args.reason || args.reason === 'eof' || args.reason === 'other') {
            if (!isKnownEarlyEof()) onEnded();
        }
    });
    ipc.on('mpv-event-video-ready', function(args) {
        if (!args || !Number.isSafeInteger(args.loadId) || typeof args.ready !== 'boolean') {
            return;
        }
        videoReadyEventsSupported = true;
        if (!args.ready) {
            if (activeVideoReadyLoadId === null || args.loadId > activeVideoReadyLoadId) {
                activeVideoReadyLoadId = args.loadId;
            }
        } else if (args.loadId === activeVideoReadyLoadId && !props.loaded) {
            props.loaded = true;
            setBackground(false);
            onPropChanged('loaded');
        }
    });

    function getProp(propName) {
        if (propName === 'hdrInfo') return props.hdrInfo || null;
        if (propName === 'videoScale') return props.videoScale || 'contain';
        if (propName === 'assSubtitlesStylingActive') return props.assSubtitlesStylingActive === true;
        if (propName === 'subtitlesSize' && typeof props.subtitlesSize === 'number') return props.subtitlesSize;
        if (propName === 'subtitlesOffset' && typeof props.subtitlesOffset === 'number') return props.subtitlesOffset;
        if (nativeExtraSubtitleProps.indexOf(propName) !== -1) return props[propName] === undefined ? null : props[propName];
        if(stremioToMPVProps[propName]) return props[stremioToMPVProps[propName]];
        // eslint-disable-next-line no-console
        console.log('Unsupported prop requested', propName);
        return null;
    }
    function onError(error) {
        events.emit('error', error);
        if (error.critical) {
            command('unload');
        }
    }
    function onEnded() {
        events.emit('ended');
    }
    function isKnownEarlyEof() {
        var time = props['time-pos'];
        var duration = props.duration;
        return typeof time === 'number' &&
            isFinite(time) &&
            typeof duration === 'number' &&
            isFinite(duration) &&
            time + EOF_END_TOLERANCE < duration;
    }
    function onPropChanged(propName) {
        if (observedProps[propName]) {
            events.emit('propChanged', propName, getProp(propName));
        }
    }
    function observeProp(propName) {
        events.emit('propValue', propName, getProp(propName));
        observedProps[propName] = true;
    }
    function setProp(propName, propValue) {
        switch (propName) {
            case 'paused': {
                if (stream !== null) {
                    ipc.send('mpv-set-prop', ['pause', propValue]);
                }

                break;
            }
            case 'time': {
                if (stream !== null && propValue !== null && isFinite(propValue)) {
                    ipc.send('mpv-set-prop', ['time-pos', propValue/1000]);
                }

                break;
            }
            case 'playbackSpeed': {
                if (stream !== null && propValue !== null && isFinite(propValue)) {
                    ipc.send('mpv-set-prop', ['speed', propValue]);
                }
                break;
            }
            case 'videoScale': {
                if (stream !== null) {
                    switch (propValue) {
                        case 'cover':
                            ipc.send('mpv-set-prop', ['keepaspect', true]);
                            ipc.send('mpv-set-prop', ['panscan', 1.0]);
                            break;
                        case 'fill':
                            ipc.send('mpv-set-prop', ['keepaspect', false]);
                            ipc.send('mpv-set-prop', ['panscan', 0.0]);
                            break;
                        default:
                            ipc.send('mpv-set-prop', ['keepaspect', true]);
                            ipc.send('mpv-set-prop', ['panscan', 0.0]);
                            break;
                    }
                    props.videoScale = propValue;
                    onPropChanged('videoScale');
                }
                break;
            }
            case 'volume': {
                if (stream !== null && propValue !== null && isFinite(propValue)) {
                    props.mute = false;
                    ipc.send('mpv-set-prop', ['mute', 'no']);
                    ipc.send('mpv-set-prop', ['volume', propValue]);
                    onPropChanged('muted');
                    onPropChanged('volume');
                }
                break;
            }
            case 'muted': {
                if (stream !== null) {
                    ipc.send('mpv-set-prop', ['mute', propValue ? 'yes' : 'no']);
                    props.mute = propValue;
                    onPropChanged('muted');
                }
                break;
            }
            case 'selectedAudioTrackId': {
                if (stream !== null) {
                    var actualId = propValue.slice('EMBEDDED_'.length);
                    ipc.send('mpv-set-prop', ['aid', actualId]);
                }
                break;
            }
            case 'selectedSubtitlesTrackId': {
                if (stream !== null) {
                    if(propValue) {
                        var actualId = propValue.slice('EMBEDDED_'.length);
                        ensureGlobalSubtitleDelay();
                        ipc.send('mpv-set-prop', ['sid', actualId]);
                        applySharedSubtitleDelay();
                        events.emit('subtitlesTrackLoaded', propValue);
                    } else {
                        // turn off subs
                        ipc.send('mpv-set-prop', ['sid', 'no']);
                        props.sid = null;
                    }
                }
                onPropChanged('selectedSubtitlesTrackId');
                break;
            }
            case 'selectedExtraSubtitlesTrackId': {
                var previousPrimaryExtraId = props.selectedExtraSubtitlesTrackId;
                var primaryTrack = typeof propValue === 'string' ? getNativeExtraTrack(propValue) : null;
                props.selectedExtraSubtitlesTrackId = primaryTrack ? primaryTrack.id : null;
                appliedPrimaryExtraMpvId = null;
                if (stream !== null) {
                    if (props.selectedExtraSubtitlesTrackId !== null) {
                        ensureGlobalSubtitleDelay();
                        ipc.send('mpv-set-prop', ['sid', 'no']);
                        props.sid = null;
                        ensureExtraSubtitleLoaded(props.selectedExtraSubtitlesTrackId);
                        applyExtraSubtitleSelection(false);
                        applySharedSubtitleDelay();
                    } else if (previousPrimaryExtraId !== null) {
                        ipc.send('mpv-set-prop', ['sid', 'no']);
                    }
                }
                onPropChanged('selectedExtraSubtitlesTrackId');
                break;
            }
            case 'selectedSecondarySubtitlesTrackId': {
                var previousSecondaryEmbeddedId = props.selectedSecondarySubtitlesTrackId;
                var secondaryEmbeddedTrack = typeof propValue === 'string' && Array.isArray(props.subtitlesTracks) ? props.subtitlesTracks.find(function(track) {
                    return track.id === propValue;
                }) : null;
                props.selectedSecondarySubtitlesTrackId = secondaryEmbeddedTrack ? secondaryEmbeddedTrack.id : null;
                appliedSecondaryExtraMpvId = null;
                if (stream !== null) {
                    if (props.selectedSecondarySubtitlesTrackId !== null) {
                        ensureGlobalSubtitleDelay();
                        ipc.send('mpv-set-prop', ['secondary-sid', props.selectedSecondarySubtitlesTrackId.slice('EMBEDDED_'.length)]);
                        applySharedSubtitleDelay();
                    } else if (previousSecondaryEmbeddedId !== null && props.selectedSecondaryExtraSubtitlesTrackId === null) {
                        ipc.send('mpv-set-prop', ['secondary-sid', 'no']);
                        clearSecondarySubtitleDelay();
                    }
                }
                onPropChanged('selectedSecondarySubtitlesTrackId');
                break;
            }
            case 'selectedSecondaryExtraSubtitlesTrackId': {
                var previousSecondaryExtraId = props.selectedSecondaryExtraSubtitlesTrackId;
                var secondaryTrack = typeof propValue === 'string' ? getNativeExtraTrack(propValue) : null;
                props.selectedSecondaryExtraSubtitlesTrackId = secondaryTrack ? secondaryTrack.id : null;
                appliedSecondaryExtraMpvId = null;
                if (stream !== null) {
                    if (props.selectedSecondaryExtraSubtitlesTrackId !== null) {
                        ensureGlobalSubtitleDelay();
                        ipc.send('mpv-set-prop', ['secondary-sid', 'no']);
                        ensureExtraSubtitleLoaded(props.selectedSecondaryExtraSubtitlesTrackId);
                        applyExtraSubtitleSelection(true);
                    } else if (previousSecondaryExtraId !== null && props.selectedSecondarySubtitlesTrackId === null) {
                        ipc.send('mpv-set-prop', ['secondary-sid', 'no']);
                        clearSecondarySubtitleDelay();
                    }
                }
                onPropChanged('selectedSecondaryExtraSubtitlesTrackId');
                break;
            }
            case 'extraSubtitlesDelay': {
                if (propValue !== null && isFinite(propValue)) {
                    props.extraSubtitlesDelay = Math.round(propValue);
                    applySharedSubtitleDelay();
                    onPropChanged('extraSubtitlesDelay');
                }
                break;
            }
            case 'secondarySubtitlesDelay': {
                props.secondarySubtitlesDelay = propValue !== null && isFinite(propValue) ? Math.round(propValue) : 0;
                if (hasSecondarySubtitleSelection()) {
                    applySharedSubtitleDelay();
                } else {
                    clearSecondarySubtitleDelay();
                }
                onPropChanged('secondarySubtitlesDelay');
                break;
            }
            case 'extraSubtitlesSize': {
                if (propValue !== null && isFinite(propValue)) {
                    props.extraSubtitlesSize = Math.max(0, parseInt(propValue, 10));
                    ipc.send('mpv-set-prop', ['sub-scale', props.extraSubtitlesSize * SUBS_SCALE_FACTOR]);
                    onPropChanged('extraSubtitlesSize');
                }
                break;
            }
            case 'extraSubtitlesOffset': {
                if (propValue !== null && isFinite(propValue)) {
                    props.extraSubtitlesOffset = Math.max(0, Math.min(100, parseInt(propValue, 10)));
                    ipc.send('mpv-set-prop', ['sub-pos', 100 - props.extraSubtitlesOffset]);
                    onPropChanged('extraSubtitlesOffset');
                }
                break;
            }
            case 'extraSubtitlesTextColor':
            case 'extraSubtitlesBackgroundColor':
            case 'extraSubtitlesOutlineColor': {
                props[propName] = propValue;
                var nativeColorProp = propName === 'extraSubtitlesTextColor' ? 'sub-color' :
                    propName === 'extraSubtitlesBackgroundColor' ? 'sub-back-color' : 'sub-border-color';
                if (typeof propValue === 'string') {
                    var nativeArgb = propValue.replace(/^#(\w{6})(\w{2})$/, '#');
                    ipc.send('mpv-set-prop', [nativeColorProp, nativeArgb]);
                }
                onPropChanged(propName);
                break;
            }
            case 'subtitlesSize': {
                props.subtitlesSize = propValue;
                ipc.send('mpv-set-prop', [stremioToMPVProps[propName], props.assSubtitlesStylingActive ? 1 : propValue * SUBS_SCALE_FACTOR]);
                break;
            }
            case 'subtitlesDelay': {
                ipc.send('mpv-set-prop', [stremioToMPVProps[propName], propValue]);
                if (hasSecondarySubtitleSelection()) {
                    ipc.send('mpv-set-prop', ['secondary-sub-delay', propValue + getSecondarySubtitleDelay() / 1000]);
                }
                break;
            }
            case 'subtitlesOffset': {
                props.subtitlesOffset = propValue;
                ipc.send('mpv-set-prop', [stremioToMPVProps[propName], props.assSubtitlesStylingActive ? 100 : 100 - propValue]);
                break;
            }
            case 'subtitlesTextColor':
            case 'subtitlesBackgroundColor':
            case 'subtitlesOutlineColor':
            {
                // MPV accepts color in #AARRGGBB
                var argb = propValue.replace(/^#(\w{6})(\w{2})$/, '#$2$1');
                ipc.send('mpv-set-prop', [stremioToMPVProps[propName], argb]);
                break;
            }
            default: {
                // eslint-disable-next-line no-console
                console.log('Unhandled setProp for', propName);
            }
        }
    }
    function command(commandName, commandArgs) {
        switch (commandName) {
            case 'load': {
                command('unload');
                if (commandArgs && commandArgs.stream && typeof commandArgs.stream.url === 'string') {
                    waitForMPVVersion.then(function (mpvVersion) {
                        stream = commandArgs.stream;
                        onPropChanged('stream');

                        assSubtitlesStylingEnabled = commandArgs.assSubtitlesStyling === true;
                        var subAssOverride = assSubtitlesStylingEnabled ? 'no' : 'strip';
                        ipc.send('mpv-set-prop', ['sub-ass-override', subAssOverride]);

                        var gpuProcessing = !!commandArgs.gpuVideoProcessing &&
                            !!commandArgs.hardwareDecoding;

                        // Hardware decoding
                        var hwdecAuto = commandArgs.platform === 'windows' ? 'auto' : 'auto-copy';
                        var hwdecValue = commandArgs.hardwareDecoding ? (gpuProcessing ? 'd3d11va' : hwdecAuto) : 'no';
                        ipc.send('mpv-set-prop', ['hwdec', hwdecValue]);

                        // GPU video processing
                        if (typeof commandArgs.gpuVideoProcessing === 'boolean') {
                            ipc.send('mpv-set-gpu-video-processing', gpuProcessing);
                        }

                        // Video output
                        var videoOutput = commandArgs.platform === 'windows' ? (commandArgs.videoMode === null ? 'gpu-next' : 'gpu') : 'libmpv';
                        ipc.send('mpv-set-prop', ['vo', videoOutput]);

                        var separateWindow = options.mpvSeparateWindow ? 'yes' : 'no';
                        ipc.send('mpv-set-prop', ['osc', separateWindow]);
                        ipc.send('mpv-set-prop', ['input-default-bindings', separateWindow]);
                        ipc.send('mpv-set-prop', ['input-vo-keyboard', separateWindow]);

                        var startAt = Math.floor(parseInt(commandArgs.time, 10) / 1000) || 0;
                        if (startAt !== 0) {
                            if (versionGTE(mpvVersion, '0.39')) {
                                ipc.send('mpv-command', ['loadfile', stream.url, 'replace', '-1', 'start=+' + startAt]);
                            } else {
                                ipc.send('mpv-command', ['loadfile', stream.url, 'replace', 'start=+' + startAt]);
                            }
                        } else {
                            ipc.send('mpv-command', ['loadfile', stream.url]);
                        }
                        ipc.send('mpv-set-prop', ['sid', 'no']);
                        ipc.send('mpv-set-prop', ['secondary-sid', 'no']);
                        ipc.send('mpv-set-prop', ['secondary-sub-delay', 0]);
                        ipc.send('mpv-set-prop', ['pause', false]);
                        ipc.send('mpv-set-prop', ['speed', props.speed]);
                        if (props.aid) {
                            if (typeof props.aid === 'string' && props.aid.startsWith('EMBEDDED_')) {
                                ipc.send('mpv-set-prop', ['aid', props.aid.slice('EMBEDDED_'.length)]);
                            } else {
                                ipc.send('mpv-set-prop', ['aid', props.aid]);
                            }
                        }
                        ipc.send('mpv-set-prop', ['mute', 'no']);

                        onPropChanged('paused');
                        onPropChanged('time');
                        onPropChanged('duration');
                        onPropChanged('buffering');
                        onPropChanged('buffered');
                        onPropChanged('muted');
                        onPropChanged('subtitlesTracks');
                        onPropChanged('selectedSubtitlesTrackId');
                        onPropChanged('assSubtitlesStylingActive');
                    });
                } else {
                    onError(Object.assign({}, ERROR.UNSUPPORTED_STREAM, {
                        critical: true,
                        stream: commandArgs ? commandArgs.stream : null
                    }));
                }
                break;
            }
            case 'addExtraSubtitlesTracks': {
                if (commandArgs && Array.isArray(commandArgs.tracks)) {
                    var nextTracks = Array.isArray(props.extraSubtitlesTracks) ? props.extraSubtitlesTracks.slice() : [];
                    commandArgs.tracks.forEach(function(track) {
                        if (!track || typeof track.id !== 'string') {
                            return;
                        }
                        var index = nextTracks.findIndex(function(item) { return item.id === track.id; });
                        if (index === -1) {
                            nextTracks.push(track);
                            events.emit('extraSubtitlesTrackAdded', track);
                        } else {
                            nextTracks[index] = track;
                        }
                    });
                    props.extraSubtitlesTracks = nextTracks;
                    onPropChanged('extraSubtitlesTracks');
                    syncExtraSubtitleSelections();
                }
                break;
            }
            case 'unload': {
                var wasASSSubtitlesStylingActive = props.assSubtitlesStylingActive === true;
                activeVideoReadyLoadId = null;
                props = {
                    loaded: false,
                    pause: false,
                    mute: false,
                    speed: 1,
                    subtitlesTracks: [],
                    audioTracks: [],
                    buffering: false,
                    buffered: null,
                    aid: null,
                    sid: null,
                    'mpv-sid': null,
                    'secondary-sid': null,
                    extraSubtitlesTracks: [],
                    selectedExtraSubtitlesTrackId: null,
                    selectedSecondarySubtitlesTrackId: null,
                    selectedSecondaryExtraSubtitlesTrackId: null,
                    extraSubtitlesDelay: null,
                    secondarySubtitlesDelay: 0,
                    extraSubtitlesSize: 100,
                    extraSubtitlesOffset: 0,
                    extraSubtitlesTextColor: '#FFFFFFFF',
                    extraSubtitlesBackgroundColor: '#00000000',
                    extraSubtitlesOutlineColor: '#222222FF',
                    videoScale: 'contain',
                    assSubtitlesStylingActive: false,
                };
                assSubtitlesStylingEnabled = false;
                pendingExtraSubtitleTracks = Object.create(null);
                appliedPrimaryExtraMpvId = null;
                appliedSecondaryExtraMpvId = null;
                avgDuration = 0;
                durationReady = false;
                ipc.send('mpv-command', ['stop']);
                ipc.send('mpv-set-prop', ['keepaspect', true]);
                ipc.send('mpv-set-prop', ['panscan', 0.0]);
                onPropChanged('loaded');
                onPropChanged('stream');
                onPropChanged('paused');
                onPropChanged('time');
                onPropChanged('duration');
                onPropChanged('buffering');
                onPropChanged('buffered');
                onPropChanged('muted');
                onPropChanged('subtitlesTracks');
                onPropChanged('selectedSubtitlesTrackId');
                onPropChanged('extraSubtitlesTracks');
                onPropChanged('selectedExtraSubtitlesTrackId');
                onPropChanged('selectedSecondarySubtitlesTrackId');
                onPropChanged('selectedSecondaryExtraSubtitlesTrackId');
                onPropChanged('extraSubtitlesDelay');
                onPropChanged('secondarySubtitlesDelay');
                onPropChanged('extraSubtitlesSize');
                onPropChanged('extraSubtitlesOffset');
                onPropChanged('videoScale');
                if (wasASSSubtitlesStylingActive) {
                    onPropChanged('assSubtitlesStylingActive');
                }
                setBackground(true);
                break;
            }
            case 'destroy': {
                command('unload');
                destroyed = true;
                events.removeAllListeners();
                break;
            }
        }
    }

    this.on = function (eventName, listener) {
        if (destroyed) {
            throw new Error('Video is destroyed');
        }

        events.on(eventName, listener);
    };
    this.dispatch = function (action) {
        if (destroyed) {
            throw new Error('Video is destroyed');
        }

        if (action) {
            action = deepFreeze(cloneDeep(action));
            switch (action.type) {
                case 'observeProp': {
                    observeProp(action.propName);
                    break;
                }
                case 'setProp': {
                    setProp(action.propName, action.propValue);
                    return;
                }
                case 'command': {
                    command(
                        action.commandName,
                        action.commandArgs
                    );
                    return;
                }
            }
        }
    };
}
ShellVideo.canPlayStream = function() {
    return Promise.resolve(true);
};

ShellVideo.manifest = {
    name: 'ShellVideo',
    external: false,
    props: Object.keys(stremioToMPVProps).concat(nativeExtraSubtitleProps),
    commands: ['load', 'unload', 'destroy', 'addExtraSubtitlesTracks'],
    events: [
        'propValue',
        'propChanged',
        'ended',
        'error',
        'subtitlesTrackLoaded',
        'extraSubtitlesTrackLoaded',
        'extraSubtitlesTrackAdded',
        'secondaryExtraSubtitlesTrackLoaded',
    ],
};

module.exports = ShellVideo;
