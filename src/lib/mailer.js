import nodemailer from 'nodemailer';
import env from '../config/env.js';

/**
 * Envío de correo.
 *
 * Con MAIL_DRIVER=console (valor por defecto en desarrollo) los correos
 * se imprimen por consola: el flujo completo de reservas se puede probar
 * sin credenciales SMTP y sin riesgo de enviar correos reales durante
 * las pruebas. Con MAIL_DRIVER=smtp se usa el transporte real; con
 * MAIL_DRIVER=resend se envía por la API HTTP de Resend, para hostings
 * que bloquean el SMTP saliente (Render Free). Las credenciales viven
 * solo en variables de entorno.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

async function sendWithResend({ to, subject, html, text, replyTo }) {
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
      reply_to: replyTo || undefined,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${body.message ?? res.statusText}`);
  return { messageId: body.id };
}

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (env.MAIL_DRIVER === 'smtp') {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  } else {
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }

  return transporter;
}

/**
 * Envía un correo. Nunca lanza hacia arriba: si el SMTP falla, la
 * reserva ya está guardada y no queremos perderla por un problema de
 * correo. El fallo se registra para poder reenviar desde el panel.
 */
export async function sendMail({ to, subject, html, text, replyTo }) {
  if (!to) return { ok: false, error: 'destinatario vacío' };

  try {
    const info =
      env.MAIL_DRIVER === 'resend'
        ? await sendWithResend({ to, subject, html, text, replyTo })
        : await getTransporter().sendMail({
            from: env.MAIL_FROM,
            to,
            subject,
            html,
            text,
            replyTo,
          });

    if (env.MAIL_DRIVER === 'console') {
      console.log('\n──────── CORREO (modo consola) ────────');
      console.log(`Para:    ${to}`);
      console.log(`Asunto:  ${subject}`);
      console.log(`${text ?? ''}`);
      console.log('───────────────────────────────────────\n');
    }

    return { ok: true, id: info.messageId };
  } catch (error) {
    console.error('[mailer] Fallo al enviar correo:', error.message);
    return { ok: false, error: error.message };
  }
}

/** Lanza los envíos sin bloquear la respuesta HTTP. */
export function sendMailAsync(payload) {
  sendMail(payload).catch((e) => console.error('[mailer] error no controlado:', e));
}

export async function verifyMailer() {
  if (env.MAIL_DRIVER !== 'smtp') return true;
  try {
    await getTransporter().verify();
    return true;
  } catch (error) {
    console.warn('[mailer] SMTP no disponible:', error.message);
    return false;
  }
}
