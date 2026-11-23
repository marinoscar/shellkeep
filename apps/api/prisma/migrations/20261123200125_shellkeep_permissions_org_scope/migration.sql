-- =============================================================================
-- ShellKeep's domain permissions become org-scoped (issue #47)
-- =============================================================================
--
-- Platform migration 0024_split_system_org_roles moved the platform's org
-- permissions onto the org roles (org_admin, contributor, viewer) held on a
-- membership. ShellKeep's six domain permissions were declared after it, so they
-- still carry the column default scope 'system' and the `admin` role still holds
-- them. The identity slice resolves a user's effective permissions as the system
-- roles' system-scope grants plus the grants of the current organization's
-- membership role, so they move the same way 0024 moved the platform's:
--
--   1. the six permissions become scope 'org';
--   2. admin's grants of them are copied to org_admin (every administrator holds
--      org_admin on their membership since 0024, so no administrator loses one);
--   3. admin's grants of them are deleted.
--
-- contributor and viewer already hold their grants and are untouched. The seed
-- (seedPlatform) writes the same scope and the same org_admin grants from the
-- registered declarations, but never deletes a grant, so step 3 has to be here.
-- Idempotent and a no-op on a database the seed has not reached yet.
-- =============================================================================

UPDATE "permissions" SET "scope" = 'org'
WHERE "name" IN (
  'servers:read', 'servers:write', 'servers:delete',
  'sessions:read', 'sessions:write', 'sessions:delete'
);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT oa."id", rp."permission_id"
FROM "role_permissions" rp
JOIN "roles" a ON a."id" = rp."role_id" AND a."name" = 'admin'
JOIN "permissions" p ON p."id" = rp."permission_id"
 AND p."name" IN (
  'servers:read', 'servers:write', 'servers:delete',
  'sessions:read', 'sessions:write', 'sessions:delete'
 )
CROSS JOIN "roles" oa
WHERE oa."name" = 'org_admin'
ON CONFLICT DO NOTHING;

DELETE FROM "role_permissions" rp
USING "roles" a, "permissions" p
WHERE rp."role_id" = a."id" AND a."name" = 'admin'
  AND rp."permission_id" = p."id"
  AND p."name" IN (
    'servers:read', 'servers:write', 'servers:delete',
    'sessions:read', 'sessions:write', 'sessions:delete'
  );
