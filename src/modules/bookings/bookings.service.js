import prisma from '../../lib/prisma.js';
import { getSettings } from '../settings/settings.service.js';
import { DateTime, zonedDateTime, overlaps } from '../../lib/time.js';
import { badRequest, notFound, conflict, forbidden } from '../../lib/errors.js';
import { generateBookingCode } from '../../lib/tokens.js';
import { sendMailAsync } from '../../lib/mailer.js';
import {
  bookingReceivedCustomer,
  bookingReceivedOwner,
  bookingConfirmed,
  bookingCancelled,
  bookingRescheduled,
} from '../../emails/templates.js';

const LIVE_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED'];

/**
 * Clave del bloqueo consultivo de Postgres.
 *
 * El estudio tiene una sola agenda, así que serializar la creación y la
 * reprogramación de reservas con una única clave es suficiente y mucho
 * más simple que particionar por día. El bloqueo es *transaccional*
 * (`pg_advisory_xact_lock`): se libera solo al terminar la transacción,
 * pase lo que pase.
 */
const CALENDAR_LOCK_KEY = 848120260;

const bookingInclude = {
  service: {
    select: {
      id: true,
      slug: true,
      name: true,
      durationMinutes: true,
      priceCents: true,
      currency: true,
      category: true,
    },
  },
  occasion: { select: { id: true, slug: true, name: true } },
};

/** Vista de una reserva para el cliente (sin campos internos). */
export function toPublicBooking(booking) {
  return {
    id: booking.id,
    code: booking.code,
    status: booking.status,
    startAt: booking.startAt,
    endAt: booking.endAt,
    paymentMethod: booking.paymentMethod,
    priceCents: booking.priceCents,
    currency: booking.currency,
    customerName: booking.customerName,
    customerEmail: booking.customerEmail,
    customerPhone: booking.customerPhone,
    notes: booking.notes,
    service: booking.service,
    occasion: booking.occasion,
    createdAt: booking.createdAt,
  };
}

/**
 * Comprueba, DENTRO de la transacción y con el calendario bloqueado,
 * que el horario pedido sigue siendo reservable.
 *
 * Se repiten aquí todas las validaciones del listado de huecos porque
 * el cliente pudo haber cargado la página hace veinte minutos, o podría
 * estar llamando a la API directamente sin pasar por la web.
 */
async function assertSlotBookable(tx, { service, startAt, settings, ignoreBookingId = null }) {
  const tz = settings.timezone;
  const start = DateTime.fromJSDate(startAt).setZone(tz);
  const totalMinutes = service.durationMinutes + settings.bufferMinutes;
  const end = start.plus({ minutes: totalMinutes });
  const now = DateTime.now().setZone(tz);

  // 1. Nunca en el pasado y con la antelación mínima configurada.
  if (start <= now) throw badRequest('No se pueden agendar citas en el pasado');
  if (start < now.plus({ hours: settings.minNoticeHours })) {
    throw badRequest(
      `Necesitamos al menos ${settings.minNoticeHours} horas de antelación. Elige otro horario.`,
    );
  }

  // 2. Dentro del horizonte de reservas.
  if (start > now.plus({ days: settings.maxAdvanceDays })) {
    throw badRequest(`Solo aceptamos reservas con ${settings.maxAdvanceDays} días de antelación como máximo.`);
  }

  // 3. Dentro de una franja de atención, con el servicio completo dentro.
  const dateISO = start.toISODate();
  const rules = await tx.availabilityRule.findMany({
    where: { weekday: start.weekday, active: true },
  });

  const fitsWindow = rules.some((rule) => {
    const windowStart = zonedDateTime(dateISO, rule.startTime, tz);
    const windowEnd = zonedDateTime(dateISO, rule.endTime, tz);
    return windowStart.isValid && windowEnd.isValid && start >= windowStart && end <= windowEnd;
  });

  if (!fitsWindow) {
    throw conflict('Ese horario está fuera de nuestra agenda de atención.', { code: 'OUT_OF_HOURS' });
  }

  // 4. El inicio debe caer en la rejilla de huecos, no en un minuto suelto.
  const gridBase = rules
    .map((rule) => zonedDateTime(dateISO, rule.startTime, tz))
    .filter((d) => d.isValid && d <= start)
    .sort((a, b) => b - a)[0];

  if (gridBase) {
    const diff = start.diff(gridBase, 'minutes').minutes;
    if (Math.abs(diff % settings.slotIntervalMinutes) > 0.001) {
      throw conflict('Ese horario no corresponde a un turno válido.');
    }
  }

  const startUtc = start.toUTC().toJSDate();
  const endUtc = end.toUTC().toJSDate();

  // 5. Sin solape con reservas vivas.
  const clashing = await tx.booking.findFirst({
    where: {
      status: { in: LIVE_STATUSES },
      startAt: { lt: endUtc },
      endAt: { gt: startUtc },
      ...(ignoreBookingId ? { id: { not: ignoreBookingId } } : {}),
    },
    select: { id: true },
  });
  if (clashing) {
    throw conflict('Ese horario acaba de ocuparse. Elige otro, por favor.', { code: 'SLOT_TAKEN' });
  }

  // 6. Sin solape con bloqueos de agenda.
  const blocks = await tx.timeBlock.findMany({
    where: { startAt: { lt: endUtc }, endAt: { gt: startUtc } },
    select: { startAt: true, endAt: true },
  });
  const blocked = blocks.some((b) =>
    overlaps(start, end, DateTime.fromJSDate(b.startAt), DateTime.fromJSDate(b.endAt)),
  );
  if (blocked) throw conflict('Ese día u horario no está disponible.', { code: 'SLOT_BLOCKED' });

  return { startUtc, endUtc };
}

