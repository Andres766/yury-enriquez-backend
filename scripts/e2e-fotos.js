/**
 * Prueba de integración de la biblioteca de fotos y de Cloudinary.
 *
 * Cubre:
 *  · /api/media: permisos (invitada 401, clienta 403, CSRF), firma de
 *    subida que se puede recalcular y que no filtra el secreto; 503
 *    MEDIA_DISABLED cuando falta la configuración.
 *  · /api/photos: alta con la respuesta de Cloudinary (firma correcta,
 *    firma falsa, URL de otro dominio o de otra nube, public_id fuera de
 *    la carpeta), edición con validación, listado público (campos,
 *    orden, oculta las que no van en la galería), orden y borrado (409
 *    con los usos; con force=1 quita las referencias y llama a destroy).
 *  · Ajustes: foto del inicio y de «Sobre mí» (incluye "//evil").
 *  · Servicios: punto de enfoque de las fotos.
 *
 * NUNCA llama a Cloudinary de verdad: usa credenciales inventadas y
 * reemplaza globalThis.fetch para interceptar api.cloudinary.com. El
 * resto de peticiones (las que van a la API local) pasan normal.
 *
 * Requiere la base sembrada y la administradora del seed:
 *     NODE_ENV=development node scripts/e2e-fotos.js
 *
 * Crea datos de prueba (fotos "e2e-…", un servicio y una ocasión
 * "Prueba e2e fotos", una clienta @ejemplo.test), los limpia al
 * terminar y deja como estaban el orden de la galería y las fotos del
 * inicio.
 */
import crypto from 'node:crypto';

// Credenciales inventadas ANTES de cargar la app: env.js las lee al importarse.
const CLOUD = 'nube-e2e';
const API_KEY = '123456789012345';
const API_SECRET = 'secreto-e2e-que-no-debe-salir-nunca';
const FOLDER = 'yury-e2e';
process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
process.env.CLOUDINARY_API_KEY = API_KEY;
process.env.CLOUDINARY_API_SECRET = API_SECRET;
process.env.CLOUDINARY_FOLDER = FOLDER;

const { createApp } = await import('../src/app.js');
const { default: prisma } = await import('../src/lib/prisma.js');
const { default: env } = await import('../src/config/env.js');
const { invalidateSettingsCache } = await import('../src/modules/settings/settings.service.js');

