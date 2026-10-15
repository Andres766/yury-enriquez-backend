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

/**
 * Como `cleanText`, pero deja el texto en UNA sola línea.
 *
 * Pensado para la dirección del servicio: viaja a la fila de una tabla
 * de correo, al mensaje de WhatsApp y a la búsqueda de Google Maps, y en
 * ninguno de esos sitios un salto de línea sirve de algo. Si la clienta
 * escribió "Calle 18 # 25-30" y debajo "Barrio Centro", queda
 * "Calle 18 # 25-30, Barrio Centro". No se recorta: la longitud la
 * valida el esquema, que así puede rechazar en vez de cortar a ciegas.
 */
export function cleanLine(value, { maxLength = 2000 } = {}) {
  return cleanText(value, { maxLength })
    // Un bloque de saltos cuenta como UNO aunque entre ellos haya espacios
    // ("Calle 1\n \nBarrio"): si no, quedaría "Calle 1, , Barrio".
    .replace(/[ \t]*,?(?:[ \t]*\n)+[ \t]*/g, ', ')
    .replace(/ {2,}/g, ' ');
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

/**
 * Como `cleanPhone`, pero además deja los celulares colombianos en forma
 * canónica `+57XXXXXXXXXX`.
 *
 * En Colombia casi todo el mundo escribe su celular de 10 dígitos sin
 * indicativo ("300 123 4567"). Guardado así, el enlace wa.me con el que
 * la maquilladora confirma la cita lo lee como un número de Grecia (+30)
 * y no abre. Un número de 10 dígitos que empieza por 3 solo puede ser un
 * móvil colombiano, así que se le pone el +57. También se aceptan
 * "57300…" sin el más y "0057300…". Cualquier otra cosa (un número de
 * Ecuador con +593, un fijo) se deja tal cual: no se inventa nada.
 */
export function cleanCoPhone(value) {
  const clean = cleanPhone(value);
  let digits = clean.replace(/\D/g, '');
  if (!clean.startsWith('+') && digits.startsWith('00')) digits = digits.slice(2);

  if (digits.length === 10 && digits.startsWith('3')) return `+57${digits}`;
  if (digits.length === 12 && digits.startsWith('573')) return `+${digits}`;
  return clean.startsWith('00') ? `+${digits}` : clean;
}

/**
 * Etiqueta corta de origen ("instagram", "instagram/catrinas2026").
 *
 * Llega de parámetros de la URL que cualquiera puede escribir, así que
 * se reduce a minúsculas, letras, números y . _ - / y se recorta. Si no
 * queda nada útil se devuelve cadena vacía: un origen raro nunca debe
 * hacer fallar una reserva.
 */
export function cleanSource(value, { maxLength = 60 } = {}) {
  return cleanText(value, { maxLength: 200 })
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._\-/]/g, '')
    .slice(0, maxLength)
    .replace(/^[-/.]+|[-/.]+$/g, '');
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
