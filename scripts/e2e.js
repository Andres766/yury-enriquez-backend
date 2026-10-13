/**
 * Prueba de integración contra la base de datos real.
 *
 * Recorre el flujo completo: catálogo → disponibilidad → reserva como
 * invitada → intento de doble reserva (incluido un ataque de carrera con
 * peticiones simultáneas) → registro de clienta → panel de
 * administración → sellos de fidelidad.
 *
 * Requiere la base sembrada:
 *     npm run setup
 *     node scripts/e2e.js
 *
 * Ejecútalo con NODE_ENV=development (el valor de .env). El script hace
 * decenas de reservas seguidas desde la misma IP y con los límites de
 * producción acabaría midiendo el rate limiter en vez del flujo. Esos
 * límites se comprueban aparte, en scripts/smoke.js.
 *
 * Crea datos de prueba y los limpia al terminar.
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
const created = { bookingCodes: [], userEmails: [] };

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

console.log('\nPrueba de integración end-to-end\n');

const guest = createSession();

// ── 1. Catálogo público ─────────────────────────────────────────────
console.log('1. Catálogo público');
let service;
let occasion;
{
  await guest.request('/health'); // obtiene la cookie CSRF

  const settings = await guest.request('/settings');
  check('GET /settings devuelve los datos del negocio', settings.status === 200 && Boolean(settings.data.settings.brandName));
  check(
    'Los ajustes públicos NO exponen el correo interno de avisos',
    settings.data.settings.ownerNotificationEmail === undefined,
  );

  const services = await guest.request('/services');
  service = services.data.services?.find((s) => s.category === 'MAQUILLAJE');
  check('GET /services devuelve el catálogo', services.status === 200 && services.data.services.length > 0,
    `recibidos ${services.data.services?.length ?? 0}`);
  check('Los servicios traen galería', Boolean(service?.images?.length));

  const occasions = await guest.request('/occasions');
  occasion = occasions.data.occasions?.[0];
  check('GET /occasions devuelve las ocasiones', occasions.status === 200 && occasions.data.occasions.length > 0);
  check('Las ocasiones traen su lista de "qué incluye"', Boolean(occasion?.includes?.length));

  const filtered = await guest.request('/services?category=PAQUETE');
  check(
    'El filtro por categoría funciona',
    filtered.status === 200 && filtered.data.services.every((s) => s.category === 'PAQUETE'),
  );
}

// ── 2. Disponibilidad ───────────────────────────────────────────────
console.log('\n2. Disponibilidad');
let slot;
let slotDate;
{
  const now = new Date();
  const month = await guest.request(
    `/availability/month?serviceId=${service.id}&year=${now.getFullYear()}&month=${now.getMonth() + 1}`,
  );
  check('GET /availability/month responde', month.status === 200 && Array.isArray(month.data.days));

  /*
   * Se elige el día MÁS libre, no el primero con hueco.
   *
   * A lo largo de la prueba se reservan cuatro o cinco citas en ese
   * mismo día (invitada, carrera, clienta registrada, reprogramación).
   * Si se cogiera un día con solo tres huecos, el propio script los
   * agotaría y las comprobaciones posteriores fallarían por falta de
   * cupo, no por un defecto de la aplicación.
   */
  let days = month.data.days.filter((d) => d.available);

  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const m2 = await guest.request(
    `/availability/month?serviceId=${service.id}&year=${next.getFullYear()}&month=${next.getMonth() + 1}`,
  );
  days = days.concat((m2.data.days ?? []).filter((d) => d.available));

  days.sort((a, b) => b.slotCount - a.slotCount);
  check('Hay al menos un día con cupo', days.length > 0);
  check(
    'El día elegido tiene holgura para toda la prueba',
    (days[0]?.slotCount ?? 0) >= 6,
    `el día más libre tiene ${days[0]?.slotCount ?? 0} huecos`,
  );

  slotDate = days[0]?.date;
  const slots = await guest.request(`/availability/slots?serviceId=${service.id}&date=${slotDate}`);
  slot = slots.data.slots?.[0];

  check('GET /availability/slots devuelve horarios', slots.status === 200 && slots.data.slots.length > 0,
    `día ${slotDate}, ${slots.data.slots?.length ?? 0} huecos`);
  check('Los horarios traen inicio, fin y etiqueta', Boolean(slot?.start && slot?.end && slot?.label));

  const pasado = await guest.request(`/availability/slots?serviceId=${service.id}&date=2020-01-15`);
  check('Una fecha pasada no ofrece horarios', pasado.status === 200 && pasado.data.slots.length === 0);

  // Sin un hueco de partida no hay nada que probar: mejor parar aquí con
  // un mensaje claro que arrastrar un `undefined` hasta un error opaco
  // treinta líneas más abajo.
  if (!slot) {
    console.error(
      '\n✖ No hay ningún horario disponible con el que continuar.\n' +
        '  Revisa que el horario semanal esté sembrado (npm run db:seed)\n' +
        '  y que no haya bloqueos cubriendo los próximos dos meses.\n',
    );
    server.close();
    await prisma.$disconnect();
    process.exit(1);
  }
}

