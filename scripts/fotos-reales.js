/**
 * Pone las fotos reales de Yury en los servicios y ocasiones de una base
 * que ya existe (producción), sin tocar precios, textos ni reservas.
 *
 * Uso (desde backend/, con la DATABASE_URL de la base que quieras cambiar):
 *
 *   node scripts/fotos-reales.js                 → solo muestra lo que haría
 *   node scripts/fotos-reales.js --apply         → lo aplica
 *   node scripts/fotos-reales.js --apply --sin-menores
 *        → igual, pero sin fotos de quinceañeras ni de niñas/niños
 *          (mientras no esté la autorización escrita de sus acudientes)
 *
 * IMPORTANTE: las rutas apuntan a /img/trabajos/… del frontend. Ejecútalo
 * DESPUÉS de publicar el frontend que trae esas fotos; si no, la web
 * mostraría imágenes rotas hasta que Vercel termine de desplegar.
 *
 * Es idempotente: se puede correr varias veces y deja siempre lo mismo.
 */
import prisma from '../src/lib/prisma.js';
import { servicePhotos, occasionPhoto, SERVICE_SLUGS, OCCASION_SLUGS } from '../prisma/fotos-reales.js';

const apply = process.argv.includes('--apply');
const sinMenores = process.argv.includes('--sin-menores');

console.log(
  `\n${apply ? 'APLICANDO' : 'SIMULACIÓN (nada se escribe; añade --apply para aplicar)'}` +
    `${sinMenores ? ' · sin fotos de menores' : ''}\n`,
);

let servicesChanged = 0;
let occasionsChanged = 0;

for (const slug of SERVICE_SLUGS) {
  const service = await prisma.service.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!service) {
    console.log(`  · servicio "${slug}" no existe en esta base: se omite`);
    continue;
  }

  const photos = servicePhotos(slug, { sinMenores });
  console.log(`  ✔ ${service.name}: ${photos.map((p) => p.url.split('/').pop()).join(', ')}`);

  if (apply) {
    await prisma.$transaction([
      prisma.serviceImage.deleteMany({ where: { serviceId: service.id } }),
      prisma.serviceImage.createMany({ data: photos.map((p) => ({ ...p, serviceId: service.id })) }),
    ]);
  }
  servicesChanged += 1;
}

for (const slug of OCCASION_SLUGS) {
  const occasion = await prisma.occasion.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!occasion) {
    console.log(`  · ocasión "${slug}" no existe en esta base: se omite`);
    continue;
  }

  const heroImage = occasionPhoto(slug, { sinMenores });
  console.log(`  ✔ Ocasión ${occasion.name}: ${heroImage.split('/').pop()}`);

  if (apply) await prisma.occasion.update({ where: { id: occasion.id }, data: { heroImage } });
  occasionsChanged += 1;
}

console.log(
  `\n${apply ? 'Listo' : 'Se cambiarían'}: ${servicesChanged} servicios y ${occasionsChanged} ocasiones.\n`,
);

await prisma.$disconnect();
