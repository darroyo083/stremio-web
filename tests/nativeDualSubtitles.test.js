/** @jest-environment jsdom */
const EventEmitter = require('eventemitter3');
const ShellVideo = require('@stremio/stremio-video/src/ShellVideo/ShellVideo');

class FakeShellTransport extends EventEmitter {
    constructor() {
        super();
        this.sent = [];
    }

    send(name, args) {
        this.sent.push([name, args]);
    }

    clear() {
        this.sent.length = 0;
    }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const hasSend = (transport, eventName, args) => {
    return transport.sent.some(([name, value]) => {
        return name === eventName && JSON.stringify(value) === JSON.stringify(args);
    });
};

describe('ShellVideo native dual external subtitles', () => {
    test('loads external tracks lazily and assigns primary and secondary mpv ids', async () => {
        const shellTransport = new FakeShellTransport();
        const video = new ShellVideo({
            shellTransport,
            containerElement: { style: {}, parentElement: null },
            mpvSeparateWindow: false,
        });

        shellTransport.emit('mpv-prop-change', { name: 'mpv-version', data: '0.41.0' });
        video.dispatch({
            type: 'command',
            commandName: 'load',
            commandArgs: {
                stream: { url: 'https://example.test/video.mp4' },
                platform: 'windows',
                assSubtitlesStyling: false,
                hardwareDecoding: false,
                gpuVideoProcessing: false,
                videoMode: null,
                time: 0,
            },
        });
        await flush();

        const primary = {
            id: 'twincue:dual:v1:pair:main',
            lang: 'eng',
            url: 'https://example.test/main.srt',
        };
        const secondary = {
            id: 'twincue:dual:v1:pair:secondary',
            lang: 'spa',
            url: 'https://example.test/secondary.srt',
        };
        video.dispatch({
            type: 'command',
            commandName: 'addExtraSubtitlesTracks',
            commandArgs: { tracks: [primary, secondary] },
        });

        shellTransport.clear();
        video.dispatch({ type: 'setProp', propName: 'selectedExtraSubtitlesTrackId', propValue: primary.id });
        expect(hasSend(shellTransport, 'mpv-command', [
            'sub-add',
            primary.url,
            'auto',
            `STREMIO_EXTRA_SUBTITLE:${encodeURIComponent(primary.id)}`,
            'eng',
        ])).toBe(true);
        expect(shellTransport.sent.some(([name, args]) => name === 'mpv-command' && args[0] === 'sub-add' && args[1] === secondary.url)).toBe(false);

        shellTransport.emit('mpv-prop-change', {
            name: 'track-list',
            data: [{
                id: 10,
                type: 'sub',
                title: `STREMIO_EXTRA_SUBTITLE:${encodeURIComponent(primary.id)}`,
                lang: 'eng',
                external: true,
            }],
        });
        expect(hasSend(shellTransport, 'mpv-set-prop', ['sid', '10'])).toBe(true);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['sid', 10])).toBe(false);

        shellTransport.clear();
        video.dispatch({ type: 'setProp', propName: 'selectedSecondaryExtraSubtitlesTrackId', propValue: secondary.id });
        expect(hasSend(shellTransport, 'mpv-command', [
            'sub-add',
            secondary.url,
            'auto',
            `STREMIO_EXTRA_SUBTITLE:${encodeURIComponent(secondary.id)}`,
            'spa',
        ])).toBe(true);

        shellTransport.emit('mpv-prop-change', {
            name: 'track-list',
            data: [
                {
                    id: 10,
                    type: 'sub',
                    title: `STREMIO_EXTRA_SUBTITLE:${encodeURIComponent(primary.id)}`,
                    lang: 'eng',
                    external: true,
                },
                {
                    id: 11,
                    type: 'sub',
                    title: `STREMIO_EXTRA_SUBTITLE:${encodeURIComponent(secondary.id)}`,
                    lang: 'spa',
                    external: true,
                },
            ],
        });
        expect(hasSend(shellTransport, 'mpv-set-prop', ['secondary-sid', '11'])).toBe(true);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['secondary-sid', 11])).toBe(false);
    });


    test('uses real mpv ids for embedded primary and secondary and shares delay with an independent secondary offset', async () => {
        const shellTransport = new FakeShellTransport();
        const video = new ShellVideo({
            shellTransport,
            containerElement: { style: {}, parentElement: null },
            mpvSeparateWindow: false,
        });

        shellTransport.emit('mpv-prop-change', { name: 'mpv-version', data: '0.41.0' });
        video.dispatch({
            type: 'command',
            commandName: 'load',
            commandArgs: {
                stream: { url: 'https://example.test/video-embedded.mkv' },
                platform: 'windows',
                assSubtitlesStyling: false,
                hardwareDecoding: false,
                gpuVideoProcessing: false,
                videoMode: null,
                time: 0,
            },
        });
        await flush();
        shellTransport.emit('mpv-prop-change', {
            name: 'track-list',
            data: [
                { id: 5, type: 'sub', lang: 'eng', title: 'English embedded' },
                { id: 9, type: 'sub', lang: 'spa', title: 'Spanish embedded' },
            ],
        });

        shellTransport.clear();
        video.dispatch({ type: 'setProp', propName: 'selectedSubtitlesTrackId', propValue: 'EMBEDDED_5' });
        video.dispatch({ type: 'setProp', propName: 'selectedSecondarySubtitlesTrackId', propValue: 'EMBEDDED_9' });
        expect(hasSend(shellTransport, 'mpv-set-prop', ['sid', '5'])).toBe(true);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['secondary-sid', '9'])).toBe(true);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['sid', '0'])).toBe(false);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['secondary-sid', '1'])).toBe(false);

        shellTransport.clear();
        video.dispatch({ type: 'setProp', propName: 'extraSubtitlesDelay', propValue: -3000 });
        expect(hasSend(shellTransport, 'mpv-set-prop', ['sub-delay', -3])).toBe(true);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['secondary-sub-delay', -3])).toBe(true);

        shellTransport.clear();
        video.dispatch({ type: 'setProp', propName: 'secondarySubtitlesDelay', propValue: 500 });
        expect(hasSend(shellTransport, 'mpv-set-prop', ['sub-delay', -3])).toBe(true);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['secondary-sub-delay', -2.5])).toBe(true);
    });

    test('strips primary ASS positioning while dual subtitles are active and restores it when secondary is off', async () => {
        const shellTransport = new FakeShellTransport();
        const video = new ShellVideo({
            shellTransport,
            containerElement: { style: {}, parentElement: null },
            mpvSeparateWindow: false,
        });

        shellTransport.emit('mpv-prop-change', { name: 'mpv-version', data: '0.41.0' });
        video.dispatch({
            type: 'command',
            commandName: 'load',
            commandArgs: {
                stream: { url: 'https://example.test/positioned-ass.mkv' },
                platform: 'windows',
                assSubtitlesStyling: true,
                hardwareDecoding: false,
                gpuVideoProcessing: false,
                videoMode: null,
                time: 0,
            },
        });
        await flush();
        shellTransport.emit('mpv-prop-change', {
            name: 'track-list',
            data: [
                { id: 5, type: 'sub', lang: 'eng', codec: 'ass', title: 'English ASS' },
                { id: 9, type: 'sub', lang: 'ita', codec: 'ass', title: 'Italian ASS' },
            ],
        });
        video.dispatch({ type: 'setProp', propName: 'selectedSubtitlesTrackId', propValue: 'EMBEDDED_5' });
        shellTransport.emit('mpv-prop-change', { name: 'sid', data: 5 });
        video.dispatch({ type: 'setProp', propName: 'subtitlesOffset', propValue: 18 });

        shellTransport.clear();
        video.dispatch({ type: 'setProp', propName: 'selectedSecondarySubtitlesTrackId', propValue: 'EMBEDDED_9' });
        expect(hasSend(shellTransport, 'mpv-set-prop', ['sub-ass-override', 'strip'])).toBe(true);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['sub-pos', 82])).toBe(true);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['secondary-sid', '9'])).toBe(true);

        shellTransport.clear();
        video.dispatch({ type: 'setProp', propName: 'selectedSecondarySubtitlesTrackId', propValue: null });
        expect(hasSend(shellTransport, 'mpv-set-prop', ['sub-ass-override', 'no'])).toBe(true);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['sub-pos', 100])).toBe(true);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['secondary-sid', 'no'])).toBe(true);
    });

    test('plain text primary keeps its user vertical position when dual mode toggles', async () => {
        const shellTransport = new FakeShellTransport();
        const video = new ShellVideo({ shellTransport, containerElement: { style: {}, parentElement: null }, mpvSeparateWindow: false });
        shellTransport.emit('mpv-prop-change', { name: 'mpv-version', data: '0.41.0' });
        video.dispatch({ type: 'command', commandName: 'load', commandArgs: { stream: { url: 'https://example.test/plain-text.mkv' }, platform: 'windows', assSubtitlesStyling: true, hardwareDecoding: false, gpuVideoProcessing: false, videoMode: null, time: 0 } });
        await flush();
        shellTransport.emit('mpv-prop-change', { name: 'track-list', data: [
            { id: 5, type: 'sub', lang: 'eng', codec: 'subrip', title: 'English SRT' },
            { id: 9, type: 'sub', lang: 'ita', codec: 'subrip', title: 'Italian SRT' },
        ] });
        video.dispatch({ type: 'setProp', propName: 'selectedSubtitlesTrackId', propValue: 'EMBEDDED_5' });
        shellTransport.emit('mpv-prop-change', { name: 'sid', data: 5 });
        video.dispatch({ type: 'setProp', propName: 'subtitlesOffset', propValue: 23 });

        shellTransport.clear();
        video.dispatch({ type: 'setProp', propName: 'selectedSecondarySubtitlesTrackId', propValue: 'EMBEDDED_9' });
        expect(hasSend(shellTransport, 'mpv-set-prop', ['sub-ass-override', 'strip'])).toBe(true);
        expect(shellTransport.sent.some(([name, args]) => name === 'mpv-set-prop' && args[0] === 'sub-pos')).toBe(false);

        shellTransport.clear();
        video.dispatch({ type: 'setProp', propName: 'selectedSecondarySubtitlesTrackId', propValue: null });
        expect(hasSend(shellTransport, 'mpv-set-prop', ['sub-ass-override', 'no'])).toBe(true);
        expect(shellTransport.sent.some(([name, args]) => name === 'mpv-set-prop' && args[0] === 'sub-pos')).toBe(false);
    });

    test('supports embedded primary with TwinCue secondary and shared delay', async () => {
        const shellTransport = new FakeShellTransport();
        const video = new ShellVideo({ shellTransport, containerElement: { style: {}, parentElement: null }, mpvSeparateWindow: false });
        shellTransport.emit('mpv-prop-change', { name: 'mpv-version', data: '0.41.0' });
        video.dispatch({ type: 'command', commandName: 'load', commandArgs: { stream: { url: 'https://example.test/mixed-a.mkv' }, platform: 'windows', assSubtitlesStyling: false, hardwareDecoding: false, gpuVideoProcessing: false, videoMode: null, time: 0 } });
        await flush();
        const secondary = { id: 'twincue:dual:v1:mixed:secondary', lang: 'spa', url: 'https://example.test/mixed-secondary.srt' };
        video.dispatch({ type: 'command', commandName: 'addExtraSubtitlesTracks', commandArgs: { tracks: [secondary] } });
        shellTransport.emit('mpv-prop-change', { name: 'track-list', data: [{ id: 5, type: 'sub', lang: 'eng', title: 'English embedded' }] });
        video.dispatch({ type: 'setProp', propName: 'selectedSubtitlesTrackId', propValue: 'EMBEDDED_5' });
        video.dispatch({ type: 'setProp', propName: 'selectedSecondaryExtraSubtitlesTrackId', propValue: secondary.id });
        shellTransport.emit('mpv-prop-change', { name: 'track-list', data: [
            { id: 5, type: 'sub', lang: 'eng', title: 'English embedded' },
            { id: 11, type: 'sub', lang: 'spa', title: `STREMIO_EXTRA_SUBTITLE:${encodeURIComponent(secondary.id)}`, external: true },
        ] });
        expect(hasSend(shellTransport, 'mpv-set-prop', ['sid', '5'])).toBe(true);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['secondary-sid', '11'])).toBe(true);
        shellTransport.clear();
        video.dispatch({ type: 'setProp', propName: 'extraSubtitlesDelay', propValue: -2000 });
        expect(hasSend(shellTransport, 'mpv-set-prop', ['sub-delay', -2])).toBe(true);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['secondary-sub-delay', -2])).toBe(true);
    });

    test('supports TwinCue primary with embedded secondary and shared delay', async () => {
        const shellTransport = new FakeShellTransport();
        const video = new ShellVideo({ shellTransport, containerElement: { style: {}, parentElement: null }, mpvSeparateWindow: false });
        shellTransport.emit('mpv-prop-change', { name: 'mpv-version', data: '0.41.0' });
        video.dispatch({ type: 'command', commandName: 'load', commandArgs: { stream: { url: 'https://example.test/mixed-b.mkv' }, platform: 'windows', assSubtitlesStyling: false, hardwareDecoding: false, gpuVideoProcessing: false, videoMode: null, time: 0 } });
        await flush();
        const primary = { id: 'twincue:dual:v1:mixed:main', lang: 'eng', url: 'https://example.test/mixed-main.srt' };
        video.dispatch({ type: 'command', commandName: 'addExtraSubtitlesTracks', commandArgs: { tracks: [primary] } });
        shellTransport.emit('mpv-prop-change', { name: 'track-list', data: [{ id: 9, type: 'sub', lang: 'spa', title: 'Spanish embedded' }] });
        video.dispatch({ type: 'setProp', propName: 'selectedExtraSubtitlesTrackId', propValue: primary.id });
        shellTransport.emit('mpv-prop-change', { name: 'track-list', data: [
            { id: 9, type: 'sub', lang: 'spa', title: 'Spanish embedded' },
            { id: 10, type: 'sub', lang: 'eng', title: `STREMIO_EXTRA_SUBTITLE:${encodeURIComponent(primary.id)}`, external: true },
        ] });
        video.dispatch({ type: 'setProp', propName: 'selectedSecondarySubtitlesTrackId', propValue: 'EMBEDDED_9' });
        expect(hasSend(shellTransport, 'mpv-set-prop', ['sid', '10'])).toBe(true);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['secondary-sid', '9'])).toBe(true);
        shellTransport.clear();
        video.dispatch({ type: 'setProp', propName: 'extraSubtitlesDelay', propValue: 1500 });
        expect(hasSend(shellTransport, 'mpv-set-prop', ['sub-delay', 1.5])).toBe(true);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['secondary-sub-delay', 1.5])).toBe(true);
    });

    test('secondary OFF clears only secondary selection and secondary delay', async () => {
        const shellTransport = new FakeShellTransport();
        const video = new ShellVideo({ shellTransport, containerElement: { style: {}, parentElement: null }, mpvSeparateWindow: false });
        shellTransport.emit('mpv-prop-change', { name: 'mpv-version', data: '0.41.0' });
        video.dispatch({ type: 'command', commandName: 'load', commandArgs: { stream: { url: 'https://example.test/off.mkv' }, platform: 'windows', assSubtitlesStyling: false, hardwareDecoding: false, gpuVideoProcessing: false, videoMode: null, time: 0 } });
        await flush();
        shellTransport.emit('mpv-prop-change', { name: 'track-list', data: [
            { id: 5, type: 'sub', lang: 'eng' },
            { id: 9, type: 'sub', lang: 'spa' },
        ] });
        video.dispatch({ type: 'setProp', propName: 'selectedSubtitlesTrackId', propValue: 'EMBEDDED_5' });
        video.dispatch({ type: 'setProp', propName: 'selectedSecondarySubtitlesTrackId', propValue: 'EMBEDDED_9' });
        shellTransport.clear();
        video.dispatch({ type: 'setProp', propName: 'selectedSecondarySubtitlesTrackId', propValue: null });
        expect(hasSend(shellTransport, 'mpv-set-prop', ['secondary-sid', 'no'])).toBe(true);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['secondary-sub-delay', 0])).toBe(true);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['sid', 'no'])).toBe(false);
    });

    test('external secondary can be turned OFF without clearing primary', async () => {
        const shellTransport = new FakeShellTransport();
        const video = new ShellVideo({ shellTransport, containerElement: { style: {}, parentElement: null }, mpvSeparateWindow: false });
        shellTransport.emit('mpv-prop-change', { name: 'mpv-version', data: '0.41.0' });
        video.dispatch({ type: 'command', commandName: 'load', commandArgs: { stream: { url: 'https://example.test/external-off.mkv' }, platform: 'windows', assSubtitlesStyling: false, hardwareDecoding: false, gpuVideoProcessing: false, videoMode: null, time: 0 } });
        await flush();
        const primary = { id: 'external-main', lang: 'eng', url: 'https://example.test/main.srt' };
        const secondary = { id: 'external-spanish-track', lang: 'spa', url: 'https://example.test/secondary.srt' };
        video.dispatch({ type: 'command', commandName: 'addExtraSubtitlesTracks', commandArgs: { tracks: [primary, secondary] } });
        video.dispatch({ type: 'setProp', propName: 'selectedExtraSubtitlesTrackId', propValue: primary.id });
        shellTransport.emit('mpv-prop-change', { name: 'track-list', data: [
            { id: 10, type: 'sub', lang: 'eng', title: 'STREMIO_EXTRA_SUBTITLE:' + encodeURIComponent(primary.id), external: true },
        ] });
        video.dispatch({ type: 'setProp', propName: 'selectedSecondaryExtraSubtitlesTrackId', propValue: secondary.id });
        shellTransport.emit('mpv-prop-change', { name: 'track-list', data: [
            { id: 10, type: 'sub', lang: 'eng', title: 'STREMIO_EXTRA_SUBTITLE:' + encodeURIComponent(primary.id), external: true },
            { id: 11, type: 'sub', lang: 'spa', title: 'STREMIO_EXTRA_SUBTITLE:' + encodeURIComponent(secondary.id), external: true },
        ] });
        shellTransport.clear();
        video.dispatch({ type: 'setProp', propName: 'selectedSecondaryExtraSubtitlesTrackId', propValue: null });
        expect(hasSend(shellTransport, 'mpv-set-prop', ['secondary-sid', 'no'])).toBe(true);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['secondary-sub-delay', 0])).toBe(true);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['sid', 'no'])).toBe(false);
    });
    test('switches primary between external and embedded without leaving stale active sid', async () => {
        const shellTransport = new FakeShellTransport();
        const video = new ShellVideo({ shellTransport, containerElement: { style: {}, parentElement: null }, mpvSeparateWindow: false });
        shellTransport.emit('mpv-prop-change', { name: 'mpv-version', data: '0.41.0' });
        video.dispatch({ type: 'command', commandName: 'load', commandArgs: { stream: { url: 'https://example.test/switch.mkv' }, platform: 'windows', assSubtitlesStyling: false, hardwareDecoding: false, gpuVideoProcessing: false, videoMode: null, time: 0 } });
        await flush();
        const primary = { id: 'twincue:dual:v1:switch:main', lang: 'eng', url: 'https://example.test/switch-main.srt' };
        video.dispatch({ type: 'command', commandName: 'addExtraSubtitlesTracks', commandArgs: { tracks: [primary] } });
        shellTransport.emit('mpv-prop-change', { name: 'track-list', data: [
            { id: 5, type: 'sub', lang: 'eng', title: 'Embedded English' },
            { id: 10, type: 'sub', lang: 'eng', title: `STREMIO_EXTRA_SUBTITLE:${encodeURIComponent(primary.id)}`, external: true },
        ] });

        video.dispatch({ type: 'setProp', propName: 'selectedExtraSubtitlesTrackId', propValue: primary.id });
        shellTransport.clear();
        video.dispatch({ type: 'setProp', propName: 'selectedExtraSubtitlesTrackId', propValue: null });
        video.dispatch({ type: 'setProp', propName: 'selectedSubtitlesTrackId', propValue: 'EMBEDDED_5' });
        const sidWrites = shellTransport.sent.filter(([name, args]) => name === 'mpv-set-prop' && args[0] === 'sid');
        expect(sidWrites[sidWrites.length - 1]).toEqual(['mpv-set-prop', ['sid', '5']]);

        shellTransport.clear();
        video.dispatch({ type: 'setProp', propName: 'selectedSubtitlesTrackId', propValue: null });
        video.dispatch({ type: 'setProp', propName: 'selectedExtraSubtitlesTrackId', propValue: primary.id });
        const reverseSidWrites = shellTransport.sent.filter(([name, args]) => name === 'mpv-set-prop' && args[0] === 'sid');
        expect(reverseSidWrites[reverseSidWrites.length - 1]).toEqual(['mpv-set-prop', ['sid', '10']]);
    });

    test('new playback source clears secondary sid and its delay before loading', async () => {
        const shellTransport = new FakeShellTransport();
        const video = new ShellVideo({ shellTransport, containerElement: { style: {}, parentElement: null }, mpvSeparateWindow: false });
        shellTransport.emit('mpv-prop-change', { name: 'mpv-version', data: '0.41.0' });
        const load = (url) => video.dispatch({ type: 'command', commandName: 'load', commandArgs: { stream: { url }, platform: 'windows', assSubtitlesStyling: false, hardwareDecoding: false, gpuVideoProcessing: false, videoMode: null, time: 0 } });
        load('https://example.test/source-one.mkv');
        await flush();
        shellTransport.emit('mpv-prop-change', { name: 'track-list', data: [{ id: 5, type: 'sub', lang: 'eng' }, { id: 9, type: 'sub', lang: 'spa' }] });
        video.dispatch({ type: 'setProp', propName: 'selectedSubtitlesTrackId', propValue: 'EMBEDDED_5' });
        video.dispatch({ type: 'setProp', propName: 'selectedSecondarySubtitlesTrackId', propValue: 'EMBEDDED_9' });
        video.dispatch({ type: 'setProp', propName: 'extraSubtitlesDelay', propValue: -1000 });
        shellTransport.clear();
        load('https://example.test/source-two.mkv');
        await flush();
        expect(hasSend(shellTransport, 'mpv-set-prop', ['secondary-sid', 'no'])).toBe(true);
        expect(hasSend(shellTransport, 'mpv-set-prop', ['secondary-sub-delay', 0])).toBe(true);
    });

    test('advertises native external subtitle capabilities', () => {
        expect(ShellVideo.manifest.props).toContain('selectedExtraSubtitlesTrackId');
        expect(ShellVideo.manifest.props).toContain('selectedSecondarySubtitlesTrackId');
        expect(ShellVideo.manifest.props).toContain('selectedSecondaryExtraSubtitlesTrackId');
        expect(ShellVideo.manifest.props).toContain('secondarySubtitlesDelay');
        expect(ShellVideo.manifest.commands).toContain('addExtraSubtitlesTracks');
        expect(ShellVideo.manifest.events).toContain('secondaryExtraSubtitlesTrackLoaded');
    });
});