// ── 3. Reserva como invitada ────────────────────────────────────────
console.log('\n3. Reserva como invitada (sin cuenta)');
let guestBooking;
{
  const payload = {
    serviceId: service.id,
    occasionId: occasion.id,
    startAt: slot.start,
    customerName: 'Prueba Invitada',
    customerEmail: 'prueba.invitada@ejemplo.test',
    customerPhone: '+573001112233',
    paymentMethod: 'TRANSFERENCIA',
    notes: 'Prueba automática. Tonos <script>alert(1)</script> cálidos.',
  };

  const res = await guest.request('/bookings', { method: 'POST', body: payload });
  guestBooking = res.data.booking;
  if (guestBooking) created.bookingCodes.push(guestBooking.code);

  check('Se crea la reserva sin sesión iniciada', res.status === 201, `recibido ${res.status}: ${res.data?.error ?? ''}`);
  check('Devuelve un código de reserva', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(guestBooking?.code ?? ''));
  check('El estado inicial es PENDING', guestBooking?.status === 'PENDING');
  check(
    'El precio se toma del catálogo, no del cliente',
    guestBooking?.priceCents === service.priceCents,
  );

  // El texto se guarda tal cual: el escape se hace al renderizar.
  check('Las notas conservan el texto de la clienta', guestBooking?.notes?.includes('<script>'));

  const conPrecio = await guest.request('/bookings', {
    method: 'POST',
    body: { ...payload, startAt: slot.start, priceCents: 1, status: 'CONFIRMED' },
  });
  check(
    'Enviar priceCents o status desde el cliente no los aplica',
    conPrecio.status === 409 || conPrecio.status === 400,
    `recibido ${conPrecio.status}`,
  );
}

