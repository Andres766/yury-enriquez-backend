/**
 * Saneamiento de entrada y escape de salida.
 *
 * Estrategia en dos capas:
 *  1) ENTRADA — `cleanText` normaliza y recorta lo que llega del cliente
 *     (quita caracteres de control, colapsa espacios, limita longitud).
 *     Guardamos el texto TAL CUAL lo escribió la persona; no intentamos
 *     "limpiar HTML" en la base, porque eso corrompe datos legítimos
 *     ("Peinado & recogido", "5 < 10").
 *  2) SALIDA — `escapeHtml` se aplica en el único sitio donde
 *     construimos HTML a mano: las plantillas de correo. React escapa
 *     por defecto en el frontend, así que el XSS queda cubierto en
 *     ambos destinos.
 */

// Caracteres de control C0/C1 salvo tabulador, salto de línea y retorno.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Normaliza texto libre procedente del cliente. */
export function cleanText(value, { maxLength = 2000 } = {}) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(CONTROL_CHARS, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

/** Normaliza un correo: minúsculas y sin espacios. */
export function cleanEmail(value) {
  return cleanText(value, { maxLength: 254 }).toLowerCase().replace(/\s/g, '');
}

/** Deja solo dígitos y un `+` inicial opcional (formato WhatsApp). */
export function cleanPhone(value) {
  const raw = cleanText(value, { maxLength: 32 });
  const plus = raw.startsWith('+') ? '+' : '';
  return plus + raw.replace(/\D/g, '');
}

const HTML_ENTITIES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapa texto que se va a interpolar dentro de HTML (correos). */
export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch]);
}

/**
 * Tag template que escapa TODO lo interpolado.
 * Uso: `h\`<p>Hola ${nombre}</p>\`` deja `nombre` escapado sin pensarlo.
 * Para anidar HTML ya generado por nosotros, usa `safe()`.
 */
export function h(strings, ...values) {
  return strings.reduce((out, str, i) => {
    if (i >= values.length) return out + str;
    const v = values[i];
    const rendered = v instanceof SafeHtml ? v.value : escapeHtml(v);
    return out + str + rendered;
  }, '');
}

class SafeHtml {
  constructor(value) {
    this.value = String(value);
  }
  toString() {
    return this.value;
  }
}

/**
 * Marca un fragmento como HTML de confianza (lo generamos nosotros con
 * `h`, nunca proviene directamente del usuario).
 */
export function safe(value) {
  return new SafeHtml(value);
}

/** Convierte saltos de línea de texto de usuario en <br> ya escapados. */
export function nl2brSafe(value) {
  return safe(escapeHtml(value).replace(/\n/g, '<br>'));
}
