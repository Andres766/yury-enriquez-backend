import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { optionalAuth, requireAuth, requireAdmin } from '../../middleware/auth.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { bookingLimiter, lookupLimiter } from '../../middleware/rateLimit.js';
import { asyncHandler, badRequest } from '../../lib/errors.js';
import {
  createBookingSchema,
  lookupBookingSchema,
  adminListSchema,
  updateStatusSchema,
  rescheduleSchema,
  idParamSchema,
} from './bookings.schema.js';
import {
  createBooking,
  findBookingForGuest,
  listBookingsForUser,
  cancelOwnBooking,
  listBookingsAdmin,
  getBookingAdmin,
  updateBookingStatus,
  rescheduleBooking,
  getDashboardStats,
  toPublicBooking,
} from './bookings.service.js';

const router = Router();

/**
 * POST /api/bookings — crear reserva.
 *
 * `optionalAuth`: si hay sesión, la reserva se asocia a la cuenta; si
 * no, se guarda como invitada. Reservar NUNCA exige registro.
 */
router.post(
  '/',
  bookingLimiter,
  optionalAuth,
  validate({ body: createBookingSchema }),
  asyncHandler(async (req, res) => {
    const { website, ...input } = req.valid.body;
    if (website) throw badRequest('Solicitud rechazada');

    const booking = await createBooking(input, {
      userId: req.user?.id ?? null,
      ip: req.ip,
    });

    res.status(201).json({ booking: toPublicBooking(booking) });
  }),
);

/** POST /api/bookings/lookup — consulta de invitada (código + correo). */
router.post(
  '/lookup',
  lookupLimiter,
  validate({ body: lookupBookingSchema }),
  asyncHandler(async (req, res) => {
    const booking = await findBookingForGuest(req.valid.body);
    res.json({ booking: toPublicBooking(booking) });
  }),
);

/** GET /api/bookings/mine — historial de la clienta registrada. */
router.get(
  '/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const bookings = await listBookingsForUser(req.user.id);
    res.json({ bookings: bookings.map(toPublicBooking) });
  }),
);

/** POST /api/bookings/:id/cancel — la clienta cancela su propia cita. */
router.post(
  '/:id/cancel',
  requireAuth,
  requireCsrf,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const booking = await cancelOwnBooking({
      bookingId: req.valid.params.id,
      userId: req.user.id,
    });
    res.json({ booking: toPublicBooking(booking) });
  }),
);

// ── Rutas de administración ──────────────────────────────────────────

router.get(
  '/admin/stats',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(await getDashboardStats());
  }),
);

router.get(
  '/admin',
  requireAdmin,
  validate({ query: adminListSchema }),
  asyncHandler(async (req, res) => {
    res.json(await listBookingsAdmin(req.valid.query));
  }),
);

router.get(
  '/admin/:id',
  requireAdmin,
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    res.json({ booking: await getBookingAdmin(req.valid.params.id) });
  }),
);

router.patch(
  '/admin/:id/status',
  requireAdmin,
  requireCsrf,
  validate({ params: idParamSchema, body: updateStatusSchema }),
  asyncHandler(async (req, res) => {
    const booking = await updateBookingStatus({ id: req.valid.params.id, ...req.valid.body });
    res.json({ booking });
  }),
);

router.patch(
  '/admin/:id/reschedule',
  requireAdmin,
  requireCsrf,
  validate({ params: idParamSchema, body: rescheduleSchema }),
  asyncHandler(async (req, res) => {
    const booking = await rescheduleBooking({
      id: req.valid.params.id,
      startAt: req.valid.body.startAt,
    });
    res.json({ booking });
  }),
);

export default router;