// ── 4. Doble reserva ────────────────────────────────────────────────
console.log('\n4. Protección contra doble reserva');
{
  const duplicada = await guest.request('/bookings', {
    method: 'POST',
    body: {
      serviceId: service.id,
      startAt: slot.start,
      customerName: 'Otra Persona',
      customerEmail: 'otra.persona@ejemplo.test',
      customerPhone: '+573004445566',
      paymentMethod: 'EFECTIVO',
    },
  });
  check('El mismo horario se rechaza con 409', duplicada.status === 409, `recibido ${duplicada.status}`);
  check('El código de error es SLOT_TAKEN', duplicada.data?.code === 'SLOT_TAKEN', JSON.stringify(duplicada.data));

  const slots = await guest.request(`/availability/slots?serviceId=${service.id}&date=${slotDate}`);
  check(
    'El horario ocupado desaparece del listado',
    !slots.data.slots.some((s) => s.start === slot.start),
  );

  // Carrera: cinco peticiones simultáneas por el mismo hueco libre.
  // Los nombres van sin dígitos porque el esquema solo admite letras,
  // que es justamente lo que queremos que siga haciendo.
  const NOMBRES = ['Ana Carrera', 'Bruna Carrera', 'Celia Carrera', 'Dalia Carrera', 'Eva Carrera'];
  const libre = slots.data.slots[0];
  if (libre) {
    const sesiones = Array.from({ length: 5 }, () => createSession());
    await Promise.all(sesiones.map((s) => s.request('/health')));

    const resultados = await Promise.all(
      sesiones.map((s, i) =>
        s.request('/bookings', {
          method: 'POST',
          body: {
            serviceId: service.id,
            startAt: libre.start,
            customerName: NOMBRES[i],
            customerEmail: `carrera${i}@ejemplo.test`,
            customerPhone: `+57300000000${i}`,
            paymentMethod: 'EFECTIVO',
          },
        }),
      ),
    );

    const exitosas = resultados.filter((r) => r.status === 201);
    exitosas.forEach((r) => created.bookingCodes.push(r.data.booking.code));

    check(
      'Con 5 peticiones simultáneas solo UNA se crea',
      exitosas.length === 1,
      `se crearon ${exitosas.length}; estados: ${resultados.map((r) => r.status).join(', ')}; ` +
        `errores: ${resultados.filter((r) => r.status !== 201).map((r) => r.data?.error).join(' | ')}`,
    );
    check(
      'Las otras cuatro reciben 409',
      resultados.filter((r) => r.status === 409).length === 4,
      `códigos: ${resultados.map((r) => r.data?.code ?? r.status).join(', ')}`,
    );
  }

  // Fecha en el pasado.
  const pasada = await guest.request('/bookings', {
    method: 'POST',
    body: {
      serviceId: service.id,
      startAt: new Date(Date.now() - 86_400_000).toISOString(),
      customerName: 'Viajera Del Tiempo',
      customerEmail: 'pasado@ejemplo.test',
      customerPhone: '+573007778899',
      paymentMethod: 'EFECTIVO',
    },
  });
  check('Una fecha pasada se rechaza', pasada.status === 400 || pasada.status === 409, `recibido ${pasada.status}`);

  // Hora fuera de la agenda (3 de la madrugada).
  const madrugada = new Date(`${slotDate}T08:00:00.000Z`); // 03:00 en Bogotá
  const fuera = await guest.request('/bookings', {
    method: 'POST',
    body: {
      serviceId: service.id,
      startAt: madrugada.toISOString(),
      customerName: 'Fuera De Horario',
      customerEmail: 'madrugada@ejemplo.test',
      customerPhone: '+573009990011',
      paymentMethod: 'EFECTIVO',
    },
  });
  check('Un horario fuera de la agenda se rechaza', fuera.status === 409 || fuera.status === 400,
    `recibido ${fuera.status}`);
}

// ── 5. Consulta de invitada ─────────────────────────────────────────
console.log('\n5. Consulta de reserva por código');
{
  const ok = await guest.request('/bookings/lookup', {
    method: 'POST',
    body: { code: guestBooking.code, email: 'prueba.invitada@ejemplo.test' },
  });
  check('Código + correo correctos devuelven la reserva', ok.status === 200 && ok.data.booking.code === guestBooking.code);

  const malCorreo = await guest.request('/bookings/lookup', {
    method: 'POST',
    body: { code: guestBooking.code, email: 'intrusa@ejemplo.test' },
  });
  check('Código correcto con otro correo devuelve 404', malCorreo.status === 404);

  const inexistente = await guest.request('/bookings/lookup', {
    method: 'POST',
    body: { code: 'ZZZZ-ZZZZ', email: 'intrusa@ejemplo.test' },
  });
  check(
    'La respuesta es idéntica para código inexistente (no revela cuáles existen)',
    inexistente.status === malCorreo.status && inexistente.data.error === malCorreo.data.error,
  );
}

