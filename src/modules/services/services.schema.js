import { z } from 'zod';
import { cleanText } from '../../lib/sanitize.js';

const text = (max, msg) =>
  z
    .string()
    .transform((v) => cleanText(v, { maxLength: max }))
    .pipe(z.string().min(1, msg ?? 'Este campo es obligatorio').max(max));

/**
 * Las URL de imagen se limitan a http(s) y a rutas relativas del propio
 * sitio. Sin esta comprobación, un administrador comprometido (o un
 * error de copiar y pegar) podría introducir `javascript:` y convertir
 * la galería en un vector de XSS.
 */
const imageUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => /^https?:\/\//i.test(v) || v.startsWith('/'),
    'La URL debe empezar por http://, https:// o /',
  );

const imageSchema = z.object({
  url: imageUrl,
  alt: text(160, 'Describe la imagen para accesibilidad'),
});

const cuid = z.string().min(20).max(40).regex(/^[a-z0-9]+$/i);

const baseService = {
  name: text(120, 'El nombre es obligatorio'),
  category: z.enum(['MAQUILLAJE', 'PEINADO', 'PAQUETE']),
  shortDescription: text(240, 'Escribe una descripción corta'),
  description: text(4000, 'Escribe la descripción detallada'),
  durationMinutes: z.coerce.number().int().min(15, 'Mínimo 15 minutos').max(600),
  priceCents: z.coerce.number().int().min(0).max(100_000_000),
  currency: z.string().length(3).default('COP'),
  active: z.boolean().default(true),
  featured: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  images: z.array(imageSchema).max(12, 'Máximo 12 imágenes').default([]),
  occasionIds: z.array(cuid).max(12).default([]),
};

export const createServiceSchema = z.object(baseService);

export const updateServiceSchema = z
  .object(baseService)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'No hay cambios que guardar');

export const listServicesQuerySchema = z.object({
  category: z.enum(['MAQUILLAJE', 'PEINADO', 'PAQUETE']).optional(),
  occasion: z
    .string()
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Ocasión inválida')
    .optional(),
});

export const slugParamSchema = z.object({
  slug: z.string().max(64).regex(/^[a-z0-9-]+$/, 'Identificador inválido'),
});

export const idParamSchema = z.object({ id: cuid });
