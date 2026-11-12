import { Transform } from 'class-transformer';

/**
 * RECORTA LOS ESPACIOS DE LOS BORDES de un texto libre antes de validarlo.
 *
 * Corre dentro del `ValidationPipe` global (`transform: true`, en `main.ts` y
 * en `test/helpers.ts`): class-transformer arma el DTO —y aplica esto— ANTES de
 * que class-validator lo mire. Por eso un nombre de solo espacios llega vacio
 * y el `@IsNotEmpty()` de al lado da el mismo 400 que a un nombre vacio.
 *
 * Solo para texto que alguien escribe y otro lee: nombres, notas, motivos. No
 * para claves, emails, ids, fechas ni el HTML de una plantilla, donde un
 * espacio puede ser parte del dato.
 *
 * Lo que no es un string pasa tal cual, para que su validador de tipo siga
 * dando el error de siempre.
 */
export function Recortado(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}
