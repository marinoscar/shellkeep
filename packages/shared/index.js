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
