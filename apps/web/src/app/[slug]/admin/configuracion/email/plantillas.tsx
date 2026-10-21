'use client';

import { type FormEvent, useRef, useState } from 'react';
import type { PlantillaPublica, TipoPlantilla } from '@boxadmin/shared';
import { Aviso, Boton } from '@/componentes/ui';
import { useGuardarPlantilla, usePlantillas } from '@/hooks/use-configuracion';

/**
 * LAS CINCO PLANTILLAS DE LOS AVISOS: EL OTRO RECURSO DEL `@Controller('config')`.
 *
 * ---------------------------------------------------------------------------
 * UNA PLANTILLA POR DEFECTO NO ES UNA PLANTILLA TUYA, Y SE DICE.
 *
 * `GET /config/plantillas` devuelve SIEMPRE las cinco: `listarPlantillas()`
 * recorre `TIPOS_DE_PLANTILLA` y para cada tipo usa la fila del gimnasio o, si
 * no hay, `PLANTILLAS_POR_DEFECTO[tipo]`, marcando `esPorDefecto: propia ===
 * undefined`. O sea que un gimnasio nuevo ve cinco textos completos y
 * funcionando sin haber configurado nada.
 *
 * Por eso el `esPorDefecto` se DIBUJA. Pintar el texto del codigo sin decir de
 * donde sale le hace creer al admin que ese texto lo escribio el: lee «su»
 * plantilla, cambia una palabra, y lo que esta haciendo en realidad es CREAR la
 * primera —el `create` de `guardarPlantilla`, no el `update`—. La diferencia
 * importa el dia que mejoremos un texto por defecto: a quien no haya guardado
 * nunca le llega la mejora, y a quien guardo una vez, no.
 *
 * ---------------------------------------------------------------------------
 * LOS MARCADORES: DE DONDE SALE LA LISTA, Y POR QUE NO ESTA ESCRITA AQUI.
 *
 * Las plantillas son Handlebars y los datos son `DatosDePlantilla =
 * Record<string, string>`: LOS MARCADORES VALIDOS DE CADA TIPO NO ESTAN
 * DECLARADOS EN NINGUN SITIO. Son los que cada emisor le pasa a
 * `resolverMensaje`, y eso es codigo del servidor, no un contrato.
 *
 * Y el riesgo no es un error: **Handlebars renderiza un marcador que no existe
 * como CADENA VACIA, no como literal.** Un `{{clase}}` en `RECORDATORIO_PAGO`
 * —que solo recibe `alumno` y `gimnasio`— no le llega al alumno como
 * `{{clase}}`: le llega como un hueco. «Te esperamos en » y nada. El admin no
 * se entera nunca, porque el email que se rompe no es el suyo.
 *
 * EL CRITERIO: los marcadores que se listan son los de la plantilla POR
 * DEFECTO de ese tipo. Es la unica lista del repo garantizada a funcionar —las
 * defaults rinden bien por construccion, el emisor les pasa lo que usan—. Puede
 * quedarse CORTA si un emisor manda mas datos de los que su default gasta, pero
 * NUNCA promete uno que no llega. Under-reportar es el lado barato del error:
 * un marcador de mas en la lista es un hueco en el email de un alumno.
 *
 * ⚠️ Y EL PROBLEMA DE VERDAD: `PLANTILLAS_POR_DEFECTO` vive en
 * `apps/api/src/comunicacion/plantillas.ts` y NO SE PUEDE IMPORTAR desde el
 * panel. Copiar la lista a mano —`CONFIRMACION: ['alumno', 'clase', …]`— seria
 * una SEGUNDA FUENTE DE VERDAD que se desincroniza en silencio: el dia que
 * alguien mejore el texto por defecto de `VENCIMIENTO_PACK` y le agregue un
 * `{{hora}}`, esta lista seguiria diciendo lo de antes y nadie se enteraria,
 * porque no hay ningun test que pueda comparar dos archivos que no se ven.
 *
 * LO QUE SE HACE EN SU LUGAR: la lista se EXTRAE DEL TEXTO QUE MANDA LA API.
 * Cuando un tipo llega con `esPorDefecto: true`, el `cuerpoHtml` y el `asunto`
 * que vienen en esa respuesta SON, literalmente, los de `plantillas.ts` —el
 * service los copia campo a campo—. O sea que `plantillas.ts` sigue siendo la
 * unica fuente: viaja por el cable en vez de estar copiada. Si mañana le
 * agregan un `{{hora}}` al texto por defecto, el panel lo lista sin que nadie
 * toque este archivo.
 *
 * EL LIMITE DE ESO, DICHO Y NO DISIMULADO: para un tipo que el gimnasio YA
 * reescribio, la API manda la plantilla del gimnasio y la por defecto no viaja.
 * De ese tipo no se puede saber la lista, y entonces NO SE LISTA NINGUNA y se
 * explica por que. Es mejor listar menos que inventar. Lo unico que se guarda
 * es lo que SI se llego a ver: si un tipo llego por defecto en esta sesion y
 * despues se guardo, los marcadores aprendidos siguen puestos —no se dedujeron,
 * se vieron—.
 *
 * ---------------------------------------------------------------------------
 * EL AVISO DE UN MARCADOR DE FUERA AVISA, Y NO BLOQUEA.
 *
 * La lista under-reporta A PROPOSITO, asi que un marcador que no este en ella
 * puede ser un hueco de verdad —`{{clase}}` en `RECORDATORIO_PAGO`— o un dato
 * que el emisor manda y la default no usa. Bloquear el guardado convertiria el
 * conservadurismo de la lista en un impedimento: dejaria al admin sin poder
 * escribir algo correcto porque el panel no tiene forma de saberlo. Se dice lo
 * que se sabe y se guarda igual.
 *
 * ---------------------------------------------------------------------------
 * LA PREVISUALIZACION VA EN UN `<iframe sandbox>` SIN PERMISOS.
 *
 * Es lo unico que deja ver como llega el email de verdad, y el HTML de una
 * plantilla lo escribe un admin: con un `dangerouslySetInnerHTML` ese HTML
 * correria DENTRO del panel, con la sesion de quien lo este mirando —que puede
 * ser otro admin, o un superadmin—. El `sandbox` VACIO es un `sandbox` sin
 * ningun permiso: ni scripts, ni formularios, ni mismo origen. Un
 * `sandbox="allow-scripts allow-same-origin"` se ve exactamente igual de bien y
 * no aisla nada, por eso el spec afirma sobre el ATRIBUTO.
 *
 * El HTML entra por el ATRIBUTO `srcdoc`, que el navegador parsea en el
 * documento ANIDADO. En el documento del panel ese HTML nunca llega a ser
 * nodos: es texto dentro de un atributo.
 *
 * ⚠️ LO QUE EL SANDBOX NO HACE, dicho para que nadie lo suponga: no impide que
 * el documento anidado PIDA recursos. Un `<img src="https://…">` dentro de una
 * plantilla hace su peticion igual al previsualizar. Por eso el marco lleva
 * `referrerPolicy="no-referrer"`: es lo que se puede declarar. Lo que no se
 * puede es prometer que no salga la peticion.
 *
 * ---------------------------------------------------------------------------
 * LA PREVISUALIZACION NO ES UN RENDER DE HANDLEBARS, Y LO DICE.
 *
 * El panel no tiene Handlebars —no esta en las dependencias de `apps/web` y
 * meterlo seria arrastrar un compilador entero al bundle para pintar un
 * ejemplo—. Lo que hace es sustituir los marcadores SUELTOS por un ejemplo; los
 * bloques (`{{#if}}`, `{{#each}}`) se ven tal cual estan escritos. Decirlo es
 * parte de la previsualizacion: una que fingiera resolver los bloques estaria
 * mintiendo sobre la mitad del lenguaje.
 *
 * EL ASUNTO NO VA EN EL MARCO, y no es un olvido. `resolverMensaje` renderiza
 * el asunto SIN escapar y termina en el `subject` de nodemailer, que es texto
 * plano: dibujarlo como HTML seria enseñar algo que no existe. Va como texto.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ EL CUERPO DE LA PLANTILLA SI QUEDA ESCRITO EN EL MARCADO DEL PANEL, Y SE
 * MIDIO.
 *
 * Es el mismo mecanismo que dejo el campo de la clave SMTP sin controlar en la
 * Tarea 5: un `<textarea>` CONTROLADO de React sincroniza su `defaultValue`, y
 * en un `<textarea>` el `defaultValue` ES SU TEXTO HIJO. Medido:
 * `<textarea id="t">CENTINELA-DEL-CUERPO</textarea>` en `document.body.innerHTML`.
 * Mas el `srcdoc` del marco, que es otro atributo con el mismo texto dentro.
 *
 * Aqui eso se deja estar, y la diferencia con la clave es la unica que importa:
 * EL CUERPO DE UNA PLANTILLA NO ES UN SECRETO. Es un texto que el gimnasio
 * escribe para mandarselo a sus alumnos, vuelve entero en cada `GET` y se
 * dibuja en pantalla. Que viaje en una foto del DOM no le cuenta a nadie nada
 * que no pudiera leer mirando. La clave era lo contrario: no vuelve nunca, y
 * por eso alli el precio de no controlar el campo valia la pena.
 */

