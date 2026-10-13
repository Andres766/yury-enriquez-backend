import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAdmin } from '../../middleware/auth.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { asyncHandler } from '../../lib/errors.js';
import {
  createServiceSchema,
  updateServiceSchema,
  listServicesQuerySchema,
  slugParamSchema,
  idParamSchema,
} from './services.schema.js';
import {
  listServices,
  getServiceBySlug,
  getServiceById,
  createService,
  updateService,
  deleteService,
} from './services.service.js';

const router = Router();

// ── Público ──────────────────────────────────────────────────────────

router.get(
  '/',
  validate({ query: listServicesQuerySchema }),
  asyncHandler(async (req, res) => {
    res.json({ services: await listServices(req.valid.query) });
  }),
);

// ── Administración (antes de /:slug para que no lo capture) ─────────

router.get(
  '/admin/all',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ services: await listServices({ includeInactive: true }) });
  }),
);

router.post(
  '/admin',
  requireAdmin,
  requireCsrf,
  validate({ body: createServiceSchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ service: await createService(req.valid.body) });
  }),
);

router.get(
  '/admin/:id',
  requireAdmin,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    res.json({ service: await getServiceById(req.valid.params.id) });
  }),
);

router.patch(
  '/admin/:id',
  requireAdmin,
  requireCsrf,
  validate({ params: idParamSchema, body: updateServiceSchema }),
  asyncHandler(async (req, res) => {
    res.json({ service: await updateService(req.valid.params.id, req.valid.body) });
  }),
);

router.delete(
  '/admin/:id',
  requireAdmin,
  requireCsrf,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    await deleteService(req.valid.params.id);
    res.json({ ok: true });
  }),
);

router.get(
  '/:slug',
  validate({ params: slugParamSchema }),
  asyncHandler(async (req, res) => {
    res.json({ service: await getServiceBySlug(req.valid.params.slug) });
  }),
);

export default router;
