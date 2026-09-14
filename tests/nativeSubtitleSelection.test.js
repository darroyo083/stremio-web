const {
    resolvePrimarySubtitle,
    resolveSecondarySubtitle,
} = require('../src/routes/Player/nativeSubtitleSelection');

const embeddedEngA = { id: 'EMBEDDED_5', lang: 'eng', embedded: true, origin: 'EMBEDDED' };
const embeddedEngB = { id: 'EMBEDDED_7', lang: 'eng', embedded: true, origin: 'EMBEDDED' };
const embeddedSpa = { id: 'EMBEDDED_9', lang: 'spa', embedded: true, origin: 'EMBEDDED' };
const twinMain = { id: 'twincue:dual:v1:pair:main', lang: 'eng', origin: 'TwinCue' };
const twinSecondary = { id: 'twincue:dual:v1:pair:secondary', lang: 'spa', origin: 'TwinCue' };

describe('native dual subtitle fallback hierarchy', () => {
    test('prefers embedded primary and embedded secondary when both languages are embedded', () => {
        expect(resolvePrimarySubtitle({
            embeddedTracks: [embeddedEngA, embeddedSpa],
            externalTracks: [twinMain, twinSecondary],
            language: 'eng',
        })).toEqual({ source: 'embedded', track: embeddedEngA });
        expect(resolveSecondarySubtitle({
            embeddedTracks: [embeddedEngA, embeddedSpa],
            externalTracks: [twinMain, twinSecondary],
            language: 'spa',
            primaryTrackId: embeddedEngA.id,
        })).toEqual({ source: 'embedded', track: embeddedSpa });
    });

    test('falls back from embedded primary to paired TwinCue secondary', () => {
        expect(resolvePrimarySubtitle({
            embeddedTracks: [embeddedEngA],
            externalTracks: [twinMain, twinSecondary],
            language: 'eng',
        })).toEqual({ source: 'embedded', track: embeddedEngA });
        expect(resolveSecondarySubtitle({
            embeddedTracks: [embeddedEngA],
            externalTracks: [twinMain, twinSecondary],
            language: 'spa',
            primaryTrackId: twinMain.id,
        })).toEqual({ source: 'external', track: twinSecondary });
    });

    test('falls back from TwinCue primary to embedded secondary', () => {
        expect(resolvePrimarySubtitle({
            embeddedTracks: [embeddedSpa],
            externalTracks: [twinMain, twinSecondary],
            language: 'eng',
        })).toEqual({ source: 'external', track: twinMain });
        expect(resolveSecondarySubtitle({
            embeddedTracks: [embeddedSpa],
            externalTracks: [twinMain, twinSecondary],
            language: 'spa',
            primaryTrackId: twinMain.id,
        })).toEqual({ source: 'embedded', track: embeddedSpa });
    });

    test('keeps TwinCue external primary and secondary as final fallback', () => {
        expect(resolvePrimarySubtitle({
            embeddedTracks: [],
            externalTracks: [twinMain, twinSecondary],
            language: 'eng',
        })).toEqual({ source: 'external', track: twinMain });
        expect(resolveSecondarySubtitle({
            embeddedTracks: [],
            externalTracks: [twinMain, twinSecondary],
            language: 'spa',
            primaryTrackId: twinMain.id,
        })).toEqual({ source: 'external', track: twinSecondary });
    });

    test('preserves an explicit embedded variant by real track id', () => {
        expect(resolvePrimarySubtitle({
            embeddedTracks: [embeddedEngA, embeddedEngB],
            externalTracks: [twinMain],
            language: 'eng',
            explicitSource: 'embedded',
            explicitId: embeddedEngB.id,
        })).toEqual({ source: 'embedded', track: embeddedEngB });

        expect(resolveSecondarySubtitle({
            embeddedTracks: [embeddedEngA, embeddedEngB],
            externalTracks: [],
            language: 'eng',
            explicitSource: 'embedded',
            explicitId: embeddedEngB.id,
        })).toEqual({ source: 'embedded', track: embeddedEngB });
    });
});
