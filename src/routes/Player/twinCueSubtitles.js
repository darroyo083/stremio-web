// Copyright (C) 2017-2026 Smart code 203358507

const getTwinCueTrackRole = (id) => {
    if (typeof id !== 'string') {
        return null;
    }

    const match = /^twincue:dual:v1:.+:(main|secondary)$/.exec(id);
    return match ? match[1] : null;
};

const getTwinCueSecondaryTrackId = (id) => {
    if (typeof id !== 'string') {
        return null;
    }

    const match = /^(twincue:dual:v1:.+):main$/.exec(id);
    return match ? `${match[1]}:secondary` : null;
};

const findTwinCueSecondaryTrack = (tracks, primaryTrackId) => {
    const secondaryTrackId = getTwinCueSecondaryTrackId(primaryTrackId);
    if (secondaryTrackId === null || !Array.isArray(tracks)) {
        return null;
    }

    return tracks.find((track) => track && track.id === secondaryTrackId) || null;
};

module.exports = {
    getTwinCueTrackRole,
    getTwinCueSecondaryTrackId,
    findTwinCueSecondaryTrack,
};
