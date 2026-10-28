'use client';

import { useState } from 'react';
import { PATRON_FECHA, type ComprobantePublico, type MetodoPago } from '@boxadmin/shared';
import { Campo } from '@/componentes/formulario';
import { Aviso, Boton } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import {
  useAprobarComprobante,
  useColaDeComprobantes,
  useRechazarComprobante,
} from '@/hooks/use-dinero';
import { Seleccion } from './usuarios/[id]/controles';
import { mensajeDeFallo } from './usuarios/[id]/errores';

/**
 * LA COLA DE COMPROBANTES POR REVISAR. `GET /comprobantes?estado=PENDIENTE`.
 *
 * ===========================================================================
 * POR QUE VIVE EN LA PORTADA, AL LADO DE LOS PAGOS PENDIENTES
 * ===========================================================================
 *
 * Por el mismo motivo que se midio en la Fase 11 y que esta escrito entero en
 * el docblock de `pagos-pendientes.tsx`: UNA COLA ENTERRADA EN UNA PANTALLA
 * PROPIA SE VISITA MENOS. Esto no es un reporte que alguien va a buscar: es
 * trabajo pendiente de otra persona —un alumno que subio la foto de una
 * transferencia y esta esperando— y lo que decide si se hace es si se ve sin
 * tener que decidir ir. La portada es donde aterriza todo el mundo al entrar
 * (`destinoPorRol` manda ahi a los admins) y ya es la pantalla de HOY.
 *
 * Son las DOS listas de trabajo del dia y se leen juntas: a quien hay que
 * llamar porque no pago, y quien ya pago y esta esperando que se lo
 * reconozcan. Separarlas en dos sitios es garantizar que se mire una.
 *
 * NO LLEVA PUERTA DE ROL, igual que el bloque de al lado y por lo mismo. El
 * `GET` pide `ALUMNO` —ver mas abajo— y las dos escrituras piden
 * `ADMIN_OPERATIVO`, que es el rol MINIMO con el que el layout del panel deja
 * entrar: cualquiera que vea esta pantalla puede aprobar y rechazar. Una
 * comprobacion que nunca puede fallar es ruido que el proximo lector
 * confundiria con una defensa.
 *
 * ===========================================================================
 * APROBAR NO ES UN BOTON. ES UN FORMULARIO, Y ES COBRAR.
 * ===========================================================================
 *
 * LAS DOS COSAS ESTAN VERIFICADAS CONTRA LA API, NO DEDUCIDAS:
 *
 *  1. `AprobarComprobanteDto` (`apps/api/src/comprobantes/dto/aprobar-comprobante.dto.ts`)
 *     exige `monto` —`@Matches(/^\d{1,8}(\.\d{1,2})?$/)`— y `cubreHasta`
 *     —`@Matches(PATRON_FECHA)`—, los dos SIN `@IsOptional()`. `metodo` y
 *     `nota` si lo son. O sea que un boton de «Aprobar» a secas es un 400:
 *     faltan los dos campos que el admin es el unico que sabe, porque esta
 *     mirando la foto de la transferencia.
 *
 *  2. `ComprobantesService.aprobar` hace un `cliente.pago.create(...)` DENTRO
 *     de la misma `$transaction` que marca el comprobante como aprobado, con
 *     un comentario que explica por que: «si naciera fuera, un fallo entre las
 *     dos escrituras dejaria un comprobante aprobado sin cobro registrado, y
 *     eso no se descubre hasta cuadrar la caja a fin de mes». APROBAR ACUÑA UN
 *     PAGO.
 *
 * Y por eso esta pantalla no dice «Aprobar» y ya: dice que se esta
 * REGISTRANDO UN COBRO, con los mismos campos y las mismas consecuencias que
 * el formulario de la ficha. Quien pulsa aqui no esta ordenando una bandeja de
 * entrada: esta metiendo plata en la caja del mes, y lo que escriba en «Monto»
 * es lo que va a figurar cobrado.
 *
 * `RevisarComprobanteDto` —el de rechazar— lleva SOLO `nota`, y es
 * `@IsOptional()` de verdad: leido, no supuesto. Rechazar no crea ningun
 * `Pago` y no toca la caja.
 *
 * ===========================================================================
 * LA COLA QUE SE CUENTA AQUI NO ES EL NUMERO DE FILAS DE LA BASE
 * ===========================================================================
 *
 * `ComprobantesService.listar` se ramifica por rol adentro, y la rama del
 * admin lleva una decision escrita: `where.subidoEn = { not: null }`, «al admin
 * no se le muestran filas sin archivo: serian enlaces rotos». Un alumno que
 * pidio la URL de subida y no termino de subir el archivo deja una fila
 * PENDIENTE en la tabla que esta cola NO enseña.
 *
 * Eso NO es un bug de paginacion ni un filtro que falte, y hay que decirlo en
 * pantalla: el dia que alguien cuente los comprobantes por SQL y le den ocho
 * donde la portada dice seis, la conclusion por defecto es «la pantalla se
 * come filas». Se dice antes de que pase. Ver `LA_COLA_NO_SON_TODAS`.
 *
 * Tambien explica por que esta pantalla NO tiene una rama de «comprobante sin
 * archivo» de verdad: al admin no le llega ninguna. El `urlDeDescarga === null`
 * se contempla igual porque el contrato lo permite (`string | null`) y una
 * pantalla que asuma lo contrario pinta un `href="null"`, pero no se siembra en
 * el spec: seria una respuesta que la API no puede dar.
 *
 * ===========================================================================
 * EL ENLACE AL ARCHIVO CADUCA, ASI QUE NO SE GUARDA EN NINGUN SITIO
 * ===========================================================================
 *
 * `ComprobantePublico.urlDeDescarga` esta documentada como «firmada y de vida
 * corta», y la firma la pone `AlmacenDeArchivos.urlDeDescarga` cada vez que el
 * service arma la respuesta —una vez por fila y por peticion—. O sea que no es
 * una propiedad del comprobante: es una propiedad de ESA respuesta.
 *
 * Por eso el `href` se lee de `comprobante.urlDeDescarga` en el pintado y no
 * pasa por ningun `useState`, ningun `useMemo` con dependencias y ningun
 * almacen del navegador. Una copia guardada sobrevive a la respuesta que la
 * trajo y se convierte, sin avisar, en un enlace que contesta 403 cuando
 * alguien lo pulsa media hora despues; y «el archivo no se puede abrir» se
 * reporta como un problema del almacen, no como una cache de mas en el
 * cliente.
 */

