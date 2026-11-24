-- CreateTable
CREATE TABLE "terminal_session_summaries" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "org_id" UUID,
    "job_id" UUID,
    "status" TEXT NOT NULL,
    "summary_md" TEXT,
    "commands" JSONB,
    "findings" JSONB,
    "source_chars" INTEGER,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "terminal_session_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "terminal_session_summaries_session_id_created_at_idx" ON "terminal_session_summaries"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "terminal_session_summaries_user_id_idx" ON "terminal_session_summaries"("user_id");

-- AddForeignKey
ALTER TABLE "terminal_session_summaries" ADD CONSTRAINT "terminal_session_summaries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "terminal_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_session_summaries" ADD CONSTRAINT "terminal_session_summaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
