/** @jest-environment jsdom */
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockInstances = [];

jest.mock('@stremio/stremio-video', () => {
    const EventEmitter = require('eventemitter3');
    return class MockVideo extends EventEmitter {
        constructor() {
            super();
            this.dispatched = [];
            mockInstances.push(this);
        }
        dispatch(action) {
            this.dispatched.push(action);
        }
        destroy() {}
    };
});
const useVideo = require('../src/routes/Player/useVideo');

const propWrites = (video) => video.dispatched
    .filter((action) => action.type === 'setProp')
    .map((action) => [action.propName, action.propValue]);

describe('useVideo dual subtitle controller', () => {
    let container;
    let root;
    let controller;

    beforeEach(async () => {
        mockInstances.length = 0;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        const Harness = () => {
            controller = useVideo();
            return React.createElement('div', { ref: controller.containerRef });
        };
        await act(async () => {
            root.render(React.createElement(Harness));
        });
        expect(mockInstances).toHaveLength(1);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    test('switching primary source clears the old source before selecting the new one and preserves secondary', async () => {
        const video = mockInstances[0];
        await act(async () => controller.setSubtitlesTrack('EMBEDDED_5'));
        expect(propWrites(video).slice(-2)).toEqual([
            ['selectedExtraSubtitlesTrackId', null],
            ['selectedSubtitlesTrackId', 'EMBEDDED_5'],
        ]);
        expect(propWrites(video)).not.toContainEqual(['selectedSecondarySubtitlesTrackId', null]);
        expect(propWrites(video)).not.toContainEqual(['selectedSecondaryExtraSubtitlesTrackId', null]);

        video.dispatched.length = 0;
        await act(async () => controller.setExtraSubtitlesTrack('twincue:dual:v1:pair:main'));
        expect(propWrites(video)).toEqual([
            ['selectedSubtitlesTrackId', null],
            ['selectedExtraSubtitlesTrackId', 'twincue:dual:v1:pair:main'],
        ]);
    });

    test('switching secondary source clears only the previous secondary source first', async () => {
        const video = mockInstances[0];
        await act(async () => controller.setSecondarySubtitlesTrack('EMBEDDED_9'));
        expect(propWrites(video)).toEqual([
            ['selectedSecondaryExtraSubtitlesTrackId', null],
            ['selectedSecondarySubtitlesTrackId', 'EMBEDDED_9'],
        ]);

        video.dispatched.length = 0;
        await act(async () => controller.setSecondaryExtraSubtitlesTrack('twincue:dual:v1:pair:secondary'));
        expect(propWrites(video)).toEqual([
            ['selectedSecondarySubtitlesTrackId', null],
            ['selectedSecondaryExtraSubtitlesTrackId', 'twincue:dual:v1:pair:secondary'],
        ]);
    });

    test('global and secondary delays are dispatched independently', async () => {
        const video = mockInstances[0];
        await act(async () => controller.setSubtitlesDelay(-3000));
        await act(async () => controller.setSecondarySubtitlesDelay(500));
        expect(propWrites(video)).toEqual([
            ['extraSubtitlesDelay', -3000],
            ['secondarySubtitlesDelay', 500],
        ]);
    });
});
