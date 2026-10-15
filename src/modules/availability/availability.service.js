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
 *   6. Cae dentro del horizonte de reservas y, si el servicio tiene
 *      temporada, dentro de sus fechas (ver isInSeason).
 *
 * El margen (`bufferMinutes`) se aplica al final de cada cita, para
 * limpiar y preparar antes de la siguiente.
 */

const LIVE_STATUSES = ['PENDING', 'CONFIRMED', 'COMPLETED'];

/** Días de anticipación máxima para un servicio: el suyo o el general. */
export function horizonDays(service, settings) {
  return service?.maxAdvanceDays ?? settings.maxAdvanceDays;
}

/**
 * Último instante reservable para un servicio.
 *
 * Se cuenta hasta el FINAL del último día, igual en el calendario, en
 * la lista de horarios y al crear la reserva: si una fuera hasta "ahora
 * + N días" exactos y otra hasta medianoche, el calendario ofrecería
 * por la tarde horarios que luego se rechazan.
 */
export function bookingHorizon({ service, settings, now }) {
  return now.plus({ days: horizonDays(service, settings) }).endOf('day');
}

/**
 * Temporada de un servicio: { from, until } con fechas YYYY-MM-DD (ambas
 * inclusive, en la zona del negocio), o null si se reserva todo el año.
 * Puede faltar una de las dos puntas: "desde el 22" o "hasta el 31".
 *
 * La temporada limita el DÍA DE LA CITA, no el día en que se reserva:
 * las catrinas (22–31 oct) se pueden separar desde hoy mismo. Por eso
 * convive con el horizonte (bookingHorizon) y se aplican los dos.
 */
export function serviceSeason(service) {
  const from = service?.availableFrom || null;
  const until = service?.availableUntil || null;
  return from || until ? { from, until } : null;
}

/**
 * ¿Se puede agendar ese día (YYYY-MM-DD en la zona del negocio) dentro
 * de la temporada del servicio? Las fechas se comparan como texto, igual
 * que el tema de temporada de Ajustes. Es la ÚNICA regla de temporada:
 * la usan el calendario, la lista de horarios, "próximo horario libre",
 * la creación y la reprogramación, para que ninguna ofrezca un día que
 * otra rechace.
 */
export function isInSeason(service, dateISO) {
  const season = serviceSeason(service);
  if (!season) return true;
  return (!season.from || dateISO >= season.from) && (!season.until || dateISO <= season.until);
}

/** "2026-10-22" → "22 de octubre". */
const dayMonth = (dateISO) => DateTime.fromISO(dateISO).setLocale('es').toFormat("d 'de' LLLL");

/**
 * Mensaje para quien intenta reservar fuera de temporada, con la misma
 * forma que muestra la web: "del 22 al 31 de octubre" si es el mismo mes.
 */
export function seasonMessage(service) {
  const season = serviceSeason(service);
  if (!season) return null;
  const { from, until } = season;
  if (from && until) {
    const sameMonth = from.slice(0, 7) === until.slice(0, 7);
    const start = sameMonth ? String(Number(from.slice(8, 10))) : dayMonth(from);
    return `Este servicio solo se reserva del ${start} al ${dayMonth(until)}.`;
  }
  if (from) return `Este servicio se reserva a partir del ${dayMonth(from)}.`;
  return `Este servicio solo se reserva hasta el ${dayMonth(until)}.`;
}

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
    select: {
      id: true,
      durationMinutes: true,
      name: true,
      maxAdvanceDays: true,
      availableFrom: true,
      availableUntil: true,
    },
  });
  if (!service) throw notFound('El servicio no existe o no está disponible');

  const day = startOfDay(dateISO, tz);
  const now = DateTime.now().setZone(tz);

  // Ventana de reserva: ni pasado ni más allá del horizonte permitido.
  const horizon = bookingHorizon({ service, settings, now });
  if (day.endOf('day') < now.startOf('day') || day > horizon || !isInSeason(service, dateISO)) {
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
    select: { id: true, durationMinutes: true, maxAdvanceDays: true, availableFrom: true, availableUntil: true },
  });
  if (!service) throw notFound('El servicio no existe o no está disponible');

  const monthStart = DateTime.fromObject({ year, month, day: 1 }, { zone: tz });
  if (!monthStart.isValid) throw badRequest('Mes inválido');
  const monthEnd = monthStart.endOf('month');

  const now = DateTime.now().setZone(tz);
  const earliest = now.plus({ hours: settings.minNoticeHours });
  const horizon = bookingHorizon({ service, settings, now });

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

    /*
     * Un día sin cupo puede estarlo por motivos muy distintos, y para la
     * clienta no es lo mismo: "cerrado" (no se atiende ese día),
     * "lleno" (Yury está ocupada) o "aún no abierto" (pasa del horizonte
     * de reservas: se puede pedir por WhatsApp). Si todo saliera igual de
     * gris, una novia que busca junio entendería que no hay cupo.
     *
     * "Fuera de temporada" va antes que "aún no abierto": un día que cae
     * fuera de las fechas del servicio no se abrirá nunca, por mucho que
     * pase el tiempo, y decirle a la clienta que espere sería engañarla.
     */
    if (day.endOf('day') < earliest) {
      days.push({ date: dateISO, available: false, slotCount: 0, reason: 'past' });
      continue;
    }
    if (!isInSeason(service, dateISO)) {
      days.push({ date: dateISO, available: false, slotCount: 0, reason: 'season' });
      continue;
    }
    if (day > horizon) {
      days.push({ date: dateISO, available: false, slotCount: 0, reason: 'beyond' });
      continue;
    }
    if (dayRules.length === 0) {
      days.push({ date: dateISO, available: false, slotCount: 0, reason: 'closed' });
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

    days.push({ date: dateISO, available: count > 0, slotCount: count, ...(count > 0 ? {} : { reason: 'full' }) });
  }

  return {
    year,
    month,
    timezone: tz,
    // El calendario usa estos dos datos para no dejar avanzar más allá
    // del último mes reservable y explicar por qué.
    maxAdvanceDays: horizonDays(service, settings),
    lastBookableDate: horizon.toISODate(),
    // Temporada del servicio ({ from, until } o null), para que la web
    // explique por qué esos días no se pueden elegir.
    season: serviceSeason(service),
    days,
  };
}

