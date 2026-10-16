import prisma from '../../lib/prisma.js';
import { getSettings, invalidateSettingsCache } from '../settings/settings.service.js';

/**
 * Dónde se está usando cada foto de la biblioteca.
 *
 * Los servicios, las ocasiones y el inicio guardan la URL de la foto (no
 * su id): así siguen funcionando con fotos que no están en la biblioteca
 * y la web pública no necesita uniones extra. El precio es que, para
 * saber si una foto está en uso, hay que buscar su URL en esos sitios.
 * Eso es lo que hace este módulo, y es lo que permite avisarle a Yury
 * antes de borrar una foto que todavía sale en un servicio.
 */

export const HERO_LABEL = 'Foto principal del inicio';
export const ABOUT_LABEL = 'Foto de «Sobre mí»';

/** Campos que la web pública necesita para pintar la galería. */
export const publicPhotoSelect = {
  id: true,
  url: true,
  width: true,
  height: true,
  alt: true,
  category: true,
  featured: true,
  focus: true,
  credit: true,
  minor: true,
};

export const PHOTO_ORDER = [{ sortOrder: 'asc' }, { createdAt: 'asc' }];

/** Map url → [{ type, id?, name }] para las URL dadas. */
export async function usageByUrl(urls) {
  const wanted = [...new Set(urls.filter(Boolean))];
  const usage = new Map();
  if (!wanted.length) return usage;

  const [images, occasions, settings] = await Promise.all([
    prisma.serviceImage.findMany({
      where: { url: { in: wanted } },
      select: { url: true, serviceId: true, service: { select: { name: true } } },
      orderBy: { service: { sortOrder: 'asc' } },
    }),
    prisma.occasion.findMany({
      where: { heroImage: { in: wanted } },
      select: { id: true, name: true, heroImage: true },
      orderBy: { sortOrder: 'asc' },
    }),
    getSettings({ fresh: true }),
  ]);

  const add = (url, entry) => {
    const list = usage.get(url) ?? [];
    // Un servicio que repite la misma foto se nombra una sola vez.
    if (!list.some((e) => e.type === entry.type && e.id === entry.id)) list.push(entry);
    usage.set(url, list);
  };

  if (wanted.includes(settings.heroImageUrl)) add(settings.heroImageUrl, { type: 'hero', name: HERO_LABEL });
  if (wanted.includes(settings.aboutImageUrl)) add(settings.aboutImageUrl, { type: 'about', name: ABOUT_LABEL });
  for (const img of images) add(img.url, { type: 'service', id: img.serviceId, name: img.service.name });
  for (const occ of occasions) add(occ.heroImage, { type: 'occasion', id: occ.id, name: occ.name });

  return usage;
}

/** Biblioteca completa para el panel, cada foto con sus usos. */
export async function listAdminPhotos() {
  const photos = await prisma.photo.findMany({ orderBy: PHOTO_ORDER });
  const usage = await usageByUrl(photos.map((p) => p.url));
  return photos.map((photo) => ({ ...photo, usedBy: usage.get(photo.url) ?? [] }));
}

/**
 * Quita la foto de todos los sitios donde se usa y la borra de la
 * biblioteca, todo en una transacción: o queda limpia en todas partes o
 * no cambia nada. Un servicio que se queda sin fotos sigue funcionando
 * (la web muestra su tarjeta sin imagen); el inicio vuelve a su foto de
 * serie.
 */
export async function deletePhotoEverywhere(photo) {
  const settings = await getSettings({ fresh: true });

  await prisma.$transaction(async (tx) => {
    await tx.serviceImage.deleteMany({ where: { url: photo.url } });
    await tx.occasion.updateMany({ where: { heroImage: photo.url }, data: { heroImage: null } });

    const settingsData = {};
    if (settings.heroImageUrl === photo.url) {
      Object.assign(settingsData, { heroImageUrl: null, heroImageAlt: null, heroImageFocus: null });
    }
    if (settings.aboutImageUrl === photo.url) {
      Object.assign(settingsData, { aboutImageUrl: null, aboutImageAlt: null, aboutImageFocus: null });
    }
    if (Object.keys(settingsData).length) {
      await tx.settings.update({ where: { id: 1 }, data: settingsData });
    }

    await tx.photo.delete({ where: { id: photo.id } });
  });

  // Los ajustes se cachean unos segundos: sin esto, el inicio seguiría
  // mostrando la foto borrada hasta que caducara la caché.
  invalidateSettingsCache();
}
