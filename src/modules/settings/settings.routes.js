import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireAdmin } from '../../middleware/auth.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { asyncHandler, badRequest } from '../../lib/errors.js';
import { cleanText, cleanEmail, cleanPhone } from '../../lib/sanitize.js';
import { getSettings, updateSettings, publicSettings, adminSettings } from './settings.service.js';
import { isValidDateISO } from '../../lib/time.js';

const router = Router();

const text = (max) =>
  z
    .string()
    .transform((v) => cleanText(v, { maxLength: max }))
    .pipe(z.string().max(max));

/** Solo se aceptan URL http(s): nada de `javascript:` ni `data:`. */
const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => !v || /^https?:\/\//i.test(v), 'La URL debe empezar por http:// o https://')
  .optional()
  .or(z.literal(''));

/** Fecha de calendario YYYY-MM-DD; vacío o null la borra. */
const calendarDate = z
  .union([z.string().trim(), z.null()])
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && isValidDateISO(v)), 'Fecha no válida (AAAA-MM-DD)');

const settingsBody = z.object({
  brandName: text(80),
  tagline: text(160),
  aboutText: text(3000),
  contactEmail: z.string().transform(cleanEmail).pipe(z.string().email().or(z.literal(''))),
  contactPhone: z.string().transform(cleanPhone).pipe(z.string().max(20)),
  whatsappNumber: z.string().transform(cleanPhone).pipe(z.string().max(20)),
  instagramUrl: httpUrl,
  tiktokUrl: httpUrl,
  facebookUrl: httpUrl,
  addressLine: text(200),
  mapUrl: httpUrl,
  businessHoursNote: text(300),
  ownerNotificationEmail: z.string().transform(cleanEmail).pipe(z.string().email().or(z.literal(''))),
  transferInstructions: text(1000),
  /**
   * Tema visual del sitio publico. No existe ninguna ruta que permita
   * cambiarlo sin ser administradora: las visitantes no tienen selector,
   * solo reciben el valor ya decidido en GET /api/settings.
   */
  theme: z.enum(['LIGHT', 'DARK', 'HALLOWEEN']),
  /** Tema de temporada: vacío o null desactiva la programación. */
  seasonalTheme: z
    .union([z.enum(['LIGHT', 'DARK', 'HALLOWEEN']), z.literal(''), z.null()])
    .transform((v) => (v ? v : null)),
  seasonalStartDate: calendarDate,
  seasonalEndDate: calendarDate,
  timezone: z
    .string()
    .max(64)
    .refine((v) => {
      try {
        new Intl.DateTimeFormat('es', { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, 'Zona horaria desconocida'),
  slotIntervalMinutes: z.coerce.number().int().min(5).max(240),
  bufferMinutes: z.coerce.number().int().min(0).max(240),
  minNoticeHours: z.coerce.number().int().min(0).max(720),
  maxAdvanceDays: z.coerce.number().int().min(1).max(365),
  stampsRequired: z.coerce.number().int().min(2).max(50),
  rewardDescription: text(200),
});

/** GET /api/settings — datos públicos de contacto, marca y reglas. */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ settings: publicSettings(await getSettings()) });
  }),
);

router.get(
  '/admin',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ settings: adminSettings(await getSettings({ fresh: true })) });
  }),
);

router.patch(
  '/admin',
  requireAdmin,
  requireCsrf,
  validate({ body: settingsBody.partial() }),
  asyncHandler(async (req, res) => {
    const data = { ...req.valid.body };
    // Las URL vacías se guardan como NULL, no como cadena vacía.
    for (const key of ['instagramUrl', 'tiktokUrl', 'facebookUrl', 'mapUrl']) {
      if (data[key] === '') data[key] = null;
    }

    // La programación de temporada se valida completa, mezclando lo que
    // llega con lo que ya está guardado (el PATCH puede ser parcial).
    const current = await getSettings({ fresh: true });
    const merged = { ...current, ...data };
    if (merged.seasonalTheme || merged.seasonalStartDate || merged.seasonalEndDate) {
      const details = [];
      if (!merged.seasonalTheme) details.push({ field: 'seasonalTheme', message: 'Elige el tema de temporada' });
      if (!merged.seasonalStartDate) details.push({ field: 'seasonalStartDate', message: 'Falta la fecha de inicio' });
      if (!merged.seasonalEndDate) details.push({ field: 'seasonalEndDate', message: 'Falta la fecha de fin' });
      if (
        merged.seasonalStartDate &&
        merged.seasonalEndDate &&
        merged.seasonalStartDate > merged.seasonalEndDate
      ) {
        details.push({ field: 'seasonalEndDate', message: 'La fecha de fin no puede ser anterior a la de inicio' });
      }
      if (details.length) {
        throw badRequest('Revisa la programación del tema de temporada', { code: 'VALIDATION_ERROR', details });
      }
    }

    res.json({ settings: adminSettings(await updateSettings(data)) });
  }),
);

export default router;
