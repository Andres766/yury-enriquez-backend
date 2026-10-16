-- Biblioteca de fotos administrable (Cloudinary) y fotos del inicio
ALTER TABLE "ServiceImage" ADD COLUMN "focus" TEXT NOT NULL DEFAULT '50% 50%';

ALTER TABLE "Settings" ADD COLUMN "heroImageUrl" TEXT;
ALTER TABLE "Settings" ADD COLUMN "heroImageAlt" TEXT;
ALTER TABLE "Settings" ADD COLUMN "heroImageFocus" TEXT;
ALTER TABLE "Settings" ADD COLUMN "aboutImageUrl" TEXT;
ALTER TABLE "Settings" ADD COLUMN "aboutImageAlt" TEXT;
ALTER TABLE "Settings" ADD COLUMN "aboutImageFocus" TEXT;

CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "publicId" TEXT,
    "url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "alt" TEXT NOT NULL DEFAULT '',
    "category" TEXT,
    "inGallery" BOOLEAN NOT NULL DEFAULT true,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "focus" TEXT NOT NULL DEFAULT '50% 50%',
    "credit" TEXT,
    "minor" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Photo_publicId_key" ON "Photo"("publicId");
CREATE INDEX "Photo_inGallery_category_sortOrder_idx" ON "Photo"("inGallery", "category", "sortOrder");
