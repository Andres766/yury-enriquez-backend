import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import { validate } from '../../middleware/validate.js';
import { requireAdmin } from '../../middleware/auth.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { asyncHandler, notFound } from '../../lib/errors.js';
import { cleanText } from '../../lib/sanitize.js';

/**
 * Ocasiones: bodas, quinceañeros, grados, sesiones de fotos…
 *
 * Alimentan la sección "Para cada ocasión" de la web y se pueden
 * asociar a los servicios, de modo que cada ocasión muestra qué se
 * ofrece para ella.
 */

const router = Router();

const text = (max) =>
  z
    .string()
    .transform((v) => cleanText(v, { maxLength: max }))
    .pipe(z.string().min(1).max(max));

const cuid = z.string().min(20).max(40).regex(/^[a-z0-9]+$/i);

const occasionBody = {
  slug: z
    .string()
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Usa solo minúsculas, números y guiones'),
  name: text(80),
  tagline: text(160),
  description: text(2000),
  includes: z.array(text(200)).max(12).default([]),
  heroImage: z
    .string()
    .max(500)
    .refine((v) => !v || /^https?:\/\//i.test(v) || v.startsWith('/'), 'URL inválida')
    .optional()
    .or(z.literal('')),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  active: z.boolean().default(true),
};

const withServices = {
  services: {
    where: { service: { active: true } },
    include: {
      service: {
        select: {
          id: true,
          slug: true,
          name: true,
          category: true,
          priceCents: true,
          currency: true,
          durationMinutes: true,
          shortDescription: true,
          images: { take: 1, orderBy: { sortOrder: 'asc' } },
        },
      },
    },
  },
};

const shape = (occasion) => ({
  ...occasion,
  services: occasion.services?.map((link) => link.service) ?? [],
});

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const occasions = await prisma.occasion.findMany({
      where: { active: true },
      include: withServices,
      orderBy: { sortOrder: 'asc' },
    });
    res.json({ occasions: occasions.map(shape) });
  }),
);

router.get(
  '/admin/all',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const occasions = await prisma.occasion.findMany({ orderBy: { sortOrder: 'asc' } });
    res.json({ occasions });
  }),
);

router.post(
  '/admin',
  requireAdmin,
  requireCsrf,
  validate({ body: z.object(occasionBody) }),
  asyncHandler(async (req, res) => {
    const { heroImage, ...data } = req.valid.body;
    const occasion = await prisma.occasion.create({
      data: { ...data, heroImage: heroImage || null },
    });
    res.status(201).json({ occasion });
  }),
);

router.patch(
  '/admin/:id',
  requireAdmin,
  requireCsrf,
  validate({ params: z.object({ id: cuid }), body: z.object(occasionBody).partial() }),
  asyncHandler(async (req, res) => {
    const { heroImage, ...data } = req.valid.body;
    const occasion = await prisma.occasion.update({
      where: { id: req.valid.params.id },
      data: { ...data, ...(heroImage !== undefined ? { heroImage: heroImage || null } : {}) },
    });
    res.json({ occasion });
  }),
);

router.delete(
  '/admin/:id',
  requireAdmin,
  requireCsrf,
  validate({ params: z.object({ id: cuid }) }),
  asyncHandler(async (req, res) => {
    await prisma.occasion.delete({ where: { id: req.valid.params.id } });
    res.json({ ok: true });
  }),
);

router.get(
  '/:slug',
  validate({ params: z.object({ slug: z.string().max(60).regex(/^[a-z0-9-]+$/) }) }),
  asyncHandler(async (req, res) => {
    const occasion = await prisma.occasion.findFirst({
      where: { slug: req.valid.params.slug, active: true },
      include: withServices,
    });
    if (!occasion) throw notFound('Ocasión no encontrada');
    res.json({ occasion: shape(occasion) });
  }),
);

export default router;
