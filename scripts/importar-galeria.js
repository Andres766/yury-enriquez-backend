/**
 * Pasa a la biblioteca de fotos (tabla Photo) las 22 fotos que venían
 * dentro del código de la web, para que Yury también pueda reordenarlas,
 * editarlas o quitarlas desde Panel → Fotos.
 *
 * Uso (desde backend/, con la DATABASE_URL de la base a cambiar):
 *   node scripts/importar-galeria.js            → muestra lo que haría
 *   node scripts/importar-galeria.js --apply    → lo aplica
 *
 * Idempotente: una foto cuya URL ya está en la biblioteca no se repite.
 * Las fotos siguen sirviéndose desde la web (/img/trabajos/…); no se
 * suben a Cloudinary, así que no gastan su cuota.
 */
import fs from 'node:fs';
import prisma from '../src/lib/prisma.js';

const apply = process.argv.includes('--apply');
const rows = JSON.parse(fs.readFileSync(new URL('../prisma/galeria-inicial.json', import.meta.url), 'utf8'));

const existing = new Set((await prisma.photo.findMany({ select: { url: true } })).map((p) => p.url));
const missing = rows.filter((r) => !existing.has(r.url));

console.log(`\n${apply ? 'APLICANDO' : 'SIMULACIÓN (añade --apply para aplicar)'}`);
console.log(`  En la lista: ${rows.length} · ya en la biblioteca: ${rows.length - missing.length} · por importar: ${missing.length}`);
missing.forEach((r) => console.log(`  + ${r.url.split('/').pop()}  [${r.category}]${r.featured ? ' ★' : ''}${r.minor ? ' (menor)' : ''}`));

if (apply && missing.length) {
  await prisma.photo.createMany({ data: missing.map((r) => ({ ...r, inGallery: true })) });
}

console.log(`\n${apply ? 'Listo' : 'Se importarían'}: ${missing.length} fotos.\n`);
await prisma.$disconnect();
