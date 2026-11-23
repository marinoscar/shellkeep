-- Domain tables that exist in deployed databases only because of `prisma db push`.
-- No earlier migration created them, so `prisma migrate deploy` on an empty
-- database failed at 20260322203853_add_server_profile_color. This migration
-- creates them exactly as a deployed database has them (WITHOUT "color", which
-- the next migration adds).
--
-- On an EXISTING database (production, staging, a restored copy) do NOT run it:
--   npm run prisma -- migrate resolve --applied 20260124223147_add_terminal_domain
-- before anything else. On a fresh database `migrate deploy` runs it normally.

-- CreateEnum
CREATE TYPE "AuthMethod" AS ENUM ('password', 'key', 'agent');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('active', 'detached', 'terminated');

-- CreateTable
CREATE TABLE "server_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 22,
    "username" TEXT NOT NULL,
    "auth_method" "AuthMethod" NOT NULL,
    "encrypted_password" TEXT,
    "encrypted_private_key" TEXT,
    "encrypted_passphrase" TEXT,
    "fingerprint" TEXT,
    "tags" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "server_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminal_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "server_profile_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'active',
    "tmux_session_id" TEXT NOT NULL,
    "cols" INTEGER NOT NULL DEFAULT 80,
    "rows" INTEGER NOT NULL DEFAULT 24,
    "last_activity_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "terminal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "server_profiles_user_id_idx" ON "server_profiles"("user_id");

-- CreateIndex
CREATE INDEX "terminal_sessions_user_id_idx" ON "terminal_sessions"("user_id");

-- CreateIndex
CREATE INDEX "terminal_sessions_server_profile_id_idx" ON "terminal_sessions"("server_profile_id");

-- CreateIndex
CREATE INDEX "terminal_sessions_status_idx" ON "terminal_sessions"("status");

-- AddForeignKey
ALTER TABLE "server_profiles" ADD CONSTRAINT "server_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_server_profile_id_fkey" FOREIGN KEY ("server_profile_id") REFERENCES "server_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
