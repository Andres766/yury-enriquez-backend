/**
 * Carga el contenido real de Yury (propuesta final del 15 de octubre de
 * 2026: Sobre mí, servicio 100 % a domicilio, servicios y tarifas,
 * temporada de catrinas, talleres, paquete de novios, horario, abono y
 * medios de pago) en una base que ya existe, normalmente producción.
 *
 * Uso (desde backend/, con la DATABASE_URL de la base que quieras cambiar):
 *
 *   node scripts/contenido-yury.js            → muestra cada cambio (antes → después)
 *   node scripts/contenido-yury.js --apply    → lo aplica, todo en una transacción
 *
 * Requisitos: el backend con las migraciones 20261015000000 (talleres,
 * temporada por servicio, abono) y 20261015010000 (domicilio) ya
 * desplegado, y el frontend que trae las fotos de /img/trabajos.
 *
 * Qué NO hace: no borra servicios (los que no están en la propuesta de
 * Yury se DESACTIVAN, así sus reservas pasadas siguen enlazadas), no toca
 * reservas, clientas ni testimonios. Es idempotente.
 *
 * Duraciones: cuando Yury da un rango («2:30 a 3:00 horas») se usa el
 * máximo, para que la agenda nunca encime dos citas.
 *
 * Horario: Yury atiende de 4:00 a. m. a 6:00 p. m., pero las citas de
 * madrugada se piden SOLO por WhatsApp. La agenda en línea abre a las
 * 6:00 a. m.; las de 4:00 a 6:00 a. m. siguen por WhatsApp. Se cambia en
 * Panel → Agenda y horarios.
 */
import prisma from '../src/lib/prisma.js';

const apply = process.argv.includes('--apply');
const COP = (pesos) => pesos * 100;
const img = (id) => `/img/trabajos/${id}-960.webp`;

// ── Ajustes del negocio ──────────────────────────────────────────────

const SETTINGS = {
  aboutText: [
    '“Como te sientes, te ves; y como te ves, te sientes.”',
    'Detrás del maquillaje no solo hay técnica y color: hay una herramienta poderosa para la construcción del amor propio y la reconexión con tu belleza real, tanto por dentro como por fuera. Como Maquilladora Profesional, Auxiliar de Enfermería y Psicóloga Profesional con 9 años de experiencia, entiendo la estética como una extensión directa de la salud, la piel y el bienestar integral.',
    'Mi propósito es acompañarte en un proceso donde el cuidado de tu piel —como el órgano vital que es— y el realce de tus facciones se conviertan en un ritual de autocuidado, seguridad y amor por ti misma. Porque la verdadera belleza florece cuando te sientes plenamente bien contigo misma.',
  ].join('\n\n'),
  whatsappNumber: '+573218549608',
  contactPhone: '+573218549608',
  contactEmail: 'yury1603@hotmail.com',
  ownerNotificationEmail: 'yury1603@hotmail.com',
  transferInstructions:
    'Nequi: 321 854 9608\nDaviplata: 321 854 9608\n\nTu reserva queda confirmada cuando recibo el comprobante del abono del 50 % del valor total del servicio. Envíalo por WhatsApp al 321 854 9608. El resto lo pagas en efectivo o por transferencia el día del servicio.',
  depositPercent: 50,
  homeVisitFeeCents: COP(21_000),
  businessHoursNote:
    'Lunes a domingo, incluidos festivos, de 4:00 a. m. a 6:00 p. m. Las citas de madrugada para grados, bodas y quinceañeras se reservan solo por WhatsApp, con mínimo 20 días de anticipación.',
  // Los de TikTok/Facebook y la dirección eran de ejemplo: no se muestran
  // mientras Yury no pase los suyos.
  tiktokUrl: null,
  facebookUrl: null,
  addressLine: '',
  mapUrl: null,
  // Tema base claro y Halloween solo en las fechas de las catrinas
  theme: 'LIGHT',
  seasonalTheme: 'HALLOWEEN',
  seasonalStartDate: '2026-10-22',
  seasonalEndDate: '2026-10-31',
};

// ── Servicios (slug → datos). Los existentes se actualizan; los nuevos se crean ──

const PESTANAS = 'Pestañas de tira o banda fina, opcionales: +$20.000';

