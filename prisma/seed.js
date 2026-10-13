import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

/**
 * Datos de prueba.
 *
 * Idempotente: se puede ejecutar varias veces sin duplicar nada.
 *
 * Las fotos apuntan a picsum.photos con semillas fijas, así la galería
 * no sale vacía al montar el proyecto. Sustitúyelas por las fotos reales
 * del estudio desde el panel (Servicios → editar → galería).
 */

const prisma = new PrismaClient();

const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
const photo = (seed, w = 1200, h = 900) => `https://picsum.photos/seed/${seed}/${w}/${h}`;
const COP = (pesos) => pesos * 100;

// ── Ocasiones ────────────────────────────────────────────────────────

const OCCASIONS = [
  {
    slug: 'bodas',
    name: 'Bodas',
    tagline: 'El día que llevas años imaginando',
    description:
      'Acompañamos a la novia desde la prueba previa hasta el último retoque antes del brindis. Trabajamos con maquillaje de larga duración y fijación resistente al calor, las lágrimas y las horas de baile. Reservamos la agenda completa del día para que nadie vaya con prisa.',
    includes: [
      'Prueba de maquillaje y peinado previa, sin costo adicional',
      'Maquillaje de novia con productos de larga duración',
      'Peinado con prueba de accesorios, velo o tocado',
      'Kit de retoque para llevar contigo toda la jornada',
      'Opción de desplazamiento al lugar de la preparación',
    ],
    heroImage: photo('boda-novia', 1600, 1000),
    sortOrder: 1,
  },
  {
    slug: 'quinceaneros',
    name: 'Quinceañeros',
    tagline: 'Su primera gran noche',
    description:
      'Un look que la haga sentirse ella misma, no una versión mayor de sí misma. Conversamos primero con la quinceañera y su familia para encontrar el equilibrio entre la ilusión de la fiesta y la piel de quince años. Incluye el maquillaje del cambio de vestuario si lo hay.',
    includes: [
      'Asesoría previa de color según el vestido',
      'Maquillaje luminoso pensado para piel joven',
      'Peinado de fiesta con fijación para toda la noche',
      'Retoque para el cambio de vestido o la hora loca',
      'Descuento en el maquillaje de mamá',
    ],
    heroImage: photo('quince-fiesta', 1600, 1000),
    sortOrder: 2,
  },
  {
    slug: 'grados',
    name: 'Grados',
    tagline: 'Para la foto que va a quedar enmarcada',
    description:
      'El maquillaje de grado tiene que verse impecable bajo la luz del auditorio y en las fotos de cerca con la familia. Buscamos un acabado natural pero definido, que no se pierda con el flash ni se corra durante la ceremonia.',
    includes: [
      'Base de cobertura media con acabado natural en fotografía',
      'Definición de mirada y cejas para el primer plano',
      'Peinado que aguante la toga y el birrete',
      'Labial de larga duración, transferencia mínima',
      'Tarifas especiales para grupos de compañeras',
    ],
    heroImage: photo('grado-toga', 1600, 1000),
    sortOrder: 3,
  },
  {
    slug: 'sesiones-de-fotos',
    name: 'Sesiones de fotos',
    tagline: 'Maquillaje pensado para el lente',
    description:
      'La cámara ve distinto que el ojo humano. Trabajamos con productos sin SPF y sin partículas reflectantes para evitar el velo blanco del flash, y adaptamos la intensidad al tipo de sesión: editorial, retrato corporativo, embarazo o libro de contenido para redes.',
    includes: [
      'Productos libres de SPF para evitar el reflejo del flash',
      'Contorno y luces calibrados para la cámara',
      'Hasta dos cambios de look en la misma sesión',
      'Acompañamiento durante la sesión para retoques',
      'Coordinación directa con tu fotógrafo o fotógrafa',
    ],
    heroImage: photo('sesion-fotos', 1600, 1000),
    sortOrder: 4,
  },
  {
    slug: 'fiestas',
    name: 'Fiestas',
    tagline: 'Para salir sin pensar en el espejo',
    description:
      'Cumpleaños, matrimonios de otras, fin de año, la fiesta de la empresa. Un look de noche resistente, con la intensidad que pidas: desde el glow discreto hasta el ojo ahumado completo con pestañas postizas.',
    includes: [
      'Maquillaje de noche con fijación de larga duración',
      'Pestañas postizas incluidas si las quieres',
      'Peinado rápido: ondas, recogido o liso pulido',
      'Asesoría de color según el atuendo',
    ],
    heroImage: photo('fiesta-noche', 1600, 1000),
    sortOrder: 5,
  },
  {
    slug: 'eventos-sociales',
    name: 'Eventos sociales',
    tagline: 'Bautizos, primeras comuniones, aniversarios',
    description:
      'Eventos de día, con luz natural y muchas fotos familiares. Priorizamos un acabado fresco y natural, que se vea como tú en tu mejor día y no como una capa de producto. Ideal también para madrinas, mamás y abuelas.',
    includes: [
      'Maquillaje natural pensado para luz de día',
      'Tratamiento especial para piel madura si se requiere',
      'Peinado sencillo y pulido',
      'Atención a grupos familiares en el mismo turno',
    ],
    heroImage: photo('evento-social', 1600, 1000),
    sortOrder: 6,
  },
];

