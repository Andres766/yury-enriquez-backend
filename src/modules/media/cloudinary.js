import crypto from 'node:crypto';
import env from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

/**
 * Cloudinary: firmas y borrado.
 *
 * Las fotos viajan DIRECTO del celular de Yury a Cloudinary; este
 * servidor nunca recibe los bytes. Lo único que hace es:
 *  1) firmar cada subida (sin firma, Cloudinary no acepta nada en
 *     nuestra cuenta, así que nadie más puede llenarla de fotos), y
 *  2) comprobar la firma de la RESPUESTA de Cloudinary antes de guardar
 *     la foto en la biblioteca: así nadie puede colar en la web una URL
 *     cualquiera haciéndola pasar por una subida.
 *
 * El secreto (CLOUDINARY_API_SECRET) solo se usa aquí dentro y jamás se
 * devuelve en una respuesta.
 *
 * La configuración se lee de `env` en cada llamada (no al cargar el
 * módulo) para que la prueba e2e pueda apagar la subida sin reiniciar.
 */

/** Tope que el panel muestra y comprueba antes de subir (plan gratuito: 10 MB por imagen). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export function mediaConfig() {
  const cloudName = env.CLOUDINARY_CLOUD_NAME;
  const apiKey = env.CLOUDINARY_API_KEY;
  const apiSecret = env.CLOUDINARY_API_SECRET;
  const folder = env.CLOUDINARY_FOLDER || 'yury-enriquez';
  return {
    enabled: Boolean(cloudName && apiKey && apiSecret),
    cloudName: cloudName ?? null,
    apiKey: apiKey ?? null,
    apiSecret: apiSecret ?? null,
    folder,
  };
}

/** Config o 503 si falta alguna credencial. */
export function requireMediaConfig() {
  const config = mediaConfig();
  if (!config.enabled) {
    throw new AppError(
      503,
      'La subida de fotos todavía no está configurada. Pídele a quien administra la web que la active.',
      { code: 'MEDIA_DISABLED' },
    );
  }
  return config;
}

/**
 * Algoritmo de firma de Cloudinary: parámetros ordenados
 * alfabéticamente, unidos con "&" como `clave=valor`, el secreto pegado
 * al final y SHA-1 en hexadecimal. Los vacíos no se firman.
 */
export function signParams(params, secret) {
  const toSign = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return crypto.createHash('sha1').update(toSign + secret).digest('hex');
}

/**
 * Compara dos firmas en tiempo constante. timingSafeEqual exige
 * buffers del mismo largo, así que un largo distinto se resuelve antes
 * (eso no filtra nada: el largo de una firma SHA-1 es público).
 */
export function sameSignature(expected, received) {
  if (typeof received !== 'string') return false;
  const a = Buffer.from(String(expected).toLowerCase(), 'utf8');
  const b = Buffer.from(received.toLowerCase(), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Firma una subida: solo `folder` y `timestamp` quedan firmados. */
export function signUpload(config = requireMediaConfig()) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signParams({ folder: config.folder, timestamp }, config.apiSecret);
  return { cloudName: config.cloudName, apiKey: config.apiKey, timestamp, folder: config.folder, signature };
}

/** ¿La respuesta de subida viene de verdad de Cloudinary (y de nuestra cuenta)? */
export function verifyUploadResponse({ public_id: publicId, version, signature }, config = requireMediaConfig()) {
  const expected = signParams({ public_id: publicId, version }, config.apiSecret);
  return sameSignature(expected, signature);
}

/**
 * Borra una imagen de Cloudinary. Nunca lanza: si Cloudinary falla o no
 * responde, se registra y se devuelve false. La foto ya salió de la web
 * (la base manda), así que un fallo aquí solo deja un archivo huérfano
 * en Cloudinary, que se puede borrar a mano desde su panel.
 */
/**
 * Carpeta en la que Cloudinary guardó una foto, preguntándole con la
 * clave secreta (Admin API). Hace falta en las cuentas nuevas, que usan
 * «carpetas dinámicas»: ahí el parámetro firmado `folder` deja la foto en
 * la carpeta pero NO antepone «carpeta/» al public_id, así que mirar el
 * public_id no basta para saber de dónde viene. Devuelve null si
 * Cloudinary no responde: en la duda, la subida se rechaza.
 */
export async function assetFolderOf(publicId, config = requireMediaConfig()) {
  const path = publicId.split('/').map(encodeURIComponent).join('/');
  const auth = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64');
  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/resources/image/upload/${path}`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.asset_folder ?? data?.folder ?? null;
  } catch (error) {
    console.error('[cloudinary] No se pudo consultar la carpeta de %s: %s', publicId, error?.message ?? error);
    return null;
  }
}

export async function destroyImage(publicId) {
  const config = mediaConfig();
  if (!config.enabled) {
    console.warn('[cloudinary] No se borró %s: la subida de fotos no está configurada.', publicId);
    return false;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const body = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    api_key: config.apiKey,
    signature: signParams({ public_id: publicId, timestamp }, config.apiSecret),
  });

  try {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/destroy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => null);
    // "not found" también vale: el archivo ya no está, que es lo que se quería.
    if (res.ok && (data?.result === 'ok' || data?.result === 'not found')) return true;
    console.error('[cloudinary] No se pudo borrar %s: HTTP %d %j', publicId, res.status, data);
    return false;
  } catch (error) {
    console.error('[cloudinary] No se pudo borrar %s: %s', publicId, error?.message ?? error);
    return false;
  }
}
