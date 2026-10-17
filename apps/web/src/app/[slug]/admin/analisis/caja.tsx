'use client';

import type { CajaDelMes, CobradoPorMetodo, MetodoPago } from '@boxadmin/shared';
import { Tabla, type ColumnaDeTabla } from '@/componentes/tabla';
import { Aviso, Boton } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { useCaja, type Mes } from '@/hooks/use-stats';
import { textoDelMes } from './filtros';

/**
 * LA CAJA DEL MES: el dato mas sensible del panel, y el unico reporte de la
 * fase que pide `ADMIN_SALON`.
 *
 * LA PUERTA DE ROL NO ESTA AQUI SINO EN `page.tsx`, Y ES A PROPOSITO. Este
 * componente llama a `useCaja` en su primera linea: montarlo es pedir. Si la
 * comprobacion viviera dentro —un `if (!alcanza) return null` despues del
 * hook— el bloque no se dibujaria pero la peticion saldria igual, y un bloque
 * que no se dibuja pero se pide filtra lo mismo que uno dibujado: la respuesta
 * viaja al navegador y queda en la cache de TanStack, legible desde las
 * herramientas del navegador. Es el patron de `horarios`: el contenido vive en
 * otro componente para que sus hooks NO se ejecuten cuando el rol no alcanza.
 *
 * ---------------------------------------------------------------------------
 * EL DINERO SE CUENTA EN `centavos`. SIEMPRE.
 *
 * `Importe` trae `centavos` —entero, la verdad— y `texto` —dos decimales, para
 * mostrar—. No existe un campo con pesos como float y el contrato dice por que:
 * «un float de dinero es una suma mal hecha esperando a ocurrir, y tenerlo
 * disponible garantiza que alguien lo use».
 *
 * Asi que aqui la regla es literal: lo que se PINTA tal cual sale de `texto`
 * —es el campo hecho para eso— y lo que se CALCULA sale de `centavos`, con el
 * resultado formateado por `textoDeCentavos`. `Number(importe.texto)` no
 * aparece en este archivo ni puede aparecer: es la puerta por la que entra el
 * float.
 */

/** Lo que se lee cuando una participacion no se puede calcular. */
export const SIN_PARTICIPACION = 'Sin datos';

/**
 * LO QUE HAY QUE SABER PARA NO LEER MAL EL MARGEN, Y VA AL LADO DEL NUMERO.
 *
 * El contrato de `CajaDelMes` lo dice por escrito y la pantalla tiene que
 * decirlo tambien: `cobrado` es CAJA —se cuenta por `Pago.createdAt`, cuando
 * entro el dinero— y `costoProfesoras` es DEVENGADO —las clases de ese mes—.
 *
 * NO ES UNA NOTA AL PIE. Un margen es un numero que invita a compararlo con el
 * del mes pasado, y esa comparacion es exactamente la que las dos bases rompen:
 * un alumno que paga octubre el 28 de septiembre entra en la caja de
 * septiembre, asi que un mes puede verse brillante y el siguiente pobre sin que
 * haya pasado nada. Una advertencia que hay que ir a buscar llega tarde.
 */
export const NOTA_DEL_MARGEN =
  'Mezcla dos bases: lo cobrado se cuenta cuando entro el dinero (caja) y el costo de las ' +
  'profesoras, por las clases de este mes (devengado). Quien paga octubre el 28 de septiembre ' +
  'entra en la caja de septiembre, asi que comparar el margen de dos meses sin saber esto lleva ' +
  'a conclusiones falsas.';

/**
 * POR QUE LO BONIFICADO VA APARTE Y NO SUMADO.
 *
 * Una cortesia es un metodo de pago normal y NADA OBLIGA A QUE SU MONTO SEA
 * CERO. Sumarla a lo cobrado haria que un mes en el que el gimnasio regalo
 * cuotas apareciera como un mes de buena facturacion, que es la conclusion
 * falsa mas cara que puede sacar alguien mirando esta pantalla.
 */
export const NOTA_DE_LO_BONIFICADO =
  'Las cortesias no son facturacion: no entran en lo cobrado y se cuentan aparte. Nada obliga a ' +
  'que su monto sea cero.';

/** El pendiente es un estimado, y el contrato insiste en que se diga. */
export const NOTA_DEL_PENDIENTE =
  'Es un estimado evaluado al cerrar este mes, no una deuda calculada: el sistema no lleva ' +
  'cuenta corriente. Es lo que costaria ponerse al dia con un pack.';

/**
 * Centavos a texto, con la MISMA grafia que el `texto` del contrato.
 *
 * Es una copia deliberada de `aTexto` (`apps/api/src/liquidacion/calcular-importes.ts`),
 * no un `toFixed(2)`: `(centavos / 100).toFixed(2)` vuelve a meter el float que
 * `centavos` existe para evitar, y en un total grande redondea mal el ultimo
 * centavo. Aritmetica entera y nada mas.
 *
 * Se copia en vez de importarse porque `aTexto` vive en la API y
 * `@boxadmin/shared` no lo exporta: traerlo seria tocar `packages/shared`. Lo
 * que impide que las dos grafias se separen es que esta funcion se usa SOLO
 * para los numeros que esta pantalla calcula —los que vienen del servidor se
 * pintan con su `texto`—, asi que una discrepancia de formato se veria en la
 * misma pantalla, en la linea de al lado.
 *
 * El signo va delante y se conserva: un margen puede quedar en rojo, y un mes
 * flojo con las clases dadas es exactamente eso.
 */
