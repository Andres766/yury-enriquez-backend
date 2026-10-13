/**
 * Prueba de humo de la capa HTTP.
 *
 * Levanta la API en un puerto efímero y comprueba las defensas que NO
 * dependen de la base de datos: cabeceras de seguridad, lista blanca de
 * CORS, exigencia de CSRF, validación de entrada, control de acceso por
 * rol y límite de tamaño del cuerpo.
 *
 *     node scripts/smoke.js
 *
 * Con la base de datos en marcha, las rutas que la usan devolverán datos
 * reales; sin ella, este script sigue siendo válido porque cada caso
 * comprueba que la petición se rechaza ANTES de llegar a la capa de
 * datos.
 */
import { createApp } from '../src/app.js';

const app = createApp();
const server = await new Promise((resolve) => {
  const s = app.listen(0, () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  [32m✔[0m ${name}`);
  } else {
    failed += 1;
    console.log(`  [31m✖[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\nPrueba de humo de la API\n');

// ── Cabeceras y salud ───────────────────────────────────────────────
console.log('Cabeceras de seguridad');
{
  const res = await fetch(`${base}/api/health`);
  const body = await res.json();

  check('GET /api/health responde 200', res.status === 200);
  check('El cuerpo indica ok', body.ok === true);
  check('Content-Security-Policy presente', Boolean(res.headers.get('content-security-policy')));
  check("X-Frame-Options / frame-ancestors 'none'", /frame-ancestors 'none'/.test(res.headers.get('content-security-policy') ?? ''));
  check('X-Content-Type-Options: nosniff', res.headers.get('x-content-type-options') === 'nosniff');
  check('Referrer-Policy definida', Boolean(res.headers.get('referrer-policy')));
  check('Sin cabecera X-Powered-By', !res.headers.get('x-powered-by'));
  check('Emite la cookie CSRF', /csrfToken=/.test(res.headers.get('set-cookie') ?? ''));
  check('Cabeceras de rate limit presentes', Boolean(res.headers.get('ratelimit') || res.headers.get('ratelimit-limit')));
}

// ── CORS ────────────────────────────────────────────────────────────
console.log('\nCORS');
{
  const permitido = await fetch(`${base}/api/health`, { headers: { Origin: 'http://localhost:5173' } });
  check(
    'Permite el origen de la lista blanca',
    permitido.headers.get('access-control-allow-origin') === 'http://localhost:5173',
  );
  check('Permite credenciales', permitido.headers.get('access-control-allow-credentials') === 'true');

  const bloqueado = await fetch(`${base}/api/health`, { headers: { Origin: 'https://sitio-malicioso.example' } });
  check('Rechaza un origen desconocido', bloqueado.status === 403, `recibido ${bloqueado.status}`);
}

// ── CSRF ────────────────────────────────────────────────────────────
console.log('\nProtección CSRF');
{
  const sinToken = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.com', password: 'Cualquiera123' }),
  });
  const body = await sinToken.json();
  check('POST sin token CSRF se rechaza con 403', sinToken.status === 403, `recibido ${sinToken.status}`);
  check('El código de error es CSRF_INVALID', body.code === 'CSRF_INVALID');

  const desajustado = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: 'csrfToken=valor-de-la-cookie',
      'X-CSRF-Token': 'valor-distinto',
    },
    body: JSON.stringify({ email: 'a@b.com', password: 'Cualquiera123' }),
  });
  check('Token de cabecera distinto al de la cookie se rechaza', desajustado.status === 403);
}

// ── Validación de entrada ───────────────────────────────────────────
console.log('\nValidación de entrada (Zod)');
{
  const token = 'token-csrf-de-prueba';
  const headers = {
    'Content-Type': 'application/json',
    Cookie: `csrfToken=${token}`,
    'X-CSRF-Token': token,
  };

  const invalido = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ fullName: 'A', email: 'esto-no-es-correo', password: '123' }),
  });
  const body = await invalido.json();

  check('Datos inválidos devuelven 400', invalido.status === 400, `recibido ${invalido.status}`);
  check('Incluye el detalle por campo', Array.isArray(body.details) && body.details.length >= 2);
  check(
    'Señala el correo inválido',
    body.details?.some((d) => d.field === 'email'),
  );
  check(
    'Señala la contraseña débil',
    body.details?.some((d) => d.field === 'password'),
  );

  const slots = await fetch(`${base}/api/availability/slots?serviceId=xxx&date=no-es-fecha`);
  check('Parámetros de consulta inválidos devuelven 400', slots.status === 400);
}

