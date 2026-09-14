// Copyright (C) 2017-2026 Smart code 203358507

const { getTwinCueTrackRole, findTwinCueSecondaryTrack } = require('./twinCueSubtitles');
const allLanguages = require('langs').all();

const normalizeLanguage = (value) => {
    if (typeof value !== 'string' || value.length === 0) {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    const bracketedCode = /\[([a-z]{2,3})\]$/.exec(normalized);
    const code = bracketedCode ? bracketedCode[1] : normalized;
    const language = allLanguages.find((candidate) => [candidate['1'], candidate['2'], candidate['2B'], candidate['2T'], candidate['3'], candidate.ietf].includes(code));
    return language ? language['2'] : code;
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

const resolveSecondaryLanguageSelection = ({
    preference,
    embeddedTracks,
    externalTracks,
    selectedEmbeddedId,
    selectedExternalId,
}) => {
    if (preference !== null && preference !== undefined) {
        if (preference.enabled === false) {
            return null;
        }
        if (preference.enabled === true) {
            const preferredLanguage = normalizeLanguage(preference.language);
            if (preferredLanguage !== null) {
                return preferredLanguage;
            }
        }
    }

    const selectedEmbedded = findExact(embeddedTracks, selectedEmbeddedId);
    if (selectedEmbedded) {
        return normalizeLanguage(selectedEmbedded.lang);
    }

    const selectedExternal = findExact(externalTracks, selectedExternalId);
    return selectedExternal ? normalizeLanguage(selectedExternal.lang) : null;
};
const reconcileSecondaryPreferenceForStreamChange = (preference) => {
    if (!preference || preference.enabled !== true || (!preference.source && !preference.id)) {
        return preference;
    }
    const language = normalizeLanguage(preference.language);
    return {
        enabled: true,
        ...(language ? { language } : {}),
    };
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
    if (twinCueSecondary) return { source: 'external', track: twinCueSecondary };

    // Compatibility with the previously working external+external selector: not every
    // external subtitle track keeps a TwinCue-shaped id after it reaches the player.
    // An explicit language choice must still be able to select any matching external
    // track while preferring paired/TwinCue secondaries when they are identifiable.
    const normalExternal = findByLanguage(externalTracks, language);
    return normalExternal ? { source: 'external', track: normalExternal } : null;
};

module.exports = {
    normalizeLanguage,
    languageMatches,
    resolvePrimarySubtitle,
    resolveSecondarySubtitle,
    resolveSecondaryLanguageSelection,
    reconcileSecondaryPreferenceForStreamChange,
};
