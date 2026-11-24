-- =============================================================================
-- Terminal snippets: saved text the key panel inserts into the terminal (#172)
-- =============================================================================
--
-- A user-owned table (user_id, cascade on user delete) with org_id as a REFERENCE, the same shape as
-- terminal_sessions and server_profiles: a snippet is private to its owner and never shared, so it is not
-- an org table and has no row-level security. Every query names the owner.
--
-- Why a table and not the `shortcuts` settings namespace: snippets are user content with ordering, search
-- and potentially many rows; a settings document has a size cap, is replaced whole on every write and
-- cannot be ordered or searched in the database.
--
-- The limits are repeated as CHECK constraints (the API validates them first): title 1..80 characters,
-- body 1..4096 bytes, at most 8 tags. No backfill: the table is new.
-- =============================================================================


-- CreateTable
CREATE TABLE "snippets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "snippets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "snippets_user_id_position_idx" ON "snippets"("user_id", "position");

-- CreateIndex
CREATE INDEX "snippets_org_id_user_id_idx" ON "snippets"("org_id", "user_id");

-- AddForeignKey
ALTER TABLE "snippets" ADD CONSTRAINT "snippets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snippets" ADD CONSTRAINT "snippets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CHECK constraints: the caps the API enforces.
ALTER TABLE "snippets" ADD CONSTRAINT "snippets_title_check"
  CHECK (char_length("title") BETWEEN 1 AND 80);
ALTER TABLE "snippets" ADD CONSTRAINT "snippets_body_check"
  CHECK (octet_length("body") BETWEEN 1 AND 4096);
ALTER TABLE "snippets" ADD CONSTRAINT "snippets_tags_check"
  CHECK ("tags" IS NULL OR cardinality("tags") <= 8);
