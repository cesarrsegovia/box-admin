'use client';

import { type FormEvent, useState } from 'react';
import type { PreguntaAdmin, TestimonioAdmin } from '@boxadmin/shared';
import { Campo } from '@/componentes/formulario';
import { Aviso, Boton } from '@/componentes/ui';
import {
  useBorrarPregunta,
  useBorrarTestimonio,
  useCrearPregunta,
  useCrearTestimonio,
} from '@/hooks/use-configuracion';

/**
 * LAS DOS LISTAS QUE SE GUARDAN SOLAS, Y POR QUE VIVEN EN UN ARCHIVO HERMANO.
 *
 * ---------------------------------------------------------------------------
 * 1. PORQUE UN `page.tsx` NO PUEDE EXPORTAR NADA MAS QUE EL `default`.
 *
 * Next 15 lo prohibe y ni `tsc --noEmit` ni los tests lo ven: el error aparece
 * recien en `next build`, habla de `OmitWithTag` y «not assignable to never» y
 * no se parece en nada a la causa. Asi que todo lo que la pantalla necesite
 * exportar —estos dos bloques y el `CampoLargo` que comparten con ella— vive
 * aqui, en un archivo que no es una ruta.
 *
 * ---------------------------------------------------------------------------
 * 2. Y PORQUE EL ESTADO DE CADA ALTA TIENE QUE SER SUYO.
 *
 * Las dos listas NO pasan por el `PUT` general: un testimonio se da de alta con
 * su propio `POST /config/web-salon/testimonios` y se borra con su propio
 * `DELETE`. Si el borrador del alta viviera en el estado de la pantalla, junto
 * al del formulario grande, un `setBorrador({...})` mal apuntado —o un
 * `onSuccess` que limpiara «el formulario»— se llevaria por delante lo que la
 * persona tuviera a medio escribir en el otro lado.
 *
 * Teniendo cada bloque su propio `useState`, eso no es una disciplina que haya
 * que recordar: es que no hay ninguna variable compartida que pisar. Lo mismo
 * entre las dos listas entre si.
 *
 * ---------------------------------------------------------------------------
 * 3. LAS DOS ESCRITURAS INVALIDAN LA MISMA CLAVE QUE EL `PUT` GENERAL, Y ESO NO
 *    ES UNA COMODIDAD.
 *
 * `ConfiguracionWebSalon` lleva `testimonios` y `preguntas` DENTRO: no existe
 * un `GET /config/web-salon/testimonios` al que apuntar, asi que la unica
 * consulta que pinta esta lista es la de la web entera. Lo resuelve
 * `use-configuracion`; aqui solo se hereda.
 *
 * El efecto que SI es de esta pantalla: tras un alta, la consulta de la web se
 * refresca y el formulario grande recibe datos nuevos del servidor. Que eso no
 * pise lo tecleado es responsabilidad del borrador de `page.tsx` —ver su
 * comentario— y tiene su test.
 *
 * ---------------------------------------------------------------------------
 * EL `id` DE CADA FILA NO SE ESCRIBE EN EL MARCADO.
 *
 * Ni como `id` de un `<li>`, ni en un `data-`, ni en un `aria-controls`. Viaja
 * SOLO dentro del `onClick` de su fila. Es el mismo criterio que el resto del
 * panel: un identificador interno que no hace falta para nada de lo que se ve
 * no tiene por que estar en el HTML que cualquiera lee con el inspector. El
 * boton se distingue por el NOMBRE de quien dio el testimonio, que es lo que
 * la persona que borra esta mirando.
 */

/** Lo que se dice cuando el campo del orden no es un numero entero. */
const TEXTO_DEL_ORDEN_ROTO = 'Poné un numero entero, o dejalo vacio.';

/** Lo que se dice cuando falta un campo obligatorio, despues de intentarlo. */
const TEXTO_DEL_CAMPO_VACIO = 'Esto no puede quedar vacio.';

