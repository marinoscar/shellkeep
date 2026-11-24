-- =============================================================================
-- Folder archives: the record of a `files.archive` job and its stored tar.gz (#158)
-- =============================================================================
--
-- One org-owned table with a NOT NULL org_id and a FORCEd file_archives_org_isolation policy copied
-- from 0025_org_scoped_rls. The link to the server is a plain foreign key (server_profiles is not under
-- row-level security) with ON DELETE SET NULL.
--
--   status  pending | running | ready | failed   ("expired" is derived from expires_at, never stored)
--
-- No backfill: the table is new. The transaction carries app.rls_bypass as the first statement.
-- =============================================================================

BEGIN;
SELECT set_config('app.rls_bypass', 'on', true);


-- CreateTable
CREATE TABLE "file_archives" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "server_profile_id" UUID,
    "path" VARCHAR(4096) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "job_id" UUID,
    "storage_key" VARCHAR(512),
    "size_bytes" BIGINT,
    "warning" VARCHAR(255),
    "error_code" VARCHAR(64),
    "error_message" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "file_archives_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "file_archives_org_id_user_id_created_at_idx" ON "file_archives"("org_id", "user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "file_archives_expires_at_idx" ON "file_archives"("expires_at");

-- CreateIndex
CREATE INDEX "file_archives_server_profile_id_idx" ON "file_archives"("server_profile_id");

-- AddForeignKey
ALTER TABLE "file_archives" ADD CONSTRAINT "file_archives_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_archives" ADD CONSTRAINT "file_archives_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_archives" ADD CONSTRAINT "file_archives_server_profile_id_fkey" FOREIGN KEY ("server_profile_id") REFERENCES "server_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CHECK constraint: the allowed states.
ALTER TABLE "file_archives" ADD CONSTRAINT "file_archives_status_check"
  CHECK ("status" IN ('pending','running','ready','failed'));

-- Row-level security, as in 0025_org_scoped_rls.
ALTER TABLE "file_archives" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "file_archives" FORCE ROW LEVEL SECURITY;
CREATE POLICY "file_archives_org_isolation" ON "file_archives"
  USING      ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on')
  WITH CHECK ("org_id" = NULLIF(current_setting('app.org_id', true), '')::uuid
              OR current_setting('app.rls_bypass', true) = 'on');

COMMIT;
