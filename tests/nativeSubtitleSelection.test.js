const {
    resolvePrimarySubtitle,
    resolveSecondarySubtitle,
    resolveSecondaryLanguageSelection,
    reconcileSecondaryPreferenceForStreamChange,
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

    test('preserves baseline OFF to language behavior with a normal external secondary track', () => {
        const ordinaryExternalSpa = { id: 'external-spanish-track', lang: 'spa', origin: 'OpenSubtitles' };
        expect(resolveSecondarySubtitle({
            embeddedTracks: [],
            externalTracks: [ordinaryExternalSpa],
            language: 'spa',
            primaryTrackId: 'external-english-track',
        })).toEqual({ source: 'external', track: ordinaryExternalSpa });
    });
    test('keeps an explicit Spanish language selected while tracks are temporarily unavailable', () => {
        const preference = { enabled: true, language: 'spa' };
        expect(resolveSecondaryLanguageSelection({
            preference,
            embeddedTracks: [],
            externalTracks: [],
            selectedEmbeddedId: null,
            selectedExternalId: null,
        })).toBe('spa');

        expect(resolveSecondaryLanguageSelection({
            preference,
            embeddedTracks: [embeddedEngA],
            externalTracks: [twinMain],
            selectedEmbeddedId: null,
            selectedExternalId: null,
        })).toBe('spa');

        expect(resolveSecondaryLanguageSelection({
            preference,
            embeddedTracks: [embeddedEngA, embeddedSpa],
            externalTracks: [twinMain, twinSecondary],
            selectedEmbeddedId: 'EMBEDDED_9',
            selectedExternalId: null,
        })).toBe('spa');
    });

    test('treats OFF as an explicit choice even if a stale secondary track is still reported', () => {
        expect(resolveSecondaryLanguageSelection({
            preference: { enabled: false },
            embeddedTracks: [embeddedSpa],
            externalTracks: [twinSecondary],
            selectedEmbeddedId: 'EMBEDDED_9',
            selectedExternalId: twinSecondary.id,
        })).toBeNull();
    });

    test('uses the applied secondary language when no explicit language preference exists', () => {
        expect(resolveSecondaryLanguageSelection({
            preference: null,
            embeddedTracks: [],
            externalTracks: [twinSecondary],
            selectedEmbeddedId: null,
            selectedExternalId: twinSecondary.id,
        })).toBe('spa');
    });
    test('keeps an explicit embedded Italian secondary variant authoritative over external fallback', () => {
        const embeddedIta = { id: 'EMBEDDED_9', lang: 'it', embedded: true, origin: 'EMBEDDED', label: 'Italiano' };
        const externalIta = { id: 'external-italian-1', lang: 'ita', origin: 'OpenSubtitles' };
        const args = {
            embeddedTracks: [embeddedIta],
            externalTracks: [externalIta],
            language: 'ita',
            primaryTrackId: embeddedEngA.id,
            explicitSource: 'embedded',
            explicitId: embeddedIta.id,
        };

        expect(resolveSecondarySubtitle(args)).toEqual({ source: 'embedded', track: embeddedIta });
        expect(resolveSecondarySubtitle({
            ...args,
            embeddedTracks: [embeddedEngA, embeddedIta],
            externalTracks: [twinMain, externalIta],
        })).toEqual({ source: 'embedded', track: embeddedIta });
        expect(resolveSecondarySubtitle({
            ...args,
            primaryTrackId: twinMain.id,
        })).toEqual({ source: 'embedded', track: embeddedIta });
    });

    test('keeps a Forced embedded Italian secondary variant authoritative', () => {
        const forcedIta = { id: 'EMBEDDED_10', lang: 'it', embedded: true, origin: 'EMBEDDED', label: 'Forced' };
        const externalIta = { id: 'external-italian-1', lang: 'ita', origin: 'OpenSubtitles' };
        expect(resolveSecondarySubtitle({
            embeddedTracks: [forcedIta],
            externalTracks: [externalIta],
            language: 'ita',
            primaryTrackId: embeddedEngA.id,
            explicitSource: 'embedded',
            explicitId: forcedIta.id,
        })).toEqual({ source: 'embedded', track: forcedIta });
    });

    test('falls back by canonical Italian language only after the explicit embedded variant disappears', () => {
        const embeddedIta = { id: 'EMBEDDED_9', lang: 'it', embedded: true, origin: 'EMBEDDED' };
        const externalIta = { id: 'external-italian-1', lang: 'ita', origin: 'OpenSubtitles' };
        expect(resolveSecondarySubtitle({
            embeddedTracks: [],
            externalTracks: [externalIta],
            language: 'ita',
            primaryTrackId: embeddedEngA.id,
            explicitSource: 'embedded',
            explicitId: embeddedIta.id,
        })).toEqual({ source: 'external', track: externalIta });
    });

    test('allows explicit secondary variant switching in both directions', () => {
        const embeddedIta = { id: 'EMBEDDED_9', lang: 'it', embedded: true, origin: 'EMBEDDED' };
        const externalIta = { id: 'external-italian-1', lang: 'ita', origin: 'OpenSubtitles' };
        const common = {
            embeddedTracks: [embeddedIta],
            externalTracks: [externalIta],
            language: 'ita',
            primaryTrackId: embeddedEngA.id,
        };
        expect(resolveSecondarySubtitle({
            ...common,
            explicitSource: 'embedded',
            explicitId: embeddedIta.id,
        })).toEqual({ source: 'embedded', track: embeddedIta });
        expect(resolveSecondarySubtitle({
            ...common,
            explicitSource: 'external',
            explicitId: externalIta.id,
        })).toEqual({ source: 'external', track: externalIta });
    });
    test('drops per-video secondary variant identity on source change but preserves language and OFF', () => {
        expect(reconcileSecondaryPreferenceForStreamChange({
            enabled: true,
            language: 'it',
            source: 'embedded',
            id: 'EMBEDDED_9',
        })).toEqual({ enabled: true, language: 'ita' });
        expect(reconcileSecondaryPreferenceForStreamChange({
            enabled: false,
            source: 'external',
            id: 'external-italian-1',
        })).toEqual({ enabled: false, source: 'external', id: 'external-italian-1' });
        expect(reconcileSecondaryPreferenceForStreamChange({ enabled: true, language: 'ita' }))
            .toEqual({ enabled: true, language: 'ita' });
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
