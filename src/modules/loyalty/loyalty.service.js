import prisma from '../../lib/prisma.js';
import { getSettings } from '../settings/settings.service.js';
import { notFound, badRequest, conflict } from '../../lib/errors.js';
import { sendMailAsync } from '../../lib/mailer.js';
import { loyaltyRewardUnlocked } from '../../emails/templates.js';

/**
 * Tarjeta de fidelidad.
 *
 * Regla de negocio explícita: los sellos SOLO los otorga la maquilladora
 * desde el panel. No hay ninguna ruta que permita a una clienta sumarse
 * sellos, ni se generan al crear una reserva; una cita agendada y no
 * atendida no vale un sello.
 *
 * Al alcanzar `stampsRequired` sellos se desbloquea una recompensa y el
 * contador del ciclo vuelve a empezar, conservando el excedente.
 */

export async function getOrCreateCard(userId) {
  const card = await prisma.loyaltyCard.upsert({
    where: { userId },
    update: {},
    create: { userId },
    include: {
      stamps: { orderBy: { createdAt: 'desc' }, take: 50 },
      rewards: { orderBy: { unlockedAt: 'desc' } },
    },
  });
  return card;
}

/** Vista de la tarjeta lista para pintar en el frontend. */
export async function getCardForUser(userId) {
  const [card, settings] = await Promise.all([getOrCreateCard(userId), getSettings()]);

  const availableRewards = card.rewards.filter((r) => r.status === 'AVAILABLE');

  return {
    stampsCurrent: card.stampsCurrent,
    stampsTotal: card.stampsTotal,
    stampsRequired: settings.stampsRequired,
    rewardDescription: settings.rewardDescription,
    progress: Math.min(1, card.stampsCurrent / Math.max(1, settings.stampsRequired)),
    hasReward: availableRewards.length > 0,
    rewards: card.rewards.map((r) => ({
      id: r.id,
      description: r.description,
      status: r.status,
      unlockedAt: r.unlockedAt,
      redeemedAt: r.redeemedAt,
    })),
    stamps: card.stamps.map((s) => ({ id: s.id, createdAt: s.createdAt, note: s.note })),
  };
}

/**
 * Otorga un sello. Solo llamado desde rutas de administración.
 *
 * Si el sello va ligado a una reserva, se exige que esté COMPLETED y que
 * no tenga sello ya (la relación es 1-a-1 en el esquema, pero se
 * comprueba antes para devolver un mensaje claro en vez de un error de
 * clave única).
 */
export async function grantStamp({ userId, bookingId = null, note = null, adminId }) {
  const settings = await getSettings();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, fullName: true, email: true, isActive: true },
  });
  if (!user) throw notFound('Clienta no encontrada');

  const result = await prisma.$transaction(async (tx) => {
    const card = await tx.loyaltyCard.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });

    if (bookingId) {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        select: { id: true, userId: true, status: true, stamp: { select: { id: true } } },
      });
      if (!booking) throw notFound('Reserva no encontrada');
      if (booking.userId !== userId) throw badRequest('Esa reserva no pertenece a esta clienta');
      if (booking.status !== 'COMPLETED') {
        throw badRequest('Solo se sella una reserva marcada como completada');
      }
      if (booking.stamp) throw conflict('Esa reserva ya tiene su sello');
    }

    await tx.loyaltyStamp.create({
      data: { cardId: card.id, bookingId, note, grantedById: adminId },
    });

    let stampsCurrent = card.stampsCurrent + 1;
    const stampsTotal = card.stampsTotal + 1;
    let unlocked = null;

    if (stampsCurrent >= settings.stampsRequired) {
      unlocked = await tx.loyaltyReward.create({
        data: { cardId: card.id, description: settings.rewardDescription, status: 'AVAILABLE' },
      });
      stampsCurrent -= settings.stampsRequired;
    }

    const updated = await tx.loyaltyCard.update({
      where: { id: card.id },
      data: { stampsCurrent, stampsTotal },
    });

    return { card: updated, unlocked };
  });

  if (result.unlocked) {
    sendMailAsync({
      to: user.email,
      ...loyaltyRewardUnlocked({ user, settings, reward: result.unlocked }),
    });
  }

  return result;
}

/** Quita el último sello (corrección de errores desde el panel). */
export async function revokeLastStamp({ userId }) {
  return prisma.$transaction(async (tx) => {
    const card = await tx.loyaltyCard.findUnique({ where: { userId } });
    if (!card) throw notFound('Esta clienta no tiene tarjeta');

    const last = await tx.loyaltyStamp.findFirst({
      where: { cardId: card.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!last) throw badRequest('No hay sellos que quitar');

    await tx.loyaltyStamp.delete({ where: { id: last.id } });

    return tx.loyaltyCard.update({
      where: { id: card.id },
      data: {
        stampsCurrent: Math.max(0, card.stampsCurrent - 1),
        stampsTotal: Math.max(0, card.stampsTotal - 1),
      },
    });
  });
}

/** Marca una recompensa como canjeada (la maquilladora, al aplicarla). */
export async function redeemReward({ rewardId }) {
  const reward = await prisma.loyaltyReward.findUnique({ where: { id: rewardId } });
  if (!reward) throw notFound('Recompensa no encontrada');
  if (reward.status !== 'AVAILABLE') throw badRequest('Esta recompensa ya no está disponible');

  return prisma.loyaltyReward.update({
    where: { id: rewardId },
    data: { status: 'REDEEMED', redeemedAt: new Date() },
  });
}

/** Listado de clientas con su tarjeta, para el panel. */
export async function listCardsAdmin({ q, page = 1, pageSize = 25 }) {
  const where = { role: 'CLIENT' };
  if (q) {
    where.OR = [
      { fullName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
    ];
  }

  const [total, users, settings] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        createdAt: true,
        loyaltyCard: {
          include: { rewards: { where: { status: 'AVAILABLE' }, select: { id: true, description: true } } },
        },
        _count: { select: { bookings: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    getSettings(),
  ]);

  return {
    total,
    page,
    pageSize,
    stampsRequired: settings.stampsRequired,
    items: users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      phone: u.phone,
      createdAt: u.createdAt,
      bookingsCount: u._count.bookings,
      stampsCurrent: u.loyaltyCard?.stampsCurrent ?? 0,
      stampsTotal: u.loyaltyCard?.stampsTotal ?? 0,
      availableRewards: u.loyaltyCard?.rewards ?? [],
    })),
  };
}
