/**
 * Who a request acts as: the user and the organization of the request.
 *
 * Built from the platform principal (`@CurrentUser('id')` and `@CurrentOrg()`
 * in an HTTP controller, `TerminalPrincipalResolver` on the WebSocket). Every
 * query on a user-owned, org-stamped table names BOTH keys in its `where`, so a
 * row of another user or another organization is a 404, never a leak.
 */
export interface OwnerScope {
  readonly userId: string;
  readonly orgId: string;
}
