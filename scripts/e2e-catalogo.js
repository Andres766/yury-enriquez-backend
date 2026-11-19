/**
 * Prueba de integración del catálogo: modo de precio, "Qué incluye",
 * anticipación y temporada por servicio, categoría Taller y edición de
 * ocasiones desde el panel.
 *
 * Requiere la base sembrada:
 *     npm run setup
 *     node scripts/e2e-catalogo.js
 *
 * Igual que scripts/e2e.js, levanta la app en un puerto libre y habla
 * con ella por HTTP como lo haría el navegador. Cambia un servicio y una
 * ocasión de verdad, así que guarda cómo estaban y los deja igual al
 * terminar, aunque alguna comprobación falle por el camino.
 */
import { createApp } from '../src/app.js';
import prisma from '../src/lib/prisma.js';

const app = createApp();
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m✖\x1b[0m ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}

/** Sesión con tarro de cookies y CSRF, como haría un navegador. */
function createSession() {
  const jar = new Map();
  let accessToken = null;

  return {
    setToken(value) {
      accessToken = value;
    },
    async request(path, { method = 'GET', body } = {}) {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const cookieHeader = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookieHeader) headers.Cookie = cookieHeader;
      if (jar.has('csrfToken') && method !== 'GET') headers['X-CSRF-Token'] = jar.get('csrfToken');

      const res = await fetch(`${base}/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      for (const raw of res.headers.getSetCookie?.() ?? []) {
        const [pair] = raw.split(';');
        const idx = pair.indexOf('=');
        jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
      }

      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { error: text.slice(0, 200) };
      }
      return { status: res.status, data };
    },
  };
}

const PRICE_MODES = ['FIXED', 'FROM', 'QUOTE'];
const sameList = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
const fieldsOf = (res) => (res.data?.details ?? []).map((d) => d.field).join(', ');

console.log('\nPrueba del catálogo (precio, qué incluye, ocasiones)\n');

const guest = createSession();
const admin = createSession();
const client = createSession();
const clientEmail = `catalogo.e2e.${Date.now()}@ejemplo.test`;

// Lo que se toca y cómo estaba, para devolverlo al final.
let serviceBackup = null;
let occasionBackup = null;

try {
  // ── 1. Catálogo público ───────────────────────────────────────────
  console.log('1. Catálogo público');
  let service;
  let occasion;
  {
    await guest.request('/health'); // obtiene la cookie CSRF

    const services = await guest.request('/services');
    const list = services.data?.services ?? [];
    service = list[0];
    check('GET /services responde con servicios', services.status === 200 && list.length > 0);
    check(
      'Cada servicio trae su modo de precio',
      list.every((s) => PRICE_MODES.includes(s.priceMode)),
      list.map((s) => `${s.slug}: ${s.priceMode}`).join(' · '),
    );
    check('Cada servicio trae su lista "qué incluye"', list.every((s) => Array.isArray(s.includes)));
    check(
      'Cada servicio trae su anticipación propia (o null)',
      list.every((s) => s.maxAdvanceDays === null || Number.isInteger(s.maxAdvanceDays)),
    );

    const detail = await guest.request(`/services/${service.slug}`);
    check(
      'La ficha pública trae priceMode e includes',
      detail.status === 200 && PRICE_MODES.includes(detail.data.service.priceMode) && Array.isArray(detail.data.service.includes),
    );

    const occasions = await guest.request('/occasions');
    occasion = occasions.data?.occasions?.find((o) => o.services?.length > 0) ?? occasions.data?.occasions?.[0];
    check('GET /occasions responde con ocasiones', occasions.status === 200 && Boolean(occasion));
    check(
      'Los servicios de cada ocasión traen el modo de precio',
      (occasions.data?.occasions ?? []).every((o) => o.services.every((s) => PRICE_MODES.includes(s.priceMode))),
    );
    check(
      'Los servicios de cada ocasión salen en el orden del catálogo',
      (occasions.data?.occasions ?? []).every((o) =>
        o.services.every((s, i, arr) => i === 0 || arr[i - 1].sortOrder <= s.sortOrder),
      ),
    );
  }

  // ── 2. Sesiones: administradora y clienta ─────────────────────────
  console.log('\n2. Sesiones');
  {
    await admin.request('/health');
    const login = await admin.request('/auth/login', {
      method: 'POST',
      body: {
        email: process.env.SEED_ADMIN_EMAIL || 'admin@yuryenriquez.com',
        password: process.env.SEED_ADMIN_PASSWORD || 'Admin.2026Segura',
      },
    });
    check('La administradora inicia sesión', login.status === 200, `recibido ${login.status}: ${login.data?.error ?? ''}`);
    admin.setToken(login.data?.accessToken);

    await client.request('/health');
    const reg = await client.request('/auth/register', {
      method: 'POST',
      body: { fullName: 'Clienta Catálogo', email: clientEmail, password: 'ContrasenaSegura1' },
    });
    check('Se crea una clienta de prueba', reg.status === 201, `recibido ${reg.status}: ${reg.data?.error ?? ''}`);
    client.setToken(reg.data?.accessToken);
  }

  // ── 3. Servicios: precio, qué incluye y anticipación ──────────────
  console.log('\n3. Servicios desde el panel');
  {
    const original = await admin.request(`/services/admin/${service.id}`);
    check('La administradora lee el servicio completo', original.status === 200);
    const s = original.data.service;
    serviceBackup = {
      id: s.id,
      body: {
        priceMode: s.priceMode,
        includes: s.includes,
        maxAdvanceDays: s.maxAdvanceDays,
        category: s.category,
        availableFrom: s.availableFrom,
        availableUntil: s.availableUntil,
        images: s.images.map(({ url, alt }) => ({ url, alt })),
      },
    };

    const cambio = await admin.request(`/services/admin/${service.id}`, {
      method: 'PATCH',
      body: {
        priceMode: 'FROM',
        includes: ['  Pestañas  ', '', 'Kit de retoque', 'Kit de retoque'],
        maxAdvanceDays: 365,
      },
    });
    check('La administradora cambia modo, viñetas y anticipación', cambio.status === 200, `recibido ${cambio.status}: ${fieldsOf(cambio)}`);
    check('El modo queda en "desde"', cambio.data?.service?.priceMode === 'FROM');
    check(
      'Las viñetas llegan limpias: sin espacios sobrantes, vacías ni repetidas',
      sameList(cambio.data?.service?.includes, ['Pestañas', 'Kit de retoque']),
      JSON.stringify(cambio.data?.service?.includes),
    );
    check('La anticipación propia queda en 365 días', cambio.data?.service?.maxAdvanceDays === 365);

    const publico = await guest.request(`/services/${service.slug}`);
    check(
      'La ficha pública refleja el cambio',
      publico.data?.service?.priceMode === 'FROM' && sameList(publico.data.service.includes, ['Pestañas', 'Kit de retoque']),
    );

    const cotizar = await admin.request(`/services/admin/${service.id}`, {
      method: 'PATCH',
      body: { priceMode: 'QUOTE', maxAdvanceDays: null },
    });
    check(
      'Se puede pasar a "cotizar" y volver al límite general (null)',
      cotizar.status === 200 && cotizar.data.service.priceMode === 'QUOTE' && cotizar.data.service.maxAdvanceDays === null,
    );

    const modoMalo = await admin.request(`/services/admin/${service.id}`, {
      method: 'PATCH',
      body: { priceMode: 'GRATIS' },
    });
    check('Un modo de precio inventado se rechaza', modoMalo.status === 400 && fieldsOf(modoMalo).includes('priceMode'));

    for (const dias of [0, 731, 12.5]) {
      const res = await admin.request(`/services/admin/${service.id}`, {
        method: 'PATCH',
        body: { maxAdvanceDays: dias },
      });
      check(`Una anticipación de ${dias} días se rechaza`, res.status === 400 && fieldsOf(res).includes('maxAdvanceDays'));
    }

    const muchas = await admin.request(`/services/admin/${service.id}`, {
      method: 'PATCH',
      body: { includes: Array.from({ length: 13 }, (_, i) => `Viñeta ${i + 1}`) },
    });
    check('Más de 12 viñetas se rechazan', muchas.status === 400 && fieldsOf(muchas).includes('includes'));

    const fotoLocal = await admin.request(`/services/admin/${service.id}`, {
      method: 'PATCH',
      body: { images: [{ url: '/img/trabajos/novia-boda-iglesia-960.webp', alt: 'Novia a la entrada de la iglesia' }] },
    });
    check(
      'Acepta una foto del propio sitio (/img/…)',
      fotoLocal.status === 200 && fotoLocal.data.service.images[0]?.url === '/img/trabajos/novia-boda-iglesia-960.webp',
      `recibido ${fotoLocal.status}: ${fieldsOf(fotoLocal)}`,
    );

    // "//" y "/\" empiezan por "/", pero el navegador los lleva a otro dominio.
    for (const url of ['javascript:alert(1)', '//otro-dominio.test/foto.jpg', '/\\otro-dominio.test/foto.jpg']) {
      const res = await admin.request(`/services/admin/${service.id}`, {
        method: 'PATCH',
        body: { images: [{ url, alt: 'Prueba' }] },
      });
      check(`Una foto con URL "${url}" se rechaza`, res.status === 400);
    }

    // Temporada: solo se reserva para días entre estas fechas (catrinas).
    const temporada = await admin.request(`/services/admin/${service.id}`, {
      method: 'PATCH',
      body: { availableFrom: '2026-10-22', availableUntil: ' 2026-10-31 ' },
    });
    check(
      'La administradora fija la temporada del servicio',
      temporada.status === 200 &&
        temporada.data.service.availableFrom === '2026-10-22' &&
        temporada.data.service.availableUntil === '2026-10-31',
      `recibido ${temporada.status}: ${fieldsOf(temporada)}`,
    );
    const fichaTemporada = await guest.request(`/services/${service.slug}`);
    check(
      'La ficha pública trae la temporada',
      fichaTemporada.data?.service?.availableFrom === '2026-10-22' && fichaTemporada.data.service.availableUntil === '2026-10-31',
    );
    const listaTemporada = await guest.request('/services');
    check(
      'El listado público trae availableFrom/availableUntil en todos los servicios',
      (listaTemporada.data?.services ?? []).every((x) => 'availableFrom' in x && 'availableUntil' in x),
    );

    const finAntes = await admin.request(`/services/admin/${service.id}`, {
      method: 'PATCH',
      body: { availableUntil: '2026-10-20' },
    });
    check(
      'Un fin anterior al inicio ya guardado se rechaza en el campo de fin',
      finAntes.status === 400 && fieldsOf(finAntes).includes('availableUntil'),
      `recibido ${finAntes.status}: ${fieldsOf(finAntes)}`,
    );

    for (const fecha of ['2026-02-30', '22/10/2026', '2026-1-5', 20261022]) {
      const res = await admin.request(`/services/admin/${service.id}`, {
        method: 'PATCH',
        body: { availableFrom: fecha },
      });
      check(`Una fecha de inicio ${JSON.stringify(fecha)} se rechaza`, res.status === 400 && fieldsOf(res).includes('availableFrom'),
        `recibido ${res.status}: ${fieldsOf(res)}`);
    }

    const soloInicio = await admin.request(`/services/admin/${service.id}`, {
      method: 'PATCH',
      body: { availableUntil: '' },
    });
    check(
      'Se puede dejar solo la fecha de inicio (vacío = sin fin)',
      soloInicio.status === 200 && soloInicio.data.service.availableFrom === '2026-10-22' && soloInicio.data.service.availableUntil === null,
    );

    const sinTemporada = await admin.request(`/services/admin/${service.id}`, {
      method: 'PATCH',
      body: { availableFrom: null, availableUntil: null },
    });
    check(
      'Con null en las dos fechas el servicio vuelve a todo el año',
      sinTemporada.status === 200 && sinTemporada.data.service.availableFrom === null && sinTemporada.data.service.availableUntil === null,
    );

    const crearAlReves = await admin.request('/services/admin', {
      method: 'POST',
      body: {
        name: `Prueba temporada e2e ${Date.now()}`,
        category: 'TALLER',
        shortDescription: 'Prueba',
        description: 'Prueba automática',
        durationMinutes: 60,
        priceCents: 0,
        availableFrom: '2026-10-31',
        availableUntil: '2026-10-22',
      },
    });
    if (crearAlReves.data?.service?.id) {
      await admin.request(`/services/admin/${crearAlReves.data.service.id}`, { method: 'DELETE' });
    }
    check(
      'Al crear, una temporada al revés también se rechaza',
      crearAlReves.status === 400 && fieldsOf(crearAlReves).includes('availableUntil'),
      `recibido ${crearAlReves.status}: ${fieldsOf(crearAlReves)}`,
    );

    // Categoría Taller (talleres de automaquillaje).
    const taller = await admin.request(`/services/admin/${service.id}`, {
      method: 'PATCH',
      body: { category: 'TALLER' },
    });
    check('La categoría TALLER se acepta', taller.status === 200 && taller.data.service.category === 'TALLER',
      `recibido ${taller.status}: ${fieldsOf(taller)}`);
    const filtroTaller = await guest.request('/services?category=TALLER');
    check(
      'El filtro público por TALLER funciona',
      filtroTaller.status === 200 &&
        filtroTaller.data.services.some((x) => x.id === service.id) &&
        filtroTaller.data.services.every((x) => x.category === 'TALLER'),
    );
    const categoriaMala = await admin.request(`/services/admin/${service.id}`, {
      method: 'PATCH',
      body: { category: 'CURSO' },
    });
    check('Una categoría inventada se rechaza', categoriaMala.status === 400 && fieldsOf(categoriaMala).includes('category'));

    const comoClienta = await client.request(`/services/admin/${service.id}`, {
      method: 'PATCH',
      body: { priceMode: 'FIXED' },
    });
    check('Una clienta NO puede editar servicios', comoClienta.status === 403, `recibido ${comoClienta.status}`);

    const sinSesion = await guest.request(`/services/admin/${service.id}`, {
      method: 'PATCH',
      body: { priceMode: 'FIXED' },
    });
    check('Sin sesión tampoco', sinSesion.status === 401 || sinSesion.status === 403, `recibido ${sinSesion.status}`);
  }

  // ── 4. Ocasiones desde el panel ───────────────────────────────────
  console.log('\n4. Ocasiones desde el panel');
  {
    const todas = await admin.request('/occasions/admin/all');
    const listado = todas.data?.occasions ?? [];
    check('La administradora ve todas las ocasiones', todas.status === 200 && listado.length > 0);
    check(
      'El listado del panel trae los servicios de cada una',
      listado.every((o) => Array.isArray(o.services)),
    );

    const o = listado.find((item) => item.id === occasion.id) ?? listado[0];
    occasionBackup = {
      id: o.id,
      body: {
        name: o.name,
        tagline: o.tagline,
        description: o.description,
        includes: o.includes,
        heroImage: o.heroImage ?? '',
        priceFromCents: o.priceFromCents ?? null,
        active: o.active,
        sortOrder: o.sortOrder,
      },
    };

    check(
      'El panel trae el precio de los servicios de cada ocasión (para el «Desde» automático)',
      o.services.every((s) => typeof s.priceCents === 'number' && 'priceMode' in s),
    );
    const conPrecio = await admin.request(`/occasions/admin/${o.id}`, { method: 'PATCH', body: { priceFromCents: 12_000_000 } });
    const publicaConPrecio = await guest.request(`/occasions/${o.slug}`);
    check(
      'Precio «desde» escrito a mano: se guarda y sale en la web',
      conPrecio.status === 200 && conPrecio.data.occasion.priceFromCents === 12_000_000 && publicaConPrecio.data?.occasion?.priceFromCents === 12_000_000,
      `recibido ${conPrecio.status} ${JSON.stringify(conPrecio.data?.details ?? conPrecio.data?.occasion?.priceFromCents)}`,
    );
    for (const [caso, valor] of [['negativo', -100], ['con centavos', 12_000_050.5], ['menor a $ 1.000', 50_000], ['en texto', '120000']]) {
      const res = await admin.request(`/occasions/admin/${o.id}`, { method: 'PATCH', body: { priceFromCents: valor } });
      check(`Precio «desde» ${caso}: 400`, res.status === 400 && fieldsOf(res).includes('priceFromCents'), `recibido ${res.status}`);
    }
    const automatico = await admin.request(`/occasions/admin/${o.id}`, { method: 'PATCH', body: { priceFromCents: null } });
    check('null lo vuelve automático', automatico.status === 200 && automatico.data.occasion.priceFromCents === null);

    const cambio = await admin.request(`/occasions/admin/${o.id}`, {
      method: 'PATCH',
      body: {
        tagline: '  Frase de prueba e2e  ',
        includes: ['Uno', '', 'Dos', 'Uno'],
        heroImage: '/img/trabajos/novia-boda-iglesia-960.webp',
      },
    });
    check('La administradora edita una ocasión', cambio.status === 200, `recibido ${cambio.status}: ${fieldsOf(cambio)}`);
    check('La frase se guarda limpia', cambio.data?.occasion?.tagline === 'Frase de prueba e2e');
    check('Las viñetas vacías y repetidas se descartan', sameList(cambio.data?.occasion?.includes, ['Uno', 'Dos']));
    check(
      'Acepta una foto del propio sitio (/img/…)',
      cambio.data?.occasion?.heroImage === '/img/trabajos/novia-boda-iglesia-960.webp',
    );

    const publica = await guest.request(`/occasions/${o.slug}`);
    check('La página pública refleja el cambio', publica.data?.occasion?.tagline === 'Frase de prueba e2e');

    for (const heroImage of [
      'javascript:alert(1)',
      '//otro-dominio.test/portada.jpg',
      '/\\otro-dominio.test/portada.jpg',
      'ftp://ejemplo.test/x.jpg',
    ]) {
      const res = await admin.request(`/occasions/admin/${o.id}`, { method: 'PATCH', body: { heroImage } });
      check(`Una portada "${heroImage}" se rechaza`, res.status === 400 && fieldsOf(res).includes('heroImage'));
    }

    const sinFoto = await admin.request(`/occasions/admin/${o.id}`, { method: 'PATCH', body: { heroImage: '' } });
    check('Vaciar la portada la deja en null', sinFoto.status === 200 && sinFoto.data.occasion.heroImage === null);

    const nombreVacio = await admin.request(`/occasions/admin/${o.id}`, { method: 'PATCH', body: { name: '   ' } });
    check('Un nombre vacío se rechaza', nombreVacio.status === 400 && fieldsOf(nombreVacio).includes('name'));

    const oculta = await admin.request(`/occasions/admin/${o.id}`, { method: 'PATCH', body: { active: false } });
    const yaNoPublica = await guest.request(`/occasions/${o.slug}`);
    const sigueEnPanel = await admin.request('/occasions/admin/all');
    check(
      'Ocultarla la quita de la web pero no del panel',
      oculta.status === 200 &&
        yaNoPublica.status === 404 &&
        (sigueEnPanel.data?.occasions ?? []).some((item) => item.id === o.id && item.active === false),
    );

    // Ocasiones que crea Yury: dirección armada con el nombre, sin pisar
    // otra, de última si no elige orden; borrar solo sin reservas.
    const nueva = {
      name: 'Día de la Madre E2E',
      tagline: 'Para consentir a mamá',
      description: 'Maquillaje para el almuerzo familiar.',
    };
    const creada = await admin.request('/occasions/admin', { method: 'POST', body: nueva });
    const c1 = creada.data?.occasion;
    const maxOrden = Math.max(...listado.map((item) => item.sortOrder));
    check(
      'Crear ocasión sin dirección: la arma con el nombre y la pone de última',
      creada.status === 201 && c1?.slug === 'dia-de-la-madre-e2e' && c1?.sortOrder === maxOrden + 1 && c1?.active === true,
      `recibido ${creada.status} ${JSON.stringify({ slug: c1?.slug, sortOrder: c1?.sortOrder, details: creada.data?.details })}`,
    );
    const otra = await admin.request('/occasions/admin', { method: 'POST', body: { ...nueva, name: 'día de la madre e2e' } });
    check('Con el mismo nombre no pisa la dirección (-2)', otra.status === 201 && otra.data?.occasion?.slug === 'dia-de-la-madre-e2e-2');
    const publicaNueva = await guest.request('/occasions/dia-de-la-madre-e2e');
    check('La nueva ya tiene su página pública', publicaNueva.status === 200 && publicaNueva.data?.occasion?.name === nueva.name);
    const sinNombre = await admin.request('/occasions/admin', { method: 'POST', body: { ...nueva, name: '¡¡!!' } });
    check('Nombre sin letras ni números: 400 en name', sinNombre.status === 400 && fieldsOf(sinNombre).includes('name'));
    const sinTextos = await admin.request('/occasions/admin', { method: 'POST', body: { name: 'Incompleta E2E' } });
    check('Sin frase ni descripción: 400', sinTextos.status === 400 && fieldsOf(sinTextos).includes('tagline'));
    const crearClienta = await client.request('/occasions/admin', { method: 'POST', body: nueva });
    check('Una clienta no puede crear ocasiones', crearClienta.status === 403);

    const servicioCualquiera = await prisma.service.findFirst({ select: { id: true, priceCents: true } });
    const reserva = await prisma.booking.create({
      data: {
        code: `E2EOCC${Date.now().toString(36).toUpperCase()}`,
        serviceId: servicioCualquiera.id,
        occasionId: otra.data.occasion.id,
        customerName: 'Prueba E2E',
        customerEmail: clientEmail,
        customerPhone: '3000000000',
        startAt: new Date('2030-01-10T15:00:00Z'),
        endAt: new Date('2030-01-10T16:00:00Z'),
        paymentMethod: 'EFECTIVO',
        priceCents: servicioCualquiera.priceCents,
      },
    });
    const conReserva = await admin.request(`/occasions/admin/${otra.data.occasion.id}`, { method: 'DELETE' });
    check(
      'Borrar una ocasión con reservas: 409 y sigue ahí',
      conReserva.status === 409 &&
        conReserva.data?.code === 'OCCASION_HAS_BOOKINGS' &&
        Boolean(await prisma.occasion.findUnique({ where: { id: otra.data.occasion.id } })),
      `recibido ${conReserva.status} ${conReserva.data?.code}`,
    );
    await prisma.booking.delete({ where: { id: reserva.id } });

    const borrada = await admin.request(`/occasions/admin/${c1.id}`, { method: 'DELETE' });
    const yaNoEsta = await guest.request('/occasions/dia-de-la-madre-e2e');
    check('Borrar una ocasión sin reservas', borrada.status === 200 && yaNoEsta.status === 404);
    await prisma.occasion.deleteMany({ where: { slug: { startsWith: 'dia-de-la-madre-e2e' } } });

    // El chip "Ideal para" de la ficha no puede llevar a una ocasión
    // oculta, pero el panel conserva el enlace para no perderlo al guardar.
    const enlazado = o.services?.find((item) => item.active);
    if (enlazado) {
      const fichaPublica = await guest.request(`/services/${enlazado.slug}`);
      const fichaPanel = await admin.request(`/services/admin/${enlazado.id}`);
      check(
        'Una ocasión oculta no sale en la ficha pública del servicio',
        fichaPublica.status === 200 && !fichaPublica.data.service.occasions.some((item) => item.id === o.id),
      );
      check(
        'El panel sí conserva el enlace con la ocasión oculta',
        fichaPanel.status === 200 && fichaPanel.data.service.occasions.some((item) => item.id === o.id),
      );
    }

    const comoClienta = await client.request(`/occasions/admin/${o.id}`, {
      method: 'PATCH',
      body: { tagline: 'Intento de clienta' },
    });
    check('Una clienta NO puede editar ocasiones', comoClienta.status === 403, `recibido ${comoClienta.status}`);

    const listaClienta = await client.request('/occasions/admin/all');
    check('Una clienta NO puede ver el listado del panel', listaClienta.status === 403);

    const sinSesion = await guest.request(`/occasions/admin/${o.id}`, {
      method: 'PATCH',
      body: { tagline: 'Intento sin sesión' },
    });
    check('Sin sesión tampoco', sinSesion.status === 401 || sinSesion.status === 403, `recibido ${sinSesion.status}`);
  }
} catch (error) {
  failed += 1;
  console.log(`\n  \x1b[31m✖\x1b[0m La prueba se interrumpió: ${error.stack ?? error.message}`);
} finally {
  // ── Restaurar ─────────────────────────────────────────────────────
  console.log('\nDejando el catálogo como estaba…');
  try {
    if (serviceBackup) {
      const res = await admin.request(`/services/admin/${serviceBackup.id}`, { method: 'PATCH', body: serviceBackup.body });
      check('Servicio restaurado', res.status === 200, `recibido ${res.status}: ${fieldsOf(res)}`);
    }
    if (occasionBackup) {
      const res = await admin.request(`/occasions/admin/${occasionBackup.id}`, {
        method: 'PATCH',
        body: occasionBackup.body,
      });
      check('Ocasión restaurada', res.status === 200, `recibido ${res.status}: ${fieldsOf(res)}`);
    }
    await prisma.booking.deleteMany({ where: { code: { startsWith: 'E2EOCC' } } });
    await prisma.occasion.deleteMany({ where: { slug: { startsWith: 'dia-de-la-madre-e2e' } } });
    await prisma.user.deleteMany({ where: { email: clientEmail } });
    console.log('  Listo.');
  } catch (error) {
    console.log(`  Aviso al restaurar: ${error.message}`);
  }
}

console.log(`\n\x1b[1m${passed} comprobaciones correctas, ${failed} fallidas.\x1b[0m\n`);

server.close();
await prisma.$disconnect();
process.exit(failed === 0 ? 0 : 1);