// ── fetch interceptado ──────────────────────────────────────────────
const realFetch = globalThis.fetch;
const cloudinaryCalls = [];
/** public_id para los que el "Cloudinary" de mentira responde con error. */
const failDestroyFor = new Set();
/** public_id → carpeta, para la consulta de carpetas dinámicas (Admin API). */
const assetFolders = new Map();
const folderLookups = [];

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (new URL(url).hostname === 'api.cloudinary.com') {
    const resource = new URL(url).pathname.split('/resources/image/upload/')[1];
    if (resource) {
      const pid = resource.split('/').map(decodeURIComponent).join('/');
      folderLookups.push({ url, auth: init.headers?.Authorization });
      return new Response(JSON.stringify({ public_id: pid, asset_folder: assetFolders.get(pid) ?? 'otra-carpeta' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const params = Object.fromEntries(new URLSearchParams(String(init.body ?? '')));
    cloudinaryCalls.push({ url, method: init.method, params });
    if (failDestroyFor.has(params.public_id)) {
      return new Response(JSON.stringify({ error: { message: 'Fallo simulado' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ result: 'ok' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return realFetch(input, init);
};

const app = createApp();
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

const PREFIX = 'Prueba e2e fotos';
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

const sha1 = (text) => crypto.createHash('sha1').update(text).digest('hex');

/** Sesión con tarro de cookies y CSRF, como haría un navegador. */
function createSession() {
  const jar = new Map();
  let accessToken = null;

  return {
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
      return { status: res.status, data, text };
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

const ids = (list) => (list ?? []).map((p) => p.id);
const fieldOf = (res) => (res.data?.details ?? []).map((d) => d.field);

/** Respuesta de subida como la que devolvería Cloudinary, bien firmada. */
const suffix = Date.now().toString(36);
let uploadCounter = 0;
function fakeUpload({ publicId, version = 1760000000 + uploadCounter, cloud = CLOUD, secret = API_SECRET } = {}) {
  uploadCounter += 1;
  const pid = publicId ?? `${FOLDER}/e2e-${suffix}-${uploadCounter}`;
  return {
    public_id: pid,
    version,
    signature: sha1(`public_id=${pid}&version=${version}${secret}`),
    secure_url: `https://res.cloudinary.com/${cloud}/image/upload/v${version}/${pid}.jpg`,
    width: 1200,
    height: 1600,
    bytes: 345_678,
    format: 'jpg',
  };
}

console.log('\nPrueba de la biblioteca de fotos\n');

const guest = createSession();
await guest.request('/health');

const { session: admin, res: adminLogin } = await loginAs(ADMIN_EMAIL, ADMIN_PASSWORD);
if (adminLogin.status !== 200) {
  console.error(`\n✖ La administradora del seed no pudo iniciar sesión (${adminLogin.status}). Revisa SEED_ADMIN_*.\n`);
  server.close();
  await prisma.$disconnect();
  process.exit(1);
}

// Estado real antes de empezar, para devolverlo igual al terminar.
const originalOrder = ids((await admin.request('/photos/admin')).data?.photos);
const originalSettings = await prisma.settings.findUnique({
  where: { id: 1 },
  select: {
    heroImageUrl: true,
    heroImageAlt: true,
    heroImageFocus: true,
    aboutImageUrl: true,
    aboutImageAlt: true,
    aboutImageFocus: true,
  },
});

const clientEmail = `fotos.${suffix}@ejemplo.test`;
const created = []; // ids de fotos creadas por la prueba
let serviceId = null;
let serviceSlug = null;
let occasionId = null;

try {
  // ── 1. Permisos ─────────────────────────────────────────────────────
  console.log('1. Permisos de /api/media y /api/photos/admin');
  const client = createSession();
  await client.request('/health');
  const reg = await client.request('/auth/register', {
    method: 'POST',
    body: { fullName: 'Prueba Fotos', email: clientEmail, password: 'Clienta.2026Prueba' },
  });
  client.setToken(reg.data?.accessToken);
  check('Se registra una clienta de prueba', reg.status === 201, `recibido ${reg.status}: ${reg.data?.error ?? ''}`);

  const rutas = [
    ['GET', '/media/config'],
    ['POST', '/media/sign'],
    ['GET', '/photos/admin'],
    ['POST', '/photos/admin', fakeUpload()],
    ['PUT', '/photos/admin/order', { ids: ['cnoexiste000000000000000'] }],
    ['PATCH', '/photos/admin/cnoexiste000000000000000', { alt: 'x' }],
    ['DELETE', '/photos/admin/cnoexiste000000000000000'],
  ];
  for (const [method, path, body] of rutas) {
    const sinSesion = await guest.request(path, { method, body });
    check(`Sin sesión: 401 en ${method} ${path}`, sinSesion.status === 401, `recibido ${sinSesion.status}`);
    const comoClienta = await client.request(path, { method, body });
    check(`Clienta: 403 en ${method} ${path}`, comoClienta.status === 403, `recibido ${comoClienta.status}`);
  }

  const sinCsrf = await admin.request('/media/sign', { method: 'POST', noCsrf: true });
  check('Sin token CSRF no se firma', sinCsrf.status === 403 && sinCsrf.data?.code === 'CSRF_INVALID');

  // ── 2. Configuración y firma ────────────────────────────────────────
  console.log('\n2. Configuración y firma de subida');
  {
    const config = await admin.request('/media/config');
    check(
      'GET /media/config dice que está activo, con nube, carpeta y tope de 10 MB',
      config.status === 200 &&
        config.data.enabled === true &&
        config.data.cloudName === CLOUD &&
        config.data.folder === FOLDER &&
        config.data.maxBytes === 10_485_760,
      JSON.stringify(config.data),
    );
    check('La configuración no expone la api key ni el secreto', !config.text.includes(API_SECRET) && !config.text.includes(API_KEY));

    const firma = await admin.request('/media/sign', { method: 'POST' });
    const f = firma.data ?? {};
    check(
      'POST /media/sign devuelve nube, api key, timestamp, carpeta y firma',
      firma.status === 200 && f.cloudName === CLOUD && f.apiKey === API_KEY && f.folder === FOLDER && Number.isInteger(f.timestamp),
      JSON.stringify(f),
    );
    check(
      'El timestamp es el de ahora (segundos)',
      Math.abs(f.timestamp - Math.floor(Date.now() / 1000)) < 60,
    );
    check(
      'La firma es sha1("folder=…&timestamp=…" + secreto)',
      f.signature === sha1(`folder=${FOLDER}&timestamp=${f.timestamp}${API_SECRET}`),
      `recibido ${f.signature}`,
    );
    check('La firma no expone el secreto', !firma.text.includes(API_SECRET));
  }

  // ── 3. Alta de fotos ────────────────────────────────────────────────
  console.log('\n3. Alta de fotos (respuesta de Cloudinary)');
  let a;
  let b;
  let hidden;
  {
    const lastBefore = await prisma.photo.aggregate({ _max: { sortOrder: true } });

    const upA = fakeUpload();
    const resA = await admin.request('/photos/admin', {
      method: 'POST',
      body: { ...upA, alt: '  Novia   con recogido  ', category: 'novias', focus: '40% 30%' },
    });
    a = resA.data?.photo;
    if (a?.id) created.push(a.id);
    check('Con la firma de Cloudinary correcta: 201', resA.status === 201 && Boolean(a?.id), `recibido ${resA.status}: ${JSON.stringify(resA.data)}`);
    check('Guarda public_id, URL y medidas', a?.publicId === upA.public_id && a?.url === upA.secure_url && a?.width === 1200 && a?.height === 1600 && a?.bytes === 345_678);
    check('Limpia el texto alternativo', a?.alt === 'Novia con recogido');
    check('Una foto nueva va al final', a?.sortOrder === (lastBefore._max.sortOrder ?? -1) + 1, `sortOrder ${a?.sortOrder}`);
    check('Valores por defecto: en galería, sin destacar, sin menor', a?.inGallery === true && a?.featured === false && a?.minor === false);

    const repetida = await admin.request('/photos/admin', { method: 'POST', body: upA });
    check('Reenviar la misma subida no la duplica', repetida.status === 200 && repetida.data?.photo?.id === a?.id);

    const resB = await admin.request('/photos/admin', { method: 'POST', body: { ...fakeUpload(), category: 'social' } });
    b = resB.data?.photo;
    if (b?.id) created.push(b.id);
    check('Se sube una segunda foto', resB.status === 201 && b?.sortOrder > a?.sortOrder);

    const resH = await admin.request('/photos/admin', {
      method: 'POST',
      body: { ...fakeUpload(), inGallery: false, alt: 'Solo para un servicio' },
    });
    hidden = resH.data?.photo;
    if (hidden?.id) created.push(hidden.id);
    check('Se sube una foto que no va en la galería', resH.status === 201 && hidden?.inGallery === false);

    const malFirmada = fakeUpload();
    malFirmada.signature = sha1('otra cosa');
    const resMal = await admin.request('/photos/admin', { method: 'POST', body: malFirmada });
    check('Firma equivocada: 400', resMal.status === 400 && resMal.data?.code === 'UPLOAD_SIGNATURE_INVALID', `recibido ${resMal.status} ${resMal.data?.code}`);

    const otroSecreto = fakeUpload({ secret: 'secreto-de-otra-cuenta' });
    const resSecreto = await admin.request('/photos/admin', { method: 'POST', body: otroSecreto });
    check('Firmada con el secreto de otra cuenta: 400', resSecreto.status === 400);

    const ajena = fakeUpload();
    ajena.secure_url = `https://evil.example/image/upload/v1/${ajena.public_id}.jpg`;
    const resAjena = await admin.request('/photos/admin', { method: 'POST', body: ajena });
    check('URL de otro dominio: 400', resAjena.status === 400 && resAjena.data?.code === 'UPLOAD_URL_INVALID', `recibido ${resAjena.status} ${resAjena.data?.code}`);

    const otraNube = fakeUpload({ cloud: 'otra-nube' });
    const resNube = await admin.request('/photos/admin', { method: 'POST', body: otraNube });
    check('URL de otra nube de Cloudinary: 400', resNube.status === 400 && resNube.data?.code === 'UPLOAD_URL_INVALID');

    const otraFoto = fakeUpload();
    otraFoto.secure_url = `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${FOLDER}/otra-foto.jpg`;
    const resOtra = await admin.request('/photos/admin', { method: 'POST', body: otraFoto });
    check('URL de una foto distinta a la firmada: 400', resOtra.status === 400 && resOtra.data?.code === 'UPLOAD_URL_INVALID');

    const conPuntos = fakeUpload();
    conPuntos.secure_url = `https://res.cloudinary.com/${CLOUD}/image/upload/../../otra-nube/image/upload/v${conPuntos.version}/${conPuntos.public_id}.jpg`;
    const resPuntos = await admin.request('/photos/admin', { method: 'POST', body: conPuntos });
    check('URL que salta a otra nube con "..": 400', resPuntos.status === 400 && resPuntos.data?.code === 'UPLOAD_URL_INVALID', `recibido ${resPuntos.status} ${resPuntos.data?.code}`);

    const otraVersion = fakeUpload();
    otraVersion.secure_url = `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${otraVersion.public_id}.jpg`;
    const resVersion = await admin.request('/photos/admin', { method: 'POST', body: otraVersion });
    check('URL con una versión distinta a la firmada: 400', resVersion.status === 400 && resVersion.data?.code === 'UPLOAD_URL_INVALID');

    const fuera = fakeUpload({ publicId: `otra-carpeta/e2e-${suffix}` });
    const resFuera = await admin.request('/photos/admin', { method: 'POST', body: fuera });
    check('public_id fuera de la carpeta: 400', resFuera.status === 400 && resFuera.data?.code === 'UPLOAD_FOLDER_INVALID', `recibido ${resFuera.status} ${resFuera.data?.code}`);

    // Carpetas dinámicas (cuentas nuevas): public_id sin «carpeta/»,
    // pero Cloudinary confirma que quedó en nuestra carpeta.
    const dinamica = fakeUpload({ publicId: `e2e-dinamica-${suffix}` });
    assetFolders.set(dinamica.public_id, FOLDER);
    const resDinamica = await admin.request('/photos/admin', { method: 'POST', body: dinamica });
    if (resDinamica.data?.photo?.id) created.push(resDinamica.data.photo.id);
    const consulta = folderLookups.find((c) => c.url.includes(`/resources/image/upload/e2e-dinamica-${suffix}`));
    check('Carpetas dinámicas: sin prefijo pero en nuestra carpeta: 201', resDinamica.status === 201, `recibido ${resDinamica.status} ${resDinamica.data?.code}`);
    check('La consulta de carpeta usa la clave secreta (Basic) y no la expone', Boolean(consulta?.auth?.startsWith('Basic ')) && !JSON.stringify(resDinamica.data).includes(API_SECRET));
    if (resDinamica.data?.photo?.id) await prisma.photo.delete({ where: { id: resDinamica.data.photo.id } });

    const dinamicaAjena = fakeUpload({ publicId: `e2e-ajena-${suffix}` });
    const resDinAjena = await admin.request("/photos/admin", { method: "POST", body: dinamicaAjena });
    check("Carpetas dinámicas: sin prefijo y en otra carpeta: 400", resDinAjena.status === 400 && resDinAjena.data?.code === "UPLOAD_FOLDER_INVALID", `recibido ${resDinAjena.status} ${resDinAjena.data?.code}`);

    const prefijo = fakeUpload({ publicId: `${FOLDER}-falsa/e2e-${suffix}` });
    const resPrefijo = await admin.request('/photos/admin', { method: 'POST', body: prefijo });
    check('Carpeta que solo empieza igual ("yury-e2e-falsa/"): 400', resPrefijo.status === 400);

    const malMeta = await admin.request('/photos/admin', { method: 'POST', body: { ...fakeUpload(), category: 'bodas' } });
    check('Alta con categoría inexistente: 400', malMeta.status === 400 && fieldOf(malMeta).includes('category'));

    const total = await prisma.photo.count({ where: { publicId: { startsWith: `${FOLDER}/e2e-${suffix}` } } });
    check('Solo quedaron guardadas las tres fotos válidas', total === 3, `hay ${total}`);
  }

  // ── 4. Edición ──────────────────────────────────────────────────────
  console.log('\n4. Edición de una foto');
  {
    const ok = await admin.request(`/photos/admin/${b.id}`, {
      method: 'PATCH',
      body: { alt: 'Maquillaje social\ncon brillo', category: 'temporada', featured: true, focus: '0% 100%', credit: 'Foto: prueba', minor: true },
    });
    const p = ok.data?.photo;
    check('PATCH válido guarda todo', ok.status === 200 && p?.category === 'temporada' && p?.featured === true && p?.focus === '0% 100%' && p?.credit === 'Foto: prueba' && p?.minor === true);
    check('El texto alternativo queda en una sola línea', p?.alt === 'Maquillaje social con brillo', JSON.stringify(p?.alt));

    const quitar = await admin.request(`/photos/admin/${b.id}`, { method: 'PATCH', body: { category: null, credit: '' } });
    check('Se puede quitar la categoría y el crédito', quitar.status === 200 && quitar.data.photo.category === null && quitar.data.photo.credit === null);
    check('Un PATCH parcial no toca lo demás', quitar.data?.photo?.featured === true && quitar.data?.photo?.focus === '0% 100%');

    const casos = [
      ['categoría inexistente', { category: 'bodas' }, 'category'],
      ['enfoque sin la segunda coordenada', { focus: '50%' }, 'focus'],
      ['enfoque por encima de 100', { focus: '101% 0%' }, 'focus'],
      ['enfoque con texto', { focus: 'center; color:red' }, 'focus'],
      ['texto alternativo de más de 200', { alt: 'x'.repeat(201) }, 'alt'],
      ['crédito de más de 120', { credit: 'x'.repeat(121) }, 'credit'],
      ['inGallery que no es sí/no', { inGallery: 'si' }, 'inGallery'],
    ];
    for (const [nombre, body, campo] of casos) {
      const res = await admin.request(`/photos/admin/${b.id}`, { method: 'PATCH', body });
      check(`Rechaza ${nombre}`, res.status === 400 && fieldOf(res).includes(campo), `recibido ${res.status} ${JSON.stringify(res.data?.details ?? res.data)}`);
    }

    const vacio = await admin.request(`/photos/admin/${b.id}`, { method: 'PATCH', body: {} });
    check('PATCH sin cambios: 400', vacio.status === 400);

    const inyectado = await admin.request(`/photos/admin/${b.id}`, {
      method: 'PATCH',
      body: { alt: 'Ok', url: 'https://evil.example/x.jpg', publicId: 'x', sortOrder: -5 },
    });
    check(
      'Ignora url, publicId y sortOrder en la edición',
      inyectado.status === 200 && inyectado.data.photo.url === b.url && inyectado.data.photo.publicId === b.publicId && inyectado.data.photo.sortOrder === b.sortOrder,
    );

    const noExiste = await admin.request('/photos/admin/cnoexiste000000000000000', { method: 'PATCH', body: { alt: 'x' } });
    check('Editar una foto que no existe: 404', noExiste.status === 404);
  }

  // ── 5. Listado público ──────────────────────────────────────────────
  console.log('\n5. Listado público');
  {
    const pub = await guest.request('/photos');
    const lista = pub.data?.photos ?? [];
    check('GET /photos responde a cualquiera', pub.status === 200 && Array.isArray(lista));
    const vista = lista.find((p) => p.id === a.id);
    check(
      'Solo expone los campos de la web',
      vista && Object.keys(vista).sort().join(',') === 'alt,category,credit,featured,focus,height,id,minor,url,width',
      vista ? Object.keys(vista).sort().join(',') : 'no aparece',
    );
    check('Oculta las fotos que no van en la galería', !ids(lista).includes(hidden.id));
    const posA = ids(lista).indexOf(a.id);
    check(
      'Las nuevas salen después de las que ya estaban',
      posA >= 0 && ids(lista).filter((id) => originalOrder.includes(id)).every((id) => ids(lista).indexOf(id) < posA),
    );
    check('Respeta el orden (a antes que b)', ids(lista).indexOf(a.id) < ids(lista).indexOf(b.id));

    const panel = await admin.request('/photos/admin');
    const enPanel = panel.data?.photos?.find((p) => p.id === hidden.id);
    check('El panel sí lista la oculta, con todos sus campos y usedBy', Boolean(enPanel) && Array.isArray(enPanel.usedBy) && 'publicId' in enPanel && 'inGallery' in enPanel);
  }

  // ── 6. Orden ────────────────────────────────────────────────────────
  console.log('\n6. Orden');
  {
    const actual = ids((await admin.request('/photos/admin')).data.photos);
    const sinPrueba = actual.filter((id) => !created.includes(id));
    const nuevo = [b.id, ...sinPrueba, a.id, hidden.id];

    const ordenar = await admin.request('/photos/admin/order', { method: 'PUT', body: { ids: nuevo } });
    check('Reordenar responde { ok: true }', ordenar.status === 200 && ordenar.data?.ok === true, `recibido ${ordenar.status} ${JSON.stringify(ordenar.data)}`);
    const panel = ids((await admin.request('/photos/admin')).data.photos);
    check('El panel queda en el orden pedido', panel.join() === nuevo.join());
    const publico = ids((await guest.request('/photos')).data.photos);
    check('La web pone primero la que se subió', publico[0] === b.id && publico.indexOf(a.id) > publico.indexOf(b.id));

    const repetidos = await admin.request('/photos/admin/order', { method: 'PUT', body: { ids: [a.id, a.id] } });
    check('Rechaza ids repetidos', repetidos.status === 400);
    const fantasma = await admin.request('/photos/admin/order', { method: 'PUT', body: { ids: [a.id, 'cnoexiste000000000000000'] } });
    check('Rechaza un id que no existe', fantasma.status === 400);
    const raro = await admin.request('/photos/admin/order', { method: 'PUT', body: { ids: ['../../etc'] } });
    check('Rechaza un id con formato inválido', raro.status === 400);
    const vacia = await admin.request('/photos/admin/order', { method: 'PUT', body: { ids: [] } });
    check('Rechaza una lista vacía', vacia.status === 400);
  }

  // ── 7. Ajustes: foto del inicio y de «Sobre mí» ─────────────────────
  console.log('\n7. Ajustes: fotos del inicio');
  {
    const casos = [
      ['URL "//evil"', { heroImageUrl: '//evil.example/x.jpg' }, 'heroImageUrl'],
      ['URL "/\\evil"', { aboutImageUrl: '/\\evil.example/x.jpg' }, 'aboutImageUrl'],
      ['URL javascript:', { heroImageUrl: 'javascript:alert(1)' }, 'heroImageUrl'],
      ['URL relativa sin "/"', { heroImageUrl: 'img/x.jpg' }, 'heroImageUrl'],
      ['enfoque inválido', { heroImageFocus: '50% 101%' }, 'heroImageFocus'],
      ['texto alternativo de más de 200', { aboutImageAlt: 'x'.repeat(201) }, 'aboutImageAlt'],
    ];
    for (const [nombre, body, campo] of casos) {
      const res = await admin.request('/settings/admin', { method: 'PATCH', body });
      check(`Rechaza ${nombre}`, res.status === 400 && fieldOf(res).includes(campo), `recibido ${res.status} ${JSON.stringify(res.data?.details ?? res.data)}`);
    }

    const ok = await admin.request('/settings/admin', {
      method: 'PATCH',
      body: {
        heroImageUrl: a.url,
        heroImageAlt: ' Novia sonriendo ',
        heroImageFocus: '40% 30%',
        aboutImageUrl: '/img/trabajos/prueba-e2e-960.webp',
        aboutImageAlt: '',
        aboutImageFocus: '',
      },
    });
    const s = ok.data?.settings;
    check('Guarda la foto del inicio (Cloudinary) y la de «Sobre mí» (ruta del sitio)', ok.status === 200 && s?.heroImageUrl === a.url && s?.aboutImageUrl === '/img/trabajos/prueba-e2e-960.webp', `recibido ${ok.status} ${JSON.stringify(ok.data?.details ?? '')}`);
    check('Vacío se guarda como null', s?.aboutImageAlt === null && s?.aboutImageFocus === null);
    check('Limpia el texto alternativo', s?.heroImageAlt === 'Novia sonriendo');

    const pub = (await guest.request('/settings')).data?.settings ?? {};
    check(
      'GET /settings expone los seis campos',
      pub.heroImageUrl === a.url && pub.heroImageAlt === 'Novia sonriendo' && pub.heroImageFocus === '40% 30%' &&
        pub.aboutImageUrl === '/img/trabajos/prueba-e2e-960.webp' && 'aboutImageAlt' in pub && 'aboutImageFocus' in pub,
      JSON.stringify(pub).slice(0, 300),
    );
  }

  // ── 8. Servicios: enfoque de las fotos ──────────────────────────────
  console.log('\n8. Servicios: enfoque de las fotos');
  {
    const servicio = {
      name: `${PREFIX} ${suffix}`,
      category: 'MAQUILLAJE',
      shortDescription: 'Servicio de prueba de fotos',
      description: 'Se borra al terminar la prueba.',
      durationMinutes: 60,
      priceCents: 1_000_000,
      active: false,
    };

    const malo = await admin.request('/services/admin', {
      method: 'POST',
      body: { ...servicio, images: [{ url: a.url, alt: 'Foto', focus: '120% 50%' }] },
    });
    check('Rechaza un enfoque fuera de rango', malo.status === 400 && fieldOf(malo).some((f) => f.startsWith('images.0.focus')), JSON.stringify(malo.data?.details));

    const malo2 = await admin.request('/services/admin', {
      method: 'POST',
      body: { ...servicio, images: [{ url: a.url, alt: 'Foto', focus: '50%50%' }] },
    });
    check('Rechaza un enfoque mal escrito', malo2.status === 400);

    const creado = await admin.request('/services/admin', {
      method: 'POST',
      body: {
        ...servicio,
        images: [
          { url: a.url, alt: 'Foto con enfoque', focus: '30% 70%' },
          { url: '/img/trabajos/prueba-e2e-960.webp', alt: 'Foto sin enfoque' },
        ],
      },
    });
    serviceId = creado.data?.service?.id;
    serviceSlug = creado.data?.service?.slug;
    const imgs = creado.data?.service?.images ?? [];
    check('Acepta un enfoque válido', creado.status === 201 && imgs[0]?.focus === '30% 70%', `recibido ${creado.status} ${JSON.stringify(creado.data?.details ?? imgs)}`);
    check('Sin enfoque queda en el centro', imgs[1]?.focus === '50% 50%');

    const editado = await admin.request(`/services/admin/${serviceId}`, {
      method: 'PATCH',
      body: { active: true, images: [{ url: a.url, alt: 'Foto con enfoque', focus: '10% 20%' }] },
    });
    check('Editar las fotos del servicio guarda el enfoque', editado.status === 200 && editado.data.service.images[0]?.focus === '10% 20%');

    const pub = await guest.request(`/services/${serviceSlug}`);
    check('El JSON público del servicio incluye images[].focus', pub.status === 200 && pub.data?.service?.images?.[0]?.focus === '10% 20%');
  }

  // ── 9. Borrado ──────────────────────────────────────────────────────
  console.log('\n9. Borrado');
  {
    const occ = await admin.request('/occasions/admin', {
      method: 'POST',
      body: {
        slug: `e2e-fotos-${suffix}`,
        name: `${PREFIX} ocasión`,
        tagline: 'Ocasión de prueba',
        description: 'Se borra al terminar la prueba.',
        heroImage: a.url,
        active: false,
      },
    });
    occasionId = occ.data?.occasion?.id;
    check('Se crea una ocasión con la foto de portada', occ.status === 201 && Boolean(occasionId), `recibido ${occ.status}`);

    const enPanel = (await admin.request('/photos/admin')).data.photos.find((p) => p.id === a.id);
    const tipos = (enPanel?.usedBy ?? []).map((u) => u.type).sort().join(',');
    check('El panel dice dónde se usa (inicio, ocasión y servicio)', tipos === 'hero,occasion,service', `usedBy: ${JSON.stringify(enPanel?.usedBy)}`);
    check(
      'Los usos traen id y nombre',
      enPanel?.usedBy?.some((u) => u.type === 'service' && u.id === serviceId && u.name === `${PREFIX} ${suffix}`) &&
        enPanel?.usedBy?.some((u) => u.type === 'occasion' && u.id === occasionId),
    );

    const enUso = await admin.request(`/photos/admin/${a.id}`, { method: 'DELETE' });
    check('Borrar una foto en uso sin confirmar: 409 PHOTO_IN_USE', enUso.status === 409 && enUso.data?.code === 'PHOTO_IN_USE', `recibido ${enUso.status}`);
    check('El 409 trae la lista de usos', Array.isArray(enUso.data?.usedBy) && enUso.data.usedBy.length === 3);
    check('Y la foto sigue ahí', Boolean(await prisma.photo.findUnique({ where: { id: a.id } })));
    check('Sin confirmar no se llamó a Cloudinary', cloudinaryCalls.length === 0);

    const forzado = await admin.request(`/photos/admin/${a.id}?force=1`, { method: 'DELETE' });
    check('Con force=1 se borra', forzado.status === 200 && forzado.data?.ok === true && forzado.data?.cloudinaryDeleted === true, `recibido ${forzado.status} ${JSON.stringify(forzado.data)}`);
    check('La foto ya no está en la biblioteca', !(await prisma.photo.findUnique({ where: { id: a.id } })));

    const imagenes = await prisma.serviceImage.count({ where: { url: a.url } });
    check('La foto salió del servicio (fila de ServiceImage borrada)', imagenes === 0);
    const ocasion = await prisma.occasion.findUnique({ where: { id: occasionId } });
    check('La ocasión quedó sin portada', ocasion?.heroImage === null);
    const ajustes = await prisma.settings.findUnique({ where: { id: 1 } });
    check('El inicio volvió a su foto de serie (url, alt y enfoque en null)', ajustes.heroImageUrl === null && ajustes.heroImageAlt === null && ajustes.heroImageFocus === null);
    check('La foto de «Sobre mí» no se tocó', ajustes.aboutImageUrl === '/img/trabajos/prueba-e2e-960.webp');
    const pubSettings = (await guest.request('/settings')).data?.settings;
    check('La web pública ya no la muestra en el inicio (caché invalidada)', pubSettings?.heroImageUrl === null);

    const destroy = cloudinaryCalls.find((c) => c.url.endsWith('/image/destroy'));
    const prm = destroy?.params ?? {};
    check('Se llamó a destroy en la nube correcta', destroy?.url === `https://api.cloudinary.com/v1_1/${CLOUD}/image/destroy` && destroy?.method === 'POST');
    check('destroy lleva public_id, timestamp y api_key', prm.public_id === a.publicId && /^\d+$/.test(prm.timestamp ?? '') && prm.api_key === API_KEY);
    check(
      'destroy va firmado con sha1("public_id=…&timestamp=…" + secreto)',
      prm.signature === sha1(`public_id=${prm.public_id}&timestamp=${prm.timestamp}${API_SECRET}`),
    );
    check('destroy no manda el secreto', !Object.values(prm).includes(API_SECRET));

    // Si Cloudinary falla, la foto igual sale de la web y se avisa.
    failDestroyFor.add(hidden.publicId);
    const fallo = await admin.request(`/photos/admin/${hidden.id}`, { method: 'DELETE' });
    check(
      'Si Cloudinary falla, se borra igual y responde cloudinaryDeleted: false',
      fallo.status === 200 && fallo.data?.cloudinaryDeleted === false && !(await prisma.photo.findUnique({ where: { id: hidden.id } })),
      `recibido ${fallo.status} ${JSON.stringify(fallo.data)}`,
    );

    // Foto de la propia web (sin publicId): no se llama a Cloudinary.
    const local = await prisma.photo.create({ data: { url: `/img/trabajos/e2e-${suffix}-960.webp`, alt: 'Local de prueba' } });
    created.push(local.id);
    const antes = cloudinaryCalls.length;
    const borrarLocal = await admin.request(`/photos/admin/${local.id}`, { method: 'DELETE' });
    check(
      'Una foto de la web (sin Cloudinary) se borra sin llamar a destroy',
      borrarLocal.status === 200 && borrarLocal.data?.cloudinaryDeleted === null && cloudinaryCalls.length === antes,
      `recibido ${borrarLocal.status} ${JSON.stringify(borrarLocal.data)}`,
    );

    const otraVez = await admin.request(`/photos/admin/${a.id}`, { method: 'DELETE' });
    check('Borrar una que ya no existe: 404', otraVez.status === 404);
  }

  // ── 10. Sin configuración de Cloudinary ─────────────────────────────
  console.log('\n10. Sin configuración de Cloudinary');
  {
    // env.js ya se cargó; se apaga el secreto en el objeto de configuración,
    // que es lo que leen las rutas en cada petición.
    const secret = env.CLOUDINARY_API_SECRET;
    delete process.env.CLOUDINARY_API_SECRET;
    env.CLOUDINARY_API_SECRET = undefined;
    try {
      const config = await admin.request('/media/config');
      check('GET /media/config responde enabled: false', config.status === 200 && config.data?.enabled === false && config.data?.cloudName === null);
      const firma = await admin.request('/media/sign', { method: 'POST' });
      check('POST /media/sign: 503 MEDIA_DISABLED', firma.status === 503 && firma.data?.code === 'MEDIA_DISABLED', `recibido ${firma.status} ${firma.data?.code}`);
      const alta = await admin.request('/photos/admin', { method: 'POST', body: fakeUpload() });
      check('POST /photos/admin: 503 MEDIA_DISABLED', alta.status === 503 && alta.data?.code === 'MEDIA_DISABLED');
      const pub = await guest.request('/photos');
      check('La galería pública sigue funcionando', pub.status === 200 && Array.isArray(pub.data?.photos));
      const panel = await admin.request('/photos/admin');
      check('El panel sigue listando y editando', panel.status === 200 && (await admin.request(`/photos/admin/${b.id}`, { method: 'PATCH', body: { alt: 'Sin nube' } })).status === 200);
    } finally {
      env.CLOUDINARY_API_SECRET = secret;
      process.env.CLOUDINARY_API_SECRET = secret;
    }
  }
} catch (error) {
  failed += 1;
  console.log(`\n  \x1b[31m✖\x1b[0m Error inesperado: ${error.stack ?? error}`);
}

// ── Limpieza ────────────────────────────────────────────────────────
console.log('\nLimpiando datos de prueba…');
try {
  await prisma.photo.deleteMany({
    where: {
      OR: [
        { id: { in: created } },
        { publicId: { startsWith: `${FOLDER}/e2e-` } },
        { publicId: { startsWith: 'e2e-dinamica-' } },
        { url: { startsWith: '/img/trabajos/e2e-' } },
      ],
    },
  });
  if (serviceId) await prisma.service.deleteMany({ where: { id: serviceId } });
  await prisma.service.deleteMany({ where: { name: { startsWith: PREFIX } } });
  if (occasionId) await prisma.occasion.deleteMany({ where: { id: occasionId } });
  await prisma.occasion.deleteMany({ where: { slug: { startsWith: 'e2e-fotos-' } } });
  await prisma.user.deleteMany({ where: { email: clientEmail } });
  await prisma.settings.update({ where: { id: 1 }, data: originalSettings });
  invalidateSettingsCache();

  // Devuelve el orden real que tenía la galería antes de la prueba.
  if (originalOrder.length) {
    await prisma.$transaction(
      originalOrder.map((id, index) => prisma.photo.updateMany({ where: { id }, data: { sortOrder: index } })),
    );
  }
  console.log('  Listo.');
} catch (error) {
  console.log(`  Aviso al limpiar: ${error.message}`);
}

console.log(`\n\x1b[1m${passed} comprobaciones correctas, ${failed} fallidas.\x1b[0m\n`);

globalThis.fetch = realFetch;
server.close();
await prisma.$disconnect();
process.exit(failed === 0 ? 0 : 1);