// ---------------------------------------------------------------------------
// Lo que la pantalla dice, en un solo sitio
// ---------------------------------------------------------------------------

/**
 * LA FRASE MAS CARA DE ESTA PANTALLA, y va pegada al formulario de aprobar.
 *
 * Exportada para que el spec la afirme por IGUALDAD EXACTA: con un
 * `toContain('registra un pago')`, media frase borrada —justo la mitad que
 * dice que el importe lo decide quien escribe— seguiria pasando en verde.
 */
export const APROBAR_ES_COBRAR =
  'Aprobar NO es marcar un estado: registra UN COBRO en la misma operacion, por el monto y el ' +
  'periodo que escribas aqui, exactamente igual que cobrar desde la ficha de esa persona. Entra ' +
  'en la caja del mes y pone al alumno al dia. Si el importe esta mal, queda mal cobrado.';

/** Y la otra mitad: rechazar no mueve plata. */
export const RECHAZAR_NO_COBRA =
  'Rechazar no registra ningun pago y no toca la caja: solo saca el comprobante de la cola y le ' +
  'deja al alumno el motivo.';

/**
 * QUE NO ESTA EN ESTA COLA, dicho antes de que alguien cuente las filas.
 *
 * Ver el bloque de arriba sobre `where.subidoEn = { not: null }`.
 */
