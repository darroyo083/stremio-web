// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const PropTypes = require('prop-types');
const classnames = require('classnames');
const { languages } = require('stremio/common');
const { SUBTITLES_SIZES, DEFAULT_SUBTITLES_LANGUAGE, LOCAL_SUBTITLES_LANGUAGE } = require('stremio/common/CONSTANTS');
const { Button } = require('stremio/components');
const styles = require('./styles');
const { t } = require('i18next');
const { default: Stepper } = require('./Stepper');
const { default: SubtitleVariant } = require('./SubtitleVariant');
const { snapSubtitleDelay, SUBTITLES_DELAY_STEP_MS } = require('../subtitleDelay');

const ORIGIN_PRIORITIES = [
    'LOCAL',
    'EMBEDDED',
    'EXCLUSIVE',
];

const normalizeTracksLang = (tracks) => tracks.map((track) => ({
    ...track,
    lang: languages.toCode(track.lang),
}));

const sortByValues = (items, values) => items.sort((a, b) => {
    const left = values.indexOf(a);
    const right = values.indexOf(b);
    if (left === -1 && right === -1) return 0;
    if (left === -1) return 1;
    if (right === -1) return -1;
    return left - right;
});

const sortTracksByOrigin = (tracks) => tracks.slice().sort((a, b) => {
    const left = ORIGIN_PRIORITIES.indexOf(a.origin);
    const right = ORIGIN_PRIORITIES.indexOf(b.origin);
    if (left === -1 && right === -1) return 0;
    if (left === -1) return 1;
    if (right === -1) return -1;
    return left - right;
});

