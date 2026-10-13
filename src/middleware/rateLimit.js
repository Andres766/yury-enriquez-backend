import rateLimit from 'express-rate-limit';
import env from '../config/env.js';

/**
 * Clave por IP, consciente de IPv6.
 *
 * A un cliente IPv6 se le suele asignar un /64 entero, así que contar
 * por dirección completa permitiría rotar entre billones de direcciones
 * y saltarse el límite. Se agrupa por prefijo /64. En IPv4 se usa la
 * dirección tal cual.
 */
function ipKey(req) {
  const ip = req.ip ?? '';
  if (!ip.includes(':')) return ip;
  const hextets = ip.replace(/^\[|\]$/g, '').split(':');
  return `${hextets.slice(0, 4).join(':')}::/64`;
}

/**
 * Límites de tasa.
 *
 * Tres niveles:
 *  · global      — red de seguridad contra escaneos y bucles.
 *  · login       — frena la fuerza bruta de credenciales (por IP + correo,
 *                  para que un atacante no bloquee a un usuario concreto
 *                  simplemente fallando desde muchas IP).
 *  · bookings    — antispam de reservas falsas.
 *
 * En desarrollo los límites se relajan para no estorbar mientras se
 * prueba la app.
 */

const relaxed = env.isDev ? 10 : 1;

const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones. Espera un momento e inténtalo de nuevo.' },
};

export const globalLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 300 * relaxed,
});

export const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 8 * relaxed,
  // Se cuentan solo los intentos fallidos: quien acierta no consume cupo.
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase().slice(0, 254) : '';
    return `${ipKey(req)}|${email}`;
  },
  message: {
    error: 'Demasiados intentos de inicio de sesión. Vuelve a intentarlo en 15 minutos.',
  },
});

export const registerLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 5 * relaxed,
  message: { error: 'Demasiadas cuentas creadas desde esta conexión. Inténtalo más tarde.' },
});

export const bookingLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 6 * relaxed,
  message: {
    error: 'Has creado varias reservas seguidas. Si necesitas otra cita, escríbenos por WhatsApp.',
  },
});

export const lookupLimiter = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  limit: 20 * relaxed,
  message: { error: 'Demasiadas consultas. Espera unos minutos.' },
});

export const refreshLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 60 * relaxed,
});
