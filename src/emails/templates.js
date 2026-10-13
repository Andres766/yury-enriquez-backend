import { h, safe, nl2brSafe, escapeHtml } from '../lib/sanitize.js';
import { formatLongDate, formatTime, formatDuration } from '../lib/time.js';
import env from '../config/env.js';

/**
 * Plantillas de correo.
 *
 * TODO lo que viene del usuario se interpola con el tag `h`, que escapa
 * automáticamente. Es el único punto del backend donde componemos HTML
 * a mano, así que aquí es donde se corta el XSS por correo: un nombre
 * como `<img onerror=...>` llega como texto plano al buzón.
 */

/**
 * Paleta de los correos.
 *
 * Fija y siempre clara, a propósito: los clientes de correo no leen
 * variables CSS ni saben qué tema tiene activo la web, y muchos
 * (Outlook, Gmail en escritorio) recortan las media queries. Un correo
 * legible en cualquier bandeja vale más que uno que combine con el tema
 * del momento. Los valores salen del logo.
 */
const PALETTE = {
  ink: '#1F1D1A', // negro de la firma
  muted: '#6E6860',
  brand: '#7D6640', // dorado oscurecido, contrasta con blanco
  blush: '#E9E1D4', // beige del logo
  gold: '#C8B287', // dorado del monograma
  line: '#D8CDBD',
  bg: '#F4EFE6',
};

const money = (cents, currency = 'COP') =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);

const PAYMENT_LABEL = {
  TRANSFERENCIA: 'Transferencia bancaria',
  EFECTIVO: 'Efectivo el día del servicio',
};

const STATUS_LABEL = {
  PENDING: 'Pendiente de confirmación',
  CONFIRMED: 'Confirmada',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
  NO_SHOW: 'No asistió',
};

/** Envoltorio común: cabecera, cuerpo y pie. */
function layout({ brand, title, intro, bodyHtml, footerNote }) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px 12px;background:${PALETTE.bg};font-family:Georgia,'Times New Roman',serif;color:${PALETTE.ink};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid ${PALETTE.line};border-radius:16px;overflow:hidden;">
    <tr><td style="background:${PALETTE.blush};padding:28px 32px;text-align:center;">
      <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:${PALETTE.muted};">${escapeHtml(brand)}</div>
      <h1 style="margin:8px 0 0;font-size:24px;font-weight:400;color:${PALETTE.ink};">${escapeHtml(title)}</h1>
    </td></tr>
    <tr><td style="padding:28px 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.65;">
      <p style="margin:0 0 20px;">${intro}</p>
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:20px 32px 28px;border-top:1px solid ${PALETTE.line};font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${PALETTE.muted};line-height:1.6;">
      ${footerNote}
    </td></tr>
  </table>
</body></html>`;
}

/** Tabla de datos clave → valor. */
function detailsTable(rows) {
  const body = rows
    .filter((r) => r && r[1] !== null && r[1] !== undefined && r[1] !== '')
    .map(
      ([label, value]) => `<tr>
        <td style="padding:8px 0;color:${PALETTE.muted};width:38%;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:8px 0;color:${PALETTE.ink};font-weight:600;">${value instanceof Object ? value : escapeHtml(value)}</td>
      </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${PALETTE.line};border-bottom:1px solid ${PALETTE.line};margin:4px 0 20px;">${body}</table>`;
}

function button(href, label) {
  return `<p style="margin:24px 0 0;text-align:center;">
    <a href="${escapeHtml(href)}" style="display:inline-block;background:${PALETTE.brand};color:#ffffff;text-decoration:none;padding:13px 28px;border-radius:999px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;">${escapeHtml(label)}</a>
  </p>`;
}

/**
 * Bloque de datos común a los dos correos de reserva.
 *
 * La hora de fin se calcula con la duración del servicio, no con
 * `booking.endAt`: ese campo incluye el margen de limpieza entre citas,
 * que es información interna de la agenda y confundiría a la clienta.
 */
function bookingRows(booking, tz) {
  const serviceEnd = new Date(booking.startAt.getTime() + booking.service.durationMinutes * 60_000);
  return [
    ['Código', booking.code],
    ['Servicio', booking.service.name],
    ['Duración', formatDuration(booking.service.durationMinutes)],
    ['Ocasión', booking.occasion?.name ?? null],
    ['Fecha', formatLongDate(booking.startAt, tz)],
    ['Hora', `${formatTime(booking.startAt, tz)} – ${formatTime(serviceEnd, tz)}`],
    ['Valor', money(booking.priceCents, booking.currency)],
    ['Medio de pago', PAYMENT_LABEL[booking.paymentMethod] ?? booking.paymentMethod],
    ['Estado', STATUS_LABEL[booking.status] ?? booking.status],
  ];
}

// ── Correo al cliente: reserva recibida ──────────────────────────────

