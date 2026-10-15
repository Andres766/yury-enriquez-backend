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
  // Dato opcional del negocio. Yury trabaja a domicilio, así que esto
  // NUNCA es "el lugar de tu cita": ese es Booking.serviceAddress.
  addressLine: text(200),
  mapUrl: httpUrl,
  businessHoursNote: text(300),
  ownerNotificationEmail: z.string().transform(cleanEmail).pipe(z.string().email().or(z.literal(''))),
  transferInstructions: text(1000),
  /**
   * Porcentaje del valor que se abona para separar la fecha (0–100).
   * Vacío o null = sin política de abono: la web y los correos no dicen
   * nada. Se acepta "50" como texto porque así llega de un <input>, pero
   * el vacío NO se convierte en 0 (z.coerce lo haría), que significaría
   * otra cosa.
   */
  depositPercent: z.preprocess(
    (v) => {
      const raw = typeof v === 'string' ? v.trim() : v;
      if (raw === '' || raw === null) return null;
      return typeof raw === 'string' ? Number(raw) : raw;
    },
    z
      .number({ invalid_type_error: 'Escribe un porcentaje entre 0 y 100' })
      .int('Escribe un porcentaje entero')
      .min(0, 'El abono no puede ser negativo')
      .max(100, 'El abono no puede pasar del 100 %')
      .nullable(),
  ),
  /**
   * Adicional del domicilio dentro del perímetro urbano, en centavos
   * (21.000 pesos = 2100000). Vacío o null = no se muestra; 0 sí es un
   * valor (domicilio sin costo), por eso el vacío no se convierte en 0.
   * Fuera de la ciudad no hay tarifa fija: se cotiza según el transporte,
   * así que aquí solo vive la urbana. El tope (100.000 pesos) solo frena
   * un cero de más tecleado por error.
   */
  homeVisitFeeCents: z.preprocess(
    (v) => {
      const raw = typeof v === 'string' ? v.trim() : v;
      if (raw === '' || raw === null) return null;
      return typeof raw === 'string' ? Number(raw) : raw;
    },
    z
      .number({ invalid_type_error: 'Escribe el valor del domicilio en números' })
      .int('El valor del domicilio va en centavos enteros')
      .min(0, 'El domicilio no puede ser negativo')
      .max(10_000_000, 'Ese valor de domicilio es demasiado alto')
      .nullable(),
  ),
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
