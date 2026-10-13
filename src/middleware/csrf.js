import crypto from 'node:crypto';
import env from '../config/env.js';
import { forbidden } from '../lib/errors.js';

/**
 * Protección CSRF por doble envío de cookie (double submit).
 *
 * El refresh token viaja en cookie httpOnly, así que el navegador la
 * adjunta sola: un sitio malicioso podría provocar peticiones en nombre
 * del usuario. Para evitarlo emitimos además una cookie `csrfToken`
 * legible por JavaScript y exigimos que su valor se repita en la
 * cabecera `X-CSRF-Token`.
 *
 * Un atacante en otro origen no puede leer la cookie (política de mismo
 * origen) ni fijar cabeceras personalizadas en una petición
 * cross-origin sin pasar antes por el preflight de CORS, que nuestra
 * lista blanca rechaza. La comparación es de tiempo constante.
 */

export const CSRF_COOKIE = 'csrfToken';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfCookieOptions() {
  return {
    httpOnly: false, // el frontend debe poder leerla para reenviarla
    secure: env.cookieSecure,
    sameSite: env.COOKIE_SAMESITE,
    domain: env.COOKIE_DOMAIN || undefined,
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  };
}

/** Emite la cookie CSRF si aún no existe. */
export function issueCsrfToken(req, res, next) {
  if (!req.cookies?.[CSRF_COOKIE]) {
    const token = crypto.randomBytes(32).toString('base64url');
    res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
    req.cookies = { ...(req.cookies ?? {}), [CSRF_COOKIE]: token };
  }
  return next();
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Valida el doble envío en los métodos que modifican estado. */
export function requireCsrf(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);

  if (!cookieToken || !headerToken || !timingSafeEqual(cookieToken, headerToken)) {
    return next(
      forbidden('Token CSRF inválido o ausente. Recarga la página e inténtalo de nuevo.', {
        code: 'CSRF_INVALID',
      }),
    );
  }

  return next();
}
