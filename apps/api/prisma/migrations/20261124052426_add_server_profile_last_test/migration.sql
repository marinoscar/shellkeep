-- AlterTable
ALTER TABLE "server_profiles" ADD COLUMN     "last_test_at" TIMESTAMPTZ,
ADD COLUMN     "last_test_code" TEXT,
ADD COLUMN     "last_test_ok" BOOLEAN;