/**
 * El orden que hay que mandar: `undefined` si el campo esta vacio —entonces se
 * OMITE y la API pone su propio cero— y `null` si lo escrito no es un entero.
 *
 * `Number('')` es CERO y `Number(' ')` tambien: sin el corte del vacio, dejar
 * el campo en blanco mandaria un orden que nadie eligio. Y `Number.isInteger`
 * y no `parseInt`, que se come la cola de `3abc` y devuelve `3`.
 *
 * EL TOPE NO SE COMPRUEBA AQUI. `Min(0)` y `Max(100000)` viven en
 * `CrearTestimonioDto` y se quedan alli: repetirlos seria una segunda fuente de
 * verdad que el dia que cambie deja la pantalla rechazando lo que la API
 * acepta. Lo unico que se ataja aqui es que lo escrito sea una cantidad.
 */
function ordenDelCampo(texto: string): number | null | undefined {
  if (texto.trim() === '') return undefined;

  const numero = Number(texto);
  return Number.isInteger(numero) ? numero : null;
}

/**
 * Un campo de texto de varias lineas, con su etiqueta y su error.
 *
 * `Campo` envuelve un `<input>` y aqui hacen falta cajas largas de verdad: el
 * texto de un testimonio admite mil caracteres, la respuesta de una pregunta
 * dos mil y el «sobre el salon» de la pantalla grande cinco mil. Un `<input>`
 * de una linea para cinco mil caracteres no es un detalle de estilo: es no
 * poder releer lo que uno acaba de escribir antes de publicarlo.
 *
 * Vive aqui y no en `@/componentes/formulario` porque los archivos compartidos
 * no son de esta tarea. El dia que una segunda pantalla lo necesite, ese es su
 * sitio.
 */
