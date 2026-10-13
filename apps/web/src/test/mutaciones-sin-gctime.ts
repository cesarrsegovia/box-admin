import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * NINGUNA MUTACION SIN `gcTime: 0`, Y LA GARANTIA ES DEL DIRECTORIO ENTERO.
 *
 * Por defecto TanStack conserva cada mutacion CINCO MINUTOS despues de que su
 * componente se desmonte, con lo que se MANDO (`variables`) y lo que VOLVIO
 * (`data`) dentro. El `QueryClient` es uno solo para toda la aplicacion y dura
 * lo que dura la pestaña. `reset()` no lo arregla: no limpia nada, solo
 * desengancha al observador y programa el recolector con el `gcTime` que haya.
 *
 * Por ahi pasan las dos contraseñas temporales del panel, los codigos de
 * invitacion, el texto de las fichas medicas y —lo que destapo este barrido—
 * el `File` del comprobante de pago del alumno: la foto o el PDF de su
 * transferencia, entero, en memoria, legible desde la consola de la maquina
 * del mostrador.
 *
 * ESTO BARRE EL DIRECTORIO, no un archivo. Antes habia un analizador copiado
 * dentro de tres specs, y la cobertura dependia de que alguien se acordara de
 * copiarlo una cuarta vez. Asi fue justamente como `use-comprobantes` se quedo
 * afuera guardando ese `File`, y como `use-rutinas` —que no tiene spec
 * ninguno— no podia estar cubierto por un centinela por spec. La propiedad que
 * hace falta es mas fuerte: un archivo de hooks NUEVO nace cubierto sin
 * necesitar su propio spec ni figurar en ninguna lista.
 */

export interface MutacionHallada {
  /** El archivo, p. ej. `use-turnos.ts`. */
  archivo: string;
  /** El hook o la constante que la declara, p. ej. `useCancelar` o `reservar`. */
  hook: string;
  /** Si lleva `gcTime: 0`. */
  tapada: boolean;
}

/**
 * Vacia comentarios y textos, dejando el codigo y las posiciones intactas.
 *
 * Hacen falta las dos cosas y por dos motivos distintos:
 *
 *  - un comentario que diga «`gcTime: 0`, como todas las de este archivo»
 *    —los hay, varios— haria pasar en verde a una mutacion desnuda; y
 *  - una llave dentro de un texto descuadraria el conteo de llaves con el que
 *    se delimita el bloque de opciones.
 *
 * Se reemplaza por espacios en vez de recortar: asi los indices siguen siendo
 * los mismos y los mensajes de error pueden hablar del archivo de verdad.
 */
export function soloCodigo(fuente: string): string {
  const salida: string[] = [];
  let i = 0;

  const blanco = (c: string): string => (c === '\n' ? '\n' : ' ');

  while (i < fuente.length) {
    const c = fuente[i] as string;
    const siguiente = fuente[i + 1];

    if (c === '/' && siguiente === '/') {
      salida.push('//');
      i += 2;
      while (i < fuente.length && fuente[i] !== '\n')
        (salida.push(blanco(fuente[i] as string)), i++);
      continue;
    }

    if (c === '/' && siguiente === '*') {
      salida.push('/*');
      i += 2;
      while (i < fuente.length && !(fuente[i] === '*' && fuente[i + 1] === '/')) {
        salida.push(blanco(fuente[i] as string));
        i++;
      }
      if (i < fuente.length) {
        salida.push('*/');
        i += 2;
      }
      continue;
    }

    if (c === "'" || c === '"' || c === '`') {
      salida.push(c);
      i++;
      while (i < fuente.length && fuente[i] !== c) {
        if (fuente[i] === '\\') {
          // Un escape se come el caracter siguiente: sin esto, `'\''` cerraria
          // donde no es y el resto del archivo se leeria como texto.
          salida.push(' ', ' ');
          i += 2;
          continue;
        }
        salida.push(blanco(fuente[i] as string));
        i++;
      }
      if (i < fuente.length) {
        salida.push(c);
        i++;
      }
      continue;
    }

    salida.push(c);
    i++;
  }

  return salida.join('');
}

