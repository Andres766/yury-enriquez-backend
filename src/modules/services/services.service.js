import prisma from '../../lib/prisma.js';
import { notFound, conflict } from '../../lib/errors.js';

const serviceInclude = {
  images: { orderBy: { sortOrder: 'asc' } },
  occasions: { include: { occasion: { select: { id: true, slug: true, name: true } } } },
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
    include: serviceInclude,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  return services.map(shape);
}

export async function getServiceBySlug(slug) {
  const service = await prisma.service.findFirst({
    where: { slug, active: true },
    include: serviceInclude,
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

export async function createService(data) {
  const { images = [], occasionIds = [], ...fields } = data;
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

  const existing = await prisma.service.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!existing) throw notFound('Servicio no encontrado');

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
