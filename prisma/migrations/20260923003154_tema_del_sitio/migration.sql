-- CreateEnum
CREATE TYPE "SiteTheme" AS ENUM ('LIGHT', 'DARK', 'HALLOWEEN');

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "theme" "SiteTheme" NOT NULL DEFAULT 'LIGHT';
