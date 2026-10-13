import prisma from '../../lib/prisma.js';
import {
  hashPassword,
  verifyPassword,
  DUMMY_HASH,
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllSessions,
} from '../../lib/tokens.js';
import { conflict, unauthorized, badRequest, notFound } from '../../lib/errors.js';
import { sendMailAsync } from '../../lib/mailer.js';
import { welcomeEmail } from '../../emails/templates.js';
import { getSettings } from '../settings/settings.service.js';

/** Proyección segura: el hash de la contraseña nunca sale de aquí. */
const publicUserSelect = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  role: true,
  marketingOptIn: true,
  createdAt: true,
};

export async function register({ fullName, email, password, phone, marketingOptIn }) {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw conflict('Ya existe una cuenta con ese correo. Inicia sesión.');

  const passwordHash = await hashPassword(password);

  /*
   * El rol se fija aquí, en el servidor, SIEMPRE como CLIENT. No hay
   * ninguna ruta pública que permita crear un administrador: la cuenta
   * de la maquilladora se crea con el seed o desde el panel.
   */
  const user = await prisma.user.create({
    data: {
      fullName,
      email,
      passwordHash,
      phone: phone || null,
      marketingOptIn: Boolean(marketingOptIn),
      role: 'CLIENT',
      loyaltyCard: { create: {} },
    },
    select: publicUserSelect,
  });

  /*
   * Al registrarse, las reservas que ya había hecho como invitada con
   * ese mismo correo se vinculan a la cuenta: así su historial y sus
   * sellos no empiezan de cero.
   */
  await prisma.booking.updateMany({
    where: { customerEmail: email, userId: null },
    data: { userId: user.id },
  });

  const settings = await getSettings();
  sendMailAsync({ to: user.email, ...welcomeEmail({ user, settings }) });

  return user;
}

export async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });

  /*
   * Si el correo no existe, se verifica igualmente contra un hash
   * ficticio. El coste temporal es idéntico, así que la respuesta no
   * delata qué correos están registrados.
   */
  const hash = user?.passwordHash ?? DUMMY_HASH;
  const ok = await verifyPassword(hash, password);

  if (!user || !ok) throw unauthorized('Correo o contraseña incorrectos');
  if (!user.isActive) throw unauthorized('Esta cuenta está desactivada');

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    marketingOptIn: user.marketingOptIn,
    createdAt: user.createdAt,
  };
}

export async function issueSession(user, { userAgent, ip } = {}) {
  const accessToken = signAccessToken(user);
  const { token: refreshToken, expiresAt } = await issueRefreshToken(user.id, { userAgent, ip });
  return { accessToken, refreshToken, refreshExpiresAt: expiresAt };
}

export async function refreshSession(refreshToken, { userAgent, ip } = {}) {
  if (!refreshToken) throw unauthorized('Sesión no encontrada', { code: 'NO_REFRESH' });

  const result = await rotateRefreshToken(refreshToken, { userAgent, ip });
  if (!result.ok) {
    const messages = {
      reused: 'Detectamos un uso indebido de la sesión. Vuelve a iniciar sesión.',
      expired: 'Tu sesión expiró. Inicia sesión de nuevo.',
      inactive: 'Esta cuenta está desactivada.',
      unknown: 'Sesión inválida.',
    };
    throw unauthorized(messages[result.reason] ?? 'Sesión inválida', { code: 'REFRESH_FAILED' });
  }

  const user = {
    id: result.user.id,
    email: result.user.email,
    fullName: result.user.fullName,
    phone: result.user.phone,
    role: result.user.role,
    marketingOptIn: result.user.marketingOptIn,
    createdAt: result.user.createdAt,
  };

  return {
    user,
    accessToken: signAccessToken(user),
    refreshToken: result.token,
    refreshExpiresAt: result.expiresAt,
  };
}

export async function logout(refreshToken) {
  await revokeRefreshToken(refreshToken);
}

export async function getProfile(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect });
  if (!user) throw notFound('Usuario no encontrado');
  return user;
}

export async function updateProfile(userId, data) {
  const patch = {};
  if (data.fullName !== undefined) patch.fullName = data.fullName;
  if (data.phone !== undefined) patch.phone = data.phone || null;
  if (data.marketingOptIn !== undefined) patch.marketingOptIn = data.marketingOptIn;

  return prisma.user.update({ where: { id: userId }, data: patch, select: publicUserSelect });
}

export async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('Usuario no encontrado');

  const ok = await verifyPassword(user.passwordHash, currentPassword);
  if (!ok) throw badRequest('La contraseña actual no es correcta');

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  // Cambiar la contraseña cierra el resto de sesiones abiertas.
  await revokeAllSessions(userId);
}

export { publicUserSelect };