// ── 6. Cuenta de clienta ────────────────────────────────────────────
console.log('\n6. Cuenta de clienta');
const client = createSession();
{
  await client.request('/health');

  const email = `clienta.e2e.${Date.now()}@ejemplo.test`;
  created.userEmails.push(email);

  const debil = await client.request('/auth/register', {
    method: 'POST',
    body: { fullName: 'Clienta Prueba', email, password: 'corta' },
  });
  check('Una contraseña débil se rechaza con detalle por campo', debil.status === 400 && debil.data.details?.length > 0);

  const reg = await client.request('/auth/register', {
    method: 'POST',
    body: {
      fullName: 'Clienta Prueba',
      email,
      password: 'ContrasenaSegura1',
      phone: '+573001234567',
      marketingOptIn: true,
      role: 'ADMIN', // intento de escalada
    },
  });
  check('Se crea la cuenta', reg.status === 201, `recibido ${reg.status}: ${reg.data?.error ?? ''}`);
  check('El rol se fuerza a CLIENT pese a enviar ADMIN', reg.data.user?.role === 'CLIENT');
  check('La respuesta NO incluye el hash de la contraseña', reg.data.user?.passwordHash === undefined);
  client.setToken(reg.data.accessToken);

  const card = await client.request('/loyalty/me');
  check('La tarjeta de fidelidad se crea con el registro', card.status === 200 && card.data.card.stampsCurrent === 0);
  check('La tarjeta indica cuántos sellos hacen falta', card.data.card.stampsRequired > 0);

  const admin = await client.request('/bookings/admin');
  check('Una clienta NO puede entrar a rutas de administración', admin.status === 403, `recibido ${admin.status}`);

  const settingsAdmin = await client.request('/settings/admin');
  check('Una clienta NO puede leer los ajustes completos', settingsAdmin.status === 403);

  // Reserva con sesión iniciada: debe quedar ligada a la cuenta.
  const slots = await client.request(`/availability/slots?serviceId=${service.id}&date=${slotDate}`);
  const libre = slots.data.slots[0];
  if (libre) {
    const res = await client.request('/bookings', {
      method: 'POST',
      body: {
        serviceId: service.id,
        startAt: libre.start,
        customerName: 'Clienta Prueba',
        customerEmail: email,
        customerPhone: '+573001234567',
        paymentMethod: 'EFECTIVO',
      },
    });
    if (res.data.booking) created.bookingCodes.push(res.data.booking.code);
    check('Una clienta con sesión puede reservar', res.status === 201);

    const mine = await client.request('/bookings/mine');
    check('La reserva aparece en su historial', mine.status === 200 && mine.data.bookings.length === 1);
  }

  const refreshed = await client.request('/auth/refresh', { method: 'POST' });
  check('El refresco de sesión funciona', refreshed.status === 200 && Boolean(refreshed.data.accessToken));
  check('El refresco devuelve un token distinto al anterior', refreshed.data.accessToken !== reg.data.accessToken);
}

