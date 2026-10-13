import { createApp } from './app.js';
import env from './config/env.js';
import prisma, { disconnectPrisma } from './lib/prisma.js';
import { verifyMailer } from './lib/mailer.js';

const app = createApp();

async function start() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('✔ Base de datos conectada');
  } catch (error) {
    console.error('✖ No se pudo conectar a la base de datos:', error.message);
    console.error('  Revisa DATABASE_URL en tu .env y que Postgres esté en marcha.');
    process.exit(1);
  }

  await verifyMailer();
  if (env.MAIL_DRIVER === 'console') {
    console.log('ℹ Correos en modo consola (MAIL_DRIVER=console): no se envía nada de verdad.');
  }

  const server = app.listen(env.PORT, () => {
    console.log(`\n  API lista en http://localhost:${env.PORT}`);
    console.log(`  Entorno:   ${env.NODE_ENV}`);
    console.log(`  CORS:      ${env.CORS_ORIGINS.join(', ') || '(sin restricción de origen)'}\n`);
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} recibido, cerrando…`);
    server.close(async () => {
      await disconnectPrisma();
      process.exit(0);
    });
    // Si algo se queda colgado, no esperamos indefinidamente.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
