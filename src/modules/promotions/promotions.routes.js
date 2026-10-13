import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import { validate } from '../../middleware/validate.js';
import { requireAdmin, optionalAuth } from '../../middleware/auth.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { asyncHandler } from '../../lib/errors.js';
import { cleanText } from '../../lib/sanitize.js';

const router = Router();

const cuid = z.string().min(20).max(40).regex(/^[a-z0-9]+$/i);

const promoBody = {
  title: z
    .string()
    .transform((v) => cleanText(v, { maxLength: 120 }))
    .pipe(z.string().min(1).max(120)),
  description: z
    .string()
    .transform((v) => cleanText(v, { maxLength: 1000 }))
    .pipe(z.string().min(1).max(1000)),
  code: z
    .string()
    .transform((v) => cleanText(v, { maxLength: 24 }).toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9-]{3,24}$/, 'Código inválido'))
    .optional()
    .or(z.literal('')),
  discountType: z.enum(['PERCENT', 'AMOUNT']).default('PERCENT'),
  discountValue: z.coerce.number().int().min(0).max(100_000_000),
  image: z
    .string()
    .max(500)
    .refine((v) => !v || /^https?:\/\//i.test(v) || v.startsWith('/'), 'URL inválida')
    .optional()
    .or(z.literal('')),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  active: z.boolean().default(true),
  membersOnly: z.boolean().default(false),
};

const createSchema = z
  .object(promoBody)
  .refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
    message: 'La fecha de fin debe ser posterior a la de inicio',
    path: ['endsAt'],
  })
  .refine((v) => v.discountType !== 'PERCENT' || v.discountValue <= 100, {
    message: 'Un descuento porcentual no puede superar el 100 %',
    path: ['discountValue'],
  });

/**
 * GET /api/promotions — promociones vigentes.
 *
 * Las marcadas `membersOnly` solo se devuelven a quien tiene sesión
 * iniciada. El filtro se aplica en la consulta, no ocultando en el
 * frontend: si no estás registrada, esos registros nunca salen del
 * servidor.
 */
router.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const now = new Date();
    const promotions = await prisma.promotion.findMany({
      where: {
        active: true,
        startsAt: { lte: now },
        endsAt: { gte: now },
        ...(req.user ? {} : { membersOnly: false }),
      },
      orderBy: { endsAt: 'asc' },
    });
    res.json({ promotions });
  }),
);

router.get(
  '/admin/all',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ promotions: await prisma.promotion.findMany({ orderBy: { startsAt: 'desc' } }) });
  }),
);

router.post(
  '/admin',
  requireAdmin,
  requireCsrf,
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const { code, image, startsAt, endsAt, ...data } = req.valid.body;
    const promotion = await prisma.promotion.create({
      data: {
        ...data,
        code: code || null,
        image: image || null,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
      },
    });
    res.status(201).json({ promotion });
  }),
);

router.patch(
  '/admin/:id',
  requireAdmin,
  requireCsrf,
  validate({ params: z.object({ id: cuid }), body: z.object(promoBody).partial() }),
  asyncHandler(async (req, res) => {
    const { code, image, startsAt, endsAt, ...data } = req.valid.body;
    const promotion = await prisma.promotion.update({
      where: { id: req.valid.params.id },
      data: {
        ...data,
        ...(code !== undefined ? { code: code || null } : {}),
        ...(image !== undefined ? { image: image || null } : {}),
        ...(startsAt ? { startsAt: new Date(startsAt) } : {}),
        ...(endsAt ? { endsAt: new Date(endsAt) } : {}),
      },
    });
    res.json({ promotion });
  }),
);

router.delete(
  '/admin/:id',
  requireAdmin,
  requireCsrf,
  validate({ params: z.object({ id: cuid }) }),
  asyncHandler(async (req, res) => {
    await prisma.promotion.delete({ where: { id: req.valid.params.id } });
    res.json({ ok: true });
  }),
);

export default router;