// ---------------------------------------------------------------------------
// Los marcadores, extraidos del texto
// ---------------------------------------------------------------------------

/**
 * Un marcador de Handlebars, en sus dos formas: `{{x}}` y `{{{x}}}`.
 *
 * Las DOS hacen el mismo hueco cuando el dato no llega —el triple solo cambia
 * si se escapa, no si existe—, asi que las dos cuentan.
 */
const MARCADOR = /\{\{\{?\s*([^{}]*?)\s*\}?\}\}/g;

/**
 * Lo que puede ser una clave de `DatosDePlantilla`, que es `Record<string, string>`.
 *
 * Un nombre plano y nada mas. Lo que no encaje —`#if x`, `/if`, `! comentario`,
 * `> parcial`, `persona.nombre`, `formatear fecha`— NO es un marcador simple y
 * de el no se afirma nada: ni se lista, ni se avisa, ni se rellena en la
 * previsualizacion. Es la misma politica de under-reportar que la lista.
 */
const NOMBRE_DE_MARCADOR = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Las dos palabras que PARECEN un marcador y no lo son.
 *
 * `{{else}}` es la bisagra de un bloque y `{{this}}` es el contexto actual.
 * Ninguna de las dos es una clave de datos, y tratarlas como tales daria un
 * aviso de hueco donde no hay ninguno.
 */
