/**
 * "En blanco" y "no vino" son el mismo dato.
 *
 * El PUT de la web del salon acepta `''`: sus campos de texto llevan
 * `@IsString()` y `@MaxLength()`, pero no `@IsNotEmpty()`. Asi que un campo
 * que el admin vacio a mano llega como cadena vacia y NO como `null`, y desde
 * la calle las dos cosas se ven igual: un encabezado "Sobre el salón" con nada
 * debajo, o un `<p>` vacio en el HTML de una pagina indexada.
 *
 * La regla vive AQUI Y EN UN SOLO SITIO, y se aplica de una vez a la respuesta
 * entera en lugar de repetir un `if` por seccion. El dia que la landing enseñe
 * un campo de texto nuevo, queda cubierto sin que nadie se acuerde de esto.
 */

/**
 * Devuelve el objeto con sus cadenas recortadas, y a `null` las que queden en
 * blanco.
 *
 * ⚠️ SOLO TOCA CADENAS. Un `0` y un `false` son datos, no ausencias: una
 * funcion que se llame "esta vacio" y se trague el cero es la trampa clasica,
 * y aqui conviviria con `destacado: false` y con precios. Lo que no es texto
 * sale exactamente como entro.
 *
 * Trabaja sobre el primer nivel: son los campos anulables que escribe el admin.
 * Lo de dentro de las listas son filas, y una fila con el texto en blanco no es
 * un campo vacio sino una fila que sobra — otra decision, y no esta.
 */
export function sinTextosEnBlanco<T extends object>(objeto: T): T {
  const salida: Record<string, unknown> = {
    ...(conTextosRecortados(objeto) as Record<string, unknown>),
  };

  for (const [clave, valor] of Object.entries(salida)) {
    // `=== ''` y no un `!valor`: solo una cadena puede ser igual a la cadena
    // vacia, asi que un `0` no entra aqui por accidente.
    if (valor === '') salida[clave] = null;
  }

  return salida as T;
}

/**
 * Recorta los bordes de todas las cadenas del primer nivel.
 *
 * ⚠️ LOS BORDES, NO EL INTERIOR. `sobreElSalon` se pinta con
 * `whitespace-pre-line` precisamente para que los saltos de linea que escribio
 * el admin se vean, asi que colapsarlos seria reescribirle el texto. Lo que
 * sobra son los de fuera: el que pega desde un procesador de textos arrastra
 * lineas en blanco arriba y abajo, y en una pagina indexada se ven.
 *
 * Recorta y NADA MAS: no anula. Quien decide que una cadena vacia vale `null`
 * es `sinTextosEnBlanco`, y por eso esta se puede usar sobre filas cuyos
 * campos el contrato declara como `string` sin mentirle a los tipos.
 */
export function conTextosRecortados<T extends object>(objeto: T): T {
  const salida: Record<string, unknown> = { ...(objeto as Record<string, unknown>) };

  for (const [clave, valor] of Object.entries(salida)) {
    if (typeof valor === 'string') salida[clave] = valor.trim();
  }

  return salida as T;
}

/**
 * Si un valor cuenta como "no vino".
 *
 * Lo es una cadena sin nada dentro, y tambien un `null` o un `undefined`.
 *
 * ⚠️ UN `0` Y UN `false` NO LO SON: son datos. Esta funcion decide si una fila
 * entera se descarta, asi que tragarse el cero aqui no deja un hueco, borra
 * contenido. Lo que no es ni texto ni ausencia sale como presente.
 */
export function estaEnBlanco(valor: unknown): boolean {
  if (valor === null || valor === undefined) return true;
  if (typeof valor !== 'string') return false;

  return valor.trim() === '';
}

/**
 * Quita de una lista las filas a las que les falta alguno de los campos que
 * las hacen tener sentido.
 *
 * Mismo razonamiento que `sinTextosEnBlanco`, un nivel mas abajo: desde la
 * calle, un testimonio con un nombre y nada debajo se ve igual de roto que una
 * seccion con encabezado y nada debajo, y una pregunta sin respuesta en un FAQ
 * parece algo que el gimnasio dejo a medias en su propia web.
 *
 * `undefined` sale como `undefined`: que no viniera la lista —la bandera
 * apagada— y que viniera sin nada usable no son lo mismo, por mas que la
 * landing acabe tratandolos igual.
 *
 * Las que sobreviven salen RECORTADAS: es el mismo recorte que ya reciben los
 * campos de primer nivel, y si viviera en otro sitio serian dos reglas.
 */
export function sinFilasIncompletas<T extends object>(
  filas: T[] | undefined,
  campos: (keyof T)[],
): T[] | undefined {
  if (filas === undefined) return undefined;

  return filas
    .map((fila) => conTextosRecortados(fila))
    .filter((fila) => campos.every((campo) => !estaEnBlanco(fila[campo])));
}
