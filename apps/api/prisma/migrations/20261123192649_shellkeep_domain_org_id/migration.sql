-- ShellKeep domain tables become organization-owned (expand, backfill, contract
-- in one migration; the tables are small). Every existing row is stamped with
-- the default organization that platform migration 0023 creates. The columns
-- carry org_id but the tables are NOT under row-level security (single
-- organization only): docs/platform-adoption/local-exceptions.md.

-- AlterTable
ALTER TABLE "server_profiles" ADD COLUMN "org_id" UUID;
ALTER TABLE "terminal_sessions" ADD COLUMN "org_id" UUID;

-- Backfill: the default organization. A missing default organization leaves a
-- NULL and the SET NOT NULL below fails the migration loudly.
UPDATE "server_profiles" SET "org_id" = (SELECT "id" FROM "organizations" WHERE "is_default");
UPDATE "terminal_sessions" SET "org_id" = (SELECT "id" FROM "organizations" WHERE "is_default");

-- AlterTable
ALTER TABLE "server_profiles" ALTER COLUMN "org_id" SET NOT NULL;
ALTER TABLE "terminal_sessions" ALTER COLUMN "org_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "server_profiles_org_id_user_id_idx" ON "server_profiles"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "terminal_sessions_org_id_user_id_idx" ON "terminal_sessions"("org_id", "user_id");

-- AddForeignKey
ALTER TABLE "server_profiles" ADD CONSTRAINT "server_profiles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