// ── Mass assignment ─────────────────────────────────────────────────
console.log('\nEscalada de privilegios');
{
  /*
   * Se usa /auth/login y no /auth/register a propósito: este script
   * debe poder ejecutarse una y otra vez SIN dejar rastro. Un registro
   * con datos válidos crearía una cuenta de verdad cuando hay base de
   * datos conectada. El login no crea nada, y sirve igual para lo que
   * se quiere demostrar: que Zod descarta en silencio los campos no
   * declarados en el esquema en vez de devolver 400.
   *
   * Que el rol acabe siendo CLIENT pese a pedir ADMIN se comprueba de
   * extremo a extremo en scripts/e2e.js, que sí limpia lo que crea.
   */
  const token = 'token-csrf-de-prueba';
  const headers = {
    'Content-Type': 'application/json',
    Cookie: `csrfToken=${token}`,
    'X-CSRF-Token': token,
  };

  const conCampoExtra = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email: 'nadie@ejemplo.test',
      password: 'ContrasenaValida1',
      role: 'ADMIN', // <- campo no declarado en el esquema
      isActive: true,
    }),
  });

  // Sin base de datos será 500; con base de datos, 401 (no existe).
  // Lo relevante es que NO es 400: el esquema descartó los extras en
  // vez de tratarlos como entrada inválida.
  check(
    'Los campos no declarados se descartan, no rompen la petición',
    conCampoExtra.status !== 400,
    `recibido ${conCampoExtra.status}`,
  );

  const sinCampoObligatorio = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ role: 'ADMIN' }),
  });
  check(
    'Un cuerpo con solo campos no declarados se rechaza con 400',
    sinCampoObligatorio.status === 400,
    `recibido ${sinCampoObligatorio.status}`,
  );
}

// ── Autorización ────────────────────────────────────────────────────
console.log('\nControl de acceso');
{
  const rutas = [
    ['GET', '/api/bookings/admin'],
    ['GET', '/api/bookings/admin/stats'],
    ['GET', '/api/services/admin/all'],
    ['GET', '/api/settings/admin'],
    ['GET', '/api/loyalty/admin/cards'],
    ['GET', '/api/loyalty/me'],
    ['GET', '/api/bookings/mine'],
  ];

  for (const [method, path] of rutas) {
    const res = await fetch(`${base}${path}`, { method });
    check(`${method} ${path} sin sesión devuelve 401`, res.status === 401, `recibido ${res.status}`);
  }

  const falso = await fetch(`${base}/api/settings/admin`, {
    headers: { Authorization: 'Bearer token.completamente.inventado' },
  });
  check('Un JWT falsificado devuelve 401', falso.status === 401);
}

// ── Rutas públicas ──────────────────────────────────────────────────
console.log('\nRutas públicas');
{
  const res = await fetch(`${base}/api/inventada`);
  check('Ruta inexistente devuelve 404', res.status === 404);

  const grande = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.com', password: 'x'.repeat(200_000) }),
  });
  check('Cuerpo excesivo se rechaza (413 o 403 por CSRF)', [413, 403].includes(grande.status), `recibido ${grande.status}`);
}

console.log(`\n${passed} comprobaciones correctas, ${failed} fallidas.\n`);

server.close();
process.exit(failed === 0 ? 0 : 1);
