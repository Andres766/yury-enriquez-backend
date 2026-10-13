import { PrismaClient } from '@prisma/client';
import env from '../config/env.js';

/**
 * Cliente Prisma único para todo el proceso.
 *
 * Todo el acceso a datos pasa por aquí: Prisma genera siempre consultas
 * parametrizadas, así que no hay concatenación de strings en SQL y la
 * inyección queda descartada por construcción. Las dos consultas crudas
 * del proyecto (bloqueo consultivo en reservas) usan `$queryRaw` con
 * plantillas etiquetadas, que también parametrizan.
 */
export const prisma = new PrismaClient({
  log: env.isDev ? ['warn', 'error'] : ['error'],
});

export async function disconnectPrisma() {
  await prisma.$disconnect();
}

export default prisma;
