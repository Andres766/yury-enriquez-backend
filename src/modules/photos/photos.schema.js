import { z } from 'zod';
import { cleanText } from '../../lib/sanitize.js';

/**
 * Reglas compartidas de las fotos: las usan la biblioteca, los
 * servicios (fotos de cada servicio) y los ajustes (foto del inicio y de
 * «Sobre mí»). Viven en un solo sitio para que el mismo valor no sea
 * válido en un formulario y rechazado en otro.
 */

export const DEFAULT_FOCUS = '50% 50%';

const FOCUS_RE = /^(\d{1,3})% (\d{1,3})%$/;
const FOCUS_MESSAGE = 'El punto de enfoque va como "50% 30%" (dos números de 0 a 100)';

/**
 * Punto de la foto que nunca se recorta (CSS object-position). Solo se
 * admite exactamente "X% Y%": el valor termina dentro de un atributo
 * style, así que nada de texto libre.
 */
export function isFocus(value) {
  const match = FOCUS_RE.exec(value);
  return Boolean(match) && Number(match[1]) <= 100 && Number(match[2]) <= 100;
}

export const focusSchema = z.string({ invalid_type_error: FOCUS_MESSAGE }).trim().refine(isFocus, FOCUS_MESSAGE);

/** Igual, pero vacío o null significa "sin elegir" (se guarda null). */
export const nullableFocusSchema = z
  .union([z.string().trim(), z.null()], { errorMap: () => ({ message: FOCUS_MESSAGE }) })
  .refine((v) => v === null || v === '' || isFocus(v), FOCUS_MESSAGE)
  .transform((v) => v || null);

/** Una sola línea: el texto alternativo y el crédito no llevan saltos. */
const oneLine = (max) =>
  z
    .string()
    .transform((v) => cleanText(v, { maxLength: max * 4 }).replace(/\s*\n+\s*/g, ' '))
    // Se RECHAZA el texto largo en vez de cortarlo a mitad de frase.
    .pipe(z.string().max(max, `Máximo ${max} caracteres`));

export const altSchema = oneLine(200);

/** Crédito visible ("Foto: …"). Vacío o null = sin crédito. */
export const creditSchema = z
  .union([oneLine(120), z.null()])
  .transform((v) => v || null);

/**
 * Las categorías viven en la tabla PhotoCategory (Yury crea las suyas):
 * aquí solo se exige la forma del id; que exista se comprueba en la ruta
 * (assertCategoryExists), contra la base.
 */
const CATEGORY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const CATEGORY_ID_MAX = 40;

export const categorySchema = z
  .union([z.string().max(CATEGORY_ID_MAX).regex(CATEGORY_ID_RE), z.literal(''), z.null()], {
    errorMap: () => ({ message: 'Elige una categoría de la lista' }),
  })
  .transform((v) => v || null);

/** Nombre de una categoría nueva, tal como sale en los filtros de la web. */
export const createCategorySchema = z.object({
  label: oneLine(40).pipe(z.string().min(2, 'Escribe un nombre de al menos 2 letras')),
});

/**
 * "Maquillaje de Catrinas" → "maquillaje-de-catrinas": el id va en la URL
 * de la galería (?categoria=…). Sin tildes ni símbolos; vacío si el
 * nombre no tiene ni una letra o número.
 */
export function categoryIdFor(label) {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CATEGORY_ID_MAX)
    .replace(/-+$/, '');
}

/** Datos que Yury edita de cada foto. */
export const photoMetaShape = {
  alt: altSchema,
  category: categorySchema,
  inGallery: z.boolean({ invalid_type_error: 'Debe ser sí o no' }),
  featured: z.boolean({ invalid_type_error: 'Debe ser sí o no' }),
  focus: focusSchema,
  credit: creditSchema,
  minor: z.boolean({ invalid_type_error: 'Debe ser sí o no' }),
};

const dimension = (max) => z.number().int().min(1).max(max).nullable().optional();

/**
 * Respuesta de Cloudinary tras la subida, tal como la recibe el
 * navegador. La firma y la URL se comprueban después en el handler,
 * contra la configuración del servidor.
 */
export const createPhotoSchema = z.object({
  public_id: z
    .string({ required_error: 'Falta public_id' })
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9_\-/.]+$/, 'public_id inválido')
    .refine((v) => !v.includes('..') && !v.startsWith('/') && !v.endsWith('/'), 'public_id inválido'),
  // Cloudinary lo manda como número; se acepta también como texto de dígitos.
  version: z
    .union([z.number().int().positive(), z.string().regex(/^\d{1,15}$/)], {
      errorMap: () => ({ message: 'version inválida' }),
    })
    .transform((v) => String(v)),
  signature: z.string().regex(/^[a-f0-9]{40}$/i, 'Firma inválida'),
  secure_url: z.string().max(600).regex(/^https:\/\/[^\s"'<>\\]+$/, 'URL inválida'),
  width: dimension(100_000),
  height: dimension(100_000),
  bytes: dimension(1_000_000_000),
  format: z.string().max(10).regex(/^[a-z0-9]+$/i).optional(),

  alt: altSchema.default(''),
  category: categorySchema.default(null),
  inGallery: photoMetaShape.inGallery.default(true),
  featured: photoMetaShape.featured.default(false),
  focus: focusSchema.default(DEFAULT_FOCUS),
  credit: creditSchema.default(null),
  minor: photoMetaShape.minor.default(false),
});

export const updatePhotoSchema = z
  .object(photoMetaShape)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'No hay cambios que guardar');

export const cuid = z.string().min(20).max(40).regex(/^[a-z0-9]+$/i);

export const orderSchema = z.object({ ids: z.array(cuid).min(1).max(1000) });
