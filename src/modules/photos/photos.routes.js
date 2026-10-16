import { Router } from 'express';
import { z } from 'zod';
import prisma from '../../lib/prisma.js';
import { validate } from '../../middleware/validate.js';
import { requireAdmin } from '../../middleware/auth.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { asyncHandler, badRequest, notFound } from '../../lib/errors.js';
import { requireMediaConfig, assetFolderOf, verifyUploadResponse, destroyImage } from '../media/cloudinary.js';
import { createPhotoSchema, updatePhotoSchema, orderSchema, cuid } from './photos.schema.js';
import {
  publicPhotoSelect,
  PHOTO_ORDER,
  usageByUrl,
  listAdminPhotos,
  deletePhotoEverywhere,
} from './photos.service.js';

/**
 * Biblioteca de fotos: la galería «Mi trabajo» y el banco del que Yury
 * escoge las fotos de servicios, ocasiones e inicio.
 *
 * Las fotos nuevas suben directo a Cloudinary desde el navegador; aquí
 * solo llega la respuesta de Cloudinary, que se comprueba (firma, nube y
 * carpeta) antes de guardarla. Las 22 fotos que venían con la web viven
 * en /img/trabajos/ y entran a la biblioteca con publicId = null.
 */

const router = Router();

const NOT_VERIFIED = 'No pudimos comprobar que la foto se haya subido bien. Vuelve a intentarlo.';

/** Si Cloudinary no está configurado, ni se valida el cuerpo: 503 directo. */
function mediaEnabled(_req, _res, next) {
  try {
    requireMediaConfig();
    return next();
  } catch (error) {
    return next(error);
  }
}

// ── Público ──────────────────────────────────────────────────────────

/** GET /api/photos — galería visible, en el orden que eligió Yury. */
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const photos = await prisma.photo.findMany({
      where: { inGallery: true },
      orderBy: PHOTO_ORDER,
      select: publicPhotoSelect,
      take: 500,
    });
    res.json({ photos });
  }),
);

// ── Administración ───────────────────────────────────────────────────

router.get(
  '/admin',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ photos: await listAdminPhotos() });
  }),
);

/**
 * POST /api/photos/admin — registra en la biblioteca una foto que el
 * navegador acaba de subir a Cloudinary.
 *
 * Tres comprobaciones, porque el cuerpo lo arma el navegador y no hay
 * que creerle:
 *  1) la firma de la respuesta solo la puede calcular quien tiene el
 *     secreto, o sea Cloudinary: prueba que la subida existió;
 *  2) la URL es de NUESTRA nube y es la de ese public_id: no se puede
 *     pegar la URL de otro sitio con una firma válida de otra foto;
 *  3) el public_id está en nuestra carpeta.
 */
