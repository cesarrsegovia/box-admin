'use client';

import { type FormEvent, useState } from 'react';
import { rolAlcanza } from '@boxadmin/shared';
import { Campo } from '@/componentes/formulario';
import { Aviso, Boton } from '@/componentes/ui';
import {
  RUTA_DE_LA_IMAGEN_DEL_QR,
  useConfigCheckIn,
  useGuardarCheckIn,
} from '@/hooks/use-configuracion';
import { useRolDeQuienMira } from '../../rol-del-panel';

/**
 * LA VENTANA DEL CHECK-IN Y EL CARTEL DEL QR.
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTA PANTALLA NO PUEDE AFIRMAR.
 *
 * `ConfigCheckInService.ver()` devuelve `CONFIG_CHECKIN_POR_DEFECTO`
 * —`{ minutosAntes: 15, minutosDespues: 15 }`— cuando NO HAY FILA, y el
 * contrato dice por que: «la ausencia de configuracion no puede ser un check-in
 * roto». Comprobado leyendo el service, no deducido: el `findFirst` devuelve
 * `null` y el `ver()` sustituye la constante, sin ninguna marca que acompañe a
 * los dos numeros.
 *
 * O sea que DESDE LA RESPUESTA NO SE PUEDE SABER si alguien eligio quince y
 * quince o si nunca toco nada. Y a diferencia de los nulos de la Fase 10 —donde
 * `null` significaba «hereda» y habia que distinguirlo de un valor propio—
 * aca EL COMPORTAMIENTO ES IDENTICO en los dos casos: no hay nada que mentir.
 *
 * Por eso esta pantalla dice QUE VENTANA RIGE HOY y no dice ni «sin
 * configurar» ni «valores por defecto»: las dos serian afirmaciones que la
 * respuesta no sostiene. Un «sin configurar» encima de una fila guardada a
 * mano con quince y quince es una mentira, y un cartel que no aparece el dia
 * que alguien guarda los mismos quince es un cambio invisible.
 *
 * Y TAMPOCO SE PONE UNA ACLARACION DEL ESTILO «los haya elegido alguien o no».
 * Es verdadera, pero habla de una distincion INTERNA que no cambia nada de lo
 * que pasa en la puerta del gimnasio. La diferencia con el «esto NO confirma
 * que el trabajo se haya procesado» del indice es que aquel tapaba una lectura
 * FALSA y probable —«los emails salen»—; aca no hay lectura falsa posible: los
 * minutos que se ven son los minutos que rigen.
 *
 * ---------------------------------------------------------------------------
 * EL QR VA COMO `src` DE UN `<img>`, NO POR `pedir`.
 *
 * `GET /config/checkin-qr/imagen` responde `image/png` y un cuerpo binario;
 * `pedir` hace `JSON.parse` de lo que llega y reventaria con un `SyntaxError`
 * que no dice nada de lo que pasa. El razonamiento entero —y los cinco pasos
 * por los que la cookie `bx_access` viaja sola con la imagen— esta en el
 * docblock de `RUTA_DE_LA_IMAGEN_DEL_QR`.
 *
 * ES UN `<img>` PELADO Y NO UN `next/image`: el componente de Next reescribe
 * el `src` hacia `/_next/image?url=…`, que es su optimizador y no nuestro
 * proxy, y por ahi no viaja la cookie de sesion. Un `unoptimized` lo evitaria,
 * pero seria pedirle a un componente que no haga lo unico que hace.
 *
 * Y SIN `?t=Date.now()`: guardar la ventana no cambia un pixel del cartel —el
 * PNG lleva la firma del gimnasio, que no depende de los minutos— y un `src`
 * atado al reloj vuelve a pedir el PNG en cada render.
 *
 * ---------------------------------------------------------------------------
 * LA PUERTA ES LA MISMA QUE LA DEL INDICE, Y POR EL MISMO MOTIVO.
 *
 * Los tres endpoints de este recurso piden `ADMIN_SALON`. La puerta va ANTES
 * de todos los hooks y en un componente aparte: no montar `PantallaDeCheckIn`
 * es no tener ni la consulta ni —lo que aca es nuevo— EL `<img>`, que es una
 * peticion de red que no pasa por `fetch` y que un `hidden` dejaria saliendo
 * igual.
 *
 * ---------------------------------------------------------------------------
 * ESTE ARCHIVO NO EXPORTA NADA MAS QUE EL `default`. Next 15 lo prohibe en un
 * `page.tsx`, ni `tsc --noEmit` ni los tests lo ven, y el error habla de
 * `OmitWithTag`. Por eso los textos son constantes del modulo SIN exportar y
 * el spec los repite escritos a mano.
 */

