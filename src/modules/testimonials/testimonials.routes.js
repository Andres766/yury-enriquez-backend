import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import { validate } from '../../middleware/validate.js';
import { requireAdmin } from '../../middleware/auth.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { asyncHandler, badRequest } from '../../lib/errors.js';
import { cleanText } from '../../lib/sanitize.js';

/**
 * Testimonios: opiniones de clientas que se muestran en la web.
 *
 * Nacen SIEMPRE sin publicar. La maquilladora los escribe a partir de
 * lo que le dijeron sus clientas (con su permiso) y decide cuándo salen
 * a la web. El listado público filtra en la consulta, así que un
 * testimonio en borrador nunca sale del servidor.
 */

const router = Router();

const cuid = z.string().min(20).max(40).regex(/^[a-z0-9]+$/i);

/*
 * Aquí el texto largo se RECHAZA en vez de recortarse: una opinión
 * cortada a mitad de frase cambia lo que dijo la clienta. El tope de
 * cleanText es solo una red de seguridad muy por encima del máximo.
 */
const text = (min, max, message) =>
  z
    .string()
    .transform((v) => cleanText(v, { maxLength: max * 4 }))
    .pipe(z.string().min(min, message).max(max, `Máximo ${max} caracteres`));

/*
 * La foto puede ser una URL absoluta (http/https) o una ruta del propio
 * sitio ("/img/…"). Se rechazan "//dominio.com" y "/\dominio.com":
 * empiezan por "/" pero el navegador las resuelve como otro sitio.
 */
const photoUrl = z
  .string()
  .max(500)
  .refine((v) => !v || /^https?:\/\/[^\s]+$/i.test(v) || /^\/(?![/\\])[^\s]*$/.test(v), 'URL de foto inválida')
  .nullable()
  .optional();

const testimonialBody = {
  name: text(1, 80, 'Escribe el nombre de la clienta'),
  occasionLabel: z
    .string()
    .transform((v) => cleanText(v, { maxLength: 320 }))
    .pipe(z.string().max(80, 'Máximo 80 caracteres'))
    .default(''),
  quote: text(10, 800, 'La opinión debe tener al menos 10 caracteres'),
  rating: z
    .number({ invalid_type_error: 'La calificación debe ser un número' })
    .int('La calificación debe ser un número entero')
    .min(1, 'La calificación va de 1 a 5')
    .max(5, 'La calificación va de 1 a 5')
    .nullable()
    .default(null),
  photoUrl,
  published: z.boolean().default(false),
};

/** Solo lo que la web necesita pintar: ni fechas ni estado interno. */
const publicSelect = {
  id: true,
  name: true,
  occasionLabel: true,
  quote: true,
  rating: true,
  photoUrl: true,
};

const ORDER = [{ sortOrder: 'asc' }, { createdAt: 'desc' }];

/** GET /api/testimonials — testimonios publicados, en el orden elegido. */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const testimonials = await prisma.testimonial.findMany({
      where: { published: true },
      orderBy: ORDER,
      select: publicSelect,
      take: 50,
    });
    res.json({ testimonials });
  }),
);

router.get(
  '/admin/all',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ testimonials: await prisma.testimonial.findMany({ orderBy: ORDER }) });
  }),
);

router.post(
  '/admin',
  requireAdmin,
  requireCsrf,
  validate({ body: z.object(testimonialBody) }),
  asyncHandler(async (req, res) => {
    const { photoUrl: photo, ...data } = req.valid.body;

    // Un testimonio nuevo va al final de la lista: el orden que ya dejó
    // armado la maquilladora no se mueve por crear uno más.
    const last = await prisma.testimonial.aggregate({ _max: { sortOrder: true } });

    const testimonial = await prisma.testimonial.create({
      data: { ...data, photoUrl: photo || null, sortOrder: (last._max.sortOrder ?? -1) + 1 },
    });
    res.status(201).json({ testimonial });
  }),
);

/*
 * PUT /admin/order — recibe los ids en el orden deseado y reescribe
 * sortOrder de todos en una transacción. Se manda la lista completa (y
 * no "sube uno") para que dos pestañas abiertas no dejen posiciones
 * repetidas.
 */
router.put(
  '/admin/order',
  requireAdmin,
  requireCsrf,
  validate({ body: z.object({ ids: z.array(cuid).min(1).max(500) }) }),
  asyncHandler(async (req, res) => {
    const { ids } = req.valid.body;
    if (new Set(ids).size !== ids.length) throw badRequest('La lista de orden tiene ids repetidos');

    const total = await prisma.testimonial.count({ where: { id: { in: ids } } });
    if (total !== ids.length) throw badRequest('Algún testimonio de la lista ya no existe. Recarga la página.');

    await prisma.$transaction(
      ids.map((id, index) => prisma.testimonial.update({ where: { id }, data: { sortOrder: index } })),
    );
    res.json({ testimonials: await prisma.testimonial.findMany({ orderBy: ORDER }) });
  }),
);

router.patch(
  '/admin/:id',
  requireAdmin,
  requireCsrf,
  validate({
    params: z.object({ id: cuid }),
    body: z
      .object({
        ...testimonialBody,
        // En una edición parcial no se aplican los valores por defecto:
        // mandar solo `published` no debe borrar la calificación.
        occasionLabel: testimonialBody.occasionLabel.removeDefault(),
        rating: testimonialBody.rating.removeDefault(),
        published: z.boolean(),
      })
      .partial(),
  }),
  asyncHandler(async (req, res) => {
    const { photoUrl: photo, ...data } = req.valid.body;
    const testimonial = await prisma.testimonial.update({
      where: { id: req.valid.params.id },
      data: { ...data, ...(photo !== undefined ? { photoUrl: photo || null } : {}) },
    });
    res.json({ testimonial });
  }),
);

router.delete(
  '/admin/:id',
  requireAdmin,
  requireCsrf,
  validate({ params: z.object({ id: cuid }) }),
  asyncHandler(async (req, res) => {
    await prisma.testimonial.delete({ where: { id: req.valid.params.id } });
    res.json({ ok: true });
  }),
);

export default router;
