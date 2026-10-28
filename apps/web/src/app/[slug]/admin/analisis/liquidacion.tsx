'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { FranjaDeLiquidacion, Importe, LiquidacionProfesor } from '@boxadmin/shared';
import { Tabla, type ColumnaDeTabla } from '@/componentes/tabla';
import { Aviso, Boton } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { useLiquidacion } from '@/hooks/use-dinero';
import type { Mes } from '@/hooks/use-stats';
import { useUsuarios } from '@/hooks/use-usuarios';
import { textoDelMes } from './filtros';

/**
 * LA LIQUIDACION DE UNA PROFESORA: lo que cobra en un mes. Es el ultimo
 * endpoint de la API que no tenia pantalla.
 *
 * LA PUERTA DE ROL NO ESTA AQUI SINO EN `page.tsx`, como la de la caja y por el
 * mismo motivo: este componente pide la lista de profesoras en su primera
 * linea, asi que montarlo es pedir. `GET /liquidacion/:profesorId` pide
 * `ADMIN_SALON` —«esto ensena tarifas», dice el controller— y la pagina no lo
 * monta para nadie por debajo.
 *
 * ---------------------------------------------------------------------------
 * LA PROFESORA SE ELIGE POR SU `perfilId`, Y VIVE EN LA URL.
 *
 * `profesorId` es un PERFIL: `LiquidacionDatos` hace
 * `perfil.findFirst({ where: { id: profesorId } })` y exige que su usuario sea
 * `PROFESOR`. `UsuarioResumen` trae los dos ids, y el del usuario contra este
 * endpoint es un 404 —en la Fase 10 ese cruce costo una tarea entera—.
 *
 * En la URL (`?profesora=`) y no en `useState`, por lo mismo que el mes: se
 * comparte por chat, sobrevive al boton de atras y vuelve puesta del login.
 *
 * NO HAY UNA POR DEFECTO. Sin `?profesora=` no se pide ninguna liquidacion:
 * elegir la primera de la lista seria pedir el sueldo de alguien que nadie
 * busco, y dejarlo en la cache del navegador.
 *
 * LA LISTA LLEVA TAMBIEN A LAS DE BAJA. `GET /usuarios?tipo=profesor` sin
 * `activo` las devuelve todas —el service solo filtra si el filtro lo trae— y
 * tiene que ser asi: una profesora que se fue en febrero sigue cobrando enero.
 *
 * ---------------------------------------------------------------------------
 * ESTA PANTALLA NO CALCULA NADA, NI UNA SUMA.
 *
 * Todo lo que hay que saber de una liquidacion lo manda el servidor ya hecho:
 * los minutos y las horas de cada grupo, los cuatro importes y los minutos sin
 * tarifa. Lo que se pinta de un `Importe` es su `texto` —el campo hecho para
 * eso— y no hace falta ni un `centavos` porque no hay ninguna cuenta.
 *
 * `aPagar` ES DEL SERVIDOR. Hoy es exactamente `dictadas`, y aun asi se pinta
 * el que vino: el dia que la regla cambie —un ajuste, un adelanto—, una
 * pantalla que copie o sume por su cuenta sigue pagando lo de antes con cara
 * de exactitud.
 *
 * LAS HORAS TAMPOCO SE DERIVAN DE LOS MINUTOS: las dos vienen en el contrato, y
 * dos implementaciones del mismo numero acaban discrepando.
 */

/** Lo que se dice antes de elegir. No es un error: es la pregunta. */
const SIN_ELEGIR = 'Elegí una profesora para ver su liquidación.';

const PRINCIPIO_DEL_FALLO_DE_LA_LISTA = 'No se pudo leer la lista de profesoras: ';
const PRINCIPIO_DEL_FALLO = 'No se pudo leer la liquidacion: ';

/**
 * La profesora de la URL, o `null`.
 *
 * Un `?profesora=` vacio es lo que deja el selector en «Elegí una profesora» y
 * vale lo mismo que no tenerlo: para la API no es «ninguna» sino
 * `/liquidacion/?anio=…`, otra ruta.
 */
function profesoraDeLaBusqueda(parametros: URLSearchParams): string | null {
  const valor = parametros.get('profesora');
  return valor === null || valor === '' ? null : valor;
}

