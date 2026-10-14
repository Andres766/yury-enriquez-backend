import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireAdmin } from '../../middleware/auth.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { asyncHandler } from '../../lib/errors.js';
import { cleanText } from '../../lib/sanitize.js';
import { slotsQuerySchema, monthQuerySchema, nextQuerySchema } from '../bookings/bookings.schema.js';
import {
  getSlotsForDate,
  getMonthAvailability,
  getNextAvailable,
  getAvailabilityRules,
  replaceAvailabilityRules,
  listTimeBlocks,
  createTimeBlock,
  deleteTimeBlock,
} from './availability.service.js';

const router = Router();
const HHmm = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Usa el formato HH:mm');
const cuid = z.string().min(20).max(40).regex(/^[a-z0-9]+$/i);

/** GET /api/availability/slots?serviceId=…&date=2026-10-04 */
router.get(
  '/slots',
  validate({ query: slotsQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await getSlotsForDate(req.valid.query));
  }),
);

/** GET /api/availability/month?serviceId=…&year=2026&month=10 */
router.get(
  '/month',
  validate({ query: monthQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await getMonthAvailability(req.valid.query));
  }),
);

/**
 * GET /api/availability/next?serviceId=…[&after=2026-10-24]
 * Primer horario libre: el botón "Próximo horario libre" del asistente y
 * "Ver el siguiente día con cupo" cuando un día está lleno.
 */
router.get(
  '/next',
  validate({ query: nextQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json(await getNextAvailable(req.valid.query));
  }),
);

/** Horario semanal publicado (para pintarlo en "Contacto"). */
router.get(
  '/rules',
  asyncHandler(async (_req, res) => {
    res.json({ rules: await getAvailabilityRules() });
  }),
);

// ── Administración ───────────────────────────────────────────────────

router.put(
  '/admin/rules',
  requireAdmin,
  requireCsrf,
  validate({
    body: z.object({
      rules: z
        .array(
          z
            .object({
              weekday: z.coerce.number().int().min(1).max(7),
              startTime: HHmm,
              endTime: HHmm,
              active: z.boolean().default(true),
            })
            .refine((r) => r.endTime > r.startTime, {
              message: 'La hora de cierre debe ser posterior a la de apertura',
              path: ['endTime'],
            }),
        )
        .max(30),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json({ rules: await replaceAvailabilityRules(req.valid.body.rules) });
  }),
);

router.get(
  '/admin/blocks',
  requireAdmin,
  validate({
    query: z.object({
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json({ blocks: await listTimeBlocks(req.valid.query) });
  }),
);

router.post(
  '/admin/blocks',
  requireAdmin,
  requireCsrf,
  validate({
    body: z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD'),
        allDay: z.boolean().default(false),
        startTime: HHmm.optional(),
        endTime: HHmm.optional(),
        reason: z
          .string()
          .transform((v) => cleanText(v, { maxLength: 200 }))
          .optional(),
      })
      .refine((v) => v.allDay || (v.startTime && v.endTime), {
        message: 'Indica hora de inicio y fin, o marca el día completo',
        path: ['startTime'],
      }),
  }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ block: await createTimeBlock(req.valid.body) });
  }),
);

router.delete(
  '/admin/blocks/:id',
  requireAdmin,
  requireCsrf,
  validate({ params: z.object({ id: cuid }) }),
  asyncHandler(async (req, res) => {
    await deleteTimeBlock(req.valid.params.id);
    res.json({ ok: true });
  }),
);

export default router;
