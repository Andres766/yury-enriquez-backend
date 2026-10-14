/**
 * Prueba de integración del catálogo: modo de precio, "Qué incluye",
 * anticipación por servicio y edición de ocasiones desde el panel.
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
        active: o.active,
        sortOrder: o.sortOrder,
      },
    };

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