export function bookingReceivedCustomer({ booking, settings }) {
  const tz = settings.timezone;
  const lookupUrl = `${env.APP_URL}/mi-reserva?codigo=${encodeURIComponent(booking.code)}`;

  const transferNote =
    booking.paymentMethod === 'TRANSFERENCIA' && settings.transferInstructions
      ? `<div style="background:${PALETTE.blush};border-radius:12px;padding:16px 18px;margin:0 0 4px;">
           <strong style="display:block;margin-bottom:6px;">Datos para la transferencia</strong>
           <span style="color:${PALETTE.muted};">${nl2brSafe(settings.transferInstructions)}</span>
         </div>`
      : booking.paymentMethod === 'EFECTIVO'
        ? `<p style="margin:0 0 4px;color:${PALETTE.muted};">Pagarás en efectivo el día del servicio. No necesitas adelantar nada.</p>`
        : '';

  const html = layout({
    brand: settings.brandName,
    title: 'Recibimos tu reserva',
    intro: h`Hola ${booking.customerName}, gracias por reservar con nosotras. Estos son los datos de tu cita:`,
    bodyHtml: `
      ${detailsTable(bookingRows(booking, tz))}
      ${transferNote}
      <p style="margin:18px 0 0;color:${PALETTE.muted};">
        Te escribiremos para confirmar la cita. Si necesitas cambiar algo, responde este correo
        o escríbenos por WhatsApp al ${escapeHtml(settings.whatsappNumber || settings.contactPhone)}.
      </p>
      ${button(lookupUrl, 'Ver mi reserva')}
    `,
    footerNote: h`${settings.brandName} · ${settings.addressLine} · ${settings.contactPhone}`,
  });

  const text = [
    `Hola ${booking.customerName}, recibimos tu reserva.`,
    '',
    ...bookingRows(booking, tz)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`),
    '',
    booking.paymentMethod === 'TRANSFERENCIA' && settings.transferInstructions
      ? `Datos para la transferencia:\n${settings.transferInstructions}`
      : 'Pagarás en efectivo el día del servicio.',
    '',
    `Consulta tu reserva: ${lookupUrl}`,
    `${settings.brandName} · ${settings.contactPhone}`,
  ].join('\n');

  return {
    subject: `Recibimos tu reserva · ${booking.code}`,
    html,
    text,
    replyTo: settings.contactEmail || undefined,
  };
}

// ── Correo a la maquilladora: nueva reserva ──────────────────────────

export function bookingReceivedOwner({ booking, settings }) {
  const tz = settings.timezone;
  const adminUrl = `${env.APP_URL}/admin/reservas?codigo=${encodeURIComponent(booking.code)}`;
  const waNumber = booking.customerPhone.replace(/\D/g, '');

  const html = layout({
    brand: settings.brandName,
    title: 'Nueva reserva',
    intro: h`${booking.customerName} acaba de reservar ${booking.service.name}.`,
    bodyHtml: `
      ${detailsTable([
        ...bookingRows(booking, tz),
        ['Cliente', booking.customerName],
        [
          'Teléfono',
          safe(
            `<a href="https://wa.me/${escapeHtml(waNumber)}" style="color:${PALETTE.brand};">${escapeHtml(booking.customerPhone)}</a>`,
          ),
        ],
        [
          'Correo',
          safe(
            `<a href="mailto:${escapeHtml(booking.customerEmail)}" style="color:${PALETTE.brand};">${escapeHtml(booking.customerEmail)}</a>`,
          ),
        ],
        ['Tipo de cliente', booking.userId ? 'Registrada' : 'Invitada (sin cuenta)'],
        ['Notas', booking.notes ? nl2brSafe(booking.notes) : null],
      ])}
      ${button(adminUrl, 'Abrir en el panel')}
    `,
    footerNote: 'Correo automático del sistema de reservas.',
  });

  const text = [
    `Nueva reserva de ${booking.customerName}`,
    '',
    ...bookingRows(booking, tz)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`),
    `Teléfono: ${booking.customerPhone}`,
    `Correo: ${booking.customerEmail}`,
    `Tipo: ${booking.userId ? 'Registrada' : 'Invitada'}`,
    booking.notes ? `Notas: ${booking.notes}` : '',
    '',
    `Panel: ${adminUrl}`,
  ].join('\n');

  return {
    subject: `Nueva reserva · ${booking.code} · ${formatLongDate(booking.startAt, tz)}`,
    html,
    text,
    replyTo: booking.customerEmail,
  };
}

// ── Cambios de estado ────────────────────────────────────────────────

