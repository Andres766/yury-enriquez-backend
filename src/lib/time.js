import { DateTime, Interval } from 'luxon';

/**
 * Utilidades de tiempo con zona horaria explícita.
 *
 * Regla del proyecto: en la base de datos TODO es UTC. La zona horaria
 * del negocio (Settings.timezone, p. ej. "America/Bogota") solo se usa
 * para interpretar lo que escribe una persona ("2026-10-04", "14:30") y
 * para formatear lo que lee. Así los horarios no se desplazan si el
 * servidor cambia de región.
 */

export const WEEKDAY_NAMES = {
  1: 'Lunes',
  2: 'Martes',
  3: 'Miércoles',
  4: 'Jueves',
  5: 'Viernes',
  6: 'Sábado',
  7: 'Domingo',
};

/** "2026-10-04" + "14:30" en zona del negocio -> DateTime con zona. */
export function zonedDateTime(dateISO, timeHHmm, zone) {
  const [hour, minute] = timeHHmm.split(':').map(Number);
  return DateTime.fromISO(dateISO, { zone }).set({
    hour,
    minute,
    second: 0,
    millisecond: 0,
  });
}

/** Inicio del día (00:00) de una fecha, en la zona del negocio. */
export function startOfDay(dateISO, zone) {
  return DateTime.fromISO(dateISO, { zone }).startOf('day');
}

export function endOfDay(dateISO, zone) {
  return DateTime.fromISO(dateISO, { zone }).endOf('day');
}

/** Valida que la cadena sea una fecha real en formato YYYY-MM-DD. */
export function isValidDateISO(dateISO, zone = 'utc') {
  return DateTime.fromISO(dateISO, { zone }).isValid;
}

/** Ahora mismo en la zona del negocio. */
export function nowIn(zone) {
  return DateTime.now().setZone(zone);
}

/** ¿Se solapan [aStart, aEnd) y [bStart, bEnd)? */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

/** Formatea para correos y panel: "sábado, 4 de octubre de 2026". */
export function formatLongDate(date, zone) {
  return DateTime.fromJSDate(date, { zone }).setLocale('es').toFormat("cccc, d 'de' LLLL 'de' yyyy");
}

/** Formatea la hora: "2:30 p. m.". */
export function formatTime(date, zone) {
  return DateTime.fromJSDate(date, { zone }).setLocale('es').toFormat('h:mm a');
}

/** "sábado, 4 de octubre de 2026 · 2:30 p. m." */
export function formatDateTime(date, zone) {
  return `${formatLongDate(date, zone)} · ${formatTime(date, zone)}`;
}

/** Duración legible: 90 -> "1 h 30 min". */
export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

/** Lista de fechas ISO entre dos fechas, inclusive, en la zona dada. */
export function eachDateISO(fromISO, toISO, zone) {
  const start = startOfDay(fromISO, zone);
  const end = startOfDay(toISO, zone);
  const out = [];
  for (let d = start; d <= end; d = d.plus({ days: 1 })) {
    out.push(d.toISODate());
  }
  return out;
}

export { DateTime, Interval };
