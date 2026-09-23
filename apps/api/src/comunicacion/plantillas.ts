import Handlebars from 'handlebars';
import type { TipoPlantilla } from '@boxadmin/shared';

export interface PlantillaCruda {
  asunto: string;
  cuerpoHtml: string;
}

/** Lo que una plantilla puede interpolar. Todo string: no hay formateo aqui. */
export type DatosDePlantilla = Record<string, string>;

/**
 * Las plantillas del codigo.
 *
 * Son constantes y no filas sembradas por gimnasio: un gimnasio nuevo funciona
 * sin configurar nada, y mejorar un texto por defecto es un cambio de codigo en
 * vez de una migracion de datos.
 *
 * El HTML es deliberadamente pobre. Un email con estilos elaborados se ve
 * distinto en cada cliente de correo y estos tienen que llegar legibles a todos.
 */
export const PLANTILLAS_POR_DEFECTO: Record<TipoPlantilla, PlantillaCruda> = {
  CONFIRMACION: {
    asunto: 'Reservaste {{clase}} para el {{fecha}}',
    cuerpoHtml:
      '<p>Hola {{alumno}},</p>' +
      '<p>Te reservamos <strong>{{clase}}</strong> el {{fecha}} a las {{hora}}.</p>' +
      '<p>{{gimnasio}}</p>',
  },
  CANCELACION: {
    asunto: 'Cancelaste {{clase}} del {{fecha}}',
    cuerpoHtml:
      '<p>Hola {{alumno}},</p>' +
      '<p>Cancelamos tu lugar en <strong>{{clase}}</strong> del {{fecha}} a las {{hora}}.</p>' +
      '<p>{{gimnasio}}</p>',
  },
  LISTA_ESPERA: {
    asunto: 'Se liberó un lugar en {{clase}}',
    cuerpoHtml:
      '<p>Hola {{alumno}},</p>' +
      '<p>Se liberó un lugar en <strong>{{clase}}</strong> del {{fecha}} a las {{hora}} ' +
      'y te lo asignamos. Ya no estás en la lista de espera.</p>' +
      '<p>{{gimnasio}}</p>',
  },
  RECORDATORIO_PAGO: {
    asunto: 'Tenés un pago pendiente en {{gimnasio}}',
    cuerpoHtml:
      '<p>Hola {{alumno}},</p>' +
      '<p>Nos figura un pago pendiente. Si ya lo hiciste, subí el comprobante desde la ' +
      'app y lo revisamos.</p>' +
      '<p>{{gimnasio}}</p>',
  },
  VENCIMIENTO_PACK: {
    asunto: 'Tu pack vence el {{fecha}}',
    cuerpoHtml:
      '<p>Hola {{alumno}},</p>' +
      // El cuerpo no repite el asunto: quien abre el mensaje ya lo leyo. Dice
      // lo que el asunto no dice, que es que pasa si no renueva.
      '<p>Después del {{fecha}} no vas a poder reservar hasta que lo renueves. ' +
      'Pasá por el gimnasio o escribinos y lo dejamos listo.</p>' +
      '<p>{{gimnasio}}</p>',
  },
};

/**
 * Compilar una plantilla cuesta parsearla, y el job diario de recordatorio
 * llama a `resolverMensaje` una vez por alumno con la misma plantilla: sin
 * memo, la misma cadena se reparsea tantas veces como alumnos tenga el
 * gimnasio.
 *
 * Esto no rompe la pureza de `resolverMensaje`: con las mismas entradas
 * devuelve lo mismo. Lo unico que cambia es cuanto tarda.
 *
 * Hay un cache por modo de escapado y no uno solo porque la misma cadena puede
 * renderizarse de las dos formas —un gimnasio puede poner el mismo texto de
 * asunto y de cuerpo— y una clave compartida devolveria la version equivocada.
 *
 * El tope existe porque la clave es texto que escribe el admin: sin el, cada
 * edicion de una plantilla dejaria una entrada viva para siempre. Pasado el
 * tope se sigue compilando igual, solo que sin guardar.
 */
const TOPE_DE_CACHE = 500;
const COMPILADAS: Record<'escapado' | 'crudo', Map<string, Handlebars.TemplateDelegate>> = {
  escapado: new Map(),
  crudo: new Map(),
};