const RESERVADAS = new Set(['else', 'this']);

/** Los marcadores simples de unos textos, sin repetir y en orden alfabetico. */
function marcadoresDe(...textos: string[]): string[] {
  const vistos = new Set<string>();

  for (const texto of textos) {
    for (const encuentro of texto.matchAll(MARCADOR)) {
      const nombre = encuentro[1] ?? '';
      if (NOMBRE_DE_MARCADOR.test(nombre) && !RESERVADAS.has(nombre)) vistos.add(nombre);
    }
  }

  // Alfabetico y no por aparicion: es una lista para leer, y el orden de
  // aparicion mezcla el asunto con el cuerpo y cambia al editar.
  return [...vistos].sort();
}

/**
 * El texto con cada marcador simple cambiado por un ejemplo visible.
 *
 * EL EJEMPLO SE FABRICA CON EL NOMBRE DEL MARCADOR —`«alumno»`— y no sale de
 * ninguna tabla: una tabla de ejemplos por nombre seria otra lista escrita a
 * mano que se desincroniza, y encima no podria cubrir un marcador que todavia
 * no existe. Las comillas angulares estan para que nadie confunda el ejemplo
 * con un dato de verdad.
 *
 * SE RELLENAN TODOS, incluidos los que el aviso dice que no van a llegar: esto
 * muestra DONDE va cada dato, no si llega. Lo segundo lo dice el aviso, con
 * nombre y apellido.
 *
 * No hace falta escapar el valor: por el filtro de `NOMBRE_DE_MARCADOR` lo que
 * se sustituye es `«` + letras, numeros y guiones bajos + `»`, donde no hay
 * ningun caracter con significado en HTML.
 */
function conEjemplos(texto: string): string {
  return texto.replace(MARCADOR, (entero: string, nombre: string) => {
    const limpio = nombre.trim();
    return NOMBRE_DE_MARCADOR.test(limpio) && !RESERVADAS.has(limpio) ? `«${limpio}»` : entero;
  });
}

/**
 * El documento del marco, armado alrededor del cuerpo.
 *
 * El `<meta charset>` va porque un `srcdoc` sin el se decodifica como latin-1 en
 * algunos navegadores y los acentos de una plantilla en español se ven rotos
 * —lo que haria que la previsualizacion mintiera justo sobre lo que existe para
 * enseñar—. `lang="es"` por el lector de pantalla.
 */
