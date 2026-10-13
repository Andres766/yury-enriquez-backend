import { z } from 'zod';
import { cleanText, cleanEmail, cleanPhone } from '../../lib/sanitize.js';

/**
 * Esquemas de reservas.
 *
 * Cada campo de texto pasa por `cleanText` ANTES de validarse, así que
 * lo que llega a la base ya viene normalizado y acotado en longitud.
 * Nótese que el esquema NO acepta `priceCents`, `status` ni `userId`:
 * esos los fija el servidor. Zod descarta cualquier campo no declarado.
 */

const name = z
  .string()
  .transform((v) => cleanText(v, { maxLength: 120 }))
  .pipe(
    z
      .string()
      .min(2, 'El nombre es demasiado corto')
      .max(120, 'El nombre es demasiado largo')
      .regex(/^[\p{L}\p{M}\s'.-]+$/u, 'El nombre solo puede contener letras'),
  );

const email = z
  .string()
  .transform(cleanEmail)
  .pipe(z.string().email('Correo electrónico inválido').max(254));

const phone = z
  .string()
  .transform(cleanPhone)
  .pipe(
    z
      .string()
      .min(7, 'El teléfono es demasiado corto')
      .max(20, 'El teléfono es demasiado largo')
      .regex(/^\+?\d{7,19}$/, 'Teléfono inválido'),
  );

const notes = z
  .string()
  .max(2000)
  .transform((v) => cleanText(v, { maxLength: 1000 }))
  .optional()
  .or(z.literal(''));

const cuid = z.string().min(20).max(40).regex(/^[a-z0-9]+$/i, 'Identificador inválido');

export const createBookingSchema = z.object({
  serviceId: cuid,
  occasionId: cuid.optional().nullable(),
  /** Instante de inicio en ISO-8601 UTC, tal y como lo devuelve /slots. */
  startAt: z.string().datetime({ offset: true, message: 'Fecha y hora inválidas' }),
  customerName: name,
  customerEmail: email,
  customerPhone: phone,
  paymentMethod: z.enum(['TRANSFERENCIA', 'EFECTIVO'], {
    errorMap: () => ({ message: 'Elige transferencia o efectivo' }),
  }),
  notes: notes,
  /**
   * Campo trampa para bots: los navegadores reales lo dejan vacío
   * porque está oculto con CSS. Si llega con contenido, se rechaza.
   */
  website: z.string().max(0, 'Solicitud rechazada').optional(),
});

export const lookupBookingSchema = z.object({
  code: z
    .string()
    .transform((v) => cleanText(v, { maxLength: 12 }).toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{4}-?[A-Z0-9]{4}$/, 'Código inválido')),
  email,
});

export const slotsQuerySchema = z.object({
  serviceId: cuid,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD'),
});

export const monthQuerySchema = z.object({
  serviceId: cuid,
  year: z.coerce.number().int().min(2024).max(2100),
  month: z.coerce.number().int().min(1).max(12),
});

export const idParamSchema = z.object({ id: cuid });

// ── Administración ───────────────────────────────────────────────────

export const adminListSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  q: z
    .string()
    .transform((v) => cleanText(v, { maxLength: 80 }))
    .optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const updateStatusSchema = z.object({
  status: z.enum(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']),
  adminNotes: z
    .string()
    .transform((v) => cleanText(v, { maxLength: 1000 }))
    .optional(),
  reason: z
    .string()
    .transform((v) => cleanText(v, { maxLength: 300 }))
    .optional(),
});

export const rescheduleSchema = z.object({
  startAt: z.string().datetime({ offset: true, message: 'Fecha y hora inválidas' }),
});