const SERVICES = {
  'maquillaje-social': {
    name: 'Maquillaje social y eventos',
    category: 'MAQUILLAJE',
    priceMode: 'FROM',
    priceCents: COP(90_000),
    durationMinutes: 75,
    shortDescription: 'Piel preparada con dermocosmética y un maquillaje de alta duración para tu evento.',
    description:
      'Antes de maquillar preparo tu piel con un protocolo de dermocosmética adaptado a tu tipo de piel, y trabajo con una técnica de alta durabilidad.\n\nPara baby shower y books o sesiones fotográficas de maternidad y familia, el maquillaje va desde $85.000.\n\nSi quieres, sumamos el diseño e instalación de pestañas (de tira o banda fina, a tu elección) por $20.000 adicionales.',
    includes: [
      'Protocolo de preparación cutánea con dermocosmética adaptada a tu tipo de piel',
      'Técnica de alta durabilidad',
      PESTANAS,
    ],
    active: true,
    featured: true,
    sortOrder: 1,
    occasions: ['grados', 'fiestas', 'eventos-sociales', 'bodas', 'quinceaneros'],
  },
  'peinado-de-fiesta': {
    name: 'Peinados de fiesta',
    category: 'PEINADO',
    priceMode: 'FROM',
    priceCents: COP(50_000),
    durationMinutes: 60,
    shortDescription: 'Ondas, alisado, cepillado estructurado o peinados elaborados.',
    description:
      'Moldeado con ondas, alisado o cepillado estructurado, o peinados elaborados para tu evento.\n\nEl valor varía según la longitud, la densidad y la textura de tu cabello, y la complejidad del diseño. Ven con el cabello limpio y completamente seco.',
    includes: ['Moldeado: ondas, alisado o cepillado estructurado', 'Peinados elaborados', 'Valor según el largo, la densidad y la textura del cabello'],
    active: true,
    featured: true,
    sortOrder: 2,
  },
  'paquete-novia-maquillaje-peinado': {
    name: 'Paquete Novias · maquillaje + peinado',
    category: 'PAQUETE',
    priceMode: 'FROM',
    priceCents: COP(190_000),
    durationMinutes: 180,
    shortDescription: 'Maquillaje y peinado para tu boda, con limpieza facial de obsequio.',
    description:
      'Te acompaño desde la asesoría hasta el último retoque: higienización y preparación dermocosmética profunda para una piel luminosa y cuidada, preparación capilar especializada y fijación de alta resistencia.\n\nObsequio exclusivo: al contratar el paquete completo de maquillaje y peinado recibes una limpieza facial básica antes del evento (exfoliación suave, tonificación y mascarilla según tu tipo de piel).',
    includes: [
      'Asesoría personalizada',
      'Protocolo de higienización y preparación dermocosmética profunda',
      'Preparación capilar especializada',
      'Fijación de alta resistencia',
      'Obsequio: limpieza facial básica antes del evento',
      PESTANAS,
    ],
    maxAdvanceDays: 365,
    active: true,
    featured: true,
    sortOrder: 3,
  },
  'paquete-quinceanera': {
    name: 'Paquete Quinceañeras · maquillaje + peinado',
    category: 'PAQUETE',
    priceMode: 'FROM',
    priceCents: COP(190_000),
    durationMinutes: 180,
    shortDescription: 'Maquillaje y peinado para tus quince, con limpieza facial de obsequio.',
    description:
      'Asesoría personalizada, higienización y preparación dermocosmética profunda para una piel luminosa y cuidada, preparación capilar especializada y fijación de alta resistencia para que el look aguante toda la fiesta.\n\nObsequio exclusivo: al contratar el paquete completo de maquillaje y peinado recibes una limpieza facial básica antes del evento (exfoliación suave, tonificación y mascarilla según tu tipo de piel).',
    includes: [
      'Asesoría personalizada',
      'Protocolo de higienización y preparación dermocosmética profunda',
      'Preparación capilar especializada',
      'Fijación de alta resistencia',
      'Obsequio: limpieza facial básica antes del evento',
      PESTANAS,
    ],
    maxAdvanceDays: 365,
    active: true,
    featured: true,
    sortOrder: 4,
  },
  'maquillaje-para-sesion-de-fotos': {
    name: 'Acompañamiento a sesión fotográfica',
    category: 'MAQUILLAJE',
    priceMode: 'FIXED',
    priceCents: COP(40_000),
    durationMinutes: 60,
    shortDescription: 'Retoques continuos en el set, por hora. Se suma a tu maquillaje.',
    description:
      'Te acompaño en la sesión para que te veas impecable en cada foto: asistencia técnica en el set, retoques continuos y control de brillos y texturas bajo la iluminación fotográfica.\n\nSon $40.000 adicionales por hora, sobre el servicio de maquillaje. La duración depende de tu sesión.',
    includes: ['Asistencia técnica en el set', 'Retoques continuos', 'Control de brillos y texturas bajo iluminación fotográfica'],
    active: true,
    featured: false,
    sortOrder: 5,
  },
  'maquillaje-artistico-de-catrina': {
    name: 'Maquillaje de Catrinas y caracterización',
    category: 'MAQUILLAJE',
    priceMode: 'FROM',
    priceCents: COP(65_000),
    durationMinutes: 90,
    shortDescription: 'Catrinas y caracterización artística para Halloween y Día de Muertos.',
    description:
      'Maquillaje artístico de catrina y caracterización. El valor varía según la complejidad del diseño.\n\nDisponible del 22 al 31 de octubre; ya puedes separar tu turno. El 31 de octubre el último turno es a las 4:00 p. m.',
    includes: ['Diseño según la complejidad que elijas', 'Disponible del 22 al 31 de octubre', 'El 31 de octubre, último turno a las 4:00 p. m.'],
    availableFrom: '2026-10-22',
    availableUntil: '2026-10-31',
    active: true,
    featured: true,
    sortOrder: 6,
  },
  // ── Nuevos ──
  'pintucaritas-y-maquillaje-infantil': {
    create: true,
    name: 'Pintucaritas y maquillaje infantil',
    category: 'MAQUILLAJE',
    priceMode: 'FROM',
    priceCents: COP(45_000),
    durationMinutes: 30,
    shortDescription: 'Todo el año: cumpleaños infantiles, eventos familiares y fiestas temáticas.',
    description:
      'Disponible todo el año para cumpleaños infantiles, eventos familiares y fiestas temáticas. Cada diseño toma de 15 a 30 minutos por niño, y el valor varía según el diseño.\n\nUso maquillaje formulado especialmente para la piel delicada de bebés y niños: 100 % hipoalergénico, libre de pinturas acrílicas o insumos industriales agresivos. Incluye hidratación previa, humectación profunda, protección solar y fijación dermocompatible.',
    includes: ['Hidratación previa y humectación profunda', 'Protección solar', 'Fijación dermocompatible', '100 % hipoalergénico, sin pinturas acrílicas'],
    active: true,
    featured: false,
    sortOrder: 7,
    occasions: ['fiestas', 'eventos-sociales'],
    images: [
      { url: img('catrina-nina'), alt: 'Niña maquillada de catrina con corona de flores y velo negro' },
      { url: img('halloween-vampira-nina'), alt: 'Niña con maquillaje de vampira' },
      { url: img('halloween-joker-nino'), alt: 'Niño con maquillaje del Joker' },
    ],
  },
  'taller-de-automaquillaje': {
    create: true,
    name: 'Taller de automaquillaje',
    category: 'TALLER',
    priceMode: 'QUOTE',
    priceCents: 0,
    durationMinutes: 180,
    shortDescription: 'Aprende a resaltar tus facciones, sola o con tus amigas.',
    description:
      'Espacios de aprendizaje para distintas etapas de la vida.\n\nModalidad individual: atención uno a uno para aprender a resaltar tus facciones según tu estructura facial, tu tipo de piel y tu estilo de vida.\n\nModalidad grupal: sesiones dinámicas para compartir y aprender entre amigas o colegas.\n\nPara jovencitas y adultas: desde el cuidado inicial y la iluminación sutil para jóvenes hasta la preparación dermocosmética avanzada para pieles maduras.\n\nLos talleres están abiertos todo el tiempo y se programan bajo demanda. Cada sesión dura de 2 a 3 horas y se cotiza según la modalidad (individual o grupal) y el número de participantes.',
    includes: ['Modalidad individual o grupal', 'Para jovencitas y adultas', 'Técnicas según tu estructura facial y tu tipo de piel'],
    active: true,
    featured: false,
    sortOrder: 8,
    images: [{ url: img('social-ojos-calidos'), alt: 'Maquillaje social con sombras cálidas' }],
  },
  'taller-verse-y-sentirse-bellas': {
    create: true,
    name: 'Taller «Verse y sentirse bellas»: belleza consciente y amor propio',
    category: 'TALLER',
    priceMode: 'QUOTE',
    priceCents: 0,
    durationMinutes: 180,
    shortDescription: 'Belleza consciente: técnica de maquillaje y bienestar emocional.',
    description:
      'Experiencias integrales que combinan la enseñanza de la técnica de maquillaje con dinámicas de autorregulación, bienestar emocional y fortalecimiento de la autoestima, para que proyectes hacia afuera el bienestar que cultivas por dentro.\n\nSon experiencias de 2 a 3 horas, abiertas todo el tiempo y programadas bajo demanda.',
    includes: ['Técnica de maquillaje', 'Dinámicas de autorregulación y bienestar emocional', 'Fortalecimiento de la autoestima'],
    active: true,
    featured: false,
    sortOrder: 9,
    images: [{ url: img('noche-ahumado-morado'), alt: 'Maquillaje con ahumado morado' }],
  },
  'bienestar-integrativo-para-novios': {
    create: true,
    name: 'Paquete de novios: preparación psicológica y bienestar integrativo',
    category: 'PAQUETE',
    priceMode: 'FROM',
    priceCents: COP(400_000),
    durationMinutes: 60, // por sesión
    shortDescription: 'Programa de 5 a 10 sesiones en pareja con la psicóloga Yury Enríquez.',
    description:
      'La planeación de una boda genera un alto impacto emocional, con estrés anticipatorio y cortisol que pueden reflejarse en la piel (brotes, opacidad, deshidratación) y en el bienestar general de la pareja.\n\nProfesional a cargo: psicóloga Yury Enríquez, con tarjeta profesional. Es un programa 100 % en pareja, diseñado de forma personalizada, de 5 a 10 sesiones. El valor va desde $400.000, según la cantidad de sesiones acordadas.\n\nAcompañamiento psicológico y regulación del estrés: sesiones de preparación con enfoque contextual-conductual, orientadas a la gestión de la ansiedad, el descanso y la autorregulación emocional antes del gran día.\n\nHerramientas para la vida en pareja: comunicación asertiva, resolución de conflictos y adaptación a la nueva etapa.\n\nPreparación para la ceremonia: un espacio de calma, presencia plena y expresión emocional para la pareja, que facilita tomar decisiones con serenidad y preparar sus votos.',
    includes: [
      'Psicóloga Yury Enríquez, con tarjeta profesional',
      '100 % en pareja y personalizado',
      'Programas de 5 a 10 sesiones',
      'Regulación del estrés, vida en pareja y preparación de los votos',
    ],
    maxAdvanceDays: 365,
    active: true,
    featured: false,
    sortOrder: 10,
    occasions: ['bodas'],
    images: [{ url: img('novia-boda-iglesia'), alt: 'Novia a la entrada de la iglesia' }],
  },
  'maquillaje-baby-shower-y-books': {
    create: true,
    name: 'Maquillaje para baby shower y books de maternidad o familia',
    category: 'MAQUILLAJE',
    priceMode: 'FROM',
    priceCents: COP(85_000),
    durationMinutes: 75,
    shortDescription: 'Para tu baby shower o tu sesión de fotos de maternidad o familia.',
    description:
      'Una subcategoría del maquillaje social y de eventos, pensada para baby shower y para books o sesiones fotográficas de maternidad y familia.\n\nIncluye el protocolo de preparación cutánea con dermocosmética adaptada a tu tipo de piel y una técnica de alta durabilidad. Si quieres, sumamos pestañas (de tira o banda fina) por $20.000 adicionales.',
    includes: [
      'Protocolo de preparación cutánea con dermocosmética adaptada a tu tipo de piel',
      'Técnica de alta durabilidad',
      PESTANAS,
    ],
    active: true,
    featured: false,
    sortOrder: 2,
    occasions: ['sesiones-de-fotos', 'eventos-sociales'],
    images: [{ url: img('social-ojos-calidos'), alt: 'Maquillaje social con sombras cálidas' }],
  },
};

