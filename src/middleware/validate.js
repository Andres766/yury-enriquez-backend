import { badRequest } from '../lib/errors.js';

/**
 * Validación de entrada con Zod, en el servidor.
 *
 * La validación del frontend es comodidad para quien usa la web; esta es
 * la que manda. Todo endpoint que reciba datos pasa por aquí, y el
 * handler solo ve `req.valid`, que contiene exclusivamente los campos
 * declarados en el esquema: cualquier propiedad extra que venga en el
 * cuerpo se descarta (Zod no hace passthrough por defecto), lo que evita
 * mass assignment — por ejemplo, colar `"role":"ADMIN"` en un registro.
 */
export function validate({ body, query, params }) {
  return function validator(req, _res, next) {
    const valid = {};

    for (const [key, schema, source] of [
      ['body', body, req.body],
      ['query', query, req.query],
      ['params', params, req.params],
    ]) {
      if (!schema) continue;

      const result = schema.safeParse(source ?? {});
      if (!result.success) {
        const details = result.error.issues.map((i) => ({
          field: i.path.join('.') || key,
          message: i.message,
        }));
        return next(badRequest('Revisa los datos enviados', { code: 'VALIDATION_ERROR', details }));
      }
      valid[key] = result.data;
    }

    req.valid = valid;
    return next();
  };
}
