/** The product's display name (`productName` in identity.json). */
export declare const APP_NAME: string;

/** The CLI executable's name (`cliName` in identity.json). */
export declare const CLI_NAME: string;

/** The GitHub repository as `owner/name` (`repoSlug` in identity.json). */
export declare const REPO_SLUG: string;

/** The one-line product description (`tagline` in identity.json), or `undefined` when unset. */
export declare const TAGLINE: string | undefined;

/**
 * The fields the Android companion's identity derives from: pass it to
 * `androidIdentity()` of `@marinoscar/platform-contract/android-app`.
 * `android` is the optional block of `identity.json`; each field overrides one
 * derived default.
 */
export declare const ANDROID_IDENTITY_SOURCE: {
  readonly productName: string;
  readonly repoSlug: string;
  readonly android?: {
    readonly applicationId?: string;
    readonly deepLinkScheme?: string;
    readonly storagePrefix?: string;
    readonly apkStem?: string;
  };
};

/**
 * The product colour (`themeColor` in identity.json): the browser and Android
 * status bars. The light accent, chosen for contrast with white.
 */
export declare const THEME_COLOR: string;

/** The splash and window background (`backgroundColor` in identity.json): the dark `bg`. */
export declare const BACKGROUND_COLOR: string;

/** One mode of the Option A palette; every value is a `#RRGGBB` hex. */
export interface BrandTokens {
  /** Page background. */
  readonly bg: string;
  /** Cards and dialogs. */
  readonly surface: string;
  /** Raised rows inside a surface. */
  readonly surface2: string;
  /** The app bar and rail. */
  readonly chrome: string;
  /** Borders and dividers. */
  readonly line: string;
  /** Primary text. */
  readonly text: string;
  /** Secondary text. */
  readonly muted: string;
  /** The brand fill (buttons, the brand mark). */
  readonly accent: string;
  /** Text and icons on an `accent` fill. */
  readonly accentInk: string;
  /** Accent-coloured text on `bg` or `surface`. */
  readonly accentText: string;
  /** Success. */
  readonly ok: string;
  /** Warning. */
  readonly warn: string;
  /** Error. */
  readonly err: string;
  /** Informational. */
  readonly info: string;
  /** The terminal background. */
  readonly term: string;
  /** The terminal foreground. */
  readonly termText: string;
}

/** The Option A palette (issue #148): light and dark. */
export declare const BRAND: {
  readonly light: BrandTokens;
  readonly dark: BrandTokens;
};