function documentoDePrevisualizacion(cuerpoHtml: string): string {
  return (
    '<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body>' +
    conEjemplos(cuerpoHtml) +
    '</body></html>'
  );
}

// ---------------------------------------------------------------------------
// Lo que dice la pantalla
// ---------------------------------------------------------------------------

/** Como se llama cada tipo en castellano. Es una ETIQUETA, no una politica. */
const NOMBRES_DE_LOS_TIPOS: Record<TipoPlantilla, string> = {
  CONFIRMACION: 'Confirmacion de reserva',
  CANCELACION: 'Cancelacion de reserva',
  RECORDATORIO_PAGO: 'Recordatorio de pago',
  LISTA_ESPERA: 'Lugar liberado de la lista de espera',
  VENCIMIENTO_PACK: 'Vencimiento del pack',
};

const PRINCIPIO_DEL_FALLO_DE_LECTURA = 'No se pudieron leer las plantillas: ';

/** El motivo de la API va TAL CUAL: es el error de Handlebars sobre SU texto. */
const PRINCIPIO_DEL_FALLO_DE_GUARDADO = 'No se pudo guardar la plantilla: ';

/**
 * EL EXITO AFIRMA LO QUE LA API COMPROBO Y NADA MAS.
 *
 * `guardarPlantilla` llama a `motivoDePlantillaInvalida(dto)` ANTES de escribir
 * y tira un 400 si no parsea, asi que un guardado bueno SI dice que el texto no
 * va a reventar al enviarse. Lo que no dice es que el resultado se lea bien ni
 * que los marcadores lleguen: eso son la previsualizacion y el aviso.
 */
const TEXTO_DEL_EXITO =
  'Guardada. La API comprueba que la plantilla parsea ANTES de escribirla, asi que esto dice ' +
  'ademas que el texto no va a reventar al enviarse. No dice que los datos lleguen ni que el ' +
  'resultado se lea bien: eso lo muestran los marcadores y la previsualizacion.';

/** Lo que distingue el texto del codigo del texto que escribio el gimnasio. */
const TEXTO_POR_DEFECTO =
  'Esta es la plantilla que trae el sistema. El gimnasio no escribio la suya, asi que lo de abajo ' +
  'no es tu texto: es el del codigo. Guardar aca no edita el tuyo, lo crea por primera vez, y ' +
  'desde entonces las mejoras que le hagamos al texto del sistema dejan de llegarte.';

const TEXTO_PROPIA =
  'Esta plantilla la escribio el gimnasio. Lo de abajo es tu texto y guardar lo reemplaza; el ' +
  'del sistema ya no se usa para este aviso.';

/** De donde sale la lista de marcadores, y hasta donde llega. */
const TEXTO_DE_LOS_MARCADORES =
  'Estos son los marcadores que usa la plantilla por defecto de este aviso, que es la unica ' +
  'lista que el panel puede saber de verdad. Los que figuran llegan siempre. Puede faltar ' +
  'alguno: si quien manda este aviso incluye mas datos de los que el texto por defecto gasta, ' +
  'el panel no tiene de donde enterarse. Se prefiere que falte uno a prometer uno que no llega.';

/**
 * CUANDO NO SE PUEDE SABER, SE DICE QUE NO SE PUEDE SABER.
 *
 * Es el caso del tipo que el gimnasio ya reescribio y que no se vio por defecto
 * en esta sesion: la API manda la plantilla en uso, que es la suya, y la del
 * codigo no viaja. Inventar una lista aqui seria exactamente la segunda fuente
 * de verdad que este archivo existe para no crear.
 */
const TEXTO_SIN_MARCADORES =
  'Los marcadores de este aviso no se pueden listar: el panel los saca de la plantilla por ' +
  'defecto, y la API solo manda la que esta en uso, que en este caso es la del gimnasio. Antes ' +
  'que inventar una lista que podria prometer un dato que no llega, no se lista ninguna.';

/** Lo que se dice cuando el texto usa un marcador que no esta en la lista. */
const PRINCIPIO_DEL_MARCADOR_DESCONOCIDO =
  'Handlebars no deja escrito un marcador que no exista: lo reemplaza por nada, asi que la frase ' +
  'le llega al alumno con un hueco en medio y nadie se entera de este lado. Estos no figuran ' +
  'entre los de este aviso, y pueden ser justo eso o datos que la lista no alcanza a ver. Se ' +
  'guarda igual: ';