export const LA_COLA_NO_SON_TODAS =
  'Esta cola no muestra los comprobantes sin archivo: son los que el alumno empezo a subir y no ' +
  'termino, y el servidor no los manda aqui porque serian enlaces rotos. Asi que estas filas ' +
  'pueden ser menos que los comprobantes pendientes que hay cargados, y no falta ninguno por un ' +
  'fallo de esta pantalla.';

/** Que el enlace no se puede guardar para despues. */
export const EL_ENLACE_CADUCA =
  'El enlace al archivo se firma cada vez que se pide la cola y dura poco. No lo guardes ni lo ' +
  'reenvies: si la pantalla lleva un rato abierta, volve a cargarla antes de abrirlo.';

/** Lo que se lee cuando la cola contesto y volvio vacia. */
export const NADA_QUE_REVISAR =
  'No hay ningun comprobante esperando revision. La cola se pidio y volvio vacia: no es que no ' +
  'hayamos podido mirar.';

/** Lo que se lee cuando la LECTURA falla, que no es lo mismo que lo de arriba. */
export const NO_SE_PUDO_LEER_LA_COLA = 'No se pudo leer la cola de comprobantes: ';

/** Un comprobante que llego sin enlace, que al admin no deberia llegarle. */
export const SIN_ENLACE_AL_ARCHIVO =
  'Este comprobante llego sin enlace al archivo. No se puede revisar lo que no se puede abrir: no ' +
  'lo apruebes a ciegas.';

export const MONTO_INVALIDO =
  'El monto va con hasta 8 enteros y como mucho 2 decimales, como 25000.10.';
export const CUBRE_HASTA_INVALIDO = 'La fecha va como YYYY-MM-DD.';

/**
 * EL MISMO PATRON QUE `AprobarComprobanteDto`, copiado a proposito.
 *
 * Igual que en `bloque-pagos.tsx`: se valida aqui para poder colgar el error
 * DEL CAMPO en vez de recibir una frase suelta del `ValidationPipe`, y el
 * patron es identico para que la pantalla no rechace nada que la API aceptaria
 * ni al reves. Y NO es un `Number.isNaN(Number(monto))`, que aceptaria
 * `25000.123` y `1e5` —dos 400 distintos— y ademas obligaria a construir el
 * float que este archivo entero existe para no construir.
 */
const PATRON_MONTO = /^\d{1,8}(\.\d{1,2})?$/;

/** Los cuatro de `MetodoPago`, con TRANSFERENCIA primero: ver `FormularioDeAprobacion`. */
const METODOS: readonly { valor: MetodoPago; texto: string }[] = [
  { valor: 'TRANSFERENCIA', texto: 'Transferencia' },
  { valor: 'EFECTIVO', texto: 'Efectivo' },
  { valor: 'CORTESIA', texto: 'Cortesia' },
  { valor: 'OTRO', texto: 'Otro' },
];

// ---------------------------------------------------------------------------
// El gesto que se acaba de hacer
// ---------------------------------------------------------------------------

/**
 * LO QUE SE HIZO CON UN COMPROBANTE, PARA QUE SE VEA CUAL DE LAS DOS COSAS FUE.
 *
 * Hace falta porque la fila DESAPARECE: aprobar y rechazar sacan al
 * comprobante de `PENDIENTE`, la invalidacion de `['comprobantes']` vuelve a
 * pedir la cola y la fila ya no vuelve. Sin este aviso, las dos acciones se
 * ven igual desde la pantalla —una fila menos— y la mas cara de las dos es la
 * que registra un cobro.
 *
 * `detalle` lleva el monto y la fecha del cobro recien hecho SOLO en la
 * aprobacion: es el resumen de lo que se acaba de registrar, que es lo que
 * alguien necesita releer para saber si se equivoco. El rechazo no tiene nada
 * equivalente que decir, y la nota del rechazo NO se repite aqui —es texto
 * sobre una persona y ya se mando—.
 */
