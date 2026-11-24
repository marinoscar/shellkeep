'use strict';

// =============================================================================
// Product identity, read from identity.json  (issue #72)
// =============================================================================
//
// `identity.json` is the one place the product name, the CLI name and the
// repository slug are written; platform-infra sync and the CLI read the same
// file. This module is plain CommonJS with a hand-written index.d.ts so it
// needs no build step: the ESM CLI reads named exports from `exports.X = ...`
// assignments, and the api and web images install it as a workspace.
// =============================================================================

const identity = require('./identity.json');

/** The product's display name (`productName`). */
exports.APP_NAME = identity.productName;

/** The CLI executable's name (`cliName`); seeds `~/.<name>` and `<NAME>_`. */
exports.CLI_NAME = identity.cliName;

/** The GitHub repository as `owner/name` (`repoSlug`). */
exports.REPO_SLUG = identity.repoSlug;

/**
 * The fields the Android companion's identity derives from: the product name,
 * the repository slug and the optional `android` block of `identity.json`
 * (`{ applicationId?, deepLinkScheme?, storagePrefix?, apkStem? }`), frozen.
 * Pass it to `androidIdentity()` of `@marinoscar/platform-contract/android-app`.
 */
exports.ANDROID_IDENTITY_SOURCE = Object.freeze({
  productName: identity.productName,
  repoSlug: identity.repoSlug,
  ...(identity.android ? { android: Object.freeze({ ...identity.android }) } : {}),
});

// =============================================================================
// Brand tokens: the Option A palette  (issue #148, design of record #75)
// =============================================================================
//
// One token set drives every surface: the web themes (apps/web
// `platform/shellTheme.ts`), the PWA manifest and `theme-color` meta, the
// terminal's `follow-app` theme and the CLI's TUI theme. The Android build reads
// `themeColor` and `backgroundColor` straight from identity.json
// (`identity.gradle.kts`), which cannot import this module; the two fields are
// therefore the source of THEME_COLOR and BACKGROUND_COLOR, and the palette's
// light accent and dark background must equal them (shared-identity.test.ts).
// =============================================================================

/**
 * The product colour (`themeColor`): the browser and Android status bars and
 * the launcher icon background. The LIGHT accent, because white text and icons
 * sit on it and it keeps WCAG AA contrast with white (the dark accent does not).
 */
exports.THEME_COLOR = identity.themeColor;

/**
 * The splash and window background (`backgroundColor`): the DARK `bg`, so a
 * cold start does not flash white before a terminal-first, dark-default UI.
 */
exports.BACKGROUND_COLOR = identity.backgroundColor;

/**
 * The Option A palette, light and dark, frozen. Every value is a `#RRGGBB` hex.
 *
 *   bg, surface, surface2, chrome, line   page, cards, raised rows, app bar, borders
 *   text, muted                           primary and secondary text
 *   accent, accentInk, accentText         the brand fill, text on it, accent-coloured text
 *   ok, warn, err, info                   status tones (text-safe on bg and surface)
 *   term, termText                        the terminal's background and foreground
 */
exports.BRAND = Object.freeze({
  light: Object.freeze({
    bg: '#F6F7F9',
    surface: '#FFFFFF',
    surface2: '#F1F3F6',
    chrome: '#FFFFFF',
    line: '#DDE1E7',
    text: '#111827',
    muted: '#4B5563',
    accent: identity.themeColor,
    accentInk: '#FFFFFF',
    accentText: '#0F766E',
    ok: '#047857',
    warn: '#B45309',
    err: '#B91C1C',
    info: '#1D4ED8',
    term: '#FBFBFC',
    termText: '#1F2937',
  }),
  dark: Object.freeze({
    bg: identity.backgroundColor,
    surface: '#171A21',
    surface2: '#1B1F27',
    chrome: '#13161C',
    line: '#262B36',
    text: '#E6E8EE',
    muted: '#9AA3B2',
    accent: '#2DD4BF',
    accentInk: '#0B2B27',
    accentText: '#5EEAD4',
    ok: '#6EE7B7',
    warn: '#FBBF24',
    err: '#FCA5A5',
    info: '#93C5FD',
    term: '#0B0D11',
    termText: '#D1D5DB',
  }),
});
