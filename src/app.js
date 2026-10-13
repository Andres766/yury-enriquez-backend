import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import morgan from 'morgan';

import env from './config/env.js';
import { issueCsrfToken } from './middleware/csrf.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';

import authRoutes from './modules/auth/auth.routes.js';
import servicesRoutes from './modules/services/services.routes.js';
import occasionsRoutes from './modules/occasions/occasions.routes.js';
import availabilityRoutes from './modules/availability/availability.routes.js';
import bookingsRoutes from './modules/bookings/bookings.routes.js';
import loyaltyRoutes from './modules/loyalty/loyalty.routes.js';
import promotionsRoutes from './modules/promotions/promotions.routes.js';
import settingsRoutes from './modules/settings/settings.routes.js';

export function createApp() {
  const app = express();

  /*
   * `trust proxy` se configura explícitamente y con un número de saltos.
   * Ponerlo en `true` a ciegas permitiría a cualquiera falsificar la
   * cabecera X-Forwarded-For y esquivar el rate limiting.
   */
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  /*
   * Cabeceras de seguridad. La API solo devuelve JSON, así que la CSP
   * puede ser máximamente restrictiva: nada de scripts, nada de marcos.
   * El frontend se sirve aparte y lleva la suya.
   */
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: env.isProd ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    }),
  );

  /*
   * CORS con lista blanca explícita. Sin comodín: `credentials: true`
   * más `origin: '*'` es una combinación que el navegador rechaza, y
   * con razón. Las peticiones sin cabecera Origin (curl, health checks
   * del hosting) se permiten porque no llevan cookies de terceros.
   */
  const allowed = new Set(env.CORS_ORIGINS);
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowed.has(origin)) return callback(null, true);
        return callback(new Error('CORS_BLOCKED'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
      maxAge: 86_400,
    }),
  );

  // Límite de tamaño: un cuerpo enorme es un vector de denegación de servicio.
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));
  app.use(cookieParser());
  app.use(compression());

  if (!env.isProd) app.use(morgan('dev'));

  app.use(globalLimiter);
  app.use(issueCsrfToken);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'estudio-belleza-api', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/services', servicesRoutes);
  app.use('/api/occasions', occasionsRoutes);
  app.use('/api/availability', availabilityRoutes);
  app.use('/api/bookings', bookingsRoutes);
  app.use('/api/loyalty', loyaltyRoutes);
  app.use('/api/promotions', promotionsRoutes);
  app.use('/api/settings', settingsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