/** Genera un código único; reintenta ante la colisión (improbable). */
async function uniqueCode(tx) {
  for (let i = 0; i < 6; i += 1) {
    const code = generateBookingCode();
    const exists = await tx.booking.findUnique({ where: { code }, select: { id: true } });
    if (!exists) return code;
  }
  throw new Error('No se pudo generar un código de reserva único');
}

// ── Creación ─────────────────────────────────────────────────────────

export async function createBooking(input, { userId = null, ip = null } = {}) {
  const settings = await getSettings();

  const booking = await prisma.$transaction(async (tx) => {
    // Serializa el acceso al calendario: dos peticiones simultáneas por
    // el mismo hueco se ejecutan una detrás de otra, y la segunda ve
    // la reserva de la primera al comprobar el solape.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CALENDAR_LOCK_KEY}::bigint)`;

    const service = await tx.service.findFirst({
      where: { id: input.serviceId, active: true },
      select: {
        id: true,
        name: true,
        durationMinutes: true,
        priceCents: true,
        currency: true,
      },
    });
    if (!service) throw notFound('El servicio seleccionado no está disponible');

    if (input.occasionId) {
      const occasion = await tx.occasion.findFirst({
        where: { id: input.occasionId, active: true },
        select: { id: true },
      });
      if (!occasion) throw badRequest('La ocasión seleccionada no es válida');
    }

    const startAt = new Date(input.startAt);
    if (Number.isNaN(startAt.getTime())) throw badRequest('Fecha y hora inválidas');

    const { startUtc, endUtc } = await assertSlotBookable(tx, { service, startAt, settings });

    const code = await uniqueCode(tx);

    return tx.booking.create({
      data: {
        code,
        serviceId: service.id,
        occasionId: input.occasionId ?? null,
        userId,
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
        notes: input.notes || null,
        startAt: startUtc,
        endAt: endUtc,
        // El precio se toma SIEMPRE del catálogo, nunca del cliente:
        // enviar "priceCents": 0 desde el navegador no sirve de nada.
        priceCents: service.priceCents,
        currency: service.currency,
        paymentMethod: input.paymentMethod,
        status: 'PENDING',
        createdIp: ip,
      },
      include: bookingInclude,
    });
  });

  // Los correos van fuera de la transacción y sin bloquear la respuesta.
  const ownerTo = settings.ownerNotificationEmail || settings.contactEmail;
  sendMailAsync({ to: booking.customerEmail, ...bookingReceivedCustomer({ booking, settings }) });
  if (ownerTo) sendMailAsync({ to: ownerTo, ...bookingReceivedOwner({ booking, settings }) });

  return booking;
}

// ── Consulta ─────────────────────────────────────────────────────────

/**
 * Consulta de invitado: exige código Y correo.
 *
 * Pedir las dos cosas evita que alguien pruebe códigos al azar y lea
 * datos personales ajenos. La respuesta es idéntica cuando el código no
 * existe y cuando el correo no coincide, para no revelar qué códigos
 * son válidos.
 */
export async function findBookingForGuest({ code, email }) {
  const booking = await prisma.booking.findUnique({
    where: { code: code.toUpperCase() },
    include: bookingInclude,
  });

  if (!booking || booking.customerEmail.toLowerCase() !== email.toLowerCase()) {
    throw notFound('No encontramos ninguna reserva con esos datos');
  }

  return booking;
}

export async function listBookingsForUser(userId) {
  const bookings = await prisma.booking.findMany({
    where: { userId },
    include: bookingInclude,
    orderBy: { startAt: 'desc' },
  });
  return bookings;
}

/** Cancelación desde la cuenta del cliente. */
export async function cancelOwnBooking({ bookingId, userId }) {
  const settings = await getSettings();

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: bookingInclude,
  });

  if (!booking || booking.userId !== userId) throw notFound('Reserva no encontrada');
  if (['CANCELLED', 'COMPLETED'].includes(booking.status)) {
    throw badRequest('Esta reserva ya no se puede cancelar');
  }

  const hoursLeft = DateTime.fromJSDate(booking.startAt).diffNow('hours').hours;
  if (hoursLeft < 24) {
    throw forbidden('Faltan menos de 24 horas: escríbenos por WhatsApp para cancelar.');
  }

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: { status: 'CANCELLED', cancelledAt: new Date() },
    include: bookingInclude,
  });

  const ownerTo = settings.ownerNotificationEmail || settings.contactEmail;
  if (ownerTo) {
    sendMailAsync({
      to: ownerTo,
      subject: `Reserva cancelada por la clienta · ${updated.code}`,
      text: `${updated.customerName} canceló su cita del ${updated.startAt.toISOString()}.`,
      html: `<p>${updated.customerName} canceló su cita.</p><p>Código: ${updated.code}</p>`,
    });
  }

  return updated;
}