type Gesto = { id: string; tipo: 'APROBADO'; detalle: string } | { id: string; tipo: 'RECHAZADO' };

/** Que accion esta abierta, y sobre que fila. Una sola a la vez, a proposito. */
type Accion = { id: string; tipo: 'APROBAR' | 'RECHAZAR' };

// ---------------------------------------------------------------------------
// El formulario de aprobar, que es un formulario de cobro
// ---------------------------------------------------------------------------

/**
 * APROBAR. `PATCH /comprobantes/:id/aprobar`, ADMIN_OPERATIVO.
 *
 * LOS DOS CAMPOS OBLIGATORIOS DEL DTO ESTAN LOS DOS EN PANTALLA y se validan
 * antes de salir, los dos a la vez: con un `return` por campo, quien se
 * equivoca en los dos ve el segundo error recien despues de arreglar el
 * primero.
 *
 * EL MONTO NO PASA POR UN `Number()` EN NINGUN PUNTO. Vive en un
 * `useState<string>`, se compara contra el patron del DTO —que es texto— y
 * viaja tal cual se escribio. `Number('25000.10')` es `25000.1`: un decimal,
 * no dos, y otro dinero. Por eso ademas el `<input>` es `type="text"` con
 * `inputMode="decimal"` y no `type="number"`, que devuelve el `.value`
 * normalizado por el navegador y acepta notacion exponencial.
 *
 * `metodo` VIAJA SIEMPRE, aunque el DTO lo acepte ausente y el service ponga
 * `dto.metodo ?? 'TRANSFERENCIA'`. Es la leccion de la Fase 12, la misma por la
 * que `esSena` viaja escrito desde la ficha: un campo con consecuencias —este
 * cae en el desglose por metodo de la caja del mes— LO DECIDE LA PANTALLA, para
 * que el dia que alguien cambie ese `??` en el service no cambie en silencio lo
 * que queda registrado. El valor por defecto del control es TRANSFERENCIA
 * —esta primero en la lista— porque es lo que un comprobante es casi siempre, y
 * asi la pantalla y el servidor dicen hoy lo mismo.
 *
 * `nota` VACIA SE OMITE y no viaja como `''`: la columna nace en `null` y «no
 * puso nota» no es «puso una nota vacia». `JSON.stringify` borra las claves
 * `undefined`, asi que omitirla aqui es mandar el cuerpo sin la clave.
 *
 * NO SE COMPRUEBA AQUI que `cubreHasta` no sea anterior a hoy: el service pone
 * `cubreDesde` en el comienzo de hoy en UTC por su cuenta y es el unico que
 * sabe cual es ese dia. Una segunda opinion local sobre el calendario del
 * servidor es exactamente la clase de regla que algun dia discrepa.
 */