/** El principio de la frase que dice que ventana rige. */
const PRINCIPIO_DE_LA_VENTANA = 'Hoy se puede marcar presente desde ';

/** Lo que se dice cuando la lectura de la ventana falla. */
const PRINCIPIO_DEL_FALLO_DE_LECTURA = 'No se pudo leer la ventana del check-in: ';

/** Lo que se dice cuando el guardado falla. El mensaje de la API va TAL CUAL. */
const PRINCIPIO_DEL_FALLO_DE_GUARDADO = 'No se pudo guardar la ventana: ';

/**
 * EL EXITO DICE LO QUE CAMBIO Y, EN LA MISMA FRASE, LO QUE NO.
 *
 * Quien guarda esta mirando el cartel del QR en la misma pantalla, y la
 * lectura obvia de un «guardado» suelto es «hay que volver a imprimirlo». Es
 * justo al reves: el PNG lleva la firma del gimnasio y no los minutos.
 */
const TEXTO_DEL_EXITO =
  'Ventana guardada. El cartel del QR no cambia: lleva la firma del gimnasio y no los minutos, ' +
  'asi que el que ya esta pegado en la pared sigue sirviendo.';

/**
 * Lo que se dice cuando el campo no es un numero entero de minutos.
 *
 * ESTO NO ES LA POLITICA, ES EL PARSEO. El tope de doce horas vive en
 * `GuardarConfigQrDto` y se queda alli: repetirlo aca seria una segunda fuente
 * de verdad que el dia que cambie deja la pantalla rechazando lo que la API
 * acepta. Lo unico que se ataja aqui es que `Number('')` es CERO —un campo
 * vacio se mandaria como «solo a la hora exacta» sin que nadie lo eligiera— y
 * que un `12abc` no es una cantidad de minutos.
 */
const TEXTO_DEL_CAMPO_ROTO = 'Poné un numero entero de minutos.';

/** Lo que el formulario tiene escrito, como texto: es lo que hay en un input. */
interface Borrador {
  antes: string;
  despues: string;
}

/**
 * El texto de un campo como minutos, o `null` si no es una cantidad.
 *
 * `Number('')` es `0` y `Number(' ')` tambien: sin el corte del vacio, borrar
 * el campo y guardar mandaria un cero que nadie escribio. Y `Number.isInteger`
 * y no `parseInt`, que se come la cola de `12abc` y devuelve `12`.
 */
function minutosDelCampo(texto: string): number | null {
  if (texto.trim() === '') return null;

  const numero = Number(texto);
  return Number.isInteger(numero) ? numero : null;
}