// ── Administración ───────────────────────────────────────────────────

export async function listBookingsAdmin({ status, from, to, q, page = 1, pageSize = 25 }) {
  const where = {};
  if (status) where.status = status;
  if (from || to) {
    where.startAt = {};
    if (from) where.startAt.gte = new Date(from);
    if (to) where.startAt.lte = new Date(to);
  }
  if (q) {
    where.OR = [
      { customerName: { contains: q, mode: 'insensitive' } },
      { customerEmail: { contains: q, mode: 'insensitive' } },
      { customerPhone: { contains: q } },
      { code: { contains: q.toUpperCase() } },
    ];
  }

  const [total, items] = await Promise.all([
    prisma.booking.count({ where }),
    prisma.booking.findMany({
      where,
      include: { ...bookingInclude, user: { select: { id: true, fullName: true, email: true } } },
      orderBy: { startAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return { total, page, pageSize, items };
}

export async function getBookingAdmin(id) {
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      ...bookingInclude,
      user: { select: { id: true, fullName: true, email: true, loyaltyCard: true } },
      stamp: true,
    },
  });
  if (!booking) throw notFound('Reserva no encontrada');
  return booking;
}

export async function updateBookingStatus({ id, status, adminNotes, reason }) {
  const settings = await getSettings();

  const current = await prisma.booking.findUnique({ where: { id }, include: bookingInclude });
  if (!current) throw notFound('Reserva no encontrada');

  const timestamps = {
    CONFIRMED: { confirmedAt: new Date() },
    CANCELLED: { cancelledAt: new Date() },
    COMPLETED: { completedAt: new Date() },
  };

  const updated = await prisma.booking.update({
    where: { id },
    data: {
      status,
      ...(adminNotes !== undefined ? { adminNotes } : {}),
      ...(timestamps[status] ?? {}),
    },
    include: bookingInclude,
  });

  if (status === 'CONFIRMED' && current.status !== 'CONFIRMED') {
    sendMailAsync({ to: updated.customerEmail, ...bookingConfirmed({ booking: updated, settings }) });
  }
  if (status === 'CANCELLED' && current.status !== 'CANCELLED') {
    sendMailAsync({
      to: updated.customerEmail,
      ...bookingCancelled({ booking: updated, settings, reason }),
    });
  }

  return updated;
}

/** Reprogramación: mismas garantías de concurrencia que al crear. */
export async function rescheduleBooking({ id, startAt }) {
  const settings = await getSettings();

  const { updated, previousStart } = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CALENDAR_LOCK_KEY}::bigint)`;

    const booking = await tx.booking.findUnique({
      where: { id },
      include: { service: { select: { durationMinutes: true } } },
    });
    if (!booking) throw notFound('Reserva no encontrada');
    if (booking.status === 'CANCELLED') throw badRequest('No se puede reprogramar una reserva cancelada');

    const newStart = new Date(startAt);
    if (Number.isNaN(newStart.getTime())) throw badRequest('Fecha y hora inválidas');

    const { startUtc, endUtc } = await assertSlotBookable(tx, {
      service: booking.service,
      startAt: newStart,
      settings,
      ignoreBookingId: booking.id,
    });

    const result = await tx.booking.update({
      where: { id },
      data: { startAt: startUtc, endAt: endUtc, status: 'CONFIRMED', confirmedAt: new Date() },
      include: bookingInclude,
    });

    return { updated: result, previousStart: booking.startAt };
  });

  sendMailAsync({
    to: updated.customerEmail,
    ...bookingRescheduled({ booking: updated, settings, previousStart }),
  });

  return updated;
}

/** Resumen para el panel: cifras de un vistazo. */
export async function getDashboardStats() {
  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [pending, upcoming, monthCompleted, totalClients] = await Promise.all([
    prisma.booking.count({ where: { status: 'PENDING', startAt: { gte: now } } }),
    prisma.booking.count({
      where: { status: { in: ['PENDING', 'CONFIRMED'] }, startAt: { gte: now, lte: in7 } },
    }),
    prisma.booking.aggregate({
      where: { status: 'COMPLETED', completedAt: { gte: monthStart } },
      _count: true,
      _sum: { priceCents: true },
    }),
    prisma.user.count({ where: { role: 'CLIENT' } }),
  ]);

  const nextBookings = await prisma.booking.findMany({
    where: { status: { in: ['PENDING', 'CONFIRMED'] }, startAt: { gte: now } },
    include: bookingInclude,
    orderBy: { startAt: 'asc' },
    take: 6,
  });

  return {
    pending,
    upcoming7Days: upcoming,
    monthCompletedCount: monthCompleted._count,
    monthRevenueCents: monthCompleted._sum.priceCents ?? 0,
    totalClients,
    nextBookings,
  };
}
