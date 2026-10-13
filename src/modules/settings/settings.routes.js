import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireAdmin } from '../../middleware/auth.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { asyncHandler } from '../../lib/errors.js';
import { cleanText, cleanEmail, cleanPhone } from '../../lib/sanitize.js';
import { getSettings, updateSettings, publicSettings } from './settings.service.js';

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
    res.json({ settings: await getSettings({ fresh: true }) });
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
    res.json({ settings: await updateSettings(data) });
  }),
);

export default router;
