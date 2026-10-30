/**
 * LA VISTA DE UNA LIQUIDACION, compartida.
 *
 * La montan Analisis (`admin/analisis/liquidacion.tsx`) y, desde la Task 3 de
 * la Fase 15, `mi-liquidacion` de la profesora. LA UNICA DIFERENCIA entre las
 * dos es el aviso de minutos sin tarifa: el admin puede ir a configurarla y la
 * profesora no, asi que lo pone quien monta (`avisoSinTarifa`).
 *
 * No importa nada de `app/`: ninguna area importa de otra. Sin `use client`
 * por lo mismo que `tabla.tsx`: no tiene hooks ni estado y quien lo monta ya
 * es cliente.
 */

import type { ReactNode } from 'react';
import type { FranjaDeLiquidacion, Importe, LiquidacionProfesor } from '@boxadmin/shared';
import { Tabla, type ColumnaDeTabla } from '@/componentes/tabla';
import { Aviso } from '@/componentes/ui';
import { textoDelMes } from '@/lib/mes';

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
 * `data-cifra` y `data-importe` son el enganche con el que los specs de quien lo
 * monta afirman por IGUALDAD EXACTA. El signo de pesos va fuera del nodo
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
 * EL NOMBRE Y EL MES SALEN DE LA RESPUESTA y no del selector: pintar lo que
 * uno mismo mando es afirmar que se miro algo que a lo mejor no se miro.
 */
export function LiquidacionLeida({
  liquidacion,
  avisoSinTarifa,
}: {
  liquidacion: LiquidacionProfesor;
  /**
   * Lo que se dice cuando hay minutos sin tarifa. Es LA UNICA diferencia
   * entre el admin —que puede ir a configurarla— y la profesora —que no—.
   * Se llama solo con minutos > 0: la condicion es de aqui y no de quien
   * llama, para que ninguna de las dos pantallas pueda olvidarla.
   */
  avisoSinTarifa: (minutos: number) => ReactNode;
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
          {importes.minutosSinTarifa > 0 && avisoSinTarifa(importes.minutosSinTarifa)}
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