export function textoDeCentavos(centavos: number): string {
  const signo = centavos < 0 ? '-' : '';
  const absoluto = Math.abs(centavos);
  const resto = absoluto % 100;
  const enteros = (absoluto - resto) / 100;

  return `${signo}${enteros}.${String(resto).padStart(2, '0')}`;
}

/** La suma del desglose, EN CENTAVOS. Enteros, sin pasar por `texto`. */
export function sumaDeCentavos(filas: readonly CobradoPorMetodo[]): number {
  return filas.reduce((total, fila) => total + fila.importe.centavos, 0);
}

/**
 * Cuanto pesa un metodo sobre el total, o `null` si no se puede saber.
 *
 * Mismo criterio que `porcentajeDe` en el service y que todo el resto de la
 * fase: con el total en cero la pregunta NO SE PUEDE CONTESTAR, y un 0% ahi
 * diria que por ese metodo no entro nada —cuando lo que pasa es que no entro
 * nada por ninguno—. Se redondea a dos decimales con aritmetica entera, igual
 * que la composicion.
 */
export function participacion(centavos: number, totalCentavos: number): number | null {
  if (totalCentavos === 0) return null;
  return Math.round((centavos * 10_000) / totalCentavos) / 100;
}

export function textoDeLaParticipacion(centavos: number, totalCentavos: number): string {
  const cuanto = participacion(centavos, totalCentavos);
  return cuanto === null ? SIN_PARTICIPACION : `${cuanto}%`;
}

/**
 * Los metodos en castellano, con un `Record` y no un `if`.
 *
 * El `Record` sobre la union obliga al compilador a cubrirlos todos: un metodo
 * nuevo en `MetodoPago` rompe la compilacion aqui en vez de aparecer en la
 * pantalla con su nombre de enum en mayusculas.
 *
 * `CORTESIA` esta en la tabla aunque el desglose NO LA TRAIGA NUNCA —el service
 * la aparta en `bonificado` antes de agrupar—: el tipo la admite, y un dia que
 * llegara pintarla como `CORTESIA` seria el sintoma menos legible posible.
 */
const NOMBRE_DEL_METODO: Record<MetodoPago, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  CORTESIA: 'Cortesia',
  OTRO: 'Otro',
};

/**
 * UN NUMERO DE DINERO, con su nombre y lo que haya que saber para leerlo.
 *
 * `data-cifra` y no el texto del titulo: es el enganche con el que el spec
 * afirma por IGUALDAD EXACTA sobre el importe, que es lo unico que distingue
 * «1000.00» de «1075.00» sin depender de buscar subcadenas —«100.00» esta
 * dentro de «1100.00», y un `toContain` pasaria en verde sobre el numero
 * equivocado—.
 *
 * El signo de pesos va FUERA del nodo marcado: dentro, cada afirmacion del spec
 * tendria que llevarlo escrito y la igualdad dejaria de leerse contra el fijo.
 */
function Cifra({
  clave,
  titulo,
  texto,
  nota,
  enRojo = false,
}: {
  clave: string;
  titulo: string;
  texto: string;
  nota?: string;
  enRojo?: boolean;
}) {
  return (
    <div
      data-cifra={clave}
      className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</p>

      <p className={`text-3xl font-semibold ${enRojo ? 'text-red-700' : 'text-slate-900'}`}>
        <span className="text-base font-normal text-slate-500">$ </span>
        <span data-importe>{texto}</span>
      </p>

      {/* EL ROJO SE DICE CON PALABRAS Y NO SOLO CON EL COLOR. Un menos delante
          de un numero largo se pasa por alto, y quien no distingue el rojo no
          tiene ninguna otra señal. Es ademas el enganche del spec: afirmar
          sobre una clase de Tailwind se rompe al cambiar de tono sin que haya
          cambiado nada de lo que la pantalla dice. */}
      {enRojo && (
        <p data-en-perdida className="text-xs font-semibold text-red-700">
          Este mes cerro en perdida.
        </p>
      )}

      {nota !== undefined && (
        <p data-nota className="text-xs text-slate-500">
          {nota}
        </p>
      )}
    </div>
  );
}

/** Las columnas del desglose. El orden lo manda el servidor, aqui no se ordena. */
function columnasDelDesglose(totalCentavos: number): readonly ColumnaDeTabla<CobradoPorMetodo>[] {
  return [
    {
      encabezado: 'Metodo',
      celda: (fila) => <span data-metodo={fila.metodo}>{NOMBRE_DEL_METODO[fila.metodo]}</span>,
    },
    {
      // El importe TAL CUAL: es el campo que el contrato trae para mostrar.
      encabezado: 'Importe',
      celda: (fila) => <span data-importe>{fila.importe.texto}</span>,
    },
    {
      // Y esto SI es una cuenta, asi que sale de `centavos`.
      encabezado: 'Participacion',
      celda: (fila) => (
        <span data-participacion>
          {textoDeLaParticipacion(fila.importe.centavos, totalCentavos)}
        </span>
      ),
    },
  ];
}