// ── 7. Panel de administración ──────────────────────────────────────
console.log('\n7. Panel de administración');
const admin = createSession();
let adminUserId;
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
  check('Su rol es ADMIN', login.data.user?.role === 'ADMIN');
  admin.setToken(login.data.accessToken);
  adminUserId = login.data.user?.id;

  const malPassword = await admin.request('/auth/login', {
    method: 'POST',
    body: { email: process.env.SEED_ADMIN_EMAIL || 'admin@yuryenriquez.com', password: 'ContrasenaIncorrecta1' },
  });
  const noExiste = await admin.request('/auth/login', {
    method: 'POST',
    body: { email: 'noexiste@ejemplo.test', password: 'ContrasenaIncorrecta1' },
  });
  check(
    'Contraseña errónea y correo inexistente dan la misma respuesta',
    malPassword.status === noExiste.status && malPassword.data.error === noExiste.data.error,
  );

  const stats = await admin.request('/bookings/admin/stats');
  check('El resumen del panel carga', stats.status === 200 && typeof stats.data.pending === 'number');

  const list = await admin.request(`/bookings/admin?q=${encodeURIComponent(guestBooking.code)}`);
  check('La búsqueda por código encuentra la reserva', list.status === 200 && list.data.items.length === 1);

  const bookingId = list.data.items[0].id;

  const confirmada = await admin.request(`/bookings/admin/${bookingId}/status`, {
    method: 'PATCH',
    body: { status: 'CONFIRMED' },
  });
  check('Se confirma la reserva', confirmada.status === 200 && confirmada.data.booking.status === 'CONFIRMED');
  check('Queda registrada la hora de confirmación', Boolean(confirmada.data.booking.confirmedAt));

  // Reprogramar a otro hueco libre.
  const slots = await admin.request(`/availability/slots?serviceId=${service.id}&date=${slotDate}`);
  const otro = slots.data.slots[0];
  if (otro) {
    const repro = await admin.request(`/bookings/admin/${bookingId}/reschedule`, {
      method: 'PATCH',
      body: { startAt: otro.start },
    });
    check('Se reprograma la cita a otro hueco', repro.status === 200, `recibido ${repro.status}: ${repro.data?.error ?? ''}`);
    check('La nueva hora quedó guardada', new Date(repro.data.booking?.startAt).toISOString() === otro.start);
  }

  const completada = await admin.request(`/bookings/admin/${bookingId}/status`, {
    method: 'PATCH',
    body: { status: 'COMPLETED' },
  });
  check('Se marca como completada', completada.status === 200 && completada.data.booking.status === 'COMPLETED');

  // Horario semanal
  const rules = await admin.request('/availability/rules');
  check('El horario semanal se lee', rules.status === 200 && rules.data.rules.length > 0);

  const reglaMala = await admin.request('/availability/admin/rules', {
    method: 'PUT',
    body: { rules: [{ weekday: 3, startTime: '18:00', endTime: '09:00' }] },
  });
  check('Una franja con cierre antes de la apertura se rechaza', reglaMala.status === 400);

  // Bloqueo de agenda.
  //
  // Se compara contra el número de huecos ANTES del bloqueo, no contra
  // cero: a estas alturas la prueba ya ha ocupado varios horarios de ese
  // día, así que "vuelven los horarios" significa "vuelven los que
  // había", no "vuelve a haber alguno".
  const antesDelBloqueo = (
    await guest.request(`/availability/slots?serviceId=${service.id}&date=${slotDate}`)
  ).data.slots.length;

  const bloqueo = await admin.request('/availability/admin/blocks', {
    method: 'POST',
    body: { date: slotDate, allDay: true, reason: 'Prueba automática' },
  });
  check('Se crea un bloqueo de día completo', bloqueo.status === 201, `recibido ${bloqueo.status}`);

  const trasBloqueo = await guest.request(`/availability/slots?serviceId=${service.id}&date=${slotDate}`);
  check('El día bloqueado deja de ofrecer horarios', trasBloqueo.data.slots.length === 0,
    `quedan ${trasBloqueo.data.slots.length}`);

  await admin.request(`/availability/admin/blocks/${bloqueo.data.block.id}`, { method: 'DELETE' });
  const trasQuitar = await guest.request(`/availability/slots?serviceId=${service.id}&date=${slotDate}`);
  check(
    'Al quitar el bloqueo vuelven exactamente los horarios que había',
    trasQuitar.data.slots.length === antesDelBloqueo,
    `antes ${antesDelBloqueo}, después ${trasQuitar.data.slots.length}`,
  );
}

