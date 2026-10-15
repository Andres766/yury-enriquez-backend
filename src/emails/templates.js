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
  TRANSFERENCIA: 'Transferencia por Nequi o Daviplata',
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
/**
 * El precio, igual que en la web: un servicio «desde» no tiene un total
 * cerrado y uno «a cotizar» no tiene precio público.
 */
function priceRow(booking) {
  const amount = money(booking.priceCents, booking.currency);
  const mode = booking.service?.priceMode ?? 'FIXED';
  if (mode === 'QUOTE') return ['Valor', 'A cotizar con Yury por WhatsApp'];
  if (mode === 'FROM') return ['Valor', `Desde ${amount} (Yury te confirma el valor final)`];
  return ['Valor', amount];
}

/**
 * Línea del abono para separar la fecha, con las mismas reglas que la
 * web (depositText en frontend/src/lib/format.js), para que la clienta
 * lea lo mismo en la ficha y en el correo:
 *   FIXED → "Separas tu fecha con un abono del 50 % ($45.000)"
 *   FROM  → "… del 50 % del valor final" (el total aún no está cerrado)
 *   QUOTE → "… del 50 % del valor acordado"
 * Sin porcentaje en Ajustes (null o 0) no hay política y no se dice nada.
 * El importe sale del precio guardado en la reserva, no del catálogo de
 * hoy: si Yury cambia la tarifa después, el abono de esta cita no cambia.
 */
export function depositText(depositPercent, booking) {
  const pct = Number(depositPercent);
  if (!pct || pct <= 0) return null;
  const mode = booking.service?.priceMode ?? 'FIXED';
  if (mode === 'QUOTE') return `Separas tu fecha con un abono del ${pct} % del valor acordado`;
  if (mode === 'FROM') return `Separas tu fecha con un abono del ${pct} % del valor final`;
  const amount = money(Math.round(((booking.priceCents ?? 0) * pct) / 100), booking.currency);
  return `Separas tu fecha con un abono del ${pct} % (${amount})`;
}

/**
 * Línea del adicional del domicilio. Yury trabaja 100 % a domicilio:
 * dentro del perímetro urbano de Pasto cobra un valor fijo (Ajustes →
 * homeVisitFeeCents) y fuera de la ciudad lo que cueste el transporte,
 * que se cuadra aparte. Sin valor en Ajustes (null) no se dice nada,
 * igual que en la web. No se suma al precio de la reserva: ese sigue
 * siendo el del servicio, que es sobre el que se calcula el abono.
 */
export function homeVisitText(homeVisitFeeCents, currency = 'COP') {
  if (homeVisitFeeCents === null || homeVisitFeeCents === undefined) return null;
  const fee = Number(homeVisitFeeCents);
  if (!Number.isFinite(fee) || fee < 0) return null;
  const urban =
    fee === 0
      ? 'Sin costo dentro del perímetro urbano de Pasto'
      : `Adicional de ${money(fee, currency)} dentro del perímetro urbano de Pasto`;
  return `${urban}. Fuera de la ciudad, según la tarifa de transporte vigente (taxi / InDrive).`;
}

function bookingRows(booking, settings) {
  const tz = settings.timezone;
  const serviceEnd = new Date(booking.startAt.getTime() + booking.service.durationMinutes * 60_000);
  return [
    ['Código', booking.code],
    ['Servicio', booking.service.name],
    ['Duración', formatDuration(booking.service.durationMinutes)],
    ['Ocasión', booking.occasion?.name ?? null],
    ['Fecha', formatLongDate(booking.startAt, tz)],
    ['Hora', `${formatTime(booking.startAt, tz)} – ${formatTime(serviceEnd, tz)}`],
    // El lugar es el que dio la clienta, nunca una dirección del negocio:
    // no hay estudio. Las reservas antiguas sin dirección omiten la fila.
    ['Dirección', booking.serviceAddress ?? null],
    priceRow(booking),
    ['Domicilio', homeVisitText(settings.homeVisitFeeCents, booking.currency)],
    ['Abono', depositText(settings.depositPercent, booking)],
    ['Medio de pago', PAYMENT_LABEL[booking.paymentMethod] ?? booking.paymentMethod],
    ['Estado', STATUS_LABEL[booking.status] ?? booking.status],
  ];
}

