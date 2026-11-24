/** The product's display name (`productName` in identity.json). */
export declare const APP_NAME: string;

/** The CLI executable's name (`cliName` in identity.json). */
export declare const CLI_NAME: string;

/** The GitHub repository as `owner/name` (`repoSlug` in identity.json). */
export declare const REPO_SLUG: string;

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
