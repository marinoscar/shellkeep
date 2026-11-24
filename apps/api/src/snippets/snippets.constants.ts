/** Limits of a snippet; the migration repeats them as CHECK constraints. */
export const SNIPPET_TITLE_MAX = 80;
export const SNIPPET_BODY_MAX_BYTES = 4096;
export const SNIPPET_TAGS_MAX = 8;
export const SNIPPET_TAG_MAX = 24;
/** Snippets one user may keep. */
export const SNIPPETS_PER_USER_MAX = 200;
/** The search text cap. */
export const SNIPPET_QUERY_MAX = 100;

/** Requests per user and minute. Reads are cheap; writes are the abuse surface. */
export const SNIPPET_READS_PER_MINUTE = 120;
export const SNIPPET_WRITES_PER_MINUTE = 60;

export const SNIPPET_WARNING_SECRET = 'looks-like-secret' as const;
export type SnippetWarning = typeof SNIPPET_WARNING_SECRET;
