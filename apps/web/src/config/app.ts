/**
 * The product name the UI and the packaged pages show (the sign-in error copy
 * of `@marinoscar/platform-web/identity` names it). The source of truth for the
 * whole product is `packages/shared/identity.json`; keep the two in step.
 */
export const APP_NAME = 'ShellKeep';

/**
 * The web app's version (its `package.json`), shown in the user menu's footer.
 * A named import, so the bundler inlines this one field and not the manifest.
 */
export { version as APP_VERSION } from '../../package.json';
