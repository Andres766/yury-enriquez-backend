import { z } from 'zod';
import { cleanText } from '../../lib/sanitize.js';
import { isValidDateISO } from '../../lib/time.js';
import { focusSchema, DEFAULT_FOCUS } from '../photos/photos.schema.js';

export const SERVICE_CATEGORIES = ['MAQUILLAJE', 'PEINADO', 'PAQUETE', 'TALLER'];

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
/**
 * Ruta del propio sitio ("/img/…"). "//otro.com/x.jpg" y "/\otro.com"
 * también empiezan por "/", pero el navegador los trata como enlaces a
 * otro dominio: se rechazan para que "relativa" signifique de verdad
 * "de esta web".
 */
export const isSitePath = (v) => v.startsWith('/') && !/^\/[/\\]/.test(v);

const imageUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => /^https?:\/\//i.test(v) || isSitePath(v),
    'La URL debe empezar por http://, https:// o /',
  );

const imageSchema = z.object({
  url: imageUrl,
  alt: text(160, 'Describe la imagen para accesibilidad'),
  // Punto que no se recorta en las tarjetas (CSS object-position). Si el
  // panel no lo manda, el centro: así una foto vieja sigue igual que antes.
  focus: focusSchema.default(DEFAULT_FOCUS),
});

const cuid = z.string().min(20).max(40).regex(/^[a-z0-9]+$/i);

/**
 * Viñetas de "Qué incluye". Se limpian una a una y las vacías o
 * repetidas se descartan en vez de rechazar el formulario entero: en el
 * panel es normal que quede una fila en blanco al final. Una viñeta es
 * una línea, así que los saltos de línea se vuelven espacios.
 */
const includesList = z
  .array(z.string().max(400, 'Cada viñeta debe ser una frase corta'))
  .max(30)
  .transform((items) => [
    ...new Set(items.map((v) => cleanText(v, { maxLength: 140 }).replace(/\s*\n+\s*/g, ' ')).filter(Boolean)),
  ])
  .pipe(z.array(z.string()).max(12, 'Máximo 12 viñetas'));

/**
 * Fecha de calendario YYYY-MM-DD para la temporada; vacío o null la
 * borra. Misma regla que las fechas del tema de temporada en Ajustes:
 * formato exacto y día real (nada de 30 de febrero). Que el fin no sea
 * anterior al inicio se comprueba en el servicio, porque un PATCH puede
 * traer solo una de las dos fechas.
 */
const calendarDate = z
  .union([z.string().trim(), z.null()], { errorMap: () => ({ message: 'Fecha no válida (AAAA-MM-DD)' }) })
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || (/^\d{4}-\d{2}-\d{2}$/.test(v) && isValidDateISO(v)), 'Fecha no válida (AAAA-MM-DD)');

const baseService = {
  name: text(120, 'El nombre es obligatorio'),
  category: z.enum(SERVICE_CATEGORIES, { errorMap: () => ({ message: 'Elige una categoría' }) }),
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
  // FIXED "$85.000" · FROM "Desde $85.000" · QUOTE "Precio a cotizar".
  priceMode: z
    .enum(['FIXED', 'FROM', 'QUOTE'], { errorMap: () => ({ message: 'Elige cómo se muestra el precio' }) })
    .default('FIXED'),
  includes: includesList.default([]),
  // null = usa el límite general de Ajustes. Hasta dos años, porque las
  // bodas se separan con mucha anticipación.
  maxAdvanceDays: z
    .number({ invalid_type_error: 'Escribe un número de días' })
    .int('Escribe un número entero de días')
    .min(1, 'Mínimo 1 día')
    .max(730, 'Máximo 730 días (dos años)')
    .nullable()
    .default(null),
  // Temporada: solo se reserva PARA días entre estas fechas (inclusive).
  // null en las dos = todo el año.
  availableFrom: calendarDate.default(null),
  availableUntil: calendarDate.default(null),
};

export const createServiceSchema = z.object(baseService);

export const updateServiceSchema = z
  .object(baseService)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'No hay cambios que guardar');

export const listServicesQuerySchema = z.object({
  category: z.enum(SERVICE_CATEGORIES).optional(),
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