/** Que es y que no es el marco de abajo. */
const TEXTO_DE_LA_PREVISUALIZACION =
  'Abajo, como llega el cuerpo del email. Los marcadores van rellenos con un ejemplo entre ' +
  'comillas —TODOS, tambien los que el aviso de arriba señala: esto muestra donde va cada dato, ' +
  'no si llega—. No es un render de Handlebars: los bloques como {{#if}} se ven tal cual estan ' +
  'escritos. Va en un marco aislado y sin permisos para que el HTML de una plantilla no pueda ' +
  'correr en la sesion de nadie.';

// ---------------------------------------------------------------------------
// Una plantilla
// ---------------------------------------------------------------------------

interface PropsDeUnaPlantilla {
  plantilla: PlantillaPublica;
  /** Los de la plantilla por defecto de ese tipo, o `null` si no se vio. */
  marcadores: string[] | null;
}

/**
 * EL FORMULARIO DE UNA PLANTILLA, CON SU PROPIA MUTACION.
 *
 * Cada una monta SU `useGuardarPlantilla`. Compartir una sola entre las cinco
 * haria que `isPending`, `isSuccess` e `isError` fueran los mismos cinco
 * carteles: guardar la de confirmacion dejaria un «guardada» colgando debajo de
 * las otras cuatro, y un 400 de una plantilla mal formada se pintaria debajo de
 * las cuatro que estan bien. Es el mismo motivo por el que el `tipo` viaja en
 * las VARIABLES y no en el hook: hay cinco en una pantalla.
 */