function FormularioDeAprobacion({
  comprobante,
  alTerminar,
}: {
  comprobante: ComprobantePublico;
  alTerminar: (gesto: Gesto) => void;
}) {
  const aprobar = useAprobarComprobante();

  const [monto, setMonto] = useState('');
  const [cubreHasta, setCubreHasta] = useState('');
  const [metodo, setMetodo] = useState<MetodoPago>('TRANSFERENCIA');
  const [nota, setNota] = useState('');

  const [errorDeMonto, setErrorDeMonto] = useState<string | undefined>(undefined);
  const [errorDeFecha, setErrorDeFecha] = useState<string | undefined>(undefined);
  const [aviso, setAviso] = useState<string | null>(null);

  async function enviar(): Promise<void> {
    setAviso(null);
    setErrorDeMonto(undefined);
    setErrorDeFecha(undefined);

    const montoMal = !PATRON_MONTO.test(monto);
    const fechaMal = !PATRON_FECHA.test(cubreHasta);

    if (montoMal) setErrorDeMonto(MONTO_INVALIDO);
    if (fechaMal) setErrorDeFecha(CUBRE_HASTA_INVALIDO);
    if (montoMal || fechaMal) return;

    try {
      await aprobar.mutateAsync({
        id: comprobante.id,
        monto,
        cubreHasta,
        metodo,
        ...(nota === '' ? {} : { nota }),
      });

      alTerminar({
        id: comprobante.id,
        tipo: 'APROBADO',
        detalle: `${monto} que cubre hasta ${cubreHasta}`,
      });
    } catch (fallo) {
      if (!(fallo instanceof ErrorDeApi)) throw fallo;
      setAviso(mensajeDeFallo(fallo, 'ADMIN_OPERATIVO'));
    }
  }

  return (
    <form
      data-formulario="aprobar"
      aria-label={`Aprobar el comprobante ${comprobante.nombreOriginal}`}
      onSubmit={(evento) => {
        evento.preventDefault();
        void enviar();
      }}
      className="flex flex-col gap-3 rounded-lg border border-slate-300 bg-slate-50 p-3"
      noValidate
    >
      {/* LA CONSECUENCIA ANTES DE LOS CAMPOS, no detras de un signo de
          interrogacion ni debajo del boton. Quien llega aqui pensando que
          ordena una bandeja de entrada tiene que leerlo antes de teclear. */}
      <p data-aprobar-es-cobrar className="text-sm font-medium text-amber-800">
        {APROBAR_ES_COBRAR}
      </p>

      {aviso !== null && <Aviso tono="error">{aviso}</Aviso>}

      <Campo
        etiqueta="Monto cobrado"
        id="comprobante-monto"
        type="text"
        inputMode="decimal"
        placeholder="25000.10"
        value={monto}
        error={errorDeMonto}
        onChange={(evento) => setMonto(evento.target.value)}
      />

      <Campo
        etiqueta="Cobertura hasta"
        id="comprobante-cubre-hasta"
        placeholder="YYYY-MM-DD"
        value={cubreHasta}
        error={errorDeFecha}
        onChange={(evento) => setCubreHasta(evento.target.value)}
      />

      <Seleccion
        etiqueta="Metodo del cobro"
        id="comprobante-metodo"
        opciones={METODOS.map((uno) => ({ valor: uno.valor, texto: uno.texto }))}
        value={metodo}
        onChange={(evento) => setMetodo(evento.target.value as MetodoPago)}
      />

      <Campo
        etiqueta="Nota del cobro"
        id="comprobante-nota-aprobar"
        value={nota}
        onChange={(evento) => setNota(evento.target.value)}
      />

      <div className="flex gap-2">
        {/* El boton NOMBRA el cobro. «Aprobar» a secas es el nombre del gesto
            en la bandeja de entrada, no el de lo que pasa al pulsarlo. */}
        <Boton type="submit" cargando={aprobar.isPending}>
          Registrar el cobro y aprobar
        </Boton>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// El formulario de rechazar, que no es el mismo
// ---------------------------------------------------------------------------

/**
 * RECHAZAR. `PATCH /comprobantes/:id/rechazar`, ADMIN_OPERATIVO.
 *
 * UN CAMPO, OPCIONAL, Y NINGUNA VALIDACION. `RevisarComprobanteDto` lleva solo
 * `nota` con `@IsOptional()`, asi que un rechazo sin motivo es una peticion
 * valida y el service guarda `nota ?? null`. Exigir aqui un motivo que la API
 * no exige seria inventar una regla, y seria la clase de regla que el dia que
 * alguien tiene prisa se saltea por otro camino.
 *
 * Se dibuja DISTINTO del de aprobar a proposito y no por casualidad de
 * maquetacion: son dos gestos con consecuencias opuestas sobre el dinero y el
 * unico momento en que se pueden distinguir es antes de pulsar.
 */
function FormularioDeRechazo({
  comprobante,
  alTerminar,
}: {
  comprobante: ComprobantePublico;
  alTerminar: (gesto: Gesto) => void;
}) {
  const rechazar = useRechazarComprobante();

  const [nota, setNota] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);

  async function enviar(): Promise<void> {
    setAviso(null);

    try {
      // La nota vacia NO viaja como `''`. Ver el mismo criterio en el
      // formulario de arriba: el cuerpo sale como `{}` y el service guarda
      // `null`, que es «no puso motivo» y no «puso un motivo vacio».
      await rechazar.mutateAsync({
        id: comprobante.id,
        ...(nota === '' ? {} : { nota }),
      });

      alTerminar({ id: comprobante.id, tipo: 'RECHAZADO' });
    } catch (fallo) {
      if (!(fallo instanceof ErrorDeApi)) throw fallo;
      setAviso(mensajeDeFallo(fallo, 'ADMIN_OPERATIVO'));
    }
  }

  return (
    <form
      data-formulario="rechazar"
      aria-label={`Rechazar el comprobante ${comprobante.nombreOriginal}`}
      onSubmit={(evento) => {
        evento.preventDefault();
        void enviar();
      }}
      className="flex flex-col gap-3 rounded-lg border border-slate-300 bg-slate-50 p-3"
      noValidate
    >
      <p data-rechazar-no-cobra className="text-sm text-slate-700">
        {RECHAZAR_NO_COBRA}
      </p>

      {aviso !== null && <Aviso tono="error">{aviso}</Aviso>}

      <Campo
        etiqueta="Motivo del rechazo"
        id="comprobante-nota-rechazar"
        value={nota}
        onChange={(evento) => setNota(evento.target.value)}
      />

      <div className="flex gap-2">
        <Boton type="submit" tono="secundario" cargando={rechazar.isPending}>
          Rechazar el comprobante
        </Boton>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Una fila
// ---------------------------------------------------------------------------

/**
 * Cada dato en SU atributo y no en una frase corrida.
 *
 * Con todo junto en un `textContent` un spec solo puede afirmar por subcadena,
 * y `toContain('25000')` pasa en verde sobre `250000`. Con nodos propios la
 * afirmacion es una igualdad exacta sobre el dato que se quiso mirar.
 */
function FilaDeComprobante({
  comprobante,
  accion,
  alPedirAccion,
  alCancelar,
  alTerminar,
}: {
  comprobante: ComprobantePublico;
  accion: Accion | null;
  alPedirAccion: (accion: Accion) => void;
  alCancelar: () => void;
  alTerminar: (gesto: Gesto) => void;
}) {
  const abierta = accion !== null && accion.id === comprobante.id ? accion.tipo : null;

  return (
    <li
      data-comprobante={comprobante.id}
      className="flex flex-col gap-2 border-b border-slate-100 pb-3 last:border-b-0"
    >
      <p className="text-sm font-medium text-slate-900">
        <span data-archivo>{comprobante.nombreOriginal}</span>{' '}
        <span data-tipo className="text-xs font-normal text-slate-500">
          {comprobante.tipoMime}
        </span>
      </p>

      <p className="text-xs text-slate-500">
        {/* El instante TAL COMO lo escribio el servidor: ISO en UTC, recortado
            y no reformateado. Todo este producto cuenta los dias en UTC, y un
            `toLocaleString()` aqui pintaria el unico instante del panel que no
            esta en esa base. Mismo criterio que `instanteLegible` en la ficha. */}
        Subido el <span data-subido>{(comprobante.subidoEn ?? '').slice(0, 10)}</span>
      </p>

      {/* EL `href` SALE DE LA RESPUESTA EN EL PINTADO. Ni estado, ni memo, ni
          almacen: la firma caduca y una copia guardada es un enlace roto que
          nadie sabe que lo esta. Ver el docblock del archivo. */}
      {comprobante.urlDeDescarga === null ? (
        <p data-sin-enlace className="text-xs font-medium text-amber-700">
          {SIN_ENLACE_AL_ARCHIVO}
        </p>
      ) : (
        <p className="text-sm">
          <a
            data-descarga
            href={comprobante.urlDeDescarga}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-slate-900 underline underline-offset-2"
          >
            Ver el archivo
          </a>
        </p>
      )}

      {/**
       * `ComprobantePublico.nota` NO SE PINTA AQUI, Y NO ES UN OLVIDO.
       *
       * Medido en `ComprobantesService`: la columna `nota` SOLO la escriben
       * `aprobar` y `rechazar`, y las dos cambian el estado. O sea que una fila
       * PENDIENTE —que es lo unico que lista esta cola— tiene SIEMPRE
       * `nota: null`. `revisadoPor` y `revisadoEn` igual. Pintar los tres seria
       * marcado que no puede aparecer nunca, y un spec que lo cubriera tendria
       * que sembrar una respuesta que la API no puede dar.
       *
       * La nota que si existe en esta pantalla es la que el admin ESCRIBE al
       * aprobar o al rechazar, y esa viaja en el cuerpo de la escritura.
       */}

      {abierta === null && (
        <div className="flex gap-2">
          {/* El nombre accesible lleva el archivo: con seis filas de «Aprobar»
              nadie sabe cual esta pulsando. */}
          <Boton
            type="button"
            aria-label={`Aprobar el comprobante ${comprobante.nombreOriginal}`}
            onClick={() => alPedirAccion({ id: comprobante.id, tipo: 'APROBAR' })}
          >
            Aprobar
          </Boton>
          <Boton
            type="button"
            tono="secundario"
            aria-label={`Rechazar el comprobante ${comprobante.nombreOriginal}`}
            onClick={() => alPedirAccion({ id: comprobante.id, tipo: 'RECHAZAR' })}
          >
            Rechazar
          </Boton>
        </div>
      )}

      {abierta === 'APROBAR' && (
        <>
          <FormularioDeAprobacion comprobante={comprobante} alTerminar={alTerminar} />
          <div>
            <Boton type="button" tono="secundario" onClick={alCancelar}>
              Cancelar
            </Boton>
          </div>
        </>
      )}

      {abierta === 'RECHAZAR' && (
        <>
          <FormularioDeRechazo comprobante={comprobante} alTerminar={alTerminar} />
          <div>
            <Boton type="button" tono="secundario" onClick={alCancelar}>
              Cancelar
            </Boton>
          </div>
        </>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Lo que se acaba de hacer
// ---------------------------------------------------------------------------

/**
 * EL AVISO DE LO QUE PASO, y las dos ramas NO comparten nodo.
 *
 * Un solo parrafo con el texto cambiado seria indistinguible para un lector de
 * pantalla que ya lo tenia leido, y para un test solo distinguible por
 * ortografia. Cada gesto tiene su marca propia (`data-ultimo-gesto`) con el
 * valor dentro, que es lo unico que no se puede confundir con una casualidad
 * de redaccion.
 */
function LoQueSeAcabaDeHacer({ gesto }: { gesto: Gesto }) {
  if (gesto.tipo === 'APROBADO') {
    return (
      <div data-ultimo-gesto="APROBADO">
        <Aviso tono="exito" alerta>
          Cobro registrado: <span data-cobro-registrado>{gesto.detalle}</span>. El comprobante quedo
          aprobado y el pago ya cuenta en la caja del mes.
        </Aviso>
      </div>
    );
  }

  return (
    <div data-ultimo-gesto="RECHAZADO">
      <Aviso alerta>
        Comprobante rechazado. No se registro ningun pago y la caja del mes no cambio.
      </Aviso>
    </div>
  );
}

// ---------------------------------------------------------------------------
// El bloque
// ---------------------------------------------------------------------------

/**
 * El bloque entero, con sus cuatro estados.
 *
 * UNA COLA VACIA NO SE PARECE A UN FALLO AL LEER, y es la distincion mas cara
 * de esta pantalla. «No hay nada que revisar» cierra el dia; «no pude
 * preguntar» obliga a volver a mirar, y mientras tanto hay alumnos que pagaron
 * y siguen figurando como que no. Un 500 dibujado como una lista sin filas
 * dice lo primero. Se dice QUE paso, se ofrece reintentar, y los dos casos
 * tienen marcas distintas en el DOM y textos distintos.
 *
 * LA SESION CADUCADA NO MANDA AL LOGIN DESDE AQUI, y es una decision. El
 * bloque de al lado —`PagosPendientes`, en esta misma portada— ya hace ese
 * `router.push` cuando su propia peticion vuelve 401, y las dos peticiones
 * caducan juntas porque es la misma cookie: dos bloques empujando al mismo
 * destino son dos navegaciones para un solo evento. Lo que si se hace es no
 * enseñar el «Unauthorized» crudo de la API —que no le dice nada a nadie— y no
 * ofrecer reintentar, que seria volver a fallar mientras la pantalla ya se
 * esta yendo.
 */
export function ComprobantesPendientes() {
  const cola = useColaDeComprobantes('PENDIENTE');

  const [accion, setAccion] = useState<Accion | null>(null);
  const [gesto, setGesto] = useState<Gesto | null>(null);

  const sesionCaducada = cola.error instanceof ErrorDeApi && cola.error.esSesionCaducada;

  function terminar(hecho: Gesto): void {
    setAccion(null);
    setGesto(hecho);
  }

  return (
    <section data-bloque="comprobantes-pendientes" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        Comprobantes por revisar
      </h2>

      {/* LAS DOS FRASES VAN FUERA DE TODAS LAS RAMAS: se leen tambien mientras
          carga y tambien cuando la cola falla. Lo que explica que es esta lista
          no puede depender de que la lista haya llegado. */}
      <p data-la-cola-no-son-todas className="text-sm text-slate-600">
        {LA_COLA_NO_SON_TODAS}
      </p>
      <p data-el-enlace-caduca className="text-sm text-slate-600">
        {EL_ENLACE_CADUCA}
      </p>

      {gesto !== null && <LoQueSeAcabaDeHacer gesto={gesto} />}

      {cola.isPending && <p className="text-sm text-slate-500">Cargando…</p>}

      {sesionCaducada && <Aviso tono="error">Tu sesion caduco. Volve a entrar.</Aviso>}

      {cola.error !== null && !sesionCaducada && (
        <div data-fallo-al-leer className="flex flex-col items-start gap-2">
          <Aviso tono="error">
            {NO_SE_PUDO_LEER_LA_COLA}
            {cola.error.message}
          </Aviso>
          <Boton type="button" tono="secundario" onClick={() => void cola.refetch()}>
            Reintentar
          </Boton>
        </div>
      )}

      {cola.data !== undefined &&
        (cola.data.length === 0 ? (
          <div data-sin-comprobantes>
            <Aviso>{NADA_QUE_REVISAR}</Aviso>
          </div>
        ) : (
          <>
            <p className="text-sm text-slate-700">
              Esperando revision: <span data-cuantos>{cola.data.length}</span>
            </p>
            <ul aria-label="Comprobantes por revisar" className="flex flex-col gap-3">
              {cola.data.map((comprobante) => (
                <FilaDeComprobante
                  key={comprobante.id}
                  comprobante={comprobante}
                  accion={accion}
                  alPedirAccion={setAccion}
                  alCancelar={() => setAccion(null)}
                  alTerminar={terminar}
                />
              ))}
            </ul>
          </>
        ))}
    </section>
  );
}