// ── Servicios ────────────────────────────────────────────────────────

const SERVICES = [
  {
    name: 'Maquillaje social',
    category: 'MAQUILLAJE',
    shortDescription: 'Un look fresco y luminoso para reuniones, cumpleaños y eventos de día.',
    description:
      'El maquillaje que resuelve casi cualquier plan. Empezamos con limpieza e hidratación según tu tipo de piel, preparamos con primer y trabajamos una base de cobertura media modulable. Definimos cejas, damos profundidad a la mirada con tonos neutros y terminamos con labial en el tono que elijas. Acabado natural, de esos que hacen que te pregunten si dormiste bien, no qué base usaste.\n\nIncluye limpieza previa, preparación de piel, maquillaje completo y fijación. Si vienes con una foto de referencia, mejor: la revisamos juntas antes de empezar.',
    durationMinutes: 60,
    priceCents: COP(85_000),
    featured: true,
    sortOrder: 1,
    occasions: ['fiestas', 'eventos-sociales', 'grados'],
    images: [
      { url: photo('maq-social-1'), alt: 'Maquillaje social con acabado natural y luminoso' },
      { url: photo('maq-social-2'), alt: 'Detalle de mirada con tonos neutros' },
      { url: photo('maq-social-3'), alt: 'Resultado final del maquillaje social' },
    ],
  },
  {
    name: 'Maquillaje de noche',
    category: 'MAQUILLAJE',
    shortDescription: 'Mirada intensa, piel impecable y fijación para aguantar hasta el final.',
    description:
      'Pensado para fiestas largas. Cobertura alta pero respirable, contorno e iluminación trabajados para la luz artificial, ojo ahumado o gráfico según lo que busques, y pestañas postizas incluidas si las quieres. Sellamos con bruma fijadora profesional para que el look llegue intacto a la última canción.\n\nSi la fiesta es al aire libre o en clima caliente, avísanos en las notas de la reserva: ajustamos los productos.',
    durationMinutes: 75,
    priceCents: COP(110_000),
    featured: true,
    sortOrder: 2,
    occasions: ['fiestas', 'quinceaneros', 'eventos-sociales'],
    images: [
      { url: photo('maq-noche-1'), alt: 'Maquillaje de noche con ojo ahumado' },
      { url: photo('maq-noche-2'), alt: 'Piel con acabado impecable bajo luz artificial' },
    ],
  },
  {
    name: 'Maquillaje de novia',
    category: 'MAQUILLAJE',
    shortDescription: 'Con prueba previa incluida y kit de retoque para todo el día.',
    description:
      'El servicio más completo del estudio. Agendamos una prueba previa, sin costo adicional, donde definimos el look con calma y probamos cómo se comporta en tu piel durante el día. El día de la boda trabajamos con productos de alta duración y resistencia al agua, con especial atención a que la piel se vea bien en fotografía y en video.\n\nIncluye prueba previa, maquillaje el día del evento, pestañas, kit de retoque para llevar (labial y polvo) y acompañamiento por WhatsApp los días previos para resolver dudas.',
    durationMinutes: 120,
    priceCents: COP(320_000),
    featured: true,
    sortOrder: 3,
    occasions: ['bodas', 'sesiones-de-fotos'],
    images: [
      { url: photo('novia-1', 1400, 1050), alt: 'Maquillaje de novia con acabado luminoso' },
      { url: photo('novia-2', 1400, 1050), alt: 'Detalle del maquillaje de ojos de novia' },
      { url: photo('novia-3', 1400, 1050), alt: 'Novia lista antes de la ceremonia' },
      { url: photo('novia-4', 1400, 1050), alt: 'Retoque de labial el día de la boda' },
    ],
  },
  {
    name: 'Maquillaje para sesión de fotos',
    category: 'MAQUILLAJE',
    shortDescription: 'Sin SPF ni partículas reflectantes: cero velo blanco con el flash.',
    description:
      'Maquillaje calibrado para cámara. Usamos productos sin protector solar y sin polvos con partículas reflectantes, que son los responsables del velo blanquecino en las fotos con flash. El contorno y las luces se trabajan con más definición de la habitual, porque el lente aplana los volúmenes.\n\nIncluye hasta dos cambios de intensidad durante la sesión y acompañamiento para retoques si la sesión es en estudio.',
    durationMinutes: 90,
    priceCents: COP(150_000),
    sortOrder: 4,
    occasions: ['sesiones-de-fotos'],
    images: [
      { url: photo('foto-sesion-1'), alt: 'Maquillaje editorial para sesión fotográfica' },
      { url: photo('foto-sesion-2'), alt: 'Prueba de luz durante la sesión' },
    ],
  },
  {
    name: 'Peinado de fiesta',
    category: 'PEINADO',
    shortDescription: 'Recogido, semirecogido u ondas con fijación de larga duración.',
    description:
      'Trabajamos sobre cabello limpio y seco. Elegimos juntas entre recogido alto, semirecogido, trenzas o las ondas amplias que nunca fallan, y lo fijamos para que aguante el baile completo. Si tienes accesorios, balaca o flores, tráelos: los integramos al peinado.\n\nEl precio es el mismo para cabello corto, medio o largo. Si tu cabello es muy denso o pasa de la cintura, la duración puede subir unos minutos.',
    durationMinutes: 60,
    priceCents: COP(75_000),
    featured: true,
    sortOrder: 5,
    occasions: ['fiestas', 'quinceaneros', 'grados', 'eventos-sociales'],
    images: [
      { url: photo('peinado-1'), alt: 'Recogido de fiesta con acabado pulido' },
      { url: photo('peinado-2'), alt: 'Ondas amplias con fijación duradera' },
      { url: photo('peinado-3'), alt: 'Semirecogido con trenzas' },
    ],
  },
  {
    name: 'Peinado de novia',
    category: 'PEINADO',
    shortDescription: 'Con prueba de velo, tocado o accesorios antes del gran día.',
    description:
      'Incluye prueba previa para definir el peinado y probar cómo se sostiene con el velo o el tocado. El día de la boda reservamos tiempo suficiente para no ir con prisa y para dejar listo el peinado antes del vestido.\n\nTrabajamos la fijación por capas, pensando en que el velo se va a retirar en algún momento de la noche y el peinado debe seguir viéndose intacto después.',
    durationMinutes: 90,
    priceCents: COP(220_000),
    sortOrder: 6,
    occasions: ['bodas'],
    images: [
      { url: photo('peinado-novia-1'), alt: 'Peinado de novia con velo' },
      { url: photo('peinado-novia-2'), alt: 'Detalle del recogido de novia' },
    ],
  },
  {
    name: 'Paquete Fiesta · maquillaje + peinado',
    category: 'PAQUETE',
    shortDescription: 'Los dos servicios en un solo turno, con precio de paquete.',
    description:
      'Maquillaje de noche y peinado de fiesta en una sola cita, coordinados entre sí para que el look funcione como conjunto. Ahorras respecto a contratar los dos servicios por separado y, sobre todo, ahorras un desplazamiento.\n\nIncluye pestañas postizas y fijación de larga duración en ambos servicios.',
    durationMinutes: 120,
    priceCents: COP(165_000),
    featured: true,
    sortOrder: 7,
    occasions: ['fiestas', 'quinceaneros', 'grados', 'eventos-sociales'],
    images: [
      { url: photo('paquete-fiesta-1'), alt: 'Maquillaje y peinado de fiesta coordinados' },
      { url: photo('paquete-fiesta-2'), alt: 'Resultado completo del paquete de fiesta' },
    ],
  },
  {
    name: 'Paquete Novia · maquillaje + peinado',
    category: 'PAQUETE',
    shortDescription: 'El servicio completo del día de la boda, con dos pruebas previas.',
    description:
      'Nuestro servicio insignia. Dos pruebas previas (una de maquillaje y otra de peinado, o ambas en la misma sesión si prefieres), el servicio completo el día de la boda, kit de retoque y acompañamiento por WhatsApp desde que reservas.\n\nEl día del evento bloqueamos la agenda: no atendemos a nadie más en ese turno. Puedes sumar el maquillaje de mamá, damas de honor o suegra con tarifa preferencial; escríbenos y armamos el presupuesto.',
    durationMinutes: 180,
    priceCents: COP(480_000),
    featured: true,
    sortOrder: 8,
    occasions: ['bodas', 'sesiones-de-fotos'],
    images: [
      { url: photo('paquete-novia-1', 1400, 1050), alt: 'Novia con maquillaje y peinado terminados' },
      { url: photo('paquete-novia-2', 1400, 1050), alt: 'Preparación de la novia en el estudio' },
      { url: photo('paquete-novia-3', 1400, 1050), alt: 'Detalle del look completo de novia' },
    ],
  },
  {
    /*
     * Servicio de temporada, sembrado DESACTIVADO a propósito.
     *
     * Así ya está escrito y con precio cuando llegue la temporada: se
     * publica con un clic desde Panel → Servicios en vez de tener que
     * redactarlo con prisa a finales de octubre. Va de la mano del tema
     * Halloween y de la franja de "Temporada de Catrinas".
     */
    name: 'Maquillaje artístico de Catrina',
    category: 'MAQUILLAJE',
    shortDescription: 'Catrina completa para Día de Muertos, con pedrería y flores.',
    description:
      'Maquillaje artístico de catrina, del clásico en blanco y negro al full glam con pedrería, pigmentos de color y flores en el cabello. Trabajamos sobre una base de larga duración sellada con bruma profesional, pensada para aguantar la noche entera sin retoques.\n\nIncluye diseño personalizado (traemos referencias y elegimos juntas), delineado detallado de cuencas, pétalos y filigranas, pedrería adherida una a una, y flores o tocado si los quieres. Se puede sumar el peinado como paquete.\n\nDisponible solo en temporada de Día de Muertos. Reserva con antelación: los cupos de esos días se llenan rápido.',
    durationMinutes: 150,
    priceCents: COP(210_000),
    active: false,
    featured: false,
    sortOrder: 10,
    occasions: ['fiestas', 'sesiones-de-fotos'],
    images: [
      { url: photo('catrina-1'), alt: 'Maquillaje artístico de catrina con pedrería y flores' },
      { url: photo('catrina-2'), alt: 'Detalle del delineado de cuencas en maquillaje de catrina' },
      { url: photo('catrina-3'), alt: 'Catrina completa con tocado floral' },
    ],
  },
  {
    name: 'Paquete Quinceañera',
    category: 'PAQUETE',
    shortDescription: 'Maquillaje y peinado para ella, con descuento en el de mamá.',
    description:
      'Pensado para la fiesta de quince: maquillaje luminoso adaptado a piel joven, peinado de fiesta con la fijación necesaria para el vals y la hora loca, y retoque incluido para el cambio de vestuario.\n\nIncluye un 20 % de descuento en el maquillaje social de mamá si se agenda en el mismo turno.',
    durationMinutes: 135,
    priceCents: COP(185_000),
    sortOrder: 9,
    occasions: ['quinceaneros'],
    images: [
      { url: photo('quince-paquete-1'), alt: 'Quinceañera con maquillaje y peinado listos' },
      { url: photo('quince-paquete-2'), alt: 'Detalle del peinado de quinceañera' },
    ],
  },
];