/**
 * Primer horario libre de un servicio, desde hoy (o desde el día
 * siguiente a `after`) hasta el horizonte de reservas.
 *
 * Recorre mes a mes con el mismo cálculo del calendario y, al dar con
 * el primer día con cupo, pide sus horarios: así el resultado es
 * exactamente lo que la clienta vería al tocar ese día. Se corta a los
 * 13 meses como red de seguridad (el horizonte máximo es de 365 días).
 *
 * Con temporada, la búsqueda empieza el primer día de la temporada (si
 * aún no ha llegado) y termina en su último día: así las catrinas no
 * recorren meses enteros fuera de fechas, y cuando la temporada ya pasó
 * la respuesta es "no hay" (date: null) en vez de un día imposible.
 */
export async function getNextAvailable({ serviceId, after }) {
  const settings = await getSettings();
  const tz = settings.timezone;
  const now = DateTime.now().setZone(tz);

  if (after && !isValidDateISO(after)) throw badRequest('Fecha inválida');

  const service = await prisma.service.findFirst({
    where: { id: serviceId, active: true },
    select: { id: true, maxAdvanceDays: true, availableFrom: true, availableUntil: true },
  });
  if (!service) throw notFound('El servicio no existe o no está disponible');

  // Un `after` del pasado no puede hacer recorrer meses ya cerrados: se
  // busca desde hoy como mínimo, y nunca antes de que abra la temporada.
  const afterISO = after ? DateTime.fromISO(after, { zone: tz }).plus({ days: 1 }).toISODate() : null;
  const season = serviceSeason(service);
  const fromISO = [now.toISODate(), afterISO, season?.from].filter(Boolean).sort().at(-1);

  // Último día en el que tiene sentido buscar: el horizonte de reservas o
  // el fin de la temporada, lo que llegue antes. Rigen los dos límites.
  const lastBookableDate = bookingHorizon({ service, settings, now }).toISODate();
  const endISO = season?.until && season.until < lastBookableDate ? season.until : lastBookableDate;
  if (fromISO > endISO) return { date: null, slot: null, lastBookableDate };

  let cursor = DateTime.fromISO(fromISO, { zone: tz }).startOf('month');
  for (let i = 0; i < 13; i += 1) {
    const month = await getMonthAvailability({ serviceId, year: cursor.year, month: cursor.month });
    // Normalmente el primer día con cupo ya tiene horarios, pero si no
    // (p. ej. el de hoy al cruzar la antelación mínima) se sigue con el
    // siguiente del mismo mes en vez de saltar al mes que viene.
    for (const day of month.days.filter((d) => d.available && d.date >= fromISO && d.date <= endISO)) {
      const { slots } = await getSlotsForDate({ serviceId, date: day.date });
      if (slots.length > 0) return { date: day.date, slot: slots[0], lastBookableDate: month.lastBookableDate };
    }
    if (cursor.endOf('month').toISODate() >= endISO) {
      return { date: null, slot: null, lastBookableDate: month.lastBookableDate };
    }
    cursor = cursor.plus({ months: 1 });
  }
  return { date: null, slot: null, lastBookableDate: null };
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
