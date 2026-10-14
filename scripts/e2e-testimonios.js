/**
 * Prueba de integración de testimonios y de la cuenta.
 *
 * Cubre:
 *  · Testimonios: el listado público oculta los no publicados y solo
 *    expone los campos de la web; CRUD y orden desde el panel;
 *    validación (calificación, texto, foto); permisos (invitada 401,
 *    clienta 403, CSRF obligatorio).
 *  · Cuenta: cambio de correo y de contraseña, con rechazo de la
 *    contraseña actual incorrecta y cierre de las otras sesiones.
 *
 * Requiere la base sembrada y la administradora del seed:
 *     npm run setup
 *     node scripts/e2e-testimonios.js
 *
 * Ejecútalo con NODE_ENV=development, por la misma razón que e2e.js:
 * con los límites de producción el script mediría el rate limiter.
 *
 * Crea datos de prueba (testimonios "Prueba e2e…" y cuentas
 * @ejemplo.test), los limpia al terminar y deja el orden de los
 * testimonios reales como estaba.
 */
import { createApp } from '../src/app.js';
import prisma from '../src/lib/prisma.js';

const app = createApp();
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

const PREFIX = 'Prueba e2e';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@yuryenriquez.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'Admin.2026Segura';

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
    get token() {
      return accessToken;
    },
    setToken(value) {
      accessToken = value;
    },
    async request(path, { method = 'GET', body, noCsrf = false } = {}) {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const cookieHeader = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      if (cookieHeader) headers.Cookie = cookieHeader;
      if (jar.has('csrfToken') && method !== 'GET' && !noCsrf) headers['X-CSRF-Token'] = jar.get('csrfToken');

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

async function loginAs(email, password) {
  const session = createSession();
  await session.request('/health'); // obtiene la cookie CSRF
  const res = await session.request('/auth/login', { method: 'POST', body: { email, password } });
  if (res.data?.accessToken) session.setToken(res.data.accessToken);
  return { session, res };
}

const ids = (list) => (list ?? []).map((t) => t.id);

console.log('\nPrueba de testimonios y cuenta\n');

const guest = createSession();
await guest.request('/health');

const { session: admin, res: adminLogin } = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
if (adminLogin.status !== 200) {
  console.error(`\n✖ La administradora del seed no pudo iniciar sesión (${adminLogin.status}). Revisa SEED_ADMIN_*.\n`);
  server.close();
  await prisma.$disconnect();
  process.exit(1);
}

// Orden real antes de empezar, para devolverlo igual al terminar.
const originalOrder = ids((await admin.request('/testimonials/admin/all')).data?.testimonials);

const suffix = Date.now().toString(36);
const clientEmail = `testimonios.${suffix}@ejemplo.test`;
const clientPassword = 'Clienta.2026Prueba';

// ── 1. Testimonios: panel y listado público ─────────────────────────
console.log('1. Testimonios: panel y listado público');
let draft;
let live;
{
  const inicial = await guest.request('/testimonials');
  check('GET /testimonials responde a cualquiera', inicial.status === 200 && Array.isArray(inicial.data.testimonials));

  const a = await admin.request('/testimonials/admin', {
    method: 'POST',
    body: { name: `${PREFIX} borrador`, quote: 'Todavía no autoriza publicar esta opinión.', rating: 5 },
  });
  draft = a.data?.testimonial;
  check('La administradora crea un testimonio', a.status === 201 && Boolean(draft?.id), `recibido ${a.status}: ${a.data?.error ?? ''}`);
  check('Nace sin publicar aunque no se diga', draft?.published === false);

  const b = await admin.request('/testimonials/admin', {
    method: 'POST',
    body: {
      name: `${PREFIX} publicada`,
      occasionLabel: 'Novia · prueba',
      quote: '  Me encantó   cómo quedó todo, duró la noche entera.  ',
      rating: 4,
      photoUrl: '/img/trabajos/prueba-480.webp',
      published: true,
    },
  });
  live = b.data?.testimonial;
  check('Crea uno publicado', b.status === 201 && live?.published === true);
  check('El texto llega normalizado (espacios)', live?.quote === 'Me encantó cómo quedó todo, duró la noche entera.');
  check('Un testimonio nuevo va al final del orden', live?.sortOrder > draft?.sortOrder);

  const publico = await guest.request('/testimonials');
  const lista = publico.data.testimonials;
  check('El público ve el publicado', ids(lista).includes(live?.id));
  check('El público NO ve el borrador', !ids(lista).includes(draft?.id));

  const visto = lista.find((t) => t.id === live?.id);
  check(
    'El público solo recibe los campos de la web',
    visto && Object.keys(visto).sort().join(',') === 'id,name,occasionLabel,photoUrl,quote,rating',
    `campos: ${visto ? Object.keys(visto).join(',') : '—'}`,
  );

  const publicar = await admin.request(`/testimonials/admin/${draft?.id}`, {
    method: 'PATCH',
    body: { published: true },
  });
  check('Publicar con un PATCH parcial funciona', publicar.status === 200 && publicar.data.testimonial.published === true);
  check('El PATCH parcial no borra la calificación', publicar.data?.testimonial?.rating === 5);
  check('Ya publicado, aparece en la web', ids((await guest.request('/testimonials')).data.testimonials).includes(draft?.id));

  const editar = await admin.request(`/testimonials/admin/${live?.id}`, {
    method: 'PATCH',
    body: { rating: null, photoUrl: '' },
  });
  check(
    'Se puede quitar la calificación y la foto',
    editar.status === 200 && editar.data.testimonial.rating === null && editar.data.testimonial.photoUrl === null,
  );

  const todos = await admin.request('/testimonials/admin/all');
  check('El panel lista también los no publicados', todos.status === 200 && ids(todos.data.testimonials).includes(draft?.id));
}

// ── 2. Orden ────────────────────────────────────────────────────────
console.log('\n2. Orden');
{
  const actual = ids((await admin.request('/testimonials/admin/all')).data.testimonials);
  // Se pone "publicada" justo antes que "borrador", sin mover el resto.
  const sinPrueba = actual.filter((id) => id !== draft.id && id !== live.id);
  const nuevo = [live.id, draft.id, ...sinPrueba];

  const ordenar = await admin.request('/testimonials/admin/order', { method: 'PUT', body: { ids: nuevo } });
  check('Reordenar devuelve la lista en el orden pedido', ordenar.status === 200 && ids(ordenar.data.testimonials).join() === nuevo.join());

  const publico = ids((await guest.request('/testimonials')).data.testimonials);
  check('La web respeta el orden', publico.indexOf(live.id) < publico.indexOf(draft.id));

  const repetidos = await admin.request('/testimonials/admin/order', { method: 'PUT', body: { ids: [live.id, live.id] } });
  check('Rechaza ids repetidos', repetidos.status === 400);

  const fantasma = await admin.request('/testimonials/admin/order', {
    method: 'PUT',
    body: { ids: [live.id, 'cnoexiste000000000000000'] },
  });
  check('Rechaza un id que no existe', fantasma.status === 400);
}

// ── 3. Validación ───────────────────────────────────────────────────
console.log('\n3. Validación');
{
  const ok = { name: `${PREFIX} validación`, quote: 'Una opinión con largo suficiente.' };
  const casos = [
    ['calificación 6', { ...ok, rating: 6 }, 'rating'],
    ['calificación 0', { ...ok, rating: 0 }, 'rating'],
    ['calificación con decimales', { ...ok, rating: 4.5 }, 'rating'],
    ['calificación como texto', { ...ok, rating: '5' }, 'rating'],
    ['opinión de menos de 10 caracteres', { ...ok, quote: 'Corta' }, 'quote'],
    ['opinión de más de 800 caracteres', { ...ok, quote: 'x'.repeat(801) }, 'quote'],
    ['nombre vacío', { ...ok, name: '   ' }, 'name'],
    ['foto con javascript:', { ...ok, photoUrl: 'javascript:alert(1)' }, 'photoUrl'],
    ['foto con //otro-dominio', { ...ok, photoUrl: '//evil.example/a.jpg' }, 'photoUrl'],
    ['foto con ruta relativa', { ...ok, photoUrl: 'img/a.jpg' }, 'photoUrl'],
  ];
  for (const [nombre, body, campo] of casos) {
    const res = await admin.request('/testimonials/admin', { method: 'POST', body });
    check(
      `Rechaza ${nombre}`,
      res.status === 400 && res.data?.details?.some((d) => d.field === campo),
      `recibido ${res.status} ${JSON.stringify(res.data?.details ?? res.data)}`,
    );
  }

  const conHttps = await admin.request('/testimonials/admin', {
    method: 'POST',
    body: { ...ok, photoUrl: 'https://example.com/foto.jpg' },
  });
  check('Acepta una foto https', conHttps.status === 201);

  const masivo = await admin.request('/testimonials/admin', {
    method: 'POST',
    body: { ...ok, published: true, sortOrder: -50, id: 'inyectado', createdAt: '2000-01-01T00:00:00Z' },
  });
  check(
    'Ignora campos que no son del formulario (sortOrder, id, createdAt)',
    masivo.status === 201 && masivo.data.testimonial.id !== 'inyectado' && masivo.data.testimonial.sortOrder >= 0,
  );
}

// ── 4. Permisos ─────────────────────────────────────────────────────
console.log('\n4. Permisos');
let client;
{
  client = createSession();
  await client.request('/health');
  const reg = await client.request('/auth/register', {
    method: 'POST',
    body: { fullName: 'Prueba Testimonios', email: clientEmail, password: clientPassword },
  });
  client.setToken(reg.data?.accessToken);
  check('Se registra una clienta de prueba', reg.status === 201, `recibido ${reg.status}: ${reg.data?.error ?? ''}`);

  const rutas = [
    ['GET', '/testimonials/admin/all'],
    ['POST', '/testimonials/admin', { name: 'X', quote: 'Intento sin permisos.' }],
    ['PATCH', `/testimonials/admin/${live.id}`, { published: false }],
    ['PUT', '/testimonials/admin/order', { ids: [live.id] }],
    ['DELETE', `/testimonials/admin/${live.id}`],
  ];
  for (const [method, path, body] of rutas) {
    const comoClienta = await client.request(path, { method, body });
    check(`Una clienta recibe 403 en ${method} ${path.replace(live.id, ':id')}`, comoClienta.status === 403, `recibido ${comoClienta.status}`);
    const sinSesion = await guest.request(path, { method, body });
    check(`Sin sesión se recibe 401 en ${method} ${path.replace(live.id, ':id')}`, sinSesion.status === 401, `recibido ${sinSesion.status}`);
  }

  const sinCsrf = await admin.request('/testimonials/admin', {
    method: 'POST',
    body: { name: `${PREFIX} csrf`, quote: 'Esto no debería guardarse.' },
    noCsrf: true,
  });
  check('Sin token CSRF la administradora tampoco escribe', sinCsrf.status === 403 && sinCsrf.data?.code === 'CSRF_INVALID');
}

// ── 5. Borrado ──────────────────────────────────────────────────────
console.log('\n5. Borrado');
{
  const borrar = await admin.request(`/testimonials/admin/${draft.id}`, { method: 'DELETE' });
  check('La administradora elimina un testimonio', borrar.status === 200);
  check('Ya no aparece en la web', !ids((await guest.request('/testimonials')).data.testimonials).includes(draft.id));

  const otraVez = await admin.request(`/testimonials/admin/${draft.id}`, { method: 'DELETE' });
  check('Eliminar uno que ya no existe da 404', otraVez.status === 404);
}

// ── 6. Cambio de correo ─────────────────────────────────────────────
console.log('\n6. Cambio de correo');
const newEmail = `testimonios.nuevo.${suffix}@ejemplo.test`;
{
  // Una segunda sesión de la misma clienta, como si estuviera en otro equipo.
  const { session: otroEquipo } = await loginAs(clientEmail, clientPassword);

  const sinSesion = await guest.request('/auth/change-email', {
    method: 'POST',
    body: { currentPassword: clientPassword, newEmail },
  });
  check('Sin sesión no se puede cambiar el correo', sinSesion.status === 401);

  const malaClave = await client.request('/auth/change-email', {
    method: 'POST',
    body: { currentPassword: 'NoEsLaClave123', newEmail },
  });
  check(
    'Con la contraseña actual incorrecta se rechaza',
    malaClave.status === 400 && malaClave.data?.details?.some((d) => d.field === 'currentPassword'),
    `recibido ${malaClave.status}`,
  );

  const ocupado = await client.request('/auth/change-email', {
    method: 'POST',
    body: { currentPassword: clientPassword, newEmail: ADMIN_EMAIL },
  });
  check('No se puede usar un correo de otra cuenta', ocupado.status === 409, `recibido ${ocupado.status}`);

  const mismo = await client.request('/auth/change-email', {
    method: 'POST',
    body: { currentPassword: clientPassword, newEmail: clientEmail.toUpperCase() },
  });
  check('Escribir el mismo correo (en mayúsculas) se rechaza', mismo.status === 400);

  const invalido = await client.request('/auth/change-email', {
    method: 'POST',
    body: { currentPassword: clientPassword, newEmail: 'esto-no-es-un-correo' },
  });
  check('Un correo mal escrito se rechaza', invalido.status === 400);

  const cambio = await client.request('/auth/change-email', {
    method: 'POST',
    body: { currentPassword: clientPassword, newEmail: `  ${newEmail.toUpperCase()} ` },
  });
  check('Con la contraseña correcta se cambia', cambio.status === 200 && cambio.data.user?.email === newEmail,
    `recibido ${cambio.status}: ${cambio.data?.error ?? ''}`);
  check('Devuelve un token nuevo con el correo nuevo', Boolean(cambio.data?.accessToken));
  client.setToken(cambio.data?.accessToken);

  const yo = await client.request('/auth/me');
  check('/auth/me ya muestra el correo nuevo', yo.data?.user?.email === newEmail);

  const sigue = await client.request('/auth/refresh', { method: 'POST' });
  check('La sesión de este navegador sigue viva', sigue.status === 200);
  if (sigue.data?.accessToken) client.setToken(sigue.data.accessToken);

  const otra = await otroEquipo.request('/auth/refresh', { method: 'POST' });
  check('La sesión del otro equipo quedó cerrada', otra.status === 401, `recibido ${otra.status}`);

  // El intento del otro equipo no debe tumbar esta sesión por la
  // detección de reutilización de tokens.
  const despues = await client.request('/auth/refresh', { method: 'POST' });
  check('Ese intento no cierra la sesión de este navegador', despues.status === 200, `recibido ${despues.status}`);
  if (despues.data?.accessToken) client.setToken(despues.data.accessToken);

  const viejo = await loginAs(clientEmail, clientPassword);
  check('Con el correo anterior ya no se entra', viejo.res.status === 401);
  const nuevo = await loginAs(newEmail, clientPassword);
  check('Con el correo nuevo sí', nuevo.res.status === 200);
}

// ── 7. Cambio de contraseña ─────────────────────────────────────────
console.log('\n7. Cambio de contraseña');
{
  const nuevaClave = 'Clienta.2026Cambiada';

  const mala = await client.request('/auth/change-password', {
    method: 'POST',
    body: { currentPassword: 'NoEsLaClave123', newPassword: nuevaClave },
  });
  check('Con la contraseña actual incorrecta se rechaza', mala.status === 400 && mala.data?.code === 'WRONG_PASSWORD');

  const debil = await client.request('/auth/change-password', {
    method: 'POST',
    body: { currentPassword: clientPassword, newPassword: 'corta' },
  });
  check('Una contraseña nueva débil se rechaza', debil.status === 400);

  const ok = await client.request('/auth/change-password', {
    method: 'POST',
    body: { currentPassword: clientPassword, newPassword: nuevaClave },
  });
  check('Con la contraseña correcta se cambia', ok.status === 200);

  const refresco = await client.request('/auth/refresh', { method: 'POST' });
  check('Cambiar la contraseña cierra también esta sesión', refresco.status === 401);

  check('La contraseña anterior ya no sirve', (await loginAs(newEmail, clientPassword)).res.status === 401);
  check('La nueva sí', (await loginAs(newEmail, nuevaClave)).res.status === 200);
}

// ── Limpieza ────────────────────────────────────────────────────────
console.log('\nLimpiando datos de prueba…');
try {
  await prisma.testimonial.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@ejemplo.test' } } });

  // Devuelve el orden real que había antes de la prueba.
  if (originalOrder.length) {
    await prisma.$transaction(
      originalOrder.map((id, index) =>
        prisma.testimonial.updateMany({ where: { id }, data: { sortOrder: index } }),
      ),
    );
  }
  console.log('  Listo.');
} catch (error) {
  console.log(`  Aviso al limpiar: ${error.message}`);
}

console.log(`\n\x1b[1m${passed} comprobaciones correctas, ${failed} fallidas.\x1b[0m\n`);

server.close();
await prisma.$disconnect();
process.exit(failed === 0 ? 0 : 1);
