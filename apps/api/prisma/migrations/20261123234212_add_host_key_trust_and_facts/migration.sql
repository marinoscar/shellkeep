-- AlterTable
ALTER TABLE "server_profiles" ADD COLUMN     "facts" JSONB,
ADD COLUMN     "facts_probed_at" TIMESTAMPTZ,
ADD COLUMN     "host_key_algorithm" TEXT,
ADD COLUMN     "host_key_trusted_at" TIMESTAMPTZ,
ADD COLUMN     "host_key_trusted_by" UUID;
