-- Tema de temporada programado: entre dos fechas (inclusive, en la zona
-- horaria del negocio) la web pública usa `seasonalTheme` en lugar de
-- `theme`. Fuera de esas fechas vuelve sola al tema base.
ALTER TABLE "Settings" ADD COLUMN "seasonalTheme" "SiteTheme";
ALTER TABLE "Settings" ADD COLUMN "seasonalStartDate" TEXT;
ALTER TABLE "Settings" ADD COLUMN "seasonalEndDate" TEXT;