// ── 8. Fidelidad ────────────────────────────────────────────────────
console.log('\n8. Tarjeta de fidelidad');
{
  const cards = await admin.request('/loyalty/admin/cards');
  check('El listado de tarjetas carga', cards.status === 200 && cards.data.items.length > 0);

  const cliente = cards.data.items.find((c) => c.email === created.userEmails[0]);
  check('Aparece la clienta recién registrada', Boolean(cliente));

  const required = cards.data.stampsRequired;
  let unlocked = null;

  for (let i = 1; i <= required; i += 1) {
    const res = await admin.request('/loyalty/admin/stamps', {
      method: 'POST',
      body: { userId: cliente.id, note: `Sello de prueba ${i}` },
    });
    if (i === 1) {
      check('Se otorga un sello', res.status === 201 && res.data.card.stampsCurrent === 1);
    }
    if (res.data.unlockedReward) unlocked = res.data.unlockedReward;
  }

  check(`Al llegar a ${required} sellos se desbloquea la recompensa`, Boolean(unlocked));

  const card = await client.request('/loyalty/me');
  check('El contador del ciclo se reinicia tras la recompensa', card.data.card.stampsCurrent === 0);
  check('El total histórico se conserva', card.data.card.stampsTotal === required);
  check('La clienta ve su recompensa disponible', card.data.card.hasReward === true);

  const redeem = await admin.request(`/loyalty/admin/rewards/${unlocked.id}/redeem`, { method: 'POST' });
  check('La recompensa se marca como canjeada', redeem.status === 200 && redeem.data.reward.status === 'REDEEMED');

  const otraVez = await admin.request(`/loyalty/admin/rewards/${unlocked.id}/redeem`, { method: 'POST' });
  check('No se puede canjear dos veces', otraVez.status === 400);

  const revocado = await admin.request('/loyalty/admin/stamps/last', {
    method: 'DELETE',
    body: { userId: cliente.id },
  });
  check('Se puede retirar el último sello', revocado.status === 200);

  const selloCliente = await client.request('/loyalty/admin/stamps', {
    method: 'POST',
    body: { userId: cliente.id },
  });
  check('Una clienta NO puede otorgarse sellos a sí misma', selloCliente.status === 403,
    `recibido ${selloCliente.status}`);
}

// ── 9. Tema del sitio ───────────────────────────────────────────────
console.log('\n9. Tema del sitio (solo lo cambia la administradora)');
{
  const original = (await guest.request('/settings')).data.settings.theme;

  const comoClienta = await client.request('/settings/admin', {
    method: 'PATCH',
    body: { theme: 'HALLOWEEN' },
  });
  check('Una clienta NO puede cambiar el tema', comoClienta.status === 403, `recibido ${comoClienta.status}`);

  const sinSesion = await guest.request('/settings/admin', {
    method: 'PATCH',
    body: { theme: 'HALLOWEEN' },
  });
  check('Sin sesión tampoco se puede cambiar', sinSesion.status === 401);

  const invalido = await admin.request('/settings/admin', {
    method: 'PATCH',
    body: { theme: 'NAVIDAD' },
  });
  check('Un tema inexistente se rechaza con 400', invalido.status === 400);

  const aplicado = await admin.request('/settings/admin', {
    method: 'PATCH',
    body: { theme: 'HALLOWEEN' },
  });
  check('La administradora sí puede cambiarlo', aplicado.status === 200 && aplicado.data.settings.theme === 'HALLOWEEN');

  const publico = await guest.request('/settings');
  check('El tema llega a la web pública', publico.data.settings.theme === 'HALLOWEEN');

  await admin.request('/settings/admin', { method: 'PATCH', body: { theme: original } });
  const restaurado = await guest.request('/settings');
  check('Se restaura el tema original', restaurado.data.settings.theme === original);
}

// ── 10. Promociones ─────────────────────────────────────────────────
console.log('\n10. Promociones');
{
  const publicas = await guest.request('/promotions');
  const conSesion = await client.request('/promotions');

  check('Las promociones públicas cargan', publicas.status === 200);
  check(
    'Sin sesión no se devuelven las de "solo registradas"',
    publicas.data.promotions.every((p) => p.membersOnly === false),
  );
  check(
    'Con sesión sí aparecen las exclusivas',
    conSesion.data.promotions.length >= publicas.data.promotions.length,
  );
}

// ── Limpieza ────────────────────────────────────────────────────────
console.log('\nLimpiando datos de prueba…');
try {
  await prisma.booking.deleteMany({ where: { code: { in: created.bookingCodes } } });
  await prisma.booking.deleteMany({ where: { customerEmail: { endsWith: '@ejemplo.test' } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@ejemplo.test' } } });
  console.log('  Listo.');
} catch (error) {
  console.log(`  Aviso al limpiar: ${error.message}`);
}

console.log(
  `\n\x1b[1m${passed} comprobaciones correctas, ${failed} fallidas.\x1b[0m\n`,
);

server.close();
await prisma.$disconnect();
process.exit(failed === 0 ? 0 : 1);
