-- Modo de precio por servicio, viñetas de "qué incluye" y antelación propia
CREATE TYPE "PriceMode" AS ENUM ('FIXED', 'FROM', 'QUOTE');
ALTER TABLE "Service" ADD COLUMN "priceMode" "PriceMode" NOT NULL DEFAULT 'FIXED';
ALTER TABLE "Service" ADD COLUMN "includes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Service" ADD COLUMN "maxAdvanceDays" INTEGER;

-- Origen de la reserva (utm_source / ref)
ALTER TABLE "Booking" ADD COLUMN "source" TEXT;

-- Testimonios publicados a mano desde el panel
CREATE TABLE "Testimonial" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "occasionLabel" TEXT NOT NULL DEFAULT '',
    "quote" TEXT NOT NULL,
    "rating" INTEGER,
    "photoUrl" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Testimonial_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Testimonial_published_sortOrder_idx" ON "Testimonial"("published", "sortOrder");