/** `useMutation` con genericos o sin ellos, precedido o no por su `const`. */
const DECLARACION = /(?:const\s+(\w+)\s*=\s*)?useMutation\s*[<(]/g;

/**
 * Delimita el objeto de opciones de UNA llamada, contando llaves.
 *
 * No se delimita por sangria («hasta el `});` a dos espacios»), que es como lo
 * hacia el analizador copiado: una mutacion declarada a otra profundidad haria
 * que el bloque se estirara hasta el cierre de OTRA, y heredaria su
 * `gcTime: 0` sin tenerlo. Un falso verde es peor que un falso rojo.
 */
function bloqueDeOpciones(codigo: string, desde: number, archivo: string): string {
  // La llamada es siempre `useMutation<...>({` o `useMutation({`. Se busca el
  // `({` y no el primer `{`, porque los genericos llevan llaves propias:
  // `useMutation<R, E, { id: string; tipo: T }>({`.
  const apertura = codigo.indexOf('({', desde);
  if (apertura === -1) {
    throw new Error(`${archivo}: un useMutation sin objeto de opciones a la vista`);
  }

  let profundidad = 0;
  for (let i = apertura + 1; i < codigo.length; i += 1) {
    if (codigo[i] === '{') profundidad += 1;
    if (codigo[i] === '}') {
      profundidad -= 1;
      if (profundidad === 0) return codigo.slice(apertura, i + 1);
    }
  }

  throw new Error(`${archivo}: no se pudo cerrar el objeto de opciones de un useMutation`);
}

/** Todas las mutaciones de todos los hooks de ese directorio. */
export function mutacionesDeLosHooks(directorio: string): MutacionHallada[] {
  const archivos = readdirSync(directorio)
    .filter((nombre) => /\.tsx?$/.test(nombre) && !nombre.includes('.spec.'))
    .sort();

  const halladas: MutacionHallada[] = [];

  for (const archivo of archivos) {
    const codigo = soloCodigo(readFileSync(join(directorio, archivo), 'utf8'));
    const usadas = new Set<string>();
    let cuantas = 0;

    DECLARACION.lastIndex = 0;
    for (
      let hallada = DECLARACION.exec(codigo);
      hallada !== null;
      hallada = DECLARACION.exec(codigo)
    ) {
      cuantas += 1;
      const opciones = bloqueDeOpciones(codigo, hallada.index, archivo);

      // LAS DOS FORMAS DE DECLARARLAS. `const reservar = useMutation(...)`
      // trae su nombre puesto; `return useMutation(...)` lo toma del
      // `export function` mas cercano hacia atras. Sin la primera, los cuatro
      // de `use-acciones-de-turno` se llamarian igual.
      const base =
        hallada[1] ??
        [...codigo.slice(0, hallada.index).matchAll(/export function (\w+)/g)].at(-1)?.[1] ??
        `(sin nombre, posicion ${hallada.index})`;

      // Si dos cayeran bajo el mismo nombre, meterlas en un mapa por nombre
      // haria que la ultima tapara a las anteriores: una desnuda desapareceria
      // detras de una vestida. Se desempatan en vez de perderse.
      let hook = base;
      for (let repeticion = 2; usadas.has(hook); repeticion += 1) hook = `${base} #${repeticion}`;
      usadas.add(hook);

      halladas.push({ archivo, hook, tapada: /\bgcTime:\s*0\b/.test(opciones) });
    }

    // EL ANALIZADOR, VIGILADO, Y CON UNA SEÑAL INDEPENDIENTE. Un parseo que
    // deja de casar no devuelve un error: devuelve una lista corta, y una
    // lista corta aprueba.
    //
    // La señal NO puede ser la misma expresion que produjo el resultado —eso
    // seria preguntarle al acusado—, asi que se cuenta a secas cuantas veces
    // aparece la palabra en el codigo, descontando la del `import`. Si el
    // archivo la usa y el barrido no saco ninguna, el roto es el analizador.
    const menciones = (codigo.match(/useMutation/g) ?? []).length;
    const enElImport = /import[^;]*\buseMutation\b[^;]*from/.test(codigo) ? 1 : 0;

    if (cuantas === 0 && menciones - enElImport > 0) {
      throw new Error(
        `${archivo}: usa useMutation ${menciones - enElImport} vez/veces y el barrido no saco ninguna`,
      );
    }
  }

  return halladas;
}