export function CampoLargo({
  etiqueta,
  id,
  valor,
  error,
  filas = 3,
  alCambiar,
}: {
  etiqueta: string;
  id: string;
  valor: string;
  error?: string | undefined;
  filas?: number;
  alCambiar: (valor: string) => void;
}) {
  const idError = `${id}-error`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {etiqueta}
      </label>
      <textarea
        id={id}
        rows={filas}
        value={valor}
        // Igual que `Campo`: es lo que hace que un lector de pantalla lea el
        // error junto al campo en vez de dejarlo suelto al final.
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : idError}
        onChange={(evento) => alCambiar(evento.target.value)}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      {error !== undefined && (
        <p id={idError} className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Los testimonios
// ---------------------------------------------------------------------------

export function ListaDeTestimonios({ testimonios }: { testimonios: TestimonioAdmin[] }) {
  const crear = useCrearTestimonio();
  const borrar = useBorrarTestimonio();

  const [nombre, setNombre] = useState('');
  const [texto, setTexto] = useState('');
  const [orden, setOrden] = useState('');

  /**
   * Los errores de «falta esto» aparecen DESPUES de intentar, no antes.
   *
   * Un formulario que llega con dos campos en rojo porque todavia no se
   * escribio nada enseña a ignorar el rojo. El del orden si aparece al
   * instante: habla de lo que hay TECLEADO, no de lo que falta.
   */
  const [intentado, setIntentado] = useState(false);

  const ordenAMandar = ordenDelCampo(orden);
  const faltaElNombre = nombre.trim() === '';
  const faltaElTexto = texto.trim() === '';

  function agregar(evento: FormEvent): void {
    evento.preventDefault();
    setIntentado(true);

    if (faltaElNombre || faltaElTexto || ordenAMandar === null) return;

    crear.mutate(
      {
        nombre: nombre.trim(),
        texto: texto.trim(),
        // El orden vacio se OMITE: la clave no viaja. Mandar un cero seria
        // elegir por quien no eligio, y mandar `undefined` dentro del objeto
        // es lo mismo que omitirlo solo porque `JSON.stringify` lo borra —algo
        // que depende de como serialice el cliente y no de esta decision—.
        ...(ordenAMandar === undefined ? {} : { orden: ordenAMandar }),
      },
      {
        onSuccess: () => {
          setNombre('');
          setTexto('');
          setOrden('');
          setIntentado(false);
        },
      },
    );
  }

  return (
    <section className="flex flex-col gap-3" data-lista="testimonios">
      <h2 className="text-lg font-semibold text-slate-900">Los testimonios</h2>
      <p className="text-sm text-slate-600">
        Lo que dicen los alumnos, con su nombre. Se publica TAL CUAL en una pagina que puede leer
        cualquiera: pedí permiso antes de poner el nombre de alguien.
      </p>

      {testimonios.length === 0 ? (
        <p className="text-sm text-slate-500" data-vacio="testimonios">
          Todavia no hay ningun testimonio cargado.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {testimonios.map((testimonio) => (
            <li
              key={testimonio.id}
              data-fila="testimonio"
              className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"
            >
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-slate-900" data-campo="nombre">
                  {testimonio.nombre}
                </p>
                <p className="text-sm text-slate-600" data-campo="texto">
                  {testimonio.texto}
                </p>
                <p className="text-xs text-slate-500">
                  Orden: <span data-campo="orden">{testimonio.orden}</span>
                </p>
              </div>

              {/* `cargando` SOLO en la fila que se esta borrando: con la
                  condicion en `borrar.isPending` a secas, pulsar un boton
                  dejaria los N botones en «cargando» y la pantalla diria que
                  se estan borrando todos. */}
              <Boton
                type="button"
                tono="peligro"
                cargando={borrar.isPending && borrar.variables === testimonio.id}
                onClick={() => borrar.mutate(testimonio.id)}
              >
                {`Borrar el testimonio de ${testimonio.nombre}`}
              </Boton>
            </li>
          ))}
        </ul>
      )}

      {borrar.isError && (
        <Aviso tono="error">
          <span data-fallo="borrar-testimonio">
            {'No se pudo borrar el testimonio: '}
            {borrar.error.message}
          </span>
        </Aviso>
      )}

      <form
        aria-label="Agregar un testimonio"
        onSubmit={agregar}
        className="flex flex-col gap-3 border-t border-slate-200 pt-3"
        noValidate
      >
        <Campo
          etiqueta="Nombre de quien lo dice"
          id="testimonio-nombre"
          value={nombre}
          error={intentado && faltaElNombre ? TEXTO_DEL_CAMPO_VACIO : undefined}
          onChange={(evento) => setNombre(evento.target.value)}
        />

        <CampoLargo
          etiqueta="Lo que dice"
          id="testimonio-texto"
          valor={texto}
          error={intentado && faltaElTexto ? TEXTO_DEL_CAMPO_VACIO : undefined}
          alCambiar={setTexto}
        />

        <Campo
          etiqueta="Orden (opcional)"
          id="testimonio-orden"
          type="number"
          value={orden}
          error={ordenAMandar === null ? TEXTO_DEL_ORDEN_ROTO : undefined}
          onChange={(evento) => setOrden(evento.target.value)}
        />

        <Boton type="submit" cargando={crear.isPending} className="self-start">
          Agregar el testimonio
        </Boton>
      </form>

      {crear.isError && (
        <Aviso tono="error">
          <span data-fallo="crear-testimonio">
            {'No se pudo agregar el testimonio: '}
            {crear.error.message}
          </span>
        </Aviso>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Las preguntas frecuentes
// ---------------------------------------------------------------------------

/**
 * El gemelo de arriba, escrito entero y no factorizado con el.
 *
 * Son dos recursos distintos —`testimonios` y `faq`, con DTOs distintos y
 * nombres de campo distintos— y lo unico que comparten es la forma. Un
 * componente generico con los dos dentro tendria que recibir las rutas, los
 * nombres de los campos y los dos pares de hooks por parametro, y la unica
 * forma de equivocarse que importa aqui —borrar de la lista que no es— pasaria
 * a depender de que argumento llego a que parametro, que es mucho mas facil de
 * cruzar que dos bloques que no se tocan.
 */
export function ListaDePreguntas({ preguntas }: { preguntas: PreguntaAdmin[] }) {
  const crear = useCrearPregunta();
  const borrar = useBorrarPregunta();

  const [pregunta, setPregunta] = useState('');
  const [respuesta, setRespuesta] = useState('');
  const [orden, setOrden] = useState('');
  const [intentado, setIntentado] = useState(false);

  const ordenAMandar = ordenDelCampo(orden);
  const faltaLaPregunta = pregunta.trim() === '';
  const faltaLaRespuesta = respuesta.trim() === '';

  function agregar(evento: FormEvent): void {
    evento.preventDefault();
    setIntentado(true);

    if (faltaLaPregunta || faltaLaRespuesta || ordenAMandar === null) return;

    crear.mutate(
      {
        pregunta: pregunta.trim(),
        respuesta: respuesta.trim(),
        ...(ordenAMandar === undefined ? {} : { orden: ordenAMandar }),
      },
      {
        onSuccess: () => {
          setPregunta('');
          setRespuesta('');
          setOrden('');
          setIntentado(false);
        },
      },
    );
  }

  return (
    <section className="flex flex-col gap-3" data-lista="preguntas">
      <h2 className="text-lg font-semibold text-slate-900">Las preguntas frecuentes</h2>
      <p className="text-sm text-slate-600">
        Lo que preguntan por WhatsApp antes de venir. Se publica tal cual en la web.
      </p>

      {preguntas.length === 0 ? (
        <p className="text-sm text-slate-500" data-vacio="preguntas">
          Todavia no hay ninguna pregunta cargada.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {preguntas.map((fila) => (
            <li
              key={fila.id}
              data-fila="pregunta"
              className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3"
            >
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-slate-900" data-campo="pregunta">
                  {fila.pregunta}
                </p>
                <p className="text-sm text-slate-600" data-campo="respuesta">
                  {fila.respuesta}
                </p>
                <p className="text-xs text-slate-500">
                  Orden: <span data-campo="orden">{fila.orden}</span>
                </p>
              </div>

              <Boton
                type="button"
                tono="peligro"
                cargando={borrar.isPending && borrar.variables === fila.id}
                onClick={() => borrar.mutate(fila.id)}
              >
                {`Borrar la pregunta: ${fila.pregunta}`}
              </Boton>
            </li>
          ))}
        </ul>
      )}

      {borrar.isError && (
        <Aviso tono="error">
          <span data-fallo="borrar-pregunta">
            {'No se pudo borrar la pregunta: '}
            {borrar.error.message}
          </span>
        </Aviso>
      )}

      <form
        aria-label="Agregar una pregunta"
        onSubmit={agregar}
        className="flex flex-col gap-3 border-t border-slate-200 pt-3"
        noValidate
      >
        <Campo
          etiqueta="La pregunta"
          id="pregunta-pregunta"
          value={pregunta}
          error={intentado && faltaLaPregunta ? TEXTO_DEL_CAMPO_VACIO : undefined}
          onChange={(evento) => setPregunta(evento.target.value)}
        />

        <CampoLargo
          etiqueta="La respuesta"
          id="pregunta-respuesta"
          valor={respuesta}
          error={intentado && faltaLaRespuesta ? TEXTO_DEL_CAMPO_VACIO : undefined}
          alCambiar={setRespuesta}
        />

        <Campo
          etiqueta="Orden (opcional)"
          id="pregunta-orden"
          type="number"
          value={orden}
          error={ordenAMandar === null ? TEXTO_DEL_ORDEN_ROTO : undefined}
          onChange={(evento) => setOrden(evento.target.value)}
        />

        <Boton type="submit" cargando={crear.isPending} className="self-start">
          Agregar la pregunta
        </Boton>
      </form>

      {crear.isError && (
        <Aviso tono="error">
          <span data-fallo="crear-pregunta">
            {'No se pudo agregar la pregunta: '}
            {crear.error.message}
          </span>
        </Aviso>
      )}
    </section>
  );
}