/**
 * EL DESGLOSE, CON SU TOTAL SUMADO DE LO QUE SE ESTA ENSEÑANDO.
 *
 * El total se suma de las filas pintadas y NO se copia de `cobrado`, que esta
 * ahi arriba en su propia tarjeta. Son dos numeros que tienen que coincidir
 * —el service calcula `cobrado` como la suma de este mismo desglose— y
 * enseñarlos juntos es lo que hace visible el dia que no coincidan: un desglose
 * al que le falte un metodo se ve al instante en vez de pasar por un detalle
 * decorativo debajo del numero bueno.
 *
 * No es una rama defensiva ni un cartel de error que nunca sale: son dos
 * numeros a la vista, y quien mira los compara.
 */
function Desglose({ porMetodo }: { porMetodo: readonly CobradoPorMetodo[] }) {
  const totalCentavos = sumaDeCentavos(porMetodo);

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Por metodo de pago
      </h3>

      <Tabla
        etiqueta="Lo cobrado por metodo de pago"
        columnas={columnasDelDesglose(totalCentavos)}
        filas={porMetodo}
        claveDeFila={(fila) => fila.metodo}
        vacio={<Aviso>Este mes no entro nada por ningun metodo de pago.</Aviso>}
      />

      <p className="text-sm text-slate-700">
        Total del desglose: $ <span data-total-del-desglose>{textoDeCentavos(totalCentavos)}</span>
      </p>
    </section>
  );
}

/**
 * La caja ya leida. Se monta SOLO si el rol alcanza: ver `page.tsx`.
 *
 * EL MES SALE DE LA RESPUESTA y no del selector, igual que el encabezado del
 * operativo. Hoy coinciden —`/stats/caja` contesta el mes que se le pidio— y
 * aun asi se pinta el que volvio: pintar lo que uno mismo mando es afirmar que
 * se miro algo que a lo mejor no se miro.
 */
function CajaLeida({ caja }: { caja: CajaDelMes }) {
  return (
    <>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        La caja de {textoDelMes(caja)}
      </h2>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Cifra clave="cobrado" titulo="Cobrado" texto={caja.cobrado.texto} />
        <Cifra
          clave="bonificado"
          titulo="Bonificado"
          texto={caja.bonificado.texto}
          nota={NOTA_DE_LO_BONIFICADO}
        />
        <Cifra
          clave="costoProfesoras"
          titulo="Costo de las profesoras"
          texto={caja.costoProfesoras.texto}
        />
        {/*
          EL MARGEN ES EL DEL SERVIDOR. No se resta aqui `cobrado - costo`: dos
          implementaciones del mismo numero acaban discrepando y el dia que
          discrepen nadie sabe cual creer. Lo unico que esta pantalla decide es
          el color, y lo decide con `centavos` —un entero— y no con el texto.
        */}
        <Cifra
          clave="margen"
          titulo="Margen"
          texto={caja.margen.texto}
          nota={NOTA_DEL_MARGEN}
          enRojo={caja.margen.centavos < 0}
        />
        <Cifra
          clave="pendienteEstimado"
          titulo="Pendiente estimado"
          texto={caja.pendienteEstimado.texto}
          nota={NOTA_DEL_PENDIENTE}
        />
      </div>

      <Desglose porMetodo={caja.porMetodo} />
    </>
  );
}

/**
 * El bloque entero, con sus tres estados.
 *
 * UNA SESION CADUCADA NO SE DIBUJA AQUI. El panel ya lo dice una vez y se esta
 * yendo al login; tres carteles iguales —uno por reporte— no informan mas y
 * tapan el unico que importa. Un 401 solo puede ser global: es el mismo token
 * para los tres, asi que el aviso del operativo cubre tambien a este.
 */
export function BloqueDeCaja({ mes }: { mes: Mes }) {
  const caja = useCaja(mes);

  if (caja.error instanceof ErrorDeApi && caja.error.esSesionCaducada) return null;

  return (
    <section data-bloque="caja" className="flex flex-col gap-3">
      {caja.isPending && <p className="text-sm text-slate-500">Cargando la caja…</p>}

      {/* Un fallo al LEER la caja no se parece a un mes sin movimiento: un mes
          vacio son ceros de verdad y este no es un cero, es un no se sabe. */}
      {caja.error !== null && (
        <div className="flex flex-col items-start gap-2">
          <Aviso tono="error">No se pudo leer la caja: {caja.error.message}</Aviso>
          <Boton tono="secundario" onClick={() => void caja.refetch()}>
            Reintentar la caja
          </Boton>
        </div>
      )}

      {caja.data !== undefined && <CajaLeida caja={caja.data} />}
    </section>
  );
}
