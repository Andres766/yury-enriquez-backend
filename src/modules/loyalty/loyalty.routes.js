import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { asyncHandler } from '../../lib/errors.js';
import { cleanText } from '../../lib/sanitize.js';
import {
  getCardForUser,
  grantStamp,
  revokeLastStamp,
  redeemReward,
  listCardsAdmin,
} from './loyalty.service.js';

const router = Router();
const cuid = z.string().min(20).max(40).regex(/^[a-z0-9]+$/i);

/** GET /api/loyalty/me — la tarjeta de la clienta con sesión iniciada. */
router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ card: await getCardForUser(req.user.id) });
  }),
);

// ── Administración: solo la maquilladora otorga sellos ──────────────

router.get(
  '/admin/cards',
  requireAdmin,
  validate({
    query: z.object({
      q: z
        .string()
        .transform((v) => cleanText(v, { maxLength: 80 }))
        .optional(),
      page: z.coerce.number().int().min(1).max(1000).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(25),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await listCardsAdmin(req.valid.query));
  }),
);

router.post(
  '/admin/stamps',
  requireAdmin,
  requireCsrf,
  validate({
    body: z.object({
      userId: cuid,
      bookingId: cuid.optional().nullable(),
      note: z
        .string()
        .transform((v) => cleanText(v, { maxLength: 200 }))
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await grantStamp({ ...req.valid.body, adminId: req.user.id });
    res.status(201).json({
      card: result.card,
      unlockedReward: result.unlocked,
    });
  }),
);

router.delete(
  '/admin/stamps/last',
  requireAdmin,
  requireCsrf,
  validate({ body: z.object({ userId: cuid }) }),
  asyncHandler(async (req, res) => {
    res.json({ card: await revokeLastStamp(req.valid.body) });
  }),
);

router.post(
  '/admin/rewards/:id/redeem',
  requireAdmin,
  requireCsrf,
  validate({ params: z.object({ id: cuid }) }),
  asyncHandler(async (req, res) => {
    res.json({ reward: await redeemReward({ rewardId: req.valid.params.id }) });
  }),
);

export default router;