// Agenda en línea: lunes (1) a domingo (7), 6:00 a. m. a 6:00 p. m.
// (de 4:00 a 6:00 a. m. solo por WhatsApp, con 20 días de anticipación).
const WEEKLY = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startTime: '06:00', endTime: '18:00' }));

// Lo que ya no está en la propuesta de Yury: se oculta, no se borra
const DEACTIVATE = ['maquillaje-de-noche', 'maquillaje-de-novia', 'peinado-de-novia', 'paquete-fiesta-maquillaje-peinado'];

// ── Ejecución ────────────────────────────────────────────────────────

const show = (v) => (v === null || v === undefined ? '∅' : typeof v === 'string' ? JSON.stringify(v.length > 70 ? `${v.slice(0, 67)}…` : v) : JSON.stringify(v));

function diff(before, after) {
  return Object.entries(after)
    .filter(([key, value]) => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(value ?? null))
    .map(([key, value]) => `      ${key}: ${show(before?.[key])} → ${show(value)}`);
}

console.log(`\n${apply ? 'APLICANDO' : 'SIMULACIÓN (nada se escribe; añade --apply para aplicar)'}\n`);

const ops = [];

// Ajustes
const settings = await prisma.settings.findUnique({ where: { id: 1 } });
const settingsChanges = diff(settings, SETTINGS);
console.log(`Ajustes: ${settingsChanges.length ? `${settingsChanges.length} cambios` : 'sin cambios'}`);
settingsChanges.forEach((l) => console.log(l));
if (settingsChanges.length) ops.push(prisma.settings.update({ where: { id: 1 }, data: SETTINGS }));