// ---------------------------------------------------------------------------
// Las cuatro situaciones de una franja
// ---------------------------------------------------------------------------

type Situacion = 'dictada' | 'sin-alumnos' | 'cerrada' | 'suplencia';

/**
 * TRES BANDERAS ORTOGONALES, CUATRO SITUACIONES. No dos.
 *
 * La tabla esta en el contrato (`FranjaDeLiquidacion`): contratada y dictada
 * es una clase que se dio; contratada sin dictar y SIN cerrar es que nadie se
 * anoto; contratada sin dictar y CERRADA es un feriado, que no suma a
 * contratadas; y no contratada es una suplencia.
 *
 * El orden de las preguntas importa: una suplencia trae `dictada: true` y se
 * pintaria como «se dio» si se preguntara eso primero. `cerrada` solo se mira
 * entre las contratadas sin dictar, que es donde el service la pone —«si hubo
 * clase pese al cierre, no estaba cerrado: se dio»—.
 */
function situacionDe(franja: FranjaDeLiquidacion): Situacion {
  if (!franja.contratada) return 'suplencia';
  if (franja.dictada) return 'dictada';
  return franja.cerrada ? 'cerrada' : 'sin-alumnos';
}

const TEXTO_DE_LA_SITUACION: Record<Situacion, string> = {
  dictada: 'Se dio',
  'sin-alumnos': 'Nadie se anotó',
  cerrada: 'Salón cerrado',
  suplencia: 'Suplencia, sin contrato',
};

function TextoDeLaSituacion({ franja }: { franja: FranjaDeLiquidacion }) {
  const situacion = situacionDe(franja);
  const motivo = situacion === 'cerrada' ? franja.motivoCierre : null;

  return (
    <span data-situacion={situacion}>
      {TEXTO_DE_LA_SITUACION[situacion]}
      {motivo !== null && `: ${motivo}`}
    </span>
  );
}

/** La tarifa TAL CUAL llego, con su origen. La que falta se dice. */
function TarifaDeLaFranja({ franja }: { franja: FranjaDeLiquidacion }) {
  if (franja.tarifaPorHora === null) {
    return (
      <span data-tarifa className="font-medium text-red-700">
        Sin tarifa
      </span>
    );
  }

  const origen = franja.origenTarifa === 'HORARIO' ? 'del horario' : 'general del gimnasio';
  return <span data-tarifa>{`${franja.tarifaPorHora} (${origen})`}</span>;
}

const COLUMNAS_DE_LAS_FRANJAS: readonly ColumnaDeTabla<FranjaDeLiquidacion>[] = [
  { encabezado: 'Fecha', celda: (franja) => franja.fecha },
  { encabezado: 'Horario', celda: (franja) => `${franja.horaInicio} a ${franja.horaFin}` },
  { encabezado: 'Minutos', celda: (franja) => franja.minutos },
  { encabezado: 'Situacion', celda: (franja) => <TextoDeLaSituacion franja={franja} /> },
  { encabezado: 'Tarifa por hora', celda: (franja) => <TarifaDeLaFranja franja={franja} /> },
];

/**
 * La clave de una fila. Dos franjas del mismo dia, a la misma hora y en la
 * misma sala no las produce el service: cada horario genera una por fecha y
 * cada turno se usa una sola vez.
 */
function claveDeLaFranja(franja: FranjaDeLiquidacion): string {
  return `${franja.fecha}|${franja.horaInicio}|${franja.salaId}|${franja.turnoId ?? ''}`;
}

// ---------------------------------------------------------------------------
// Los numeros
// ---------------------------------------------------------------------------

/**
 * Un importe, con su nombre y lo que hay que saber para leerlo.
 *
 * `data-cifra` y `data-importe` son el enganche con el que el spec afirma por
 * IGUALDAD EXACTA, como en la caja. El signo de pesos va fuera del nodo
 * marcado.
 */
