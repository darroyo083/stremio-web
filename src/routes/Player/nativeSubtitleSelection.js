// Copyright (C) 2017-2026 Smart code 203358507

const { getTwinCueTrackRole, findTwinCueSecondaryTrack } = require('./twinCueSubtitles');

const normalizeLanguage = (value) => {
    if (typeof value !== 'string' || value.length === 0) {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    const bracketedCode = /\[([a-z]{2,3})\]$/.exec(normalized);
    return bracketedCode ? bracketedCode[1] : normalized;
};

const languageMatches = (track, language) => {
    const normalized = normalizeLanguage(language);
    return normalized !== null && normalizeLanguage(track && track.lang) === normalized;
};

const findExact = (tracks, id, language) => {
    if (!Array.isArray(tracks) || typeof id !== 'string') {
        return null;
    }
    const track = tracks.find((candidate) => candidate && candidate.id === id);
    return track && (!language || languageMatches(track, language)) ? track : null;
};

const findByLanguage = (tracks, language, predicate) => {
    return Array.isArray(tracks) ? tracks.find((track) => track && languageMatches(track, language) && (!predicate || predicate(track))) || null : null;
};

const resolvePrimarySubtitle = ({ embeddedTracks, externalTracks, language, explicitSource, explicitId }) => {
    if (explicitSource === 'embedded') {
        const exact = findExact(embeddedTracks, explicitId, language);
        if (exact) return { source: 'embedded', track: exact };
    } else if (explicitSource === 'external') {
        const exact = findExact(externalTracks, explicitId, language);
        if (exact) return { source: 'external', track: exact };
    }

    const embedded = findByLanguage(embeddedTracks, language);
    if (embedded) return { source: 'embedded', track: embedded };

    const twinCueMain = findByLanguage(externalTracks, language, (track) => getTwinCueTrackRole(track.id) === 'main');
    if (twinCueMain) return { source: 'external', track: twinCueMain };

    const normalExternal = findByLanguage(externalTracks, language, (track) => getTwinCueTrackRole(track.id) !== 'secondary');
    return normalExternal ? { source: 'external', track: normalExternal } : null;
};

const resolveSecondarySubtitle = ({ embeddedTracks, externalTracks, language, primaryTrackId, explicitSource, explicitId }) => {
    if (explicitSource === 'embedded') {
        const exact = findExact(embeddedTracks, explicitId, language);
        if (exact) return { source: 'embedded', track: exact };
    } else if (explicitSource === 'external') {
        const exact = findExact(externalTracks, explicitId, language);
        if (exact) return { source: 'external', track: exact };
    }

    const embedded = findByLanguage(embeddedTracks, language);
    if (embedded) return { source: 'embedded', track: embedded };

    const paired = findTwinCueSecondaryTrack(externalTracks, primaryTrackId);
    if (paired && languageMatches(paired, language)) {
        return { source: 'external', track: paired };
    }

    const twinCueSecondary = findByLanguage(externalTracks, language, (track) => getTwinCueTrackRole(track.id) === 'secondary');
    return twinCueSecondary ? { source: 'external', track: twinCueSecondary } : null;
};

module.exports = {
    normalizeLanguage,
    languageMatches,
    resolvePrimarySubtitle,
    resolveSecondarySubtitle,
};