// Servicios
const occasions = Object.fromEntries((await prisma.occasion.findMany({ select: { id: true, slug: true } })).map((o) => [o.slug, o.id]));

for (const [slug, spec] of Object.entries(SERVICES)) {
  const { create, occasions: occSlugs, images, ...fields } = spec;
  const existing = await prisma.service.findUnique({ where: { slug }, include: { occasions: true } });

  if (!existing) {
    if (!create) {
      console.log(`\n  · ${slug}: no existe en esta base, se omite`);
      continue;
    }
    console.log(`\n  + NUEVO ${fields.name} (${slug})${fields.active ? '' : ' — se crea OCULTO'}`);
    ops.push(
      prisma.service.create({
        data: {
          slug,
          ...fields,
          images: { create: (images ?? []).map((im, i) => ({ ...im, sortOrder: i })) },
          occasions: { create: (occSlugs ?? []).filter((s) => occasions[s]).map((s) => ({ occasionId: occasions[s] })) },
        },
      }),
    );
    continue;
  }

  const changes = diff(existing, fields);
  const currentOcc = existing.occasions.map((o) => o.occasionId).sort();
  const wantedOcc = occSlugs ? occSlugs.filter((s) => occasions[s]).map((s) => occasions[s]).sort() : null;
  const occChanged = wantedOcc && JSON.stringify(currentOcc) !== JSON.stringify(wantedOcc);

  console.log(`\n  ~ ${existing.name} → ${fields.name} (${slug}): ${changes.length + (occChanged ? 1 : 0)} cambios`);
  changes.forEach((l) => console.log(l));
  if (occChanged) console.log(`      ocasiones: ${occSlugs.join(', ')}`);

  if (changes.length) ops.push(prisma.service.update({ where: { id: existing.id }, data: fields }));
  if (occChanged) {
    ops.push(prisma.serviceOccasion.deleteMany({ where: { serviceId: existing.id } }));
    ops.push(prisma.serviceOccasion.createMany({ data: wantedOcc.map((occasionId) => ({ serviceId: existing.id, occasionId })) }));
  }
}