// ── Horario semanal (1 = lunes … 7 = domingo) ───────────────────────

const AVAILABILITY = [
  { weekday: 2, startTime: '09:00', endTime: '13:00' },
  { weekday: 2, startTime: '14:00', endTime: '18:00' },
  { weekday: 3, startTime: '09:00', endTime: '13:00' },
  { weekday: 3, startTime: '14:00', endTime: '18:00' },
  { weekday: 4, startTime: '09:00', endTime: '13:00' },
  { weekday: 4, startTime: '14:00', endTime: '19:00' },
  { weekday: 5, startTime: '09:00', endTime: '13:00' },
  { weekday: 5, startTime: '14:00', endTime: '19:00' },
  { weekday: 6, startTime: '08:00', endTime: '18:00' },
  { weekday: 7, startTime: '09:00', endTime: '14:00' },
];

// ── Ejecución ────────────────────────────────────────────────────────

async function main() {
  console.log('Sembrando datos de prueba…\n');

  // 1. Ajustes del negocio
  const settingsData = {
    brandName: 'Yury Enríquez',
    tagline: 'Makeup Artist',
    aboutText:
      'Soy Yury, maquilladora profesional con más de ocho años acompañando a mujeres en los días que importan. En el estudio trabajamos con cita previa y un solo turno a la vez, porque creo que nadie debería sentirse apurada mientras se arregla. Uso productos profesionales de alta duración y adapto cada look a tu piel, tus rasgos y, sobre todo, a cómo te quieres sentir ese día.',
    contactEmail: 'hola@yuryenriquez.com',
    contactPhone: '+57 310 555 0142',
    whatsappNumber: '+573105550142',
    instagramUrl: 'https://instagram.com/yuryenriquez',
    tiktokUrl: 'https://tiktok.com/@yuryenriquez',
    facebookUrl: 'https://facebook.com/yuryenriquez',
    addressLine: 'Calle 19 #24-38, barrio La Aurora, Pasto, Nariño',
    mapUrl: 'https://maps.google.com/?q=Pasto+Nari%C3%B1o',
    businessHoursNote: 'Martes a viernes de 9:00 a 19:00 · Sábados de 8:00 a 18:00 · Domingos de 9:00 a 14:00',
    ownerNotificationEmail: process.env.SEED_ADMIN_EMAIL || 'admin@yuryenriquez.com',
    transferInstructions:
      'Bancolombia — Ahorros 123-456789-00\nA nombre de Yury Enríquez\nNequi: 310 555 0142\n\nEnvía el comprobante por WhatsApp para confirmar tu cita.',
    theme: 'LIGHT',
    timezone: 'America/Bogota',
    slotIntervalMinutes: 30,
    bufferMinutes: 15,
    minNoticeHours: 12,
    maxAdvanceDays: 90,
    stampsRequired: 8,
    rewardDescription: 'Maquillaje social de cortesía',
  };

  await prisma.settings.upsert({ where: { id: 1 }, update: settingsData, create: { id: 1, ...settingsData } });
  console.log('  ✔ Ajustes del negocio');

  // 2. Usuarios
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@yuryenriquez.com').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin.2026Segura';
  const clientEmail = (process.env.SEED_CLIENT_EMAIL || 'cliente@ejemplo.com').toLowerCase();
  const clientPassword = process.env.SEED_CLIENT_PASSWORD || 'Cliente.2026Segura';

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: { role: 'ADMIN' },
    create: {
      email: adminEmail,
      passwordHash: await argon2.hash(adminPassword, ARGON_OPTIONS),
      fullName: process.env.SEED_ADMIN_NAME || 'Yury Enríquez',
      phone: '+573105550142',
      role: 'ADMIN',
    },
  });

  const client = await prisma.user.upsert({
    where: { email: clientEmail },
    update: {},
    create: {
      email: clientEmail,
      passwordHash: await argon2.hash(clientPassword, ARGON_OPTIONS),
      fullName: 'Mariana Ochoa',
      phone: '+573124448899',
      role: 'CLIENT',
      marketingOptIn: true,
      loyaltyCard: { create: { stampsCurrent: 5, stampsTotal: 5 } },
    },
  });
  console.log('  ✔ Usuarios (1 administradora, 1 clienta)');

  // 3. Ocasiones
  const occasionBySlug = {};
  for (const occasion of OCCASIONS) {
    occasionBySlug[occasion.slug] = await prisma.occasion.upsert({
      where: { slug: occasion.slug },
      update: occasion,
      create: occasion,
    });
  }
  console.log(`  ✔ Ocasiones (${OCCASIONS.length})`);

  // 4. Servicios
  const serviceByName = {};
  for (const svc of SERVICES) {
    const { occasions, images, ...fields } = svc;
    const slug = fields.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);

    const existing = await prisma.service.findUnique({ where: { slug } });
    if (existing) {
      await prisma.serviceImage.deleteMany({ where: { serviceId: existing.id } });
      await prisma.serviceOccasion.deleteMany({ where: { serviceId: existing.id } });
    }

    serviceByName[svc.name] = await prisma.service.upsert({
      where: { slug },
      update: {
        ...fields,
        images: { create: images.map((img, i) => ({ ...img, sortOrder: i })) },
        occasions: { create: occasions.map((s) => ({ occasionId: occasionBySlug[s].id })) },
      },
      create: {
        ...fields,
        slug,
        images: { create: images.map((img, i) => ({ ...img, sortOrder: i })) },
        occasions: { create: occasions.map((s) => ({ occasionId: occasionBySlug[s].id })) },
      },
    });
  }
  console.log(`  ✔ Servicios (${SERVICES.length}) con galerías y ocasiones`);

  // 5. Horario semanal
  await prisma.availabilityRule.deleteMany({});
  await prisma.availabilityRule.createMany({ data: AVAILABILITY });
  console.log(`  ✔ Horario semanal (${AVAILABILITY.length} franjas)`);

  // 6. Promociones
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const in60 = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  await prisma.promotion.deleteMany({});
  await prisma.promotion.createMany({
    data: [
      {
        title: 'Temporada de grados · 15 % en paquetes',
        description:
          'Del mes de graduaciones: 15 % de descuento en cualquier paquete de maquillaje + peinado si vienes con dos compañeras o más. Aplica reservando el mismo día.',
        code: 'GRADOS15',
        discountType: 'PERCENT',
        discountValue: 15,
        image: photo('promo-grados', 1200, 600),
        startsAt: now,
        endsAt: in60,
        active: true,
        membersOnly: false,
      },
      {
        title: 'Martes de mirada',
        description:
          'Los martes, el diseño de cejas va de regalo con cualquier maquillaje social. Cupos limitados, se agenda por orden de reserva.',
        discountType: 'AMOUNT',
        discountValue: COP(25_000),
        startsAt: now,
        endsAt: in30,
        active: true,
        membersOnly: false,
      },
      {
        title: 'Solo para clientas registradas: 20 % en tu cumpleaños',
        description:
          'Si tienes cuenta con nosotras, el mes de tu cumpleaños tienes 20 % de descuento en el servicio que elijas. Escríbenos por WhatsApp para activarlo.',
        code: 'CUMPLE20',
        discountType: 'PERCENT',
        discountValue: 20,
        startsAt: now,
        endsAt: in60,
        active: true,
        membersOnly: true,
      },
    ],
  });
  console.log('  ✔ Promociones (3)');

  // 7. Reservas de ejemplo
  await prisma.loyaltyStamp.deleteMany({});
  await prisma.booking.deleteMany({});

  const tomorrow10 = new Date();
  tomorrow10.setDate(tomorrow10.getDate() + 3);
  tomorrow10.setHours(15, 0, 0, 0); // 10:00 en America/Bogota (UTC-5)

  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 9);
  nextWeek.setHours(19, 0, 0, 0); // 14:00 en America/Bogota

  const lastMonth = new Date();
  lastMonth.setDate(lastMonth.getDate() - 25);
  lastMonth.setHours(16, 0, 0, 0);

  const social = serviceByName['Maquillaje social'];
  const paqueteFiesta = serviceByName['Paquete Fiesta · maquillaje + peinado'];
  const novia = serviceByName['Paquete Novia · maquillaje + peinado'];

  const mk = (service, start, extra = {}) => ({
    code: extra.code,
    serviceId: service.id,
    startAt: start,
    endAt: new Date(start.getTime() + (service.durationMinutes + 15) * 60_000),
    priceCents: service.priceCents,
    currency: service.currency,
    ...extra,
  });

  await prisma.booking.create({
    data: mk(social, tomorrow10, {
      code: 'DEMO-2345',
      userId: client.id,
      occasionId: occasionBySlug['eventos-sociales'].id,
      customerName: client.fullName,
      customerEmail: client.email,
      customerPhone: client.phone,
      paymentMethod: 'TRANSFERENCIA',
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      notes: 'Prefiero tonos cálidos, el vestido es verde esmeralda.',
    }),
  });

  await prisma.booking.create({
    data: mk(paqueteFiesta, nextWeek, {
      code: 'DEMO-6789',
      customerName: 'Laura Benavides',
      customerEmail: 'laura.benavides@ejemplo.com',
      customerPhone: '+573001234567',
      occasionId: occasionBySlug['fiestas'].id,
      paymentMethod: 'EFECTIVO',
      status: 'PENDING',
      notes: 'Es una boda al aire libre, hará calor.',
    }),
  });

  const completed = await prisma.booking.create({
    data: mk(novia, lastMonth, {
      code: 'DEMO-9012',
      userId: client.id,
      occasionId: occasionBySlug['bodas'].id,
      customerName: client.fullName,
      customerEmail: client.email,
      customerPhone: client.phone,
      paymentMethod: 'TRANSFERENCIA',
      status: 'COMPLETED',
      confirmedAt: lastMonth,
      completedAt: lastMonth,
    }),
  });
  console.log('  ✔ Reservas de ejemplo (3)');

  // 8. Sellos de fidelidad de la clienta demo
  const card = await prisma.loyaltyCard.findUnique({ where: { userId: client.id } });
  if (card) {
    await prisma.loyaltyStamp.create({
      data: {
        cardId: card.id,
        bookingId: completed.id,
        grantedById: admin.id,
        note: 'Paquete de novia completado',
      },
    });
    for (let i = 0; i < 4; i += 1) {
      await prisma.loyaltyStamp.create({
        data: { cardId: card.id, grantedById: admin.id, note: `Servicio anterior ${i + 1}` },
      });
    }
    await prisma.loyaltyCard.update({
      where: { id: card.id },
      data: { stampsCurrent: 5, stampsTotal: 5 },
    });
  }
  console.log('  ✔ Tarjeta de fidelidad demo (5 de 8 sellos)');

  console.log('\n─────────────────────────────────────────────');
  console.log('  Datos de acceso');
  console.log('─────────────────────────────────────────────');
  console.log(`  Panel de administración`);
  console.log(`    correo:     ${adminEmail}`);
  console.log(`    contraseña: ${adminPassword}`);
  console.log(`\n  Clienta de prueba`);
  console.log(`    correo:     ${clientEmail}`);
  console.log(`    contraseña: ${clientPassword}`);
  console.log('─────────────────────────────────────────────');
  console.log('  Cambia estas contraseñas antes de publicar.\n');
}

main()
  .catch((e) => {
    console.error('\n✖ Error al sembrar datos:\n', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