const SubtitlesMenu = React.memo(React.forwardRef((props, ref) => {
    const subtitlesTracks = React.useMemo(() => {
        return normalizeTracksLang(Array.isArray(props.subtitlesTracks) ? props.subtitlesTracks : []);
    }, [props.subtitlesTracks]);

    const extraSubtitlesTracks = React.useMemo(() => {
        return normalizeTracksLang(Array.isArray(props.extraSubtitlesTracks) ? props.extraSubtitlesTracks : []);
    }, [props.extraSubtitlesTracks]);

    const allSubtitles = React.useMemo(() => {
        return subtitlesTracks.concat(extraSubtitlesTracks);
    }, [subtitlesTracks, extraSubtitlesTracks]);

    const subtitlesLanguages = React.useMemo(() => {
        const userLanguage = languages.toCode(props.subtitlesLanguage) ?? DEFAULT_SUBTITLES_LANGUAGE;
        const interfaceLanguage = languages.toCode(props.interfaceLanguage) ?? DEFAULT_SUBTITLES_LANGUAGE;
        const priorities = [LOCAL_SUBTITLES_LANGUAGE, userLanguage, interfaceLanguage];
        const langs = [...new Set(allSubtitles.map(({ lang }) => lang))].sort((a, b) => a.localeCompare(b));
        return sortByValues(langs, priorities);
    }, [allSubtitles, props.subtitlesLanguage, props.interfaceLanguage]);

    const selectedSubtitlesLanguage = React.useMemo(() => {
        return typeof props.selectedSubtitlesTrackId === 'string' ?
            subtitlesTracks
                .reduce((selectedSubtitlesLanguage, { id, lang }) => {
                    if (id === props.selectedSubtitlesTrackId) {
                        return lang;
                    }

                    return selectedSubtitlesLanguage;
                }, null)
            :
            typeof props.selectedExtraSubtitlesTrackId === 'string' ?
                extraSubtitlesTracks
                    .reduce((selectedSubtitlesLanguage, { id, lang }) => {
                        if (id === props.selectedExtraSubtitlesTrackId) {
                            return lang;
                        }

                        return selectedSubtitlesLanguage;
                    }, null)
                :
                null;
    }, [subtitlesTracks, extraSubtitlesTracks, props.selectedSubtitlesTrackId, props.selectedExtraSubtitlesTrackId]);
    const selectedSecondarySubtitlesLanguage = React.useMemo(() => {
        const selectedId = typeof props.selectedSecondarySubtitlesTrackId === 'string' ?
            props.selectedSecondarySubtitlesTrackId
            :
            props.selectedSecondaryExtraSubtitlesTrackId;
        if (typeof selectedId !== 'string') {
            return null;
        }
        return allSubtitles.reduce((selectedLanguage, { id, lang }) => {
            return id === selectedId ? lang : selectedLanguage;
        }, null);
    }, [allSubtitles, props.selectedSecondarySubtitlesTrackId, props.selectedSecondaryExtraSubtitlesTrackId]);
    const secondarySubtitlesLanguages = React.useMemo(() => {
        return [...new Set(allSubtitles.map(({ lang }) => lang))]
            .filter((lang) => lang !== selectedSubtitlesLanguage)
            .sort((a, b) => a.localeCompare(b));
    }, [allSubtitles, selectedSubtitlesLanguage]);
    const subtitlesTracksForLanguage = React.useMemo(() => {
        return sortTracksByOrigin(allSubtitles.filter(({ lang }) => lang === selectedSubtitlesLanguage));
    }, [allSubtitles, selectedSubtitlesLanguage]);
    const secondaryTracksForLanguage = React.useMemo(() => {
        return sortTracksByOrigin(allSubtitles.filter(({ lang }) => lang === selectedSecondarySubtitlesLanguage));
    }, [allSubtitles, selectedSecondarySubtitlesLanguage]);
    const onMouseDown = React.useCallback((event) => {
        event.nativeEvent.subtitlesMenuClosePrevented = true;
    }, []);
    const subtitlesLanguageOnClick = React.useCallback((event) => {
        const tracks = allSubtitles.filter(({ lang }) => lang === event.currentTarget.dataset.lang);
        const track = sortTracksByOrigin(tracks).shift();

        if (!track) {
            if (typeof props.onSubtitlesTrackSelected === 'function') {
                props.onSubtitlesTrackSelected(null);
            }
            if (typeof props.onExtraSubtitlesTrackSelected === 'function') {
                props.onExtraSubtitlesTrackSelected(null);
            }
        } else if (track.embedded) {
            if (typeof props.onSubtitlesTrackSelected === 'function') {
                props.onSubtitlesTrackSelected(track);
            }
        } else {
            if (typeof props.onExtraSubtitlesTrackSelected === 'function') {
                props.onExtraSubtitlesTrackSelected(track);
            }
        }
    }, [allSubtitles, props.onSubtitlesTrackSelected, props.onExtraSubtitlesTrackSelected]);
    const subtitlesTrackOnSelect = React.useCallback((track) => {
        if (track.embedded) {
            if (typeof props.onSubtitlesTrackSelected === 'function') {
                props.onSubtitlesTrackSelected(track);
            }
        } else {
            if (typeof props.onExtraSubtitlesTrackSelected === 'function') {
                props.onExtraSubtitlesTrackSelected(track);
            }
        }
    }, [props.onSubtitlesTrackSelected, props.onExtraSubtitlesTrackSelected]);
    const secondarySubtitlesLanguageOnClick = React.useCallback((event) => {
        const lang = event.currentTarget.dataset.lang;
        if (typeof props.onSecondarySubtitlesLanguageSelected === 'function') {
            props.onSecondarySubtitlesLanguageSelected(typeof lang === 'string' ? lang : null);
        }
    }, [props.onSecondarySubtitlesLanguageSelected]);
    const secondaryTrackOnSelect = React.useCallback((track) => {
        if (track.embedded) {
            if (typeof props.onSecondarySubtitlesTrackSelected === 'function') {
                props.onSecondarySubtitlesTrackSelected(track);
            }
        } else if (typeof props.onSecondaryExtraSubtitlesTrackSelected === 'function') {
            props.onSecondaryExtraSubtitlesTrackSelected(track);
        }
    }, [props.onSecondarySubtitlesTrackSelected, props.onSecondaryExtraSubtitlesTrackSelected]);
    const onSubtitlesDelayChanged = React.useCallback((value) => {
        const primaryActive = typeof props.selectedSubtitlesTrackId === 'string' || typeof props.selectedExtraSubtitlesTrackId === 'string';
        if (primaryActive && props.extraSubtitlesDelay !== null && !isNaN(props.extraSubtitlesDelay) && typeof props.onExtraSubtitlesDelayChanged === 'function') {
            const delay = Math.round(value * 1000);
            props.onExtraSubtitlesDelayChanged(snapSubtitleDelay(delay, delay - props.extraSubtitlesDelay));
        }
    }, [props.selectedSubtitlesTrackId, props.selectedExtraSubtitlesTrackId, props.extraSubtitlesDelay, props.onExtraSubtitlesDelayChanged]);
    const onSecondarySubtitlesDelayChanged = React.useCallback((value) => {
        if (typeof props.onSecondarySubtitlesDelayChanged === 'function') {
            props.onSecondarySubtitlesDelayChanged(Math.round(value * 1000));
        }
    }, [props.onSecondarySubtitlesDelayChanged]);
    const onSubtitlesSizeChanged = React.useCallback((value) => {
        if (typeof props.selectedSubtitlesTrackId === 'string') {
            if (props.subtitlesSize !== null && !isNaN(props.subtitlesSize)) {
                if (typeof props.onSubtitlesSizeChanged === 'function') {
                    props.onSubtitlesSizeChanged(value);
                }
            }
        } else if (typeof props.selectedExtraSubtitlesTrackId === 'string') {
            if (props.extraSubtitlesSize !== null && !isNaN(props.extraSubtitlesSize)) {
                if (typeof props.onExtraSubtitlesSizeChanged === 'function') {
                    props.onExtraSubtitlesSizeChanged(value);
                }
            }
        }
    }, [props.selectedSubtitlesTrackId, props.selectedExtraSubtitlesTrackId, props.subtitlesSize, props.extraSubtitlesSize, props.onSubtitlesSizeChanged, props.onExtraSubtitlesSizeChanged]);
    const onSubtitlesOffsetChanged = React.useCallback((value) => {
        if (typeof props.selectedSubtitlesTrackId === 'string') {
            if (props.subtitlesOffset !== null && !isNaN(props.subtitlesOffset)) {
                if (typeof props.onSubtitlesOffsetChanged === 'function') {
                    props.onSubtitlesOffsetChanged(value);
                }
            }
        } else if (typeof props.selectedExtraSubtitlesTrackId === 'string') {
            if (props.extraSubtitlesOffset !== null && !isNaN(props.extraSubtitlesOffset)) {
                if (typeof props.onExtraSubtitlesOffsetChanged === 'function') {
                    props.onExtraSubtitlesOffsetChanged(value);
                }
            }
        }
    }, [props.selectedSubtitlesTrackId, props.selectedExtraSubtitlesTrackId, props.subtitlesOffset, props.extraSubtitlesOffset, props.onSubtitlesOffsetChanged, props.onExtraSubtitlesOffsetChanged]);
    return (
        <div ref={ref} className={classnames(props.className, styles['subtitles-menu-container'])} onMouseDown={onMouseDown}>
            <div className={styles['languages-container']}>
                <div className={styles['languages-header']}>{ t('PLAYER_SUBTITLES_LANGUAGES') }</div>
                <div className={styles['languages-list']}>
                    <Button title={t('OFF')} className={classnames(styles['language-option'], { 'selected': selectedSubtitlesLanguage === null })} onClick={subtitlesLanguageOnClick}>
                        <div className={styles['language-label']}>{ t('OFF') }</div>
                        {
                            selectedSubtitlesLanguage === null ?
                                <div className={styles['icon']} />
                                :
                                null
                        }
                    </Button>
                    {subtitlesLanguages.map((lang, index) => (
                        <Button key={index} title={languages.label(lang)} className={classnames(styles['language-option'], { 'selected': selectedSubtitlesLanguage === lang })} data-lang={lang} onClick={subtitlesLanguageOnClick}>
                            <div className={styles['language-label']}>
                                {
                                    lang === 'local' ? t('LOCAL') : languages.label(lang)
                                }
                            </div>
                            {
                                selectedSubtitlesLanguage === lang ?
                                    <div className={styles['icon']} />
                                    :
                                    null
                            }
                        </Button>
                    ))}
                </div>
            </div>
            <div className={styles['languages-container']}>
                <div className={styles['languages-header']}>{ t('SETTINGS_SECONDARY_SUBTITLES_LANGUAGE') }</div>
                <div className={styles['languages-list']}>
                    <Button title={t('OFF')} className={classnames(styles['language-option'], { 'selected': selectedSecondarySubtitlesLanguage === null })} onClick={secondarySubtitlesLanguageOnClick}>
                        <div className={styles['language-label']}>{ t('OFF') }</div>
                        {
                            selectedSecondarySubtitlesLanguage === null ?
                                <div className={styles['icon']} />
                                :
                                null
                        }
                    </Button>
                    {secondarySubtitlesLanguages.map((lang, index) => (
                        <Button key={index} title={languages.label(lang)} className={classnames(styles['language-option'], { 'selected': selectedSecondarySubtitlesLanguage === lang })} data-lang={lang} onClick={secondarySubtitlesLanguageOnClick}>
                            <div className={styles['language-label']}>{ languages.label(lang) }</div>
                            {
                                selectedSecondarySubtitlesLanguage === lang ?
                                    <div className={styles['icon']} />
                                    :
                                    null
                            }
                        </Button>
                    ))}
                </div>
            </div>
            {
                selectedSecondarySubtitlesLanguage !== null && secondaryTracksForLanguage.length > 1 ?
                    <div className={styles['variants-container']}>
                        <div className={styles['variants-header']}>{ t('PLAYER_SUBTITLES_VARIANTS') }</div>
                        <div className={styles['variants-list']}>
                            {secondaryTracksForLanguage.map((track, index) => (
                                <SubtitleVariant
                                    key={index}
                                    track={track}
                                    selected={props.selectedSecondarySubtitlesTrackId === track.id || props.selectedSecondaryExtraSubtitlesTrackId === track.id}
                                    onSelect={secondaryTrackOnSelect}
                                />
                            ))}
                        </div>
                    </div>
                    :
                    null
            }
            <div className={styles['variants-container']}>
                <div className={styles['variants-header']}>{ t('PLAYER_SUBTITLES_VARIANTS') }</div>
                {
                    subtitlesTracksForLanguage.length > 0 ?
                        <div className={styles['variants-list']}>
                            {subtitlesTracksForLanguage.map((track, index) => (
                                <SubtitleVariant
                                    key={index}
                                    track={track}
                                    selected={props.selectedSubtitlesTrackId === track.id || props.selectedExtraSubtitlesTrackId === track.id}
                                    onSelect={subtitlesTrackOnSelect}
                                />
                            ))}
                        </div>
                        :
                        <div className={styles['no-variants-container']}>
                            <div className={styles['no-variants-label']}>
                                { t('PLAYER_SUBTITLES_DISABLED') }
                            </div>
                        </div>
                }
            </div>
            <div className={styles['subtitles-settings-container']}>
                <div className={styles['settings-header']}>{t('PLAYER_SUBTITLES_SETTINGS')}</div>
                <div className={styles['settings-list']}>
                    <Stepper
                        className={styles['stepper']}
                        label={'DELAY'}
                        value={props.extraSubtitlesDelay / 1000}
                        unit={'s'}
                        step={SUBTITLES_DELAY_STEP_MS / 1000}
                        disabled={props.extraSubtitlesDelay === null}
                        onChange={onSubtitlesDelayChanged}
                    />
                    <Stepper
                        className={styles['stepper']}
                        label={'Secondary Delay'}
                        value={(props.secondarySubtitlesDelay ?? 0) / 1000}
                        unit={'s'}
                        step={SUBTITLES_DELAY_STEP_MS / 1000}
                        disabled={typeof props.selectedSecondarySubtitlesTrackId !== 'string' && typeof props.selectedSecondaryExtraSubtitlesTrackId !== 'string'}
                        onChange={onSecondarySubtitlesDelayChanged}
                    />
                    <Stepper
                        className={styles['stepper']}
                        label={'SIZE'}
                        value={props.selectedSubtitlesTrackId ? props.subtitlesSize : props.selectedExtraSubtitlesTrackId ? props.extraSubtitlesSize : null}
                        unit={'%'}
                        step={25}
                        min={SUBTITLES_SIZES[0]}
                        max={SUBTITLES_SIZES[SUBTITLES_SIZES.length - 1]}
                        disabled={props.assSubtitlesStylingActive || (props.selectedSubtitlesTrackId && props.subtitlesSize === null) || (props.selectedExtraSubtitlesTrackId && props.extraSubtitlesSize === null)}
                        onChange={onSubtitlesSizeChanged}
                    />
                    <Stepper
                        className={styles['stepper']}
                        label={'PLAYER_SUBTITLES_VERTICAL_POSITION'}
                        value={props.selectedSubtitlesTrackId ? props.subtitlesOffset : props.selectedExtraSubtitlesTrackId ? props.extraSubtitlesOffset : null}
                        unit={'%'}
                        step={1}
                        min={0}
                        max={100}
                        disabled={props.assSubtitlesStylingActive || (props.selectedSubtitlesTrackId && props.subtitlesOffset === null) || (props.selectedExtraSubtitlesTrackId && props.extraSubtitlesOffset === null)}
                        onChange={onSubtitlesOffsetChanged}
                    />
                </div>
            </div>
        </div>
    );
}));