// ── Correo al cliente: reserva recibida ──────────────────────────────

export function bookingReceivedCustomer({ booking, settings }) {
  const tz = settings.timezone;
  const lookupUrl = `${env.APP_URL}/mi-reserva?codigo=${encodeURIComponent(booking.code)}`;

  /*
   * Con política de abono, quien paga en efectivo también tiene que
   * adelantar algo para separar la fecha: decirle "no necesitas adelantar
   * nada" la contradiría, y necesita los datos de pago igual que quien
   * paga por transferencia.
   */
  const hasDeposit = Boolean(depositText(settings.depositPercent, booking));
  const isTransfer = booking.paymentMethod === 'TRANSFERENCIA';
  const isCash = booking.paymentMethod === 'EFECTIVO';
  const showPaymentData = Boolean(settings.transferInstructions) && (isTransfer || hasDeposit);
  const paymentDataTitle = isTransfer ? 'Datos para la transferencia' : 'Datos para el abono';
  const cashText = hasDeposit
    ? 'El resto lo pagas en efectivo el día del servicio.'
    : 'Pagarás en efectivo el día del servicio. No necesitas adelantar nada.';
  // Con abono, la fecha queda confirmada al recibir el comprobante; sin
  // política de abono, la confirmación la da Yury cuando revisa la agenda.
  const confirmText = hasDeposit
    ? 'Apenas recibamos el comprobante del abono, te confirmamos la cita.'
    : 'Te escribiremos para confirmar la cita.';
  const contactNumber = settings.whatsappNumber || settings.contactPhone;

  const transferNote = [
    showPaymentData
      ? `<div style="background:${PALETTE.blush};border-radius:12px;padding:16px 18px;margin:0 0 4px;">
           <strong style="display:block;margin-bottom:6px;">${escapeHtml(paymentDataTitle)}</strong>
           <span style="color:${PALETTE.muted};">${nl2brSafe(settings.transferInstructions)}</span>
         </div>`
      : '',
    isCash ? `<p style="margin:${showPaymentData ? '12px' : '0'} 0 4px;color:${PALETTE.muted};">${escapeHtml(cashText)}</p>` : '',
  ].join('');

  const html = layout({
    brand: settings.brandName,
    title: 'Recibimos tu reserva',
    intro: h`Hola ${booking.customerName}, gracias por reservar con nosotras. Estos son los datos de tu cita:`,
    bodyHtml: `
      ${detailsTable(bookingRows(booking, settings))}
      ${transferNote}
      <p style="margin:18px 0 0;color:${PALETTE.muted};">
        ${escapeHtml(confirmText)} Si necesitas cambiar algo, responde este correo
        o escríbenos por WhatsApp al ${escapeHtml(contactNumber)}.
      </p>
      ${button(lookupUrl, 'Ver mi reserva')}
    `,
    // Sin dirección del negocio: no hay estudio al que ir. El lugar de la
    // cita es el de la clienta y ya va en la tabla.
    footerNote: h`${settings.brandName} · ${contactNumber}`,
  });

  const text = [
    `Hola ${booking.customerName}, recibimos tu reserva.`,
    '',
    ...bookingRows(booking, settings)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`),
    '',
    ...(showPaymentData ? [`${paymentDataTitle}:\n${settings.transferInstructions}`] : []),
    ...(isCash ? [cashText] : []),
    '',
    confirmText,
    `Consulta tu reserva: ${lookupUrl}`,
    `${settings.brandName} · ${contactNumber}`,
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
  // Búsqueda de Maps con la dirección tal cual la escribió la clienta,
  // para que Yury vea a dónde va antes de pedir el transporte. Casi
  // nadie escribe la ciudad, y sin ella "Calle 18 # 25-30" cae en
  // cualquier parte del país; si ya la nombra, no se toca.
  const mapsQuery = booking.serviceAddress
    ? /pasto|nari[ñn]o/i.test(booking.serviceAddress)
      ? booking.serviceAddress
      : `${booking.serviceAddress}, Pasto, Nariño`
    : null;
  const mapsUrl = mapsQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`
    : null;

  const html = layout({
    brand: settings.brandName,
    title: 'Nueva reserva',
    intro: h`${booking.customerName} acaba de reservar ${booking.service.name}.`,
    bodyHtml: `
      ${detailsTable([
        ...bookingRows(booking, settings),
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
        [
          'Cómo llegar',
          mapsUrl
            ? safe(`<a href="${escapeHtml(mapsUrl)}" style="color:${PALETTE.brand};">Abrir la dirección en Google Maps</a>`)
            : null,
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
    ...bookingRows(booking, settings)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`),
    `Teléfono: ${booking.customerPhone}`,
    `Correo: ${booking.customerEmail}`,
    ...(mapsUrl ? [`Cómo llegar: ${mapsUrl}`] : []),
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

/**
 * Pautas de preparación (contenido de Yury). Van en la confirmación
 * porque es el correo que la clienta relee la víspera.
 */
const PREPARATION_NOTE =
  'Para el día de tu cita: ten el cabello limpio y completamente seco, y el rostro limpio ' +
  'y preparado según las pautas que te damos en la asesoría previa.';

const ADDRESS_CHANGE_NOTE = 'Si la dirección cambia, avísanos por WhatsApp antes del día de la cita.';

export function bookingConfirmed({ booking, settings }) {
  const tz = settings.timezone;
  /*
   * El servicio es 100 % a domicilio: el correo dice que vamos hasta la
   * clienta, nunca "te esperamos en…". Las reservas antiguas sin
   * dirección se quedan con la frase general.
   */
  const placeIntro = booking.serviceAddress
    ? h`Hola ${booking.customerName}, tu cita quedó confirmada. Nos desplazamos hasta ${booking.serviceAddress}.`
    : h`Hola ${booking.customerName}, tu cita quedó confirmada. Nos desplazamos hasta donde estés.`;
  const html = layout({
    brand: settings.brandName,
    title: '¡Tu cita está confirmada!',
    intro: placeIntro,
    bodyHtml: `
      ${detailsTable(bookingRows(booking, settings))}
      <p style="margin:0;color:${PALETTE.muted};">${escapeHtml(PREPARATION_NOTE)}</p>
      <p style="margin:12px 0 0;color:${PALETTE.muted};">${escapeHtml(ADDRESS_CHANGE_NOTE)}</p>
    `,
    footerNote: h`¿Necesitas reprogramar? Escríbenos al ${settings.whatsappNumber || settings.contactPhone}.`,
  });

  const text = [
    `Hola ${booking.customerName}, tu cita quedó confirmada.`,
    '',
    ...bookingRows(booking, settings)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`),
    '',
    PREPARATION_NOTE,
    ADDRESS_CHANGE_NOTE,
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
        ...bookingRows(booking, settings),
      ])}
      <p style="margin:0;color:${PALETTE.muted};">Si esta fecha no te sirve, respóndenos y buscamos otra.</p>
    `,
    footerNote: h`${settings.brandName} · ${settings.contactPhone}`,
  });

  const text = [
    `Hola ${booking.customerName}, reprogramamos tu cita.`,
    `Antes: ${formatLongDate(previousStart, tz)} ${formatTime(previousStart, tz)}`,
    `Ahora: ${formatLongDate(booking.startAt, tz)} ${formatTime(booking.startAt, tz)}`,
    ...(booking.serviceAddress ? [`Dirección: ${booking.serviceAddress}`] : []),
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
