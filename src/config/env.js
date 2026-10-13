import 'dotenv/config';
import { z } from 'zod';

/**
 * Validación de la configuración al arrancar.
 *
 * Si falta un secreto o una URL, el proceso muere aquí con un mensaje
 * claro en vez de arrancar a medias y fallar en producción con un 500
 * opaco. Todos los secretos viven en variables de entorno: ninguno está
 * escrito en el código ni se versiona.
 */

const bool = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    APP_URL: z.string().url().default('http://localhost:5173'),
    CORS_ORIGINS: csv,
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET debe tener al menos 32 caracteres'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET debe tener al menos 32 caracteres'),
    ACCESS_TOKEN_TTL: z.string().default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().max(365).default(30),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

    MAIL_DRIVER: z.enum(['console', 'smtp']).default('console'),
    MAIL_FROM: z.string().default('Yury Enríquez <reservas@example.com>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_SECURE: bool(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.JWT_ACCESS_SECRET === cfg.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'JWT_ACCESS_SECRET y JWT_REFRESH_SECRET deben ser distintos',
        path: ['JWT_REFRESH_SECRET'],
      });
    }
    if (cfg.MAIL_DRIVER === 'smtp' && (!cfg.SMTP_HOST || !cfg.SMTP_PORT)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Con MAIL_DRIVER=smtp hacen falta SMTP_HOST y SMTP_PORT',
        path: ['SMTP_HOST'],
      });
    }
    if (cfg.NODE_ENV === 'production') {
      if (cfg.CORS_ORIGINS.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'En producción CORS_ORIGINS no puede estar vacío',
          path: ['CORS_ORIGINS'],
        });
      }
      if (cfg.CORS_ORIGINS.includes('*')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'CORS_ORIGINS no admite comodines: enumera los dominios',
          path: ['CORS_ORIGINS'],
        });
      }
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const detail = parsed.error.issues.map((i) => `  · ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`\n✖ Configuración inválida en .env\n${detail}\n`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  isDev: raw.NODE_ENV === 'development',
  /** Cookies seguras siempre que no estemos en desarrollo local. */
  cookieSecure: raw.NODE_ENV === 'production' || raw.COOKIE_SAMESITE === 'none',
};

export default env;