router.post(
  '/admin',
  requireAdmin,
  requireCsrf,
  mediaEnabled,
  validate({ body: createPhotoSchema }),
  asyncHandler(async (req, res) => {
    const config = requireMediaConfig();
    const { public_id: publicId, version, signature, secure_url: url, width, height, bytes, format: _format, ...meta } =
      req.valid.body;

    if (!verifyUploadResponse({ public_id: publicId, version, signature }, config)) {
      throw badRequest(NOT_VERIFIED, { code: 'UPLOAD_SIGNATURE_INVALID' });
    }

    // Cloudinary arma secure_url siempre como …/upload/v<version>/<public_id>.<formato>.
    // Se exige EXACTAMENTE esa forma (no solo "contiene el public_id"):
    // con "…/upload/../../otra-nube/…" el navegador resolvería los ".." y
    // la foto saldría de otra cuenta, y así también queda atada a la
    // versión firmada.
    const prefix = `https://res.cloudinary.com/${config.cloudName}/image/upload/`;
    const rest = url.startsWith(prefix) ? url.slice(prefix.length) : null;
    const expectedPath = `v${version}/${publicId}`;
    const extension = rest?.startsWith(expectedPath) ? rest.slice(expectedPath.length) : null;
    if (extension === null || !/^(?:\.[a-z0-9]{1,10})?$/i.test(extension)) {
      throw badRequest(NOT_VERIFIED, { code: 'UPLOAD_URL_INVALID' });
    }
    // Cuentas con carpetas fijas: el public_id ya trae «carpeta/».
    // Cuentas nuevas (carpetas dinámicas): no lo trae, así que se le
    // pregunta a Cloudinary en qué carpeta quedó. Sin respuesta, se rechaza.
    if (!publicId.startsWith(`${config.folder}/`)) {
      const folder = await assetFolderOf(publicId, config);
      if (folder !== config.folder) {
        throw badRequest(NOT_VERIFIED, { code: 'UPLOAD_FOLDER_INVALID' });
      }
    }

    // Reintento de la misma subida (se cortó la conexión justo después de
    // guardar): se devuelve la que ya está en vez de fallar o duplicarla.
    const existing = await prisma.photo.findUnique({ where: { publicId } });
    if (existing) return res.json({ photo: existing });

    // Una foto nueva va al final: el orden que Yury ya armó no se mueve.
    const last = await prisma.photo.aggregate({ _max: { sortOrder: true } });
    const photo = await prisma.photo.create({
      data: {
        ...meta,
        publicId,
        url,
        width: width ?? null,
        height: height ?? null,
        bytes: bytes ?? null,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
    return res.status(201).json({ photo });
  }),
);

/*
 * PUT /admin/order — ids en el orden deseado; se reescribe sortOrder en
 * una transacción. Antes de /admin/:id por claridad (otro método, pero
 * así se lee en orden).
 */
router.put(
  '/admin/order',
  requireAdmin,
  requireCsrf,
  validate({ body: orderSchema }),
  asyncHandler(async (req, res) => {
    const { ids } = req.valid.body;
    if (new Set(ids).size !== ids.length) throw badRequest('La lista de orden tiene fotos repetidas');

    const total = await prisma.photo.count({ where: { id: { in: ids } } });
    if (total !== ids.length) throw badRequest('Alguna foto de la lista ya no existe. Recarga la página.');

    await prisma.$transaction(
      ids.map((id, index) => prisma.photo.update({ where: { id }, data: { sortOrder: index } })),
    );
    res.json({ ok: true });
  }),
);

router.patch(
  '/admin/:id',
  requireAdmin,
  requireCsrf,
  validate({ params: z.object({ id: cuid }), body: updatePhotoSchema }),
  asyncHandler(async (req, res) => {
    const photo = await prisma.photo.update({ where: { id: req.valid.params.id }, data: req.valid.body });
    res.json({ photo });
  }),
);

/**
 * DELETE /admin/:id — si la foto sale en algún servicio, ocasión o en el
 * inicio, primero se responde 409 con la lista de usos para que el panel
 * le pregunte a Yury. Con ?force=1 se quita de todos esos sitios y se
 * borra. El archivo de Cloudinary se borra al final y aparte: si eso
 * falla, la foto igual sale de la web y se avisa con cloudinaryDeleted.
 */
router.delete(
  '/admin/:id',
  requireAdmin,
  requireCsrf,
  validate({ params: z.object({ id: cuid }), query: z.object({ force: z.string().max(5).optional() }) }),
  asyncHandler(async (req, res) => {
    const photo = await prisma.photo.findUnique({ where: { id: req.valid.params.id } });
    if (!photo) throw notFound('Esa foto ya no existe. Recarga la página.');

    const usedBy = (await usageByUrl([photo.url])).get(photo.url) ?? [];
    if (usedBy.length && req.valid.query.force !== '1') {
      // Respuesta directa (no AppError): el panel necesita `usedBy` para
      // decirle a Yury dónde sale la foto antes de que confirme.
      return res.status(409).json({
        error: 'Esta foto se está usando en la web. Si la borras, se quita también de esos lugares.',
        code: 'PHOTO_IN_USE',
        usedBy,
      });
    }

    await deletePhotoEverywhere(photo);

    // null = no aplica (foto de la propia web, sin archivo en Cloudinary).
    let cloudinaryDeleted = null;
    if (photo.publicId) {
      cloudinaryDeleted = await destroyImage(photo.publicId);
      if (!cloudinaryDeleted) {
        console.warn('[fotos] La foto %s salió de la web, pero su archivo sigue en Cloudinary (%s).', photo.id, photo.publicId);
      }
    }
    return res.json({ ok: true, cloudinaryDeleted });
  }),
);

export default router;
