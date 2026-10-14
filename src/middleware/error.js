import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors.js';
import env from '../config/env.js';

/** 404 para rutas no montadas. */
export function notFoundHandler(req, res) {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.path}` });
}

/**
 * Manejador global de errores.
 *
 * Solo se devuelve al cliente el texto de los AppError, que son los que
 * escribimos a propósito. Cualquier otro error se registra completo en
 * el servidor y al cliente le llega un mensaje genérico: así no se
 * filtran rutas de ficheros, nombres de tablas ni trazas de pila.
 */
export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Ya existe un registro con esos datos.' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'El registro no existe.' });
    }
    if (err.code === 'P2003') {
      return res.status(409).json({ error: 'No se puede completar: hay datos relacionados.' });
    }
    // La base no pudo atender la transacción a tiempo (mucha demanda a
    // la vez): es temporal, así que se pide reintentar en vez de un 500.
    if (err.code === 'P2028') {
      return res.status(503).json({
        error: 'Hay muchas reservas en este momento. Inténtalo de nuevo en unos segundos.',
        code: 'BUSY',
      });
    }
  }

  // La restricción de exclusión de Postgres contra el solapamiento de
  // reservas llega aquí si dos peticiones simultáneas la alcanzan.
  if (err?.meta?.code === '23P01' || /booking_no_overlap/.test(err?.message ?? '')) {
    return res.status(409).json({
      error: 'Ese horario acaba de ocuparse. Elige otro, por favor.',
      code: 'SLOT_TAKEN',
    });
  }

  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'El contenido enviado es demasiado grande.' });
  }

  if (err?.message === 'CORS_BLOCKED') {
    return res.status(403).json({ error: 'Origen no permitido.' });
  }

  console.error('[error]', req.method, req.originalUrl, '\n', err);

  return res.status(500).json({
    error: 'Ocurrió un error inesperado. Inténtalo de nuevo en un momento.',
    ...(env.isDev ? { debug: err?.message } : {}),
  });
}
