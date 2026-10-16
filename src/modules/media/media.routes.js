import { Router } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { asyncHandler } from '../../lib/errors.js';
import { mediaConfig, signUpload, MAX_UPLOAD_BYTES } from './cloudinary.js';

/**
 * Subida de fotos a Cloudinary (solo administradora).
 *
 * El panel pide aquí una firma de un solo uso práctico (Cloudinary la
 * acepta durante una hora) y con ella sube la foto directamente desde el
 * navegador. Ninguna de las dos rutas devuelve el secreto.
 */

const router = Router();

/** GET /api/media/config — ¿se pueden subir fotos? Para que el panel avise si no. */
router.get(
  '/config',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const { enabled, cloudName, folder } = mediaConfig();
    res.json({ enabled, cloudName: enabled ? cloudName : null, folder, maxBytes: MAX_UPLOAD_BYTES });
  }),
);

/**
 * POST /api/media/sign — firma para UNA subida. Va por POST y con CSRF
 * aunque no cambie nada en la base: una firma permite escribir en la
 * cuenta de Cloudinary, así que no debe poder pedirla otro sitio.
 */
router.post(
  '/sign',
  requireAdmin,
  requireCsrf,
  asyncHandler(async (_req, res) => {
    res.json(signUpload());
  }),
);

export default router;