function UnaPlantilla({ plantilla, marcadores }: PropsDeUnaPlantilla) {
  const guardar = useGuardarPlantilla();

  /**
   * `null` mientras nadie escribio, y entonces manda lo que dijo el servidor.
   *
   * Mismo criterio que el formulario del SMTP: sembrar con un `useEffect` deja
   * una ventana de un render en blanco y pisa lo tecleado si la consulta se
   * refresca sola —y esta se refresca sola, porque guardar CUALQUIERA de las
   * cinco invalida la clave compartida—.
   */
  const [borrador, setBorrador] = useState<{ asunto: string; cuerpoHtml: string } | null>(null);

  const campos = borrador ?? { asunto: plantilla.asunto, cuerpoHtml: plantilla.cuerpoHtml };

  const idAsunto = `asunto-${plantilla.tipo}`;
  const idCuerpo = `cuerpo-${plantilla.tipo}`;

  /**
   * Los marcadores escritos que no figuran en la lista.
   *
   * Se miran el ASUNTO Y EL CUERPO: los dos pasan por Handlebars y los dos
   * hacen el mismo hueco. Un asunto «Reservaste  para el 3 de marzo» es ademas
   * el que mas se nota, porque es lo unico que se ve sin abrir el mensaje.
   *
   * Con la lista en `null` no hay nada con que comparar y no se avisa de nada:
   * avisar de todos seria tratar «no se sabe» como «no llega».
   */
  const desconocidos =
    marcadores === null
      ? []
      : marcadoresDe(campos.asunto, campos.cuerpoHtml).filter(
          (nombre) => !marcadores.includes(nombre),
        );

  function cambiar(parte: Partial<{ asunto: string; cuerpoHtml: string }>): void {
    setBorrador({ ...campos, ...parte });
  }

  function enviar(evento: FormEvent): void {
    evento.preventDefault();

    /**
     * LOS DESCONOCIDOS NO SE MIRAN AQUI, Y ESO ES EL PUNTO.
     *
     * El aviso avisa; el guardado sigue. La lista de marcadores under-reporta a
     * proposito, asi que un corte aca dejaria al admin sin poder escribir algo
     * correcto porque el panel no tiene forma de saber que lo es.
     */
    guardar.mutate(
      { tipo: plantilla.tipo, asunto: campos.asunto, cuerpoHtml: campos.cuerpoHtml },
      {
        // Se suelta el borrador para que lo que se vea sea lo guardado: la
        // invalidacion del hook ya trae la respuesta nueva, con su
        // `esPorDefecto` en `false`, que es lo que acaba de cambiar.
        onSuccess: () => setBorrador(null),
      },
    );
  }

  return (
    <article
      data-plantilla={plantilla.tipo}
      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
    >
      <h3 className="text-lg font-semibold text-slate-900">
        {NOMBRES_DE_LOS_TIPOS[plantilla.tipo]}
      </h3>

      {/* De quien es el texto. El valor va en un ATRIBUTO propio —`si`/`no`— y
          no deducido de la frase, para que se pueda afirmar CUAL de los dos
          casos se dibujo sin buscar subcadenas dentro del texto. */}
      <p className="text-sm text-slate-600" data-por-defecto={plantilla.esPorDefecto ? 'si' : 'no'}>
        {plantilla.esPorDefecto ? TEXTO_POR_DEFECTO : TEXTO_PROPIA}
      </p>

      <form className="flex flex-col gap-3" onSubmit={enviar} noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor={idAsunto} className="text-sm font-medium text-slate-700">
            Asunto
          </label>
          <input
            id={idAsunto}
            value={campos.asunto}
            onChange={(evento) => cambiar({ asunto: evento.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={idCuerpo} className="text-sm font-medium text-slate-700">
            Cuerpo del email (HTML)
          </label>
          <textarea
            id={idCuerpo}
            rows={6}
            value={campos.cuerpoHtml}
            onChange={(evento) => cambiar({ cuerpoHtml: evento.target.value })}
            className="rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
          />
        </div>

        {/* LOS MARCADORES DE ESTE TIPO, O LA EXPLICACION DE POR QUE NO LOS HAY.
            Cada uno en su nodo con su propio atributo: asi se puede afirmar la
            lista por igualdad en vez de buscar nombres dentro de una frase,
            donde un `gimnasio` se encuentra solo por estar la palabra. */}
        {marcadores === null ? (
          <p className="text-sm text-amber-800" data-marcadores="no-se-saben">
            {TEXTO_SIN_MARCADORES}
          </p>
        ) : (
          <div className="flex flex-col gap-1" data-marcadores="se-saben">
            <p className="text-sm text-slate-600">{TEXTO_DE_LOS_MARCADORES}</p>
            <ul className="flex flex-wrap gap-2">
              {marcadores.map((nombre) => (
                <li
                  key={nombre}
                  data-marcador={nombre}
                  className="rounded bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700"
                >
                  {`{{${nombre}}}`}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* AVISA Y NO BLOQUEA: el boton de abajo no mira esto. */}
        {desconocidos.length > 0 && (
          <p className="text-sm text-amber-800" data-marcadores-desconocidos>
            {PRINCIPIO_DEL_MARCADOR_DESCONOCIDO}
            {desconocidos.map((nombre) => `{{${nombre}}}`).join(', ')}
          </p>
        )}

        <Boton type="submit" cargando={guardar.isPending}>
          Guardar la plantilla
        </Boton>
      </form>

      {/* `alerta` por lo mismo que en el SMTP: el resultado aparece despues de
          pulsar y en otro sitio, y sin el rol quien usa un lector de pantalla
          pulsa y para el no pasa nada. */}
      {guardar.isSuccess && (
        <Aviso tono="exito" alerta>
          <span data-resultado="exito">{TEXTO_DEL_EXITO}</span>
        </Aviso>
      )}

      {/* EL MOTIVO DE LA API, ENTERO. Es `La plantilla no es valida: ` mas el
          error de Handlebars sobre el texto que el propio admin acaba de
          escribir —`motivoDePlantillaInvalida` lo devuelve tal cual y no pasa
          por `motivoSeguro` a proposito, porque no hay credencial que sanear—.
          Ese texto dice la linea y la columna; un «no se pudo guardar» generico
          deja al admin buscando una llave sin cerrar a ojo. */}
      {guardar.isError && (
        <Aviso tono="error">
          <span data-resultado="error">
            {PRINCIPIO_DEL_FALLO_DE_GUARDADO}
            {guardar.error.message}
          </span>
        </Aviso>
      )}

      <div className="flex flex-col gap-1">
        <p className="text-sm text-slate-600">{TEXTO_DE_LA_PREVISUALIZACION}</p>

        {/* El ASUNTO como TEXTO y no dentro del marco: `resolverMensaje` lo
            renderiza sin escapar y termina en el `subject` de nodemailer, que
            es texto plano. Dibujarlo como HTML enseñaria algo que no existe. */}
        <p className="text-sm text-slate-900" data-previsualizacion="asunto">
          {conEjemplos(campos.asunto)}
        </p>

        {/* EL MARCO. `sandbox` VACIO = sin un solo permiso: ni scripts, ni
            formularios, ni mismo origen, ni navegacion de la pagina de arriba.
            El HTML entra por el ATRIBUTO `srcdoc` y lo parsea el documento
            ANIDADO: en el del panel no llega a ser nodos nunca. */}
        <iframe
          title={`Previsualizacion de ${NOMBRES_DE_LOS_TIPOS[plantilla.tipo]}`}
          data-previsualizacion="cuerpo"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={documentoDePrevisualizacion(campos.cuerpoHtml)}
          className="h-48 w-full rounded-lg border border-slate-200 bg-white"
        />
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Las cinco
// ---------------------------------------------------------------------------

export function LasPlantillas() {
  const plantillas = usePlantillas();

  /**
   * LOS MARCADORES QUE SE LLEGARON A VER, POR TIPO.
   *
   * Un `ref` y no un estado: no se dibuja a partir de el una transicion, no
   * tiene que provocar un render y solo CRECE. Se aprende durante el render y
   * no en un efecto porque el valor hace falta en ESTE render —con un efecto,
   * la primera pasada dibujaria «no se pueden listar» y la segunda la lista, y
   * eso es un parpadeo que dice algo falso—. Es idempotente: solo escribe la
   * primera vez que ve un tipo, asi que volver a renderizar no lo cambia.
   *
   * Para que sirve: guardar una plantilla invalida la clave y la respuesta
   * nueva de ESE tipo ya viene con `esPorDefecto: false`. Sin esto, la lista de
   * marcadores desapareceria en el instante siguiente a guardar, que es justo
   * cuando el admin la esta usando. Lo que se conserva se VIO llegar; no se
   * deduce nada.
   */
  const aprendidos = useRef(new Map<TipoPlantilla, string[]>());

  if (plantillas.isPending) {
    return <p className="text-sm text-slate-500">Cargando las plantillas de los avisos…</p>;
  }

  const lista = plantillas.data;

  /**
   * UN FALLO AL LEER NO ABRE NINGUN FORMULARIO.
   *
   * A diferencia del SMTP, aqui NO HAY un 404 que signifique «todavia no hay
   * nada»: `listarPlantillas()` devuelve siempre las cinco, porque las que no
   * estan en la base salen del codigo. O sea que cualquier fallo es un fallo de
   * verdad, y unos formularios vacios encima de unas plantillas que SI existen
   * se guardarian encima de ellas.
   */
  if (lista === undefined) {
    return (
      <section className="flex flex-col gap-4" data-seccion="plantillas">
        <h2 className="text-xl font-semibold text-slate-900">Las plantillas de los avisos</h2>
        <Aviso tono="error">
          <span data-fallo="lectura-de-plantillas">
            {PRINCIPIO_DEL_FALLO_DE_LECTURA}
            {plantillas.error.message}
          </span>
        </Aviso>
      </section>
    );
  }

  // El aprendizaje, antes de dibujar: ver el comentario de `aprendidos`.
  for (const plantilla of lista) {
    if (plantilla.esPorDefecto && !aprendidos.current.has(plantilla.tipo)) {
      aprendidos.current.set(plantilla.tipo, marcadoresDe(plantilla.asunto, plantilla.cuerpoHtml));
    }
  }

  return (
    <section className="flex flex-col gap-4" data-seccion="plantillas">
      <h2 className="text-xl font-semibold text-slate-900">Las plantillas de los avisos</h2>

      <p className="text-sm text-slate-600">
        Cada aviso que manda el gimnasio sale de una de estas plantillas. Las que nadie escribio
        salen igual, con el texto que trae el sistema.
      </p>

      {/* SE DIBUJA LO QUE MANDA LA API, EN SU ORDEN. No hay una lista de cinco
          tipos escrita aca: `listarPlantillas()` recorre `TIPOS_DE_PLANTILLA` y
          devuelve las cinco siempre, asi que repetirlas en el panel seria otra
          segunda fuente de verdad —una que ademas dejaria un hueco mudo el dia
          que se agregue un sexto tipo de aviso—. */}
      {lista.map((plantilla) => (
        <UnaPlantilla
          key={plantilla.tipo}
          plantilla={plantilla}
          marcadores={aprendidos.current.get(plantilla.tipo) ?? null}
        />
      ))}
    </section>
  );
}