/** La pantalla ya pasada la puerta. Aqui dentro viven TODOS los hooks. */
function PantallaDeCheckIn() {
  const config = useConfigCheckIn();
  const guardar = useGuardarCheckIn();

  /**
   * El borrador es `null` MIENTRAS NADIE ESCRIBIO, y entonces mandan los
   * numeros del servidor.
   *
   * No se siembra el estado con un `useEffect` al llegar la respuesta: eso
   * deja una ventana de un render con los campos vacios —que es un cero
   * disfrazado— y pisa lo que la persona este escribiendo si la consulta se
   * refresca sola.
   */
  const [borrador, setBorrador] = useState<Borrador | null>(null);

  /** Lo que la API dice que rige hoy. `undefined` hasta que llega. */
  const ventana = config.data;

  if (config.isPending) {
    return <p className="text-sm text-slate-500">Cargando la ventana del check-in…</p>;
  }

  /**
   * UN FALLO AL LEER NO SE DIBUJA COMO UNA CONFIGURACION EN CERO.
   *
   * Es el mismo error que el 404 deducido de la Fase 10: una respuesta que no
   * llego pintada como un dato vacio. Aqui seria peor que vacia —seria
   * PLAUSIBLE—: dos ceros son una ventana valida («solo a la hora exacta») y
   * quien mire la pantalla se iria creyendo que su gimnasio esta asi. Asi que
   * no hay frase de ventana, no hay formulario y no hay campos: hay el motivo.
   */
  if (ventana === undefined) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">El check-in por QR</h1>
        <Aviso tono="error">
          <span data-fallo="lectura">
            {PRINCIPIO_DEL_FALLO_DE_LECTURA}
            {config.error.message}
          </span>
        </Aviso>
      </section>
    );
  }

  const campos: Borrador = borrador ?? {
    antes: String(ventana.minutosAntes),
    despues: String(ventana.minutosDespues),
  };

  const minutosAntes = minutosDelCampo(campos.antes);
  const minutosDespues = minutosDelCampo(campos.despues);

  function enviar(evento: FormEvent) {
    evento.preventDefault();

    // Las dos comparaciones son contra `null` y no `!minutosAntes`: CERO es un
    // valor —«solo a partir de la hora exacta del inicio», dice el DTO— y un
    // falsy lo trataria como campo sin llenar.
    if (minutosAntes === null || minutosDespues === null) return;

    guardar.mutate(
      { minutosAntes, minutosDespues },
      // Al volver, mandan otra vez los numeros del servidor: la invalidacion
      // del hook refresca la consulta y el borrador tiene que soltar el mando
      // para que lo que se vea sea lo guardado y no lo tecleado.
      { onSuccess: () => setBorrador(null) },
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">El check-in por QR</h1>

      {/* QUE VENTANA RIGE HOY, Y NADA SOBRE DE DONDE SALEN LOS NUMEROS.
          Los dos numeros van en nodos propios para que el spec pueda afirmar
          sobre ELLOS —un cero se lee `0` y no se lee «vacio»— sin buscar
          subcadenas sueltas dentro de la frase. */}
      <p className="text-sm text-slate-600" data-ventana-rige>
        {PRINCIPIO_DE_LA_VENTANA}
        <strong data-minutos="antes">{ventana.minutosAntes}</strong>
        {' minutos antes del inicio del turno y hasta '}
        <strong data-minutos="despues">{ventana.minutosDespues}</strong>
        {' minutos despues.'}
      </p>

      <form className="flex max-w-sm flex-col gap-3" onSubmit={enviar}>
        <Campo
          etiqueta="Minutos antes del inicio"
          id="minutos-antes"
          type="number"
          min={0}
          // `value` SIEMPRE una cadena, y `String(0)` es `'0'`: un `||` aqui
          // dibujaria el cero como campo vacio.
          value={campos.antes}
          error={minutosAntes === null ? TEXTO_DEL_CAMPO_ROTO : undefined}
          onChange={(evento) => setBorrador({ ...campos, antes: evento.target.value })}
        />

        <Campo
          etiqueta="Minutos despues del inicio"
          id="minutos-despues"
          type="number"
          min={0}
          value={campos.despues}
          error={minutosDespues === null ? TEXTO_DEL_CAMPO_ROTO : undefined}
          onChange={(evento) => setBorrador({ ...campos, despues: evento.target.value })}
        />

        <Boton type="submit" cargando={guardar.isPending}>
          Guardar la ventana
        </Boton>
      </form>

      {/* `alerta` porque el resultado aparece DESPUES de pulsar: sin el, quien
          usa un lector de pantalla pulsa y para el no pasa nada. */}
      {guardar.isSuccess && (
        <Aviso tono="exito" alerta>
          <span data-resultado="exito">{TEXTO_DEL_EXITO}</span>
        </Aviso>
      )}

      {guardar.isError && (
        <Aviso tono="error">
          <span data-resultado="error">
            {PRINCIPIO_DEL_FALLO_DE_GUARDADO}
            {guardar.error.message}
          </span>
        </Aviso>
      )}

      <section className="flex flex-col items-start gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          El cartel de la pared
        </h2>

        <p className="text-sm text-slate-600">
          Este es el QR que se imprime y se pega. Es el mismo siempre: lleva la firma del gimnasio,
          asi que mover la ventana de arriba no lo cambia.
        </p>

        {/* El `alt` dice QUE es y no intenta describir el dibujo: el contenido
            de un QR no se puede leer en voz alta de forma util. */}
        <img
          src={RUTA_DE_LA_IMAGEN_DEL_QR}
          alt="El codigo QR de check-in del gimnasio, para imprimir y pegar en la pared."
          width={256}
          height={256}
          className="rounded-lg border border-slate-200 bg-white p-2"
        />
      </section>
    </section>
  );
}

/**
 * LA PUERTA, Y NADA MAS QUE LA PUERTA.
 *
 * Un solo hook —leer el contexto— y despues un `return null`. `rol === null`
 * es SIN PROVEEDOR y vale «no alcanza para nada»: falla cerrada.
 */
export default function PaginaDeCheckIn() {
  const rol = useRolDeQuienMira();

  if (rol === null || !rolAlcanza(rol, 'ADMIN_SALON')) return null;

  return <PantallaDeCheckIn />;
}
