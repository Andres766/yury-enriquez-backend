-- ═══════════════════════════════════════════════════════════════════
--  Garantías a nivel de base de datos.
--  Ejecutar DESPUÉS de `prisma migrate dev` con:
--      npm run db:constraints
--
--  Prisma no expresa índices parciales ni restricciones de exclusión en
--  su DSL, pero son la última línea de defensa contra la doble reserva:
--  aunque dos peticiones simultáneas burlaran el bloqueo de la
--  aplicación, Postgres rechazaría la segunda.
-- ═══════════════════════════════════════════════════════════════════

-- Necesario para combinar el operador de exclusión con rangos de tiempo.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Dos reservas vivas (PENDING/CONFIRMED/COMPLETED) no pueden solaparse.
-- El rango es [startAt, endAt): una cita que termina a las 11:00 no
-- choca con la que empieza a las 11:00.
--
-- Se usa `tsrange` y no `tstzrange` porque Prisma mapea DateTime a
-- `timestamp(3)` sin zona horaria. Convertirlo a `timestamptz` dentro
-- del índice dependería del parámetro TimeZone de la sesión, así que no
-- sería IMMUTABLE y Postgres rechazaría la restricción. Como toda la
-- aplicación guarda UTC (ver src/lib/time.js), comparar los valores tal
-- cual es correcto: todos están en la misma escala.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_no_overlap') THEN
    ALTER TABLE "Booking"
      ADD CONSTRAINT booking_no_overlap
      EXCLUDE USING gist (tsrange("startAt", "endAt", '[)') WITH &&)
      WHERE (status IN ('PENDING', 'CONFIRMED', 'COMPLETED'));
  END IF;
END
$$;

-- Coherencia básica de las reservas.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_end_after_start') THEN
    ALTER TABLE "Booking" ADD CONSTRAINT booking_end_after_start CHECK ("endAt" > "startAt");
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_price_non_negative') THEN
    ALTER TABLE "Booking" ADD CONSTRAINT booking_price_non_negative CHECK ("priceCents" >= 0);
  END IF;
END
$$;

-- Coherencia de los bloqueos de agenda.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timeblock_end_after_start') THEN
    ALTER TABLE "TimeBlock" ADD CONSTRAINT timeblock_end_after_start CHECK ("endAt" > "startAt");
  END IF;
END
$$;

-- La fila de ajustes es única por diseño.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settings_singleton') THEN
    ALTER TABLE "Settings" ADD CONSTRAINT settings_singleton CHECK (id = 1);
  END IF;
END
$$;

-- Los contadores de sellos nunca son negativos.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loyalty_stamps_non_negative') THEN
    ALTER TABLE "LoyaltyCard"
      ADD CONSTRAINT loyalty_stamps_non_negative
      CHECK ("stampsCurrent" >= 0 AND "stampsTotal" >= 0);
  END IF;
END
$$;

-- Las reglas de horario deben ser coherentes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'availability_weekday_range') THEN
    ALTER TABLE "AvailabilityRule"
      ADD CONSTRAINT availability_weekday_range CHECK (weekday BETWEEN 1 AND 7);
  END IF;
END
$$;
