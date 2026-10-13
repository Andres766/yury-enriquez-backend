import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import env from '../config/env.js';
import prisma from './prisma.js';

/**
 * Contraseñas, tokens de acceso y refresco.
 *
 * · Contraseñas → argon2id (ganador del Password Hashing Competition).
 *   Nunca se guarda ni se registra la contraseña en claro.
 * · Access token → JWT firmado, vida corta (15 min por defecto). Viaja
 *   en la respuesta JSON y el frontend lo mantiene solo en memoria.
 * · Refresh token → valor aleatorio de 256 bits. En la base guardamos
 *   únicamente su SHA-256; en el navegador viaja en cookie httpOnly,
 *   inaccesible para JavaScript. Cada uso lo rota y revoca el anterior.
 */

const ARGON_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB — recomendación OWASP 2024
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(plain) {
  return argon2.hash(plain, ARGON_OPTIONS);
}

export async function verifyPassword(hash, plain) {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

/**
 * Hash falso con el que comparar cuando el correo no existe: iguala el
 * tiempo de respuesta y evita distinguir "usuario inexistente" de
 * "contraseña incorrecta" midiendo la latencia.
 */
export const DUMMY_HASH = await argon2.hash('contrasena-ficticia-para-igualar-tiempos', ARGON_OPTIONS);

/**
 * El `jwtid` aleatorio hace que dos tokens emitidos en el mismo segundo
 * sean distintos. Sin él, `iat` y `exp` coinciden y la firma produce la
 * misma cadena, de modo que un token "renovado" sería indistinguible del
 * anterior: molesto para depurar y un obstáculo si algún día se añade
 * una lista de revocación.
 */
export function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, email: user.email }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
    issuer: 'estudio-belleza',
    audience: 'estudio-belleza-app',
    jwtid: crypto.randomUUID(),
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: 'estudio-belleza',
    audience: 'estudio-belleza-app',
  });
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Crea un refresh token, guarda su hash y devuelve el valor en claro. */
export async function issueRefreshToken(userId, { userAgent, ip } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const record = await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt,
      userAgent: userAgent?.slice(0, 255),
      ip: ip?.slice(0, 64),
    },
    select: { id: true },
  });

  return { id: record.id, token, expiresAt };
}

/**
 * Rota un refresh token: valida el actual, lo revoca y emite otro.
 *
 * Si llega un token ya revocado se asume robo de sesión y se revocan
 * TODAS las sesiones del usuario (detección de reutilización).
 */
export async function rotateRefreshToken(token, { userAgent, ip } = {}) {
  const tokenHash = sha256(token);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!stored) return { ok: false, reason: 'unknown' };

  if (stored.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: stored.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: false, reason: 'reused' };
  }

  if (stored.expiresAt < new Date()) return { ok: false, reason: 'expired' };
  if (!stored.user.isActive) return { ok: false, reason: 'inactive' };

  const next = await issueRefreshToken(stored.userId, { userAgent, ip });
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date(), replacedById: next.id },
  });

  return { ok: true, user: stored.user, ...next };
}

export async function revokeRefreshToken(token) {
  if (!token) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Código público de reserva: 8 caracteres sin vocales ni ambigüedades. */
const CODE_ALPHABET = '23456789BCDFGHJKLMNPQRSTVWXZ';
export function generateBookingCode() {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export { sha256 };