function CifraDeLiquidacion({
  clave,
  titulo,
  importe,
  nota,
  destacada = false,
  children,
}: {
  clave: string;
  titulo: string;
  importe: Importe;
  nota: string;
  destacada?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      data-cifra={clave}
      className={`flex flex-col gap-1 rounded-xl border bg-white p-4 shadow-sm ${
        destacada ? 'border-slate-400' : 'border-slate-200'
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</p>

      <p className={`font-semibold text-slate-900 ${destacada ? 'text-3xl' : 'text-xl'}`}>
        <span className="text-base font-normal text-slate-500">$ </span>
        <span data-importe>{importe.texto}</span>
      </p>

      <p data-nota className="text-xs text-slate-500">
        {nota}
      </p>

      {children}
    </div>
  );
}

/**
 * LOS MINUTOS SIN TARIFA, DENTRO DE LA CIFRA DE LO QUE SE PAGA.
 *
 * El contrato explica por que viajan: «un importe al que le faltan horas y no
 * lo dice es un numero que parece completo y no lo esta. Mayor que cero
 * significa "falta configurar una tarifa", no "trabajo menos"». Cubren LOS
 * TRES grupos, asi que el aviso habla de «estos importes» y no solo del que lo
 * lleva.
 *
 * VA AL LADO DEL IMPORTE y con palabras: una nota al pie llega tarde, y un
 * `title` no lo lee nadie que no pase el raton por encima.
 *
 * Y DICE ADONDE IR: la tarifa de un horario se edita en `admin/horarios` desde
 * la Fase 10, y la general del gimnasio sale de la misma cuenta.
 */
function AvisoSinTarifa({ minutos, slug }: { minutos: number; slug: string }) {
  return (
    <p data-sin-tarifa className="text-xs font-semibold text-red-700">
      {`${minutos} minutos de este mes no tienen tarifa, así que estos importes están incompletos. `}
      <Link href={`/${slug}/admin/horarios`} className="underline underline-offset-2">
        Configurar la tarifa en Horarios
      </Link>
    </p>
  );
}

/** Las horas de cada grupo, TAL CUAL las manda el servidor. */
function Horas({ liquidacion }: { liquidacion: LiquidacionProfesor }) {
  return (
    <dl className="grid grid-cols-3 gap-3 text-sm">
      <div>
        <dt className="text-xs text-slate-500">Horas contratadas (sin las cerradas)</dt>
        <dd data-horas="contratadas" className="font-semibold text-slate-900">
          {liquidacion.horasContratadas}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500">Horas dictadas</dt>
        <dd data-horas="dictadas" className="font-semibold text-slate-900">
          {liquidacion.horasDictadas}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500">Horas con el salón cerrado</dt>
        <dd data-horas="cerradas" className="font-semibold text-slate-900">
          {liquidacion.horasCerradas}
        </dd>
      </div>
    </dl>
  );
}

/**
 * La liquidacion ya leida.
 *
 * EL NOMBRE Y EL MES SALEN DE LA RESPUESTA y no del selector, igual que el
 * encabezado de la caja: pintar lo que uno mismo mando es afirmar que se miro
 * algo que a lo mejor no se miro.
 */
function LiquidacionLeida({
  liquidacion,
  slug,
}: {
  liquidacion: LiquidacionProfesor;
  slug: string;
}) {
  const { importes } = liquidacion;
  const mes = textoDelMes(liquidacion);

  return (
    <>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {`La liquidación de ${liquidacion.profesorNombre}, ${mes}`}
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <CifraDeLiquidacion
          clave="aPagar"
          titulo="A pagar"
          importe={importes.aPagar}
          nota="Lo calcula el servidor. Hoy es lo dictado."
          destacada
        >
          {importes.minutosSinTarifa > 0 && (
            <AvisoSinTarifa minutos={importes.minutosSinTarifa} slug={slug} />
          )}
        </CifraDeLiquidacion>

        <CifraDeLiquidacion
          clave="dictadas"
          titulo="Dictadas"
          importe={importes.dictadas}
          nota="Se paga."
        />
        <CifraDeLiquidacion
          clave="contratadasSinDictar"
          titulo="Contratadas sin dictar"
          importe={importes.contratadasSinDictar}
          nota="No se paga: horas contratadas a las que nadie se anotó."
        />
        <CifraDeLiquidacion
          clave="cerradas"
          titulo="Cerradas"
          importe={importes.cerradas}
          nota="No se paga: horas con el salón cerrado."
        />
      </div>

      <Horas liquidacion={liquidacion} />

      {/* EL ORDEN LO DA EL SERVIDOR —por fecha, hora y sala— y aqui no se
          reordena. */}
      <Tabla
        etiqueta="Las franjas del mes"
        columnas={COLUMNAS_DE_LAS_FRANJAS}
        filas={liquidacion.franjas}
        claveDeFila={claveDeLaFranja}
        vacio={
          <Aviso>
            {`${liquidacion.profesorNombre} no tiene ninguna franja en ${mes}: ni horarios contratados ni clases dadas.`}
          </Aviso>
        }
      />
    </>
  );
}

/**
 * La liquidacion de UNA profesora. Se monta solo con una elegida: no montarla
 * es no pedirla, sin un `enabled: false` a un refactor de distancia de salir.
 */
function LiquidacionDeUna({ perfilId, mes, slug }: { perfilId: string; mes: Mes; slug: string }) {
  const liquidacion = useLiquidacion(perfilId, mes);

  if (liquidacion.isPending) {
    return <p className="text-sm text-slate-500">Cargando la liquidacion…</p>;
  }

  /**
   * UN FALLO AL LEER NO SE PARECE A UN MES SIN FRANJAS. Un mes vacio son ceros
   * de verdad; esto es un no se sabe, y no pinta ni un numero.
   */
  if (liquidacion.data === undefined) {
    if (esSesionCaducada(liquidacion.error)) return null;

    return (
      <div className="flex flex-col items-start gap-2">
        <Aviso tono="error">
          {PRINCIPIO_DEL_FALLO}
          {liquidacion.error.message}
        </Aviso>
        <Boton tono="secundario" onClick={() => void liquidacion.refetch()}>
          Reintentar la liquidacion
        </Boton>
      </div>
    );
  }

  return <LiquidacionLeida liquidacion={liquidacion.data} slug={slug} />;
}

function esSesionCaducada(error: unknown): boolean {
  return error instanceof ErrorDeApi && error.esSesionCaducada;
}

/**
 * El bloque entero: el selector y, si hay una elegida, su liquidacion.
 *
 * UNA SESION CADUCADA NO SE DIBUJA AQUI. La pagina ya lo dice una vez y se esta
 * yendo al login, igual que con la caja.
 */
export function BloqueDeLiquidacion({ mes }: { mes: Mes }) {
  const { slug } = useParams<{ slug: string }>();
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();

  const profesoras = useUsuarios({ tipo: 'profesor' });
  const elegida = profesoraDeLaBusqueda(parametros);

  if (esSesionCaducada(profesoras.error)) return null;

  /**
   * Elegir escribe la URL y CONSERVA lo demas: el mes vive al lado. Volver a
   * «Elegí una profesora» QUITA la clave en vez de dejarla vacia.
   */
  function elegir(valor: string): void {
    const siguientes = new URLSearchParams(parametros.toString());
    if (valor === '') siguientes.delete('profesora');
    else siguientes.set('profesora', valor);

    const consulta = siguientes.toString();
    router.push(consulta === '' ? ruta : `${ruta}?${consulta}`);
  }

  return (
    <section data-bloque="liquidacion" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="liquidacion-profesora" className="text-xs font-medium text-slate-600">
          Profesora
        </label>
        <select
          id="liquidacion-profesora"
          value={elegida ?? ''}
          onChange={(evento) => elegir(evento.target.value)}
          className="max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
        >
          <option value="">Elegí una profesora</option>
          {(profesoras.data ?? []).map((profesora) => (
            // EL `perfilId`, NO EL `id`: es lo que `/liquidacion/:profesorId` busca.
            <option key={profesora.perfilId} value={profesora.perfilId}>
              {profesora.activo
                ? profesora.nombreCompleto
                : `${profesora.nombreCompleto} (de baja)`}
            </option>
          ))}
        </select>
      </div>

      {profesoras.error !== null && (
        <Aviso tono="error">
          {PRINCIPIO_DEL_FALLO_DE_LA_LISTA}
          {profesoras.error.message}
        </Aviso>
      )}

      {elegida === null ? (
        <p className="text-sm text-slate-600">{SIN_ELEGIR}</p>
      ) : (
        <LiquidacionDeUna key={elegida} perfilId={elegida} mes={mes} slug={slug} />
      )}
    </section>
  );
}
