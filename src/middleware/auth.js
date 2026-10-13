import { verifyAccessToken } from '../lib/tokens.js';
import { unauthorized, forbidden } from '../lib/errors.js';
import prisma from '../lib/prisma.js';

/**
 * Autenticación y autorización.
 *
 * El rol NO se lee del cuerpo de la petición ni de una cabecera: sale
 * del JWT firmado y, en las rutas de administración, se vuelve a
 * contrastar contra la base de datos. Así, revocar el rol de admin surte
 * efecto de inmediato aunque el token siga vigente.
 */

function readBearer(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

/** Adjunta req.user si hay un token válido; no falla si no lo hay. */
export function optionalAuth(req, _res, next) {
  const token = readBearer(req);
  if (!token) return next();
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
  } catch {
    // Token ausente o caducado: se sigue como invitado.
  }
  return next();
}

/** Exige sesión válida. */
export function requireAuth(req, _res, next) {
  const token = readBearer(req);
  if (!token) return next(unauthorized('Inicia sesión para continuar'));

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
    return next();
  } catch (error) {
    const msg = error.name === 'TokenExpiredError' ? 'Tu sesión expiró' : 'Sesión inválida';
    return next(unauthorized(msg, { code: 'TOKEN_INVALID' }));
  }
}

/**
 * Exige uno de los roles indicados y revalida contra la base de datos.
 * Se aplica en CADA endpoint protegido, no solo al montar el router.
 */
export function requireRole(...roles) {
  return async function roleGuard(req, _res, next) {
    if (!req.user) return next(unauthorized('Inicia sesión para continuar'));

    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { id: true, role: true, isActive: true },
      });

      if (!user || !user.isActive) return next(forbidden('Cuenta no disponible'));
      if (!roles.includes(user.role)) return next(forbidden('No tienes permisos para esta acción'));

      req.user.role = user.role;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export const requireAdmin = [requireAuth, requireRole('ADMIN')];
