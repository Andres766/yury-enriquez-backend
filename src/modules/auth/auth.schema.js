import { z } from 'zod';
import { cleanText, cleanEmail, cleanPhone } from '../../lib/sanitize.js';

const email = z
  .string()
  .transform(cleanEmail)
  .pipe(z.string().email('Correo electrónico inválido').max(254));

/**
 * Política de contraseña.
 *
 * Longitud mínima generosa (10) y variedad de caracteres, siguiendo la
 * recomendación del NIST de priorizar longitud sobre reglas rebuscadas.
 * El máximo de 200 evita el DoS por hash de entradas gigantes.
 */
const password = z
  .string()
  .min(10, 'Usa al menos 10 caracteres')
  .max(200, 'La contraseña es demasiado larga')
  .regex(/[a-záéíóúñ]/, 'Incluye al menos una minúscula')
  .regex(/[A-ZÁÉÍÓÚÑ]/, 'Incluye al menos una mayúscula')
  .regex(/\d/, 'Incluye al menos un número');

export const registerSchema = z.object({
  fullName: z
    .string()
    .transform((v) => cleanText(v, { maxLength: 120 }))
    .pipe(
      z
        .string()
        .min(2, 'El nombre es demasiado corto')
        .regex(/^[\p{L}\p{M}\s'.-]+$/u, 'El nombre solo puede contener letras'),
    ),
  email,
  password,
  phone: z
    .string()
    .transform(cleanPhone)
    .pipe(z.string().regex(/^\+?\d{7,19}$/, 'Teléfono inválido'))
    .optional()
    .or(z.literal('')),
  marketingOptIn: z.boolean().default(false),
  website: z.string().max(0).optional(),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Escribe tu contraseña').max(200),
});

export const updateProfileSchema = z.object({
  fullName: z
    .string()
    .transform((v) => cleanText(v, { maxLength: 120 }))
    .pipe(z.string().min(2).regex(/^[\p{L}\p{M}\s'.-]+$/u, 'El nombre solo puede contener letras'))
    .optional(),
  phone: z
    .string()
    .transform(cleanPhone)
    .pipe(z.string().regex(/^\+?\d{7,19}$/, 'Teléfono inválido'))
    .optional()
    .or(z.literal('')),
  marketingOptIn: z.boolean().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Escribe tu contraseña actual').max(200),
  newPassword: password,
});

export const changeEmailSchema = z.object({
  currentPassword: z.string().min(1, 'Escribe tu contraseña actual').max(200),
  newEmail: email,
});
