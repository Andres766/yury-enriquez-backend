-- Servicio 100 % a domicilio: dirección de la cita y adicional del domicilio
ALTER TABLE "Booking" ADD COLUMN "serviceAddress" TEXT;
ALTER TABLE "Settings" ADD COLUMN "homeVisitFeeCents" INTEGER;
