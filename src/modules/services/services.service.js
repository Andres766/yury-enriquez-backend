import prisma from '../../lib/prisma.js';
import { notFound, conflict, badRequest } from '../../lib/errors.js';

const occasionLink = { occasion: { select: { id: true, slug: true, name: true } } };

const serviceInclude = {
  images: { orderBy: { sortOrder: 'asc' } },
  occasions: { include: occasionLink, orderBy: { occasion: { sortOrder: 'asc' } } },
};

/*
 * En la web pública solo se listan las ocasiones visibles: si Yury
 * oculta una, el chip "Ideal para" no debe llevar a una página que ya no
 * existe. El panel usa `serviceInclude` completo, porque al guardar se
 * reescriben los enlaces y perder los de una ocasión oculta los borraría.
 */
const publicInclude = {
  ...serviceInclude,
  occasions: { ...serviceInclude.occasions, where: { occasion: { active: true } } },
};

const shape = (service) => ({
  ...service,
  occasions: service.occasions?.map((link) => link.occasion) ?? [],
});

export async function listServices({ category, occasion, includeInactive = false } = {}) {
  const where = {};
  if (!includeInactive) where.active = true;
  if (category) where.category = category;
  if (occasion) where.occasions = { some: { occasion: { slug: occasion } } };

  const services = await prisma.service.findMany({
    where,
    include: includeInactive ? serviceInclude : publicInclude,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  return services.map(shape);
}

export async function getServiceBySlug(slug) {
  const service = await prisma.service.findFirst({
    where: { slug, active: true },
    include: publicInclude,
  });
  if (!service) throw notFound('Servicio no encontrado');
  return shape(service);
}

export async function getServiceById(id) {
  const service = await prisma.service.findUnique({ where: { id }, include: serviceInclude });
  if (!service) throw notFound('Servicio no encontrado');
  return shape(service);
}

// ── Administración ───────────────────────────────────────────────────

function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function uniqueSlug(base, excludeId = null) {
  let slug = slugify(base) || 'servicio';
  let n = 1;
  for (;;) {
    const found = await prisma.service.findUnique({ where: { slug }, select: { id: true } });
    if (!found || found.id === excludeId) return slug;
    n += 1;
    slug = `${slugify(base)}-${n}`.slice(0, 64);
  }
}

/**
 * La temporada se valida ya mezclada con lo guardado: el panel puede
 * enviar solo la fecha de fin, y "hasta el 20" con un "desde el 22" ya
 * guardado dejaría un servicio que no se puede reservar nunca. Mismo
 * formato de error que el validador, para que el formulario lo pinte
 * bajo el campo.
 */
function assertSeasonRange({ availableFrom, availableUntil }) {
  if (availableFrom && availableUntil && availableUntil < availableFrom) {
    throw badRequest('Revisa las fechas de temporada', {
      code: 'VALIDATION_ERROR',
      details: [{ field: 'availableUntil', message: 'La fecha de fin no puede ser anterior a la de inicio' }],
    });
  }
}

export async function createService(data) {
  const { images = [], occasionIds = [], ...fields } = data;
  assertSeasonRange(fields);
  const slug = await uniqueSlug(fields.name);

  const service = await prisma.service.create({
    data: {
      ...fields,
      slug,
      images: { create: images.map((img, i) => ({ ...img, sortOrder: i })) },
      occasions: { create: occasionIds.map((occasionId) => ({ occasionId })) },
    },
    include: serviceInclude,
  });

  return shape(service);
}

export async function updateService(id, data) {
  const { images, occasionIds, ...fields } = data;

  const existing = await prisma.service.findUnique({
    where: { id },
    select: { id: true, name: true, availableFrom: true, availableUntil: true },
  });
  if (!existing) throw notFound('Servicio no encontrado');
  assertSeasonRange({
    availableFrom: fields.availableFrom !== undefined ? fields.availableFrom : existing.availableFrom,
    availableUntil: fields.availableUntil !== undefined ? fields.availableUntil : existing.availableUntil,
  });

  const slug = fields.name && fields.name !== existing.name ? await uniqueSlug(fields.name, id) : undefined;

  const service = await prisma.$transaction(async (tx) => {
    if (images) {
      await tx.serviceImage.deleteMany({ where: { serviceId: id } });
    }
    if (occasionIds) {
      await tx.serviceOccasion.deleteMany({ where: { serviceId: id } });
    }

    return tx.service.update({
      where: { id },
      data: {
        ...fields,
        ...(slug ? { slug } : {}),
        ...(images ? { images: { create: images.map((img, i) => ({ ...img, sortOrder: i })) } } : {}),
        ...(occasionIds ? { occasions: { create: occasionIds.map((occasionId) => ({ occasionId })) } } : {}),
      },
      include: serviceInclude,
    });
  });

  return shape(service);
}

/**
 * Borrado con protección: si el servicio tiene reservas, no se elimina
 * (perderíamos el histórico). Se desactiva, que es lo que casi siempre
 * se quiere de verdad.
 */
export async function deleteService(id) {
  const bookings = await prisma.booking.count({ where: { serviceId: id } });

  if (bookings > 0) {
    await prisma.service.update({ where: { id }, data: { active: false } });
    throw conflict(
      `Este servicio tiene ${bookings} reserva(s) asociadas, así que no se puede borrar. Lo desactivamos para que deje de aparecer en la web.`,
      { code: 'DEACTIVATED_INSTEAD' },
    );
  }

  await prisma.service.delete({ where: { id } });
}
