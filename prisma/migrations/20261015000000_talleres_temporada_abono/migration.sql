-- Categoría para los talleres de automaquillaje
ALTER TYPE "ServiceCategory" ADD VALUE 'TALLER';

-- Temporada por servicio: solo se reserva para días dentro del rango
ALTER TABLE "Service" ADD COLUMN "availableFrom" TEXT;
ALTER TABLE "Service" ADD COLUMN "availableUntil" TEXT;

-- Porcentaje de abono para separar la fecha
ALTER TABLE "Settings" ADD COLUMN "depositPercent" INTEGER;
