const {
    getTwinCueTrackRole,
    getTwinCueSecondaryTrackId,
    findTwinCueSecondaryTrack,
} = require('../src/routes/Player/twinCueSubtitles');

describe('TwinCue dual-track pairing', () => {
    test('identifies TwinCue component roles', () => {
        expect(getTwinCueTrackRole('twincue:dual:v1:pair:main')).toBe('main');
        expect(getTwinCueTrackRole('twincue:dual:v1:pair:secondary')).toBe('secondary');
        expect(getTwinCueTrackRole('opensubtitles:eng:123')).toBeNull();
    });

    test('derives the matching secondary id from a main id', () => {
        expect(getTwinCueSecondaryTrackId('twincue:dual:v1:abc123:main')).toBe('twincue:dual:v1:abc123:secondary');
        expect(getTwinCueSecondaryTrackId('twincue:dual:v1:pair:with:colons:main')).toBe('twincue:dual:v1:pair:with:colons:secondary');
        expect(getTwinCueSecondaryTrackId('twincue:dual:v1:abc123:secondary')).toBeNull();
        expect(getTwinCueSecondaryTrackId('opensubtitles:eng:123')).toBeNull();
    });

    test('finds only the secondary track from the same TwinCue pair', () => {
        const tracks = [
            { id: 'twincue:dual:v1:other:secondary', lang: 'spa' },
            { id: 'twincue:dual:v1:pair:secondary', lang: 'spa' },
            { id: 'twincue:dual:v1:pair:main', lang: 'eng' },
        ];

        expect(findTwinCueSecondaryTrack(tracks, 'twincue:dual:v1:pair:main')).toEqual(tracks[1]);
        expect(findTwinCueSecondaryTrack(tracks, 'opensubtitles:eng:123')).toBeNull();
    });
});