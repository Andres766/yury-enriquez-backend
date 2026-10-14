/**
 * Limpieza de los datos de demostración que siembra prisma/seed.js.
 *
 * Uso (desde la carpeta backend, con DATABASE_URL apuntando a la base
 * que quieres limpiar):
 *
 *     node scripts/limpiar-demo.js                  → solo muestra qué borraría
 *     node scripts/limpiar-demo.js --apply          → borra de verdad
 *     node scripts/limpiar-demo.js --apply --promos → además borra las
 *                                                     promociones de ejemplo
 *
 * Por defecto NO borra nada: imprime lo que encontró y sale. Así se
 * puede correr contra producción para mirar antes de decidir.
 *
 * Qué borra con --apply:
 *  · La clienta demo (SEED_CLIENT_EMAIL, por defecto cliente@ejemplo.com),
 *    solo si su rol es CLIENT, con su tarjeta de fidelidad, sus sellos,
 *    sus recompensas y sus sesiones.
 *  · Las reservas de esa clienta (por cuenta o por correo).
 *  · Las reservas de ejemplo del seed, con código "DEMO-…". Un código
 *    real nunca empieza así: el generador (lib/tokens.js) usa un
 *    alfabeto sin vocales, y "DEMO" tiene E y O.
 *  · Con --promos, las tres promociones de ejemplo, pero solo si siguen
 *    con el título Y la descripción exactos del seed. Si la maquilladora
 *    editó alguna, se considera suya y no se toca.
 *
 * Qué NO toca nunca: la cuenta de administradora, servicios, ocasiones,
 * horarios, ajustes, testimonios ni ninguna otra reserva. De los ajustes
 * y las fotos de ejemplo solo AVISA, para que se cambien desde el panel.
 *
 * Ojo: no vuelvas a correr `npm run db:seed` contra producción. El seed
 * borra TODAS las reservas y todos los sellos antes de crear los de
 * ejemplo.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const PROMOS = process.argv.includes('--promos');

const CLIENT_EMAIL = (process.env.SEED_CLIENT_EMAIL || 'cliente@ejemplo.com').toLowerCase();
const SEED_ADMIN_EMAIL = 'admin@yuryenriquez.com';
const DEMO_CODE_PREFIX = 'DEMO-';

/*
 * Copia literal de las promociones del seed. Si el seed cambia, hay
 * que actualizar esto; si no coincide, simplemente no se borran.
 */
const SEED_PROMOS = [
  {
    title: 'Temporada de grados · 15 % en paquetes',
    description:
      'Del mes de graduaciones: 15 % de descuento en cualquier paquete de maquillaje + peinado si vienes con dos compañeras o más. Aplica reservando el mismo día.',
  },
  {
    title: 'Martes de mirada',
    description:
      'Los martes, el diseño de cejas va de regalo con cualquier maquillaje social. Cupos limitados, se agenda por orden de reserva.',
  },
  {
    title: 'Solo para clientas registradas: 20 % en tu cumpleaños',
    description:
      'Si tienes cuenta con nosotras, el mes de tu cumpleaños tienes 20 % de descuento en el servicio que elijas. Escríbenos por WhatsApp para activarlo.',
  },
];

/* Valores inventados del seed que no deberían seguir en la web real. */
const SEED_SETTINGS = {
  contactEmail: 'hola@yuryenriquez.com',
  contactPhone: '+57 310 555 0142',
  whatsappNumber: '+573105550142',
  instagramUrl: 'https://instagram.com/yuryenriquez',
  tiktokUrl: 'https://tiktok.com/@yuryenriquez',
  facebookUrl: 'https://facebook.com/yuryenriquez',
  addressLine: 'Calle 19 #24-38, barrio La Aurora, Pasto, Nariño',
  mapUrl: 'https://maps.google.com/?q=Pasto+Nari%C3%B1o',
};

const line = (label, value) => console.log(`  ${label.padEnd(44, '.')} ${value}`);

async function main() {
  const db = new URL(process.env.DATABASE_URL ?? 'postgresql://desconocida');
  console.log(`\nLimpieza de datos de demostración — ${APPLY ? 'MODO BORRADO' : 'solo lectura (dry-run)'}`);
  console.log(`Base: ${db.hostname}${db.port ? `:${db.port}` : ''}${db.pathname}\n`);

  // ── 1. Qué hay ────────────────────────────────────────────────────
  const client = await prisma.user.findUnique({
    where: { email: CLIENT_EMAIL },
    include: { loyaltyCard: { select: { id: true } } },
  });

  if (client && client.role !== 'CLIENT') {
    console.log(`  ✖ ${CLIENT_EMAIL} existe pero su rol es ${client.role}. No se toca: revisa SEED_CLIENT_EMAIL.\n`);
  }
  const demoClient = client?.role === 'CLIENT' ? client : null;

  const bookingWhere = {
    OR: [
      { code: { startsWith: DEMO_CODE_PREFIX } },
      { customerEmail: CLIENT_EMAIL },
      ...(demoClient ? [{ userId: demoClient.id }] : []),
    ],
  };
  const bookings = await prisma.booking.findMany({
    where: bookingWhere,
    select: { id: true, code: true, customerName: true, status: true, startAt: true },
    orderBy: { startAt: 'asc' },
  });

  const cardId = demoClient?.loyaltyCard?.id;
  const [stamps, rewards, sessions] = await Promise.all([
    cardId ? prisma.loyaltyStamp.count({ where: { cardId } }) : 0,
    cardId ? prisma.loyaltyReward.count({ where: { cardId } }) : 0,
    demoClient ? prisma.refreshToken.count({ where: { userId: demoClient.id } }) : 0,
  ]);

  const promos = await prisma.promotion.findMany({
    where: { OR: SEED_PROMOS.map((p) => ({ title: p.title, description: p.description })) },
    select: { id: true, title: true },
  });

  line(`Clienta demo (${CLIENT_EMAIL})`, demoClient ? `sí — ${demoClient.fullName}` : 'no está');
  line('Tarjeta de fidelidad de la demo', cardId ? 1 : 0);
  line('Sellos de esa tarjeta', stamps);
  line('Recompensas de esa tarjeta', rewards);
  line('Sesiones guardadas de la demo', sessions);
  line('Reservas de ejemplo', bookings.length);
  for (const b of bookings) {
    console.log(`      ${b.code}  ${b.startAt.toISOString().slice(0, 10)}  ${b.status.padEnd(9)}  ${b.customerName}`);
  }
  line(`Promociones de ejemplo${PROMOS ? '' : ' (solo con --promos)'}`, promos.length);
  for (const p of promos) console.log(`      ${p.title}`);

  // ── 2. Avisos (no se borra nada de esto) ─────────────────────────
  const warnings = [];

  const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { email: true } });
  if (admins.some((a) => a.email === SEED_ADMIN_EMAIL)) {
    warnings.push(`La administradora sigue entrando con ${SEED_ADMIN_EMAIL}, que no es un buzón real. Cámbialo en Mi cuenta → Mis datos.`);
  }

  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (settings) {
    for (const [field, demo] of Object.entries(SEED_SETTINGS)) {
      if (settings[field] === demo) warnings.push(`Ajustes → ${field} todavía tiene el valor de ejemplo (${demo}).`);
    }
    if (/123-456789-00/.test(settings.transferInstructions ?? '')) {
      warnings.push('Ajustes → los datos de transferencia todavía muestran la cuenta bancaria de ejemplo.');
    }
  }

  const [picsumServices, picsumOccasions] = await Promise.all([
    prisma.serviceImage.count({ where: { url: { contains: 'picsum.photos' } } }),
    prisma.occasion.count({ where: { heroImage: { contains: 'picsum.photos' } } }),
  ]);
  if (picsumServices) warnings.push(`${picsumServices} fotos de servicios siguen siendo de prueba (picsum.photos).`);
  if (picsumOccasions) warnings.push(`${picsumOccasions} ocasiones siguen con foto de portada de prueba (picsum.photos).`);

  if (warnings.length) {
    console.log('\nAvisos (este script no los cambia; se arreglan desde el panel):');
    for (const w of warnings) console.log(`  · ${w}`);
  }

  // ── 3. Borrado ────────────────────────────────────────────────────
  if (!APPLY) {
    console.log('\nNo se borró nada. Para borrar de verdad: node scripts/limpiar-demo.js --apply\n');
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const out = {};
    // Los sellos van primero: apuntan a las reservas y a la tarjeta.
    out.stamps = cardId ? (await tx.loyaltyStamp.deleteMany({ where: { cardId } })).count : 0;
    out.rewards = cardId ? (await tx.loyaltyReward.deleteMany({ where: { cardId } })).count : 0;
    out.cards = cardId ? (await tx.loyaltyCard.deleteMany({ where: { id: cardId } })).count : 0;
    out.sessions = demoClient
      ? (await tx.refreshToken.deleteMany({ where: { userId: demoClient.id } })).count
      : 0;
    // Se borran por id, los mismos que se listaron arriba: nada nuevo se
    // cuela entre la lectura y el borrado.
    out.bookings = (await tx.booking.deleteMany({ where: { id: { in: bookings.map((b) => b.id) } } })).count;
    out.users = demoClient
      ? (await tx.user.deleteMany({ where: { id: demoClient.id, role: 'CLIENT' } })).count
      : 0;
    out.promos = PROMOS
      ? (await tx.promotion.deleteMany({ where: { id: { in: promos.map((p) => p.id) } } })).count
      : 0;
    return out;
  });

  console.log('\nBorrado:');
  line('Sellos', result.stamps);
  line('Recompensas', result.rewards);
  line('Tarjetas de fidelidad', result.cards);
  line('Sesiones', result.sessions);
  line('Reservas', result.bookings);
  line('Clienta demo', result.users);
  line('Promociones de ejemplo', result.promos);
  console.log('');
}

main()
  .catch((error) => {
    console.error('\n✖ Error durante la limpieza (no se aplicó ningún cambio a medias):\n', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