function compilar(plantilla: string, escapar: boolean): Handlebars.TemplateDelegate {
  const cache = escapar ? COMPILADAS.escapado : COMPILADAS.crudo;

  const yaCompilada = cache.get(plantilla);
  if (yaCompilada) return yaCompilada;

  const compilada = Handlebars.compile(plantilla, { noEscape: !escapar });
  if (cache.size < TOPE_DE_CACHE) cache.set(plantilla, compilada);

  return compilada;
}

/**
 * El motivo por el que una plantilla NO parsea, o `null` si parsea bien.
 *
 * LA TRAMPA, y es la razon de que esta funcion use `precompile` y no `compile`:
 * **`Handlebars.compile` NO lanza con una plantilla mal formada.** Es perezoso —
 * devuelve una funcion y parsea la primera vez que se la invoca—, asi que una
 * comprobacion escrita como `try { Handlebars.compile(texto) } catch` pasa
 * SIEMPRE y no comprueba absolutamente nada. Verificado ejecutandolo:
 * `compile('{{#if x}}sin cerrar')` devuelve sin chistar y el error de parseo
 * sale recien al renderizar. `precompile` parsea en el acto, que es lo que hace
 * falta aqui.
 *
 * El texto que devuelve es el error de Handlebars tal cual, y se le puede
 * ensenar al admin: sale de la plantilla que el mismo acaba de escribir, asi
 * que no hay nada que sanear. No pasa por `motivoSeguro` a proposito.
 */
export function motivoDePlantillaInvalida(cruda: PlantillaCruda): string | null {
  for (const texto of [cruda.asunto, cruda.cuerpoHtml]) {
    try {
      Handlebars.precompile(texto);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  return null;
}

/**
 * Que plantilla gana y como queda renderizada.
 *
 * PURA: ni base de datos ni red. Es donde vive toda la logica de esta parte de
 * la fase, y por eso se puede probar con una tabla de casos.
 *
 * PUEDE LANZAR. Una plantilla mal formada revienta aqui, al renderizar, no al
 * compilar (ver `motivoDePlantillaInvalida`). `guardarPlantilla` rechaza las
 * invalidas con un 400 y las del codigo son validas, pero una fila vieja
 * guardada antes de esa validacion sigue pudiendo estar rota: por eso quien
 * llama —`MensajeroService.avisar`— lo hace dentro de su try.
 *
 * El CUERPO se renderiza con `{{ }}`, que Handlebars ESCAPA por defecto. Es
 * deliberado y no se puede relajar: las plantillas las escribe el admin, pero
 * los datos salen de nombres que eligen los alumnos, y un alumno llamado
 * `<script>alert(1)</script>` no puede convertirse en XSS contra el admin que
 * previsualiza su plantilla.
 *
 * El ASUNTO va SIN escapar, y las dos ramas no se pueden unificar:
 *
 * - El asunto no se renderiza como HTML. Termina en el `subject` de nodemailer,
 *   que es texto plano, asi que no hay XSS que prevenir ahi. Escaparlo solo
 *   rompe el texto: un alumno llamado `O'Brien & Ana` llegaria a la bandeja
 *   como `O&#x27;Brien &amp; Ana`.
 * - El riesgo real de un asunto no es el HTML sino la inyeccion de cabeceras
 *   por `\r\n`, y de eso no protege el escapado de Handlebars —que no toca los
 *   saltos de linea— sino nodemailer, que codifica el `subject` al armar la
 *   cabecera.
 *
 * Es decir: escapar el asunto no aporta ninguna defensa y si estropea nombres
 * corrientes. Hay un test que fija las dos ramas por separado.
 */
export function resolverMensaje(
  propia: PlantillaCruda | null,
  tipo: TipoPlantilla,
  datos: DatosDePlantilla,
): { asunto: string; html: string } {
  const plantilla = propia ?? PLANTILLAS_POR_DEFECTO[tipo];

  return {
    asunto: compilar(plantilla.asunto, false)(datos),
    html: compilar(plantilla.cuerpoHtml, true)(datos),
  };
}
