/**
 * Qué foto real va en cada servicio y en cada ocasión.
 *
 * Las fotos viven en el frontend (frontend/public/img/trabajos, WebP en
 * 480 y 960 px) y aquí se guardan como rutas del propio sitio
 * ("/img/trabajos/…"), que el navegador resuelve contra el dominio de la
 * web. Lo usan dos sitios, para que nunca se desincronicen:
 *   · prisma/seed.js, al sembrar una base nueva;
 *   · scripts/fotos-reales.js, para cambiar las de una base que ya existe
 *     (producción) sin tocar nada más.
 *
 * Fotos de menores: las de quinceañeras y niñas/niños llevan `menor`.
 * Con la opción `sinMenores` se cambian por fotos de adultas, por si
 * todavía no está la autorización escrita de sus acudientes.
 *
 * Grados y Sesiones de fotos aún no tienen fotos propias: se usan las
 * más cercanas (maquillaje social; la sesión de quince de Silvio Maya)
 * para que ninguna casilla quede con una foto de relleno.
 */

const img = (id) => `/img/trabajos/${id}-960.webp`;

// id de la foto → texto alternativo y si sale una persona menor de edad
const PHOTOS = {
  'novia-boda-iglesia': { alt: 'Novia con maquillaje luminoso y recogido con ondas a la entrada de la iglesia' },
  'novia-maquillaje-velo': { alt: 'Maquillaje de novia en tonos tierra con diadema de cristal y velo' },
  'novia-peinado-mono-cristales': { alt: 'Peinado de novia: moño bajo torcido con enredadera de cristales' },
  'novia-peinado-semirecogido-flores': { alt: 'Peinado de novia semirecogido con ondas y tocado de flores plateadas' },
  'quince-espalda-balcon': { alt: 'Quinceañera de espaldas con vestido rosa de cola larga y corona', menor: true },
  'quince-vestido-rosa-ramo': { alt: 'Quinceañera con vestido rosa bordado, corona y ramo de rosas', menor: true },
  'quince-corona-dorada-sonrisa': { alt: 'Maquillaje de quinceañera natural y luminoso con corona dorada', menor: true },
  'quince-peinado-ondas-tiara': { alt: 'Peinado semirecogido con ondas largas y tiara plateada', menor: true },
  'social-ojos-calidos': { alt: 'Maquillaje social con sombras cálidas, delineado y labios rosados' },
  'noche-ahumado-morado': { alt: 'Maquillaje de noche con ahumado morado y labios vino' },
  'social-glitter-rosa': { alt: 'Sombra fucsia difuminada con delineado de glitter dorado' },
  'social-glitter-rosa-perfil': { alt: 'Perfil de un maquillaje fucsia con glitter dorado' },
  'catrina-media-cara': { alt: 'Media catrina con encaje negro, pedrería y labio mitad calavera' },
  'catrina-nina': { alt: 'Niña maquillada de catrina con corona de flores y velo negro', menor: true },
};

/** slug del servicio → fotos (la primera es la portada de la tarjeta). */
const SERVICES = {
  'maquillaje-social': ['social-ojos-calidos', 'social-glitter-rosa', 'social-glitter-rosa-perfil'],
  'maquillaje-de-noche': ['noche-ahumado-morado', 'social-glitter-rosa-perfil'],
  'maquillaje-de-novia': ['novia-boda-iglesia', 'novia-maquillaje-velo'],
  'maquillaje-para-sesion-de-fotos': ['quince-vestido-rosa-ramo', 'quince-espalda-balcon'],
  'peinado-de-fiesta': ['quince-peinado-ondas-tiara', 'noche-ahumado-morado'],
  'peinado-de-novia': ['novia-peinado-mono-cristales', 'novia-peinado-semirecogido-flores'],
  'paquete-fiesta-maquillaje-peinado': ['noche-ahumado-morado', 'social-ojos-calidos'],
  'paquete-novia-maquillaje-peinado': ['novia-boda-iglesia', 'novia-peinado-mono-cristales', 'novia-maquillaje-velo'],
  'paquete-quinceanera': ['quince-corona-dorada-sonrisa', 'quince-peinado-ondas-tiara', 'quince-vestido-rosa-ramo'],
  'maquillaje-artistico-de-catrina': ['catrina-media-cara', 'catrina-nina'],
};

/** slug de la ocasión → foto de cabecera. */
const OCCASIONS = {
  bodas: 'novia-boda-iglesia',
  quinceaneros: 'quince-espalda-balcon',
  grados: 'social-ojos-calidos',
  'sesiones-de-fotos': 'quince-vestido-rosa-ramo',
  fiestas: 'social-glitter-rosa',
  'eventos-sociales': 'noche-ahumado-morado',
};

/** Sustituta adulta de cada foto de menor, para la opción sinMenores. */
const ADULT_SUBSTITUTE = {
  'quince-espalda-balcon': 'novia-boda-iglesia',
  'quince-vestido-rosa-ramo': 'social-ojos-calidos',
  'quince-corona-dorada-sonrisa': 'social-ojos-calidos',
  'quince-peinado-ondas-tiara': 'novia-peinado-semirecogido-flores',
  'catrina-nina': 'catrina-media-cara',
};

function pick(id, sinMenores) {
  return sinMenores && PHOTOS[id]?.menor ? ADULT_SUBSTITUTE[id] : id;
}

/** Fotos de un servicio listas para ServiceImage: [{ url, alt, sortOrder }]. */
export function servicePhotos(slug, { sinMenores = false } = {}) {
  const ids = SERVICES[slug];
  if (!ids) return null;
  const unique = [...new Set(ids.map((id) => pick(id, sinMenores)))];
  return unique.map((id, i) => ({ url: img(id), alt: PHOTOS[id].alt, sortOrder: i }));
}

/** Foto de cabecera de una ocasión (ruta del sitio) o null. */
export function occasionPhoto(slug, { sinMenores = false } = {}) {
  const id = OCCASIONS[slug];
  return id ? img(pick(id, sinMenores)) : null;
}

export const SERVICE_SLUGS = Object.keys(SERVICES);
export const OCCASION_SLUGS = Object.keys(OCCASIONS);
