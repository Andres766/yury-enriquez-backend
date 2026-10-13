import { Router } from 'express';
import env from '../../config/env.js';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireCsrf } from '../../middleware/csrf.js';
import { loginLimiter, registerLimiter, refreshLimiter } from '../../middleware/rateLimit.js';
import { asyncHandler, badRequest } from '../../lib/errors.js';
import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
} from './auth.schema.js';
import {
  register,
  login,
  issueSession,
  refreshSession,
  logout,
  getProfile,
  updateProfile,
  changePassword,
} from './auth.service.js';

const router = Router();

const REFRESH_COOKIE = 'refreshToken';

/**
 * La cookie de refresco es httpOnly (JavaScript no la ve, así que un XSS
 * no puede robarla), `secure` fuera de desarrollo, y está limitada a la
 * ruta /api/auth: no se envía en ninguna otra petición.
 */
function refreshCookieOptions(expiresAt) {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.COOKIE_SAMESITE,
    domain: env.COOKIE_DOMAIN || undefined,
    path: '/api/auth',
    expires: expiresAt,
  };
}

function setSessionCookies(res, { refreshToken, refreshExpiresAt }) {
  res.cookie(REFRESH_COOKIE, refreshToken, refreshCookieOptions(refreshExpiresAt));
}

function clearSessionCookies(res) {
  res.clearCookie(REFRESH_COOKIE, { ...refreshCookieOptions(new Date(0)), expires: undefined });
}

router.post(
  '/register',
  registerLimiter,
  requireCsrf,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const { website, ...data } = req.valid.body;
    if (website) throw badRequest('Solicitud rechazada');

    const user = await register(data);
    const session = await issueSession(user, {
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });

    setSessionCookies(res, session);
    res.status(201).json({ user, accessToken: session.accessToken });
  }),
);

router.post(
  '/login',
  loginLimiter,
  requireCsrf,
  validate({ body: loginSchema }),
  asyncHandler(async (req, res) => {
    const user = await login(req.valid.body);
    const session = await issueSession(user, {
      userAgent: req.get('user-agent'),
      ip: req.ip,
    });

    setSessionCookies(res, session);
    res.json({ user, accessToken: session.accessToken });
  }),
);

/**
 * POST /api/auth/refresh — canjea la cookie httpOnly por un access token
 * nuevo y rota el refresh token. El frontend lo llama al cargar la
 * página y justo antes de que caduque el token en memoria.
 */
router.post(
  '/refresh',
  refreshLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    try {
      const session = await refreshSession(req.cookies?.[REFRESH_COOKIE], {
        userAgent: req.get('user-agent'),
        ip: req.ip,
      });
      setSessionCookies(res, session);
      res.json({ user: session.user, accessToken: session.accessToken });
    } catch (error) {
      clearSessionCookies(res);
      throw error;
    }
  }),
);

router.post(
  '/logout',
  requireCsrf,
  asyncHandler(async (req, res) => {
    await logout(req.cookies?.[REFRESH_COOKIE]);
    clearSessionCookies(res);
    res.json({ ok: true });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: await getProfile(req.user.id) });
  }),
);

router.patch(
  '/me',
  requireAuth,
  requireCsrf,
  validate({ body: updateProfileSchema }),
  asyncHandler(async (req, res) => {
    res.json({ user: await updateProfile(req.user.id, req.valid.body) });
  }),
);

router.post(
  '/change-password',
  requireAuth,
  requireCsrf,
  loginLimiter,
  validate({ body: changePasswordSchema }),
  asyncHandler(async (req, res) => {
    await changePassword(req.user.id, req.valid.body);
    clearSessionCookies(res);
    res.json({ ok: true, message: 'Contraseña actualizada. Vuelve a iniciar sesión.' });
  }),
);

export default router;
