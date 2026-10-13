import prisma from '../../lib/prisma.js';

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
    theme: settings.theme,
    timezone: settings.timezone,
    stampsRequired: settings.stampsRequired,
    rewardDescription: settings.rewardDescription,
    minNoticeHours: settings.minNoticeHours,
    maxAdvanceDays: settings.maxAdvanceDays,
    slotIntervalMinutes: settings.slotIntervalMinutes,
    bufferMinutes: settings.bufferMinutes,
  };
}
