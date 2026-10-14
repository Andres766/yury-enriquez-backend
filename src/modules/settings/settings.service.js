import prisma from '../../lib/prisma.js';
import { nowIn } from '../../lib/time.js';

/**
 * Ajustes del negocio: fila única con id = 1.
 *
 * Se cachea en memoria durante unos segundos porque casi todas las
 * peticiones la necesitan (zona horaria, duración de los slots, número
 * de sellos). Cualquier escritura invalida la caché al instante.
 */

let cache = null;
let cacheAt = 0;
const TTL_MS = 15_000;

const DEFAULTS = {
  id: 1,
  brandName: 'Yury Enriquez',
  tagline: 'Makeup Artist',
};

export async function getSettings({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cacheAt < TTL_MS) return cache;

  const settings = await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: DEFAULTS,
  });

  cache = settings;
  cacheAt = Date.now();
  return settings;
}

export function invalidateSettingsCache() {
  cache = null;
  cacheAt = 0;
}

export async function updateSettings(data) {
  const settings = await prisma.settings.update({ where: { id: 1 }, data });
  invalidateSettingsCache();
  cache = settings;
  cacheAt = Date.now();
  return settings;
}

/**
 * Tema que debe ver hoy la web pública.
 *
 * Si hay un tema de temporada programado y hoy (en la zona horaria del
 * negocio) cae entre su fecha de inicio y la de fin, ambas inclusive,
 * manda ese; si no, el tema base. Las fechas son YYYY-MM-DD, así que se
 * comparan como texto sin ambigüedad.
 *
 * Se calcula en cada petición (no se guarda), de modo que el cambio
 * ocurre solo a medianoche del día de inicio y se deshace solo al
 * terminar el día de fin, sin tareas programadas.
 */
export function seasonalStatus(settings, now = nowIn(settings.timezone)) {
  const { seasonalTheme, seasonalStartDate: start, seasonalEndDate: end } = settings;
  if (!seasonalTheme || !start || !end) return { active: false, upcoming: false };

  const today = now.toISODate();
  return { active: start <= today && today <= end, upcoming: today < start };
}

export function effectiveTheme(settings, now) {
  return seasonalStatus(settings, now).active ? settings.seasonalTheme : settings.theme;
}

/** Ajustes completos para el panel, con el tema vigente ya resuelto. */
export function adminSettings(settings) {
  const status = seasonalStatus(settings);
  return {
    ...settings,
    effectiveTheme: effectiveTheme(settings),
    seasonalActive: status.active,
    seasonalUpcoming: status.upcoming,
  };
}

/**
 * Subconjunto público de los ajustes.
 *
 * El endpoint público NO expone `ownerNotificationEmail` ni nada
 * operativo: solo lo que la web necesita pintar.
 */
export function publicSettings(settings) {
  return {
    brandName: settings.brandName,
    tagline: settings.tagline,
    aboutText: settings.aboutText,
    contactEmail: settings.contactEmail,
    contactPhone: settings.contactPhone,
    whatsappNumber: settings.whatsappNumber,
    instagramUrl: settings.instagramUrl,
    tiktokUrl: settings.tiktokUrl,
    facebookUrl: settings.facebookUrl,
    addressLine: settings.addressLine,
    mapUrl: settings.mapUrl,
    businessHoursNote: settings.businessHoursNote,
    transferInstructions: settings.transferInstructions,
    // La web pública recibe el tema ya resuelto: no sabe nada de fechas.
    theme: effectiveTheme(settings),
    timezone: settings.timezone,
    stampsRequired: settings.stampsRequired,
    rewardDescription: settings.rewardDescription,
    minNoticeHours: settings.minNoticeHours,
    maxAdvanceDays: settings.maxAdvanceDays,
    slotIntervalMinutes: settings.slotIntervalMinutes,
    bufferMinutes: settings.bufferMinutes,
  };
}