SubtitlesMenu.displayName = 'MainNavBars';

SubtitlesMenu.propTypes = {
    className: PropTypes.string,
    subtitlesLanguage: PropTypes.string,
    interfaceLanguage: PropTypes.string,
    subtitlesTracks: PropTypes.arrayOf(PropTypes.shape({
        id: PropTypes.string.isRequired,
        lang: PropTypes.string.isRequired,
        origin: PropTypes.string.isRequired,
        ass: PropTypes.bool
    })),
    selectedSubtitlesTrackId: PropTypes.string,
    subtitlesOffset: PropTypes.number,
    subtitlesSize: PropTypes.number,
    extraSubtitlesTracks: PropTypes.arrayOf(PropTypes.shape({
        id: PropTypes.string.isRequired,
        lang: PropTypes.string.isRequired,
        origin: PropTypes.string.isRequired,
        label: PropTypes.string,
        url: PropTypes.string,
        embedded: PropTypes.bool,
        local: PropTypes.bool,
        exclusive: PropTypes.bool,
        ass: PropTypes.bool
    })),
    selectedExtraSubtitlesTrackId: PropTypes.string,
    selectedSecondarySubtitlesTrackId: PropTypes.string,
    selectedSecondaryExtraSubtitlesTrackId: PropTypes.string,
    extraSubtitlesOffset: PropTypes.number,
    extraSubtitlesDelay: PropTypes.number,
    secondarySubtitlesDelay: PropTypes.number,
    extraSubtitlesSize: PropTypes.number,
    assSubtitlesStylingActive: PropTypes.bool,
    onSubtitlesTrackSelected: PropTypes.func,
    onExtraSubtitlesTrackSelected: PropTypes.func,
    onSecondarySubtitlesLanguageSelected: PropTypes.func,
    onSecondarySubtitlesTrackSelected: PropTypes.func,
    onSecondaryExtraSubtitlesTrackSelected: PropTypes.func,
    onSubtitlesOffsetChanged: PropTypes.func,
    onSubtitlesSizeChanged: PropTypes.func,
    onExtraSubtitlesOffsetChanged: PropTypes.func,
    onExtraSubtitlesDelayChanged: PropTypes.func,
    onSecondarySubtitlesDelayChanged: PropTypes.func,
    onExtraSubtitlesSizeChanged: PropTypes.func
};

module.exports = SubtitlesMenu;
