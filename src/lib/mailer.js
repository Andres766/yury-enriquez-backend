import nodemailer from 'nodemailer';
import env from '../config/env.js';

/**
 * Envío de correo.
 *
 * Con MAIL_DRIVER=console (valor por defecto en desarrollo) los correos
 * se imprimen por consola: el flujo completo de reservas se puede probar
 * sin credenciales SMTP y sin riesgo de enviar correos reales durante
 * las pruebas. Con MAIL_DRIVER=smtp se usa el transporte real; las
 * credenciales viven solo en variables de entorno.
 */

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
    const info = await getTransporter().sendMail({
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
