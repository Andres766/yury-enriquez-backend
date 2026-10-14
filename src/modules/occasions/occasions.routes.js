import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import { validate } from '../../middleware/validate.js';
import { requireAdmin } from '../../middleware/auth.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { asyncHandler, notFound } from '../../lib/errors.js';
import { cleanText } from '../../lib/sanitize.js';
import { isSitePath } from '../services/services.schema.js';

/**
 * Ocasiones: bodas, quinceañeros, grados, sesiones de fotos…
 *
 * Alimentan la sección "Para cada ocasión" de la web y se pueden
 * asociar a los servicios, de modo que cada ocasión muestra qué se
 * ofrece para ella.
 */

const router = Router();

const text = (max, msg) =>
  z
    .string()
    .transform((v) => cleanText(v, { maxLength: max }))
    .pipe(z.string().min(1, msg ?? 'Este campo es obligatorio').max(max));

const cuid = z.string().min(20).max(40).regex(/^[a-z0-9]+$/i);

/**
 * Viñetas de "Qué incluye": igual que en los servicios, las filas vacías
 * o repetidas del formulario se descartan en vez de tumbar el guardado.
 */
const includesList = z
  .array(z.string().max(400, 'Cada viñeta debe ser una frase corta'))
  .max(30)
  .transform((items) => [
    ...new Set(items.map((v) => cleanText(v, { maxLength: 200 }).replace(/\s*\n+\s*/g, ' ')).filter(Boolean)),
  ])
  .pipe(z.array(z.string()).max(12, 'Máximo 12 viñetas'));

const occasionBody = {
  slug: z
    .string()
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Usa solo minúsculas, números y guiones'),
  name: text(80, 'Escribe el nombre'),
  tagline: text(160, 'Escribe la frase corta'),
  description: text(2000, 'Escribe la descripción'),
  includes: includesList.default([]),
  // Vacío = sin foto. Misma regla que las fotos de los servicios: http(s)
  // o una ruta de esta web ("/img/trabajos/…"), nunca "javascript:" ni
  // "//otro-dominio".
  heroImage: z
    .string()
    .trim()
    .max(500)
    .refine(
      (v) => !v || /^https?:\/\//i.test(v) || isSitePath(v),
      'La URL debe empezar por http://, https:// o /',
    )
    .optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  active: z.boolean().default(true),
};

/*
 * Los servicios de cada ocasión salen en el orden del catálogo
 * (sortOrder), no en el orden en que se enlazaron: así Yury decide qué
 * va primero en /ocasiones/bodas igual que en /servicios.
 */
const withServices = {
  services: {
    where: { service: { active: true } },
    orderBy: { service: { sortOrder: 'asc' } },
    include: {
      service: {
        select: {
          id: true,
          slug: true,
          name: true,
          category: true,
          priceCents: true,
          currency: true,
          priceMode: true,
          includes: true,
          sortOrder: true,
          // La página de bodas avisa hasta qué día llega la agenda en línea.
          maxAdvanceDays: true,
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

// Panel: todas, también las ocultas, con sus servicios (incluidos los
// ocultos) para ver de un vistazo qué ofrece cada una.
router.get(
  '/admin/all',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const occasions = await prisma.occasion.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        services: {
          orderBy: { service: { sortOrder: 'asc' } },
          include: { service: { select: { id: true, slug: true, name: true, active: true } } },
        },
      },
    });
    res.json({ occasions: occasions.map(shape) });
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
