import {
  aFechaISO,
  comparaHoras,
  fechaEnRango,
  fechasDelMesEnDiaSemana,
  minutosEntreHoras,
  type FranjaDeLiquidacion,
  type LiquidacionProfesor,
  type OrigenTarifa,
} from '@boxadmin/shared';

export interface HorarioParaLiquidacion {
  salaId: string;
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  desde: Date;
  hasta: Date | null;
  /** String con dos decimales. `null` = usa la del gimnasio. */
  tarifaPorHora: string | null;
}

export interface TurnoDictado {
  id: string;
  salaId: string;
  fecha: Date;
  horaInicio: string;
  horaFin: string;
}

export interface AusenciaParaLiquidacion {
  /** `null` = todo el salon. */
  salaId: string | null;
  desde: Date;
  hasta: Date;
  motivo: string | null;
}

export interface EntradaLiquidacion {
  profesorId: string;
  profesorNombre: string;
  anio: number;
  mes: number;
  horarios: HorarioParaLiquidacion[];
  /** Los turnos del mes que tienen a ESTA profesora. */
  turnos: TurnoDictado[];
  ausencias: AusenciaParaLiquidacion[];
  tarifaDelTenant: string | null;
}

/**
 * Las horas de una profesora en un mes.
 *
 * PURA: ni una query. Es lo que permite probar las cuatro combinaciones de
 * banderas con una tabla de casos, y lo que hara que la Fase 6 —que multiplica
 * por la tarifa y aplica ajustes— pueda construirse encima sin volver a derivar
 * nada.
 *
 * NO devuelve importes. El calculo en pesos es de la Fase 6; aqui la tarifa
 * viaja ya resuelta para que alli solo haya que multiplicar.
 */
export function calcularLiquidacion(entrada: EntradaLiquidacion): LiquidacionProfesor {
  const franjas: FranjaDeLiquidacion[] = [];
  const turnosUsados = new Set<string>();

  // --- Lo contratado: el patron semanal, fecha a fecha ----------------------
  for (const horario of entrada.horarios) {
    for (const fecha of fechasDelMesEnDiaSemana(entrada.anio, entrada.mes, horario.diaSemana)) {
      if (!fechaEnRango(fecha, horario.desde, horario.hasta)) continue;

      const turno = entrada.turnos.find(
        (t) =>
          !turnosUsados.has(t.id) &&
          t.salaId === horario.salaId &&
          t.fecha.getTime() === fecha.getTime() &&
          // La misma contencion que usa el etiquetado. Si las dos reglas no
          // dijeran lo mismo, un turno podria estar etiquetado con esta
          // profesora y no aparecer como dictado en su liquidacion.
          comparaHoras(t.horaInicio, horario.horaInicio) >= 0 &&
          comparaHoras(t.horaInicio, horario.horaFin) < 0,
      );
      if (turno) turnosUsados.add(turno.id);

      const ausencia = entrada.ausencias.find(
        (a) =>
          (a.salaId === null || a.salaId === horario.salaId) &&
          fechaEnRango(fecha, a.desde, a.hasta),
      );
      // Si hubo clase pese al cierre, no estaba cerrado: se dio.
      const cerrada = ausencia !== undefined && turno === undefined;

      const { tarifa, origen } = resolverTarifa(horario.tarifaPorHora, entrada.tarifaDelTenant);

      franjas.push({
        fecha: aFechaISO(fecha),
        salaId: horario.salaId,
        horaInicio: horario.horaInicio,
        horaFin: horario.horaFin,
        minutos: minutosEntreHoras(horario.horaInicio, horario.horaFin),
        contratada: true,
        dictada: turno !== undefined,
        cerrada,
        motivoCierre: cerrada ? (ausencia?.motivo ?? null) : null,
        turnoId: turno?.id ?? null,
        tarifaPorHora: tarifa,
        origenTarifa: origen,
      });
    }
  }

  // --- Las suplencias: turnos suyos que ningun contrato cubre ---------------
  for (const turno of entrada.turnos) {
    if (turnosUsados.has(turno.id)) continue;

    franjas.push({
      fecha: aFechaISO(turno.fecha),
      salaId: turno.salaId,
      horaInicio: turno.horaInicio,
      horaFin: turno.horaFin,
      minutos: minutosEntreHoras(turno.horaInicio, turno.horaFin),
      contratada: false,
      dictada: true,
      cerrada: false,
      motivoCierre: null,
      turnoId: turno.id,
      tarifaPorHora: entrada.tarifaDelTenant,
      origenTarifa: entrada.tarifaDelTenant === null ? null : 'TENANT',
    });
  }

  franjas.sort(
    (a, b) =>
      a.fecha.localeCompare(b.fecha) ||
      a.horaInicio.localeCompare(b.horaInicio) ||
      a.salaId.localeCompare(b.salaId),
  );

  const sumar = (filtro: (f: FranjaDeLiquidacion) => boolean): number =>
    franjas.filter(filtro).reduce((total, f) => total + f.minutos, 0);

  // Contratadas EXCLUYE las cerradas: asi "contratadas menos dictadas" significa
  // una sola cosa —horas que nadie uso por falta de alumnos— en vez de mezclar
  // eso con feriados, que se negocian distinto.
  const minutosContratados = sumar((f) => f.contratada && !f.cerrada);
  const minutosDictados = sumar((f) => f.dictada);
  const minutosCerrados = sumar((f) => f.cerrada);

  return {
    profesorId: entrada.profesorId,
    profesorNombre: entrada.profesorNombre,
    anio: entrada.anio,
    mes: entrada.mes,
    minutosContratados,
    minutosDictados,
    minutosCerrados,
    horasContratadas: aHoras(minutosContratados),
    horasDictadas: aHoras(minutosDictados),
    horasCerradas: aHoras(minutosCerrados),
    franjas,
  };
}

function resolverTarifa(
  delHorario: string | null,
  delTenant: string | null,
): { tarifa: string | null; origen: OrigenTarifa | null } {
  if (delHorario !== null) return { tarifa: delHorario, origen: 'HORARIO' };
  if (delTenant !== null) return { tarifa: delTenant, origen: 'TENANT' };

  // Ninguna definida no es un error: un gimnasio puede llevar los horarios sin
  // haber cargado tarifas todavia.
  return { tarifa: null, origen: null };
}

/**
 * Los minutos son la verdad; esto es una comodidad.
 *
 * Dos decimales SIEMPRE, incluso en "4.00": la Fase 6 va a multiplicar estos
 * numeros por una tarifa en Decimal, y un formato que a veces trae decimales y
 * a veces no es una invitacion a parsearlo mal.
 */
function aHoras(minutos: number): string {
  return (minutos / 60).toFixed(2);
}