for (const slug of DEACTIVATE) {
  const s = await prisma.service.findUnique({ where: { slug }, select: { id: true, name: true, active: true } });
  if (!s) continue;
  console.log(`\n  − ${s.name} (${slug}): ${s.active ? 'se OCULTA (no está en la propuesta de Yury)' : 'ya estaba oculto'}`);
  if (s.active) ops.push(prisma.service.update({ where: { id: s.id }, data: { active: false, featured: false } }));
}

// Horario semanal
const rules = await prisma.availabilityRule.findMany({
  where: { active: true },
  orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  select: { weekday: true, startTime: true, endTime: true },
});
const sameRules = JSON.stringify(rules) === JSON.stringify(WEEKLY);
const DAYS = ['', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const fmtRules = (list) => list.map((r) => `${DAYS[r.weekday]} ${r.startTime}–${r.endTime}`).join(' · ');
console.log(`\nHorario semanal: ${sameRules ? 'sin cambios' : 'se reemplaza'}`);
if (!sameRules) {
  console.log(`      antes:   ${fmtRules(rules) || '∅'}`);
  console.log(`      después: ${fmtRules(WEEKLY)}`);
  ops.push(prisma.availabilityRule.deleteMany({}));
  ops.push(prisma.availabilityRule.createMany({ data: WEEKLY }));
}

if (apply && ops.length) await prisma.$transaction(ops);

console.log(`\n${apply ? 'Listo' : 'Se harían'}: ${ops.length} operaciones.`);

await prisma.$disconnect();
