-- =============================================================================
-- Sharing: group ownership of server profiles and runbooks (#71)
-- =============================================================================
--
-- ADDITIVE and nullable: a NULL owner_group_id means "owned by the user" (server_profiles.user_id,
-- runbooks.owner_user_id), exactly as before, so no backfill is needed. `org_id` already exists and is
-- NOT NULL on both tables (20261123192649_shellkeep_domain_org_id, 20261124005023_add_runbooks).
--
-- COMPOSITE FOREIGN KEYS (org_id, owner_group_id) -> groups (id, org_id), the target being the
-- groups_id_org_id_key unique index of the sharing slice: a foreign-key check bypasses row-level
-- security, so a plain key could let one organization point at another's group. The pair is
-- MATCH SIMPLE, so a NULL owner_group_id is not checked. ON DELETE NO ACTION (end-of-statement):
-- SET NULL would null org_id too, and RESTRICT would block an organization delete that cascades to both
-- tables; the application refuses to delete a group that owns a row (409 GROUP_OWNS_RESOURCES).
--
-- server_profiles has no row-level security (docs/platform-adoption/local-exceptions.md); runbooks is an
-- org table under forced RLS, so the transaction carries app.rls_bypass as its first statement, as every
-- migration that touches an org table does.
-- =============================================================================

BEGIN;
SELECT set_config('app.rls_bypass', 'on', true);

-- AlterTable
ALTER TABLE "runbooks" ADD COLUMN     "owner_group_id" UUID;

-- AlterTable
ALTER TABLE "server_profiles" ADD COLUMN     "owner_group_id" UUID;

-- CreateIndex
CREATE INDEX "runbooks_org_id_owner_group_id_idx" ON "runbooks"("org_id", "owner_group_id");

-- CreateIndex
CREATE INDEX "server_profiles_org_id_owner_group_id_idx" ON "server_profiles"("org_id", "owner_group_id");

-- AddForeignKey
ALTER TABLE "runbooks" ADD CONSTRAINT "runbooks_owner_group_id_org_id_fkey" FOREIGN KEY ("owner_group_id", "org_id") REFERENCES "groups"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_profiles" ADD CONSTRAINT "server_profiles_owner_group_id_org_id_fkey" FOREIGN KEY ("owner_group_id", "org_id") REFERENCES "groups"("id", "org_id") ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT;
