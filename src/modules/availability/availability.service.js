import prisma from '../../lib/prisma.js';
import { getSettings } from '../settings/settings.service.js';
import { DateTime, zonedDateTime, startOfDay, endOfDay, isValidDateISO, overlaps } from '../../lib/time.js';
import { badRequest, notFound } from '../../lib/errors.js';

/**
 * Motor de disponibilidad.
 *
 * Un hueco se ofrece solo si supera TODOS estos filtros:
 *   1. Cae dentro de una regla de horario semanal activa.
 *   2. El servicio completo (duración + margen) termina antes del cierre.
 *   3. No se solapa con ninguna reserva viva (PENDING/CONFIRMED/COMPLETED).
 *   4. No se solapa con ningún bloqueo de agenda.
 *   5. Respeta la antelación mínima (no se puede reservar "para dentro
 *      de diez minutos") y no está en el pasado.
 *
 * El margen (`bufferMinutes`) se aplica al final de cada cita, para
 * limpiar y preparar antes de la siguiente.
 */

const LIVE_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED'];

export async function getAvailabilityRules() {
  return prisma.availabilityRule.findMany({
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });
}

/**
 * Huecos disponibles para un servicio en una fecha concreta.
 * @param {string} date  "YYYY-MM-DD" en la zona del negocio
 */
export async function getSlotsForDate({ serviceId, date: dateISO }) {
  const settings = await getSettings();
  const tz = settings.timezone;

  if (!isValidDateISO(dateISO)) throw badRequest('Fecha inválida');

  const service = await prisma.service.findFirst({
    where: { id: serviceId, active: true },
    select: { id: true, durationMinutes: true, name: true },
  });
  if (!service) throw notFound('El servicio no existe o no está disponible');

  const day = startOfDay(dateISO, tz);
  const now = DateTime.now().setZone(tz);

  // Ventana de reserva: ni pasado ni más allá del horizonte permitido.
  const horizon = now.plus({ days: settings.maxAdvanceDays }).endOf('day');
  if (day.endOf('day') < now.startOf('day') || day > horizon) {
    return { date: dateISO, timezone: tz, slots: [] };
  }

  const rules = await prisma.availabilityRule.findMany({
    where: { weekday: day.weekday, active: true },
    orderBy: { startTime: 'asc' },
  });
  if (rules.length === 0) return { date: dateISO, timezone: tz, slots: [] };

  const dayStartUtc = day.toUTC().toJSDate();
  const dayEndUtc = endOfDay(dateISO, tz).toUTC().toJSDate();

  const [bookings, blocks] = await Promise.all([
    prisma.booking.findMany({
      where: {
        status: { in: LIVE_STATUSES },
        startAt: { lt: dayEndUtc },
        endAt: { gt: dayStartUtc },
      },
      select: { startAt: true, endAt: true },
    }),
    prisma.timeBlock.findMany({
      where: { startAt: { lt: dayEndUtc }, endAt: { gt: dayStartUtc } },
      select: { startAt: true, endAt: true },
    }),
  ]);

  const busy = [...bookings, ...blocks].map((b) => ({
    start: DateTime.fromJSDate(b.startAt),
    end: DateTime.fromJSDate(b.endAt),
  }));

  const earliest = now.plus({ hours: settings.minNoticeHours });
  const step = settings.slotIntervalMinutes;
  const totalMinutes = service.durationMinutes + settings.bufferMinutes;

  const slots = [];

  for (const rule of rules) {
    const windowStart = zonedDateTime(dateISO, rule.startTime, tz);
    const windowEnd = zonedDateTime(dateISO, rule.endTime, tz);
    if (!windowStart.isValid || !windowEnd.isValid || windowEnd <= windowStart) continue;

    for (let cursor = windowStart; cursor.plus({ minutes: totalMinutes }) <= windowEnd; cursor = cursor.plus({ minutes: step })) {
      const slotStart = cursor;
      const slotEnd = cursor.plus({ minutes: totalMinutes });

      if (slotStart < earliest) continue;

      const taken = busy.some((b) => overlaps(slotStart, slotEnd, b.start, b.end));
      if (taken) continue;

      slots.push({
        start: slotStart.toUTC().toISO(),
        end: slotEnd.toUTC().toISO(),
        label: slotStart.setLocale('es').toFormat('h:mm a'),
        time: slotStart.toFormat('HH:mm'),
      });
    }
  }

  // Dos reglas del mismo día pueden generar el mismo inicio: deduplicar.
  const seen = new Set();
  const unique = slots
    .filter((s) => (seen.has(s.start) ? false : seen.add(s.start)))
    .sort((a, b) => a.start.localeCompare(b.start));

  return {
    date: dateISO,
    timezone: tz,
    serviceId: service.id,
    durationMinutes: service.durationMinutes,
    slots: unique,
  };
}

