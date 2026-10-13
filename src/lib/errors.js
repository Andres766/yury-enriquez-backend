/**
 * Errores de dominio con código HTTP.
 *
 * Nunca se devuelve al cliente el mensaje de un error inesperado: el
 * manejador global (middleware/error.js) solo expone el texto de los
 * AppError, que son los que escribimos nosotros a propósito.
 */
export class AppError extends Error {
  constructor(status, message, { code = undefined, details = undefined } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest = (msg, opts) => new AppError(400, msg, opts);
export const unauthorized = (msg = 'No autenticado', opts) => new AppError(401, msg, opts);
export const forbidden = (msg = 'No autorizado', opts) => new AppError(403, msg, opts);
export const notFound = (msg = 'Recurso no encontrado', opts) => new AppError(404, msg, opts);
export const conflict = (msg, opts) => new AppError(409, msg, opts);
export const tooMany = (msg = 'Demasiadas peticiones', opts) => new AppError(429, msg, opts);

/** Envuelve handlers async para que los rechazos lleguen al error handler. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