export function bookingConfirmed({ booking, settings }) {
  const tz = settings.timezone;
  const html = layout({
    brand: settings.brandName,
    title: '¡Tu cita está confirmada!',
    intro: h`Hola ${booking.customerName}, tu cita quedó confirmada. Te esperamos.`,
    bodyHtml: `
      ${detailsTable(bookingRows(booking, tz))}
      <p style="margin:0;color:${PALETTE.muted};">
        ${escapeHtml(settings.addressLine)}<br>
        ${escapeHtml(settings.businessHoursNote)}
      </p>
    `,
    footerNote: h`¿Necesitas reprogramar? Escríbenos al ${settings.whatsappNumber || settings.contactPhone}.`,
  });

  const text = [
    `Hola ${booking.customerName}, tu cita quedó confirmada.`,
    '',
    ...bookingRows(booking, tz)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`),
    '',
    settings.addressLine,
  ].join('\n');

  return { subject: `Cita confirmada · ${booking.code}`, html, text };
}

export function bookingRescheduled({ booking, settings, previousStart }) {
  const tz = settings.timezone;
  const html = layout({
    brand: settings.brandName,
    title: 'Cambiamos la fecha de tu cita',
    intro: h`Hola ${booking.customerName}, reprogramamos tu cita. Estos son los datos nuevos:`,
    bodyHtml: `
      ${detailsTable([
        ['Antes', `${formatLongDate(previousStart, tz)} · ${formatTime(previousStart, tz)}`],
        ...bookingRows(booking, tz),
      ])}
      <p style="margin:0;color:${PALETTE.muted};">Si esta fecha no te sirve, respóndenos y buscamos otra.</p>
    `,
    footerNote: h`${settings.brandName} · ${settings.contactPhone}`,
  });

  const text = [
    `Hola ${booking.customerName}, reprogramamos tu cita.`,
    `Antes: ${formatLongDate(previousStart, tz)} ${formatTime(previousStart, tz)}`,
    `Ahora: ${formatLongDate(booking.startAt, tz)} ${formatTime(booking.startAt, tz)}`,
  ].join('\n');

  return { subject: `Tu cita cambió de fecha · ${booking.code}`, html, text };
}

export function bookingCancelled({ booking, settings, reason }) {
  const tz = settings.timezone;
  const html = layout({
    brand: settings.brandName,
    title: 'Tu cita fue cancelada',
    intro: h`Hola ${booking.customerName}, tu cita del ${formatLongDate(booking.startAt, tz)} quedó cancelada.`,
    bodyHtml: `
      ${detailsTable([
        ['Código', booking.code],
        ['Servicio', booking.service.name],
        ['Motivo', reason ?? null],
      ])}
      <p style="margin:0;color:${PALETTE.muted};">Cuando quieras retomar, puedes reservar de nuevo desde la web.</p>
      ${button(`${env.APP_URL}/reservar`, 'Reservar otra fecha')}
    `,
    footerNote: h`${settings.brandName} · ${settings.contactPhone}`,
  });

  const text = `Hola ${booking.customerName}, tu cita ${booking.code} fue cancelada.${reason ? ` Motivo: ${reason}` : ''}`;
  return { subject: `Cita cancelada · ${booking.code}`, html, text };
}

// ── Fidelidad ────────────────────────────────────────────────────────

export function loyaltyRewardUnlocked({ user, settings, reward }) {
  const html = layout({
    brand: settings.brandName,
    title: '¡Completaste tu tarjeta!',
    intro: h`Hola ${user.fullName}, llenaste los ${String(settings.stampsRequired)} sellos de tu tarjeta de fidelidad.`,
    bodyHtml: `
      <div style="background:${PALETTE.blush};border-radius:12px;padding:20px;text-align:center;margin-bottom:8px;">
        <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:${PALETTE.muted};">Tu recompensa</div>
        <div style="font-size:20px;margin-top:6px;color:${PALETTE.ink};">${escapeHtml(reward.description)}</div>
      </div>
      <p style="margin:16px 0 0;color:${PALETTE.muted};">Menciónala al agendar tu próxima cita para aplicarla.</p>
      ${button(`${env.APP_URL}/mi-cuenta`, 'Ver mi tarjeta')}
    `,
    footerNote: h`${settings.brandName} · ${settings.contactPhone}`,
  });

  const text = `Hola ${user.fullName}, completaste tu tarjeta de fidelidad. Recompensa: ${reward.description}`;
  return { subject: '¡Completaste tu tarjeta de fidelidad!', html, text };
}

export function welcomeEmail({ user, settings }) {
  const html = layout({
    brand: settings.brandName,
    title: 'Bienvenida',
    intro: h`Hola ${user.fullName}, tu cuenta quedó creada.`,
    bodyHtml: `
      <p style="margin:0 0 12px;">Desde tu cuenta puedes:</p>
      <ul style="margin:0 0 8px;padding-left:20px;color:${PALETTE.muted};line-height:1.9;">
        <li>Ver el historial de tus citas</li>
        <li>Seguir tu tarjeta de fidelidad sello a sello</li>
        <li>Enterarte primero de promociones y dinámicas</li>
      </ul>
      ${button(`${env.APP_URL}/mi-cuenta`, 'Entrar a mi cuenta')}
    `,
    footerNote: h`${settings.brandName} · ${settings.contactPhone}`,
  });

  return {
    subject: h`Bienvenida a ${settings.brandName}`,
    html,
    text: `Hola ${user.fullName}, tu cuenta en ${settings.brandName} quedó creada.`,
  };
}