/**
 * Resumen mes a mes para pintar el calendario: qué días tienen algún
 * hueco. Se calcula día a día pero con UNA sola consulta de reservas y
 * bloqueos para todo el rango.
 */
export async function getMonthAvailability({ serviceId, year, month }) {
  const settings = await getSettings();
  const tz = settings.timezone;

  const service = await prisma.service.findFirst({
    where: { id: serviceId, active: true },
    select: { id: true, durationMinutes: true },
  });
  if (!service) throw notFound('El servicio no existe o no está disponible');

  const monthStart = DateTime.fromObject({ year, month, day: 1 }, { zone: tz });
  if (!monthStart.isValid) throw badRequest('Mes inválido');
  const monthEnd = monthStart.endOf('month');

  const now = DateTime.now().setZone(tz);
  const earliest = now.plus({ hours: settings.minNoticeHours });
  const horizon = now.plus({ days: settings.maxAdvanceDays }).endOf('day');

  const [rules, bookings, blocks] = await Promise.all([
    prisma.availabilityRule.findMany({ where: { active: true } }),
    prisma.booking.findMany({
      where: {
        status: { in: LIVE_STATUSES },
        startAt: { lt: monthEnd.toUTC().toJSDate() },
        endAt: { gt: monthStart.toUTC().toJSDate() },
      },
      select: { startAt: true, endAt: true },
    }),
    prisma.timeBlock.findMany({
      where: {
        startAt: { lt: monthEnd.toUTC().toJSDate() },
        endAt: { gt: monthStart.toUTC().toJSDate() },
      },
      select: { startAt: true, endAt: true },
    }),
  ]);

  const busy = [...bookings, ...blocks].map((b) => ({
    start: DateTime.fromJSDate(b.startAt),
    end: DateTime.fromJSDate(b.endAt),
  }));

  const rulesByWeekday = new Map();
  for (const rule of rules) {
    if (!rulesByWeekday.has(rule.weekday)) rulesByWeekday.set(rule.weekday, []);
    rulesByWeekday.get(rule.weekday).push(rule);
  }

  const step = settings.slotIntervalMinutes;
  const totalMinutes = service.durationMinutes + settings.bufferMinutes;
  const days = [];

  for (let day = monthStart; day <= monthEnd; day = day.plus({ days: 1 })) {
    const dateISO = day.toISODate();
    const dayRules = rulesByWeekday.get(day.weekday) ?? [];

    if (dayRules.length === 0 || day > horizon || day.endOf('day') < earliest) {
      days.push({ date: dateISO, available: false, slotCount: 0 });
      continue;
    }

    let count = 0;
    for (const rule of dayRules) {
      const windowStart = zonedDateTime(dateISO, rule.startTime, tz);
      const windowEnd = zonedDateTime(dateISO, rule.endTime, tz);
      if (!windowStart.isValid || !windowEnd.isValid || windowEnd <= windowStart) continue;

      for (let c = windowStart; c.plus({ minutes: totalMinutes }) <= windowEnd; c = c.plus({ minutes: step })) {
        if (c < earliest) continue;
        const slotEnd = c.plus({ minutes: totalMinutes });
        if (busy.some((b) => overlaps(c, slotEnd, b.start, b.end))) continue;
        count += 1;
      }
    }

    days.push({ date: dateISO, available: count > 0, slotCount: count });
  }

  return { year, month, timezone: tz, days };
}

// ── Administración de reglas y bloqueos ─────────────────────────────

export async function replaceAvailabilityRules(rules) {
  return prisma.$transaction(async (tx) => {
    await tx.availabilityRule.deleteMany({});
    if (rules.length === 0) return [];
    await tx.availabilityRule.createMany({ data: rules });
    return tx.availabilityRule.findMany({ orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] });
  });
}

export async function listTimeBlocks({ from, to } = {}) {
  const where = {};
  if (from) where.endAt = { gt: new Date(from) };
  if (to) where.startAt = { lt: new Date(to) };
  return prisma.timeBlock.findMany({ where, orderBy: { startAt: 'asc' } });
}

export async function createTimeBlock({ date, startTime, endTime, allDay, reason }) {
  const settings = await getSettings();
  const tz = settings.timezone;

  if (!isValidDateISO(date)) throw badRequest('Fecha inválida');

  const startAt = allDay ? startOfDay(date, tz) : zonedDateTime(date, startTime, tz);
  const endAt = allDay ? endOfDay(date, tz) : zonedDateTime(date, endTime, tz);

  if (!startAt.isValid || !endAt.isValid) throw badRequest('Horas inválidas');
  if (endAt <= startAt) throw badRequest('La hora de fin debe ser posterior a la de inicio');

  return prisma.timeBlock.create({
    data: {
      startAt: startAt.toUTC().toJSDate(),
      endAt: endAt.toUTC().toJSDate(),
      allDay: Boolean(allDay),
      reason: reason || null,
    },
  });
}

export async function deleteTimeBlock(id) {
  await prisma.timeBlock.delete({ where: { id } });
}
