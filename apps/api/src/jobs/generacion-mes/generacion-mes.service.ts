import {
  aFechaISO,
  fechaEnRango,
  fechasDelMesEnDiaSemana,
  type Conflicto,
  type EtiquetaDeProfesor,
  type Exclusion,
  type PlanDeMes,
  type ReservaPlanificada,
  type TipoPack,
  type TurnoPlanificado,
} from '@boxadmin/shared';
import {
  resolverProfesorDeFranja,
  type HorarioParaResolver,
} from '../../horarios-profesor/resolver-profesor';
import { topeDelPack } from '../../reservas/ventana-pack';

// ---------------------------------------------------------------------------
// La entrada: todo lo que el planificador necesita, ya cargado
// ---------------------------------------------------------------------------

export interface SalaParaPlan {
  id: string;
  nombre: string;
  /** `null` = la sala no tiene de donde sacar el cupo de un turno nuevo. */
  cupoBase: number | null;
}

export interface RutinaParaPlan {
  id: string;
  perfilId: string;
  salaId: string;
  nombre: string;
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  desde: Date;
  hasta: Date | null;
}

export interface AusenciaParaPlan {
  /** `null` = todo el salon. */
  salaId: string | null;
  desde: Date;
  hasta: Date;
}

export interface VacacionParaPlan {
  perfilId: string;
  desde: Date;
  hasta: Date;
}

export interface TurnoExistenteParaPlan {
  id: string;
  fecha: Date;
  horaInicio: string;
  cupo: number;
  reservasActivas: number;
  /** `null` = nadie le ha puesto profesora todavia. Es lo que lo hace un hueco. */
  profesorId: string | null;
}

export interface ReservaExistenteParaPlan {
  turnoId: string;
  perfilId: string;
}

export interface PerfilParaPlan {
  id: string;
  /** `null` = sin fecha de fin de vigencia. */
  vigenciaHasta: Date | null;
  clasesExtra: number;
  pack: { tipo: TipoPack; clasesPorMes: number | null; clasesTotales: number | null } | null;
  /**
   * Clases ya consumidas dentro de la ventana del pack. Lo precalcula el
   * cargador de datos, porque derivarlo exige contar reservas en la base y el
   * planificador no la toca.
   */
  clasesConsumidas: number;
}

export interface EntradaPlanificacion {
  sala: SalaParaPlan;
  anio: number;
  mes: number;
  rutinas: RutinaParaPlan[];
  ausencias: AusenciaParaPlan[];
  vacaciones: VacacionParaPlan[];
  turnosExistentes: TurnoExistenteParaPlan[];
  reservasActivas: ReservaExistenteParaPlan[];
  perfiles: PerfilParaPlan[];
  /** Los horarios de profesora vigentes en esta sala durante el mes. */
  horarios: HorarioParaResolver[];
}

/** Una rutina aplicada a una fecha concreta del mes. */
interface Candidato {
  rutina: RutinaParaPlan;
  fecha: Date;
  fechaISO: string;
}

/** Estado de ocupacion de una franja horaria mientras se planifica. */
interface Franja {
  cupo: number | null;
  ocupadas: number;
  turnoExistenteId: string | null;
  perfilesConReserva: Set<string>;
}

const clave = (fechaISO: string, horaInicio: string): string => `${fechaISO}|${horaInicio}`;

/**
 * Convierte las rutinas de una sala en el plan de un mes.
 *
 * Es una funcion PURA a proposito: no toca la base de datos ni la cola. Todo el
 * I/O vive en el cargador (`calendario.datos.ts`) y en el worker. Gracias a eso
 * los ocho casos del checklist del PDF son tests unitarios de verdad, sin
 * truncar tablas ni esperar a un job.
 *
 * Sigue el orden del §5 del PDF: vigencia, ausencias, vacaciones, turno, cupo,
 * pack. Y su punto 7: un conflicto individual NUNCA aborta el resto. El objetivo
 * es que el admin revise una lista acotada, no que un alumno con el pack vencido
 * bloquee el mes entero.
 */
export function planificarMes(entrada: EntradaPlanificacion): PlanDeMes {
  const { sala, anio, mes } = entrada;

  const turnosACrear: TurnoPlanificado[] = [];
  const reservasACrear: ReservaPlanificada[] = [];
  const etiquetasDeProfesor: EtiquetaDeProfesor[] = [];
  const conflictos: Conflicto[] = [];
  const exclusiones: Exclusion[] = [];

  const perfilesPorId = new Map(entrada.perfiles.map((perfil) => [perfil.id, perfil]));
  const planificadasPorPerfil = new Map<string, number>();

  // --- Estado inicial de cada franja, a partir de lo que ya existe ----------
  const franjas = new Map<string, Franja>();
  for (const turno of entrada.turnosExistentes) {
    franjas.set(clave(aFechaISO(turno.fecha), turno.horaInicio), {
      cupo: turno.cupo,
      ocupadas: turno.reservasActivas,
      turnoExistenteId: turno.id,
      perfilesConReserva: new Set(),
    });
  }
  for (const reserva of entrada.reservasActivas) {
    for (const franja of franjas.values()) {
      if (franja.turnoExistenteId === reserva.turnoId) {
        franja.perfilesConReserva.add(reserva.perfilId);
      }
    }
  }

  // --- Turnos que ya existen y estan SIN profesora --------------------------
  //
  // Se recorren todos, no solo los de las franjas con rutina: el admin puede
  // haber dado de alta el horario DESPUES de publicar el mes, y esos turnos no
  // tienen por que coincidir con ningun candidato de esta vuelta.
  //
  // Los que YA tienen profesora no se tocan: tener profesora significa que
  // alguien lo decidio, y republicar el mes no puede deshacerlo.
  for (const turno of entrada.turnosExistentes) {
    if (turno.profesorId !== null) continue;

    const profesorId = resolverProfesorDeFranja(
      entrada.horarios,
      sala.id,
      turno.fecha,
      turno.horaInicio,
    );
    if (profesorId !== null) {
      etiquetasDeProfesor.push({ turnoId: turno.id, profesorId });
    }
  }

  // --- Candidatos: cada rutina de esta sala, en cada fecha que le toca ------
  const candidatos: Candidato[] = [];
  for (const rutina of entrada.rutinas) {
    if (rutina.salaId !== sala.id) continue;

    for (const fecha of fechasDelMesEnDiaSemana(anio, mes, rutina.diaSemana)) {
      if (!fechaEnRango(fecha, rutina.desde, rutina.hasta)) continue;
      candidatos.push({ rutina, fecha, fechaISO: aFechaISO(fecha) });
    }
  }

  // Orden determinista. Importa: con el cupo justo, quien entra y quien queda
  // en conflicto no puede depender del orden en que la base devolvio las filas.
  candidatos.sort(
    (a, b) =>
      a.fechaISO.localeCompare(b.fechaISO) ||
      a.rutina.horaInicio.localeCompare(b.rutina.horaInicio) ||
      a.rutina.perfilId.localeCompare(b.rutina.perfilId),
  );

  for (const { rutina, fecha, fechaISO } of candidatos) {
    // 1. Ausencias de la sala o del salon entero.
    const ausencia = entrada.ausencias.find(
      (a) => (a.salaId === null || a.salaId === sala.id) && fechaEnRango(fecha, a.desde, a.hasta),
    );
    if (ausencia) {
      exclusiones.push({
        tipo: 'AUSENCIA_SALA',
        // El perfil afectado, NO null: el cierre es uno solo, pero deja sin
        // clase a un alumno concreto por cada rutina que tocaba ese dia. Con
        // null, un salon de treinta alumnos producia treinta filas identicas e
        // inservibles; asi el admin ve a quien avisar.
        perfilId: rutina.perfilId,
        fecha: fechaISO,
        detalle:
          ausencia.salaId === null
            ? 'El salon esta cerrado ese dia'
            : `La sala ${sala.nombre} esta cerrada ese dia`,
      });
      continue;
    }

    // 2. Vacaciones del alumno. Excluyen SOLO a ese alumno: el turno sigue
    //    existiendo para los demas.
    const vacacion = entrada.vacaciones.find(
      (v) => v.perfilId === rutina.perfilId && fechaEnRango(fecha, v.desde, v.hasta),
    );
    if (vacacion) {
      exclusiones.push({
        tipo: 'VACACION_ALUMNO',
        perfilId: rutina.perfilId,
        fecha: fechaISO,
        detalle: 'El alumno esta de vacaciones ese dia',
      });
      continue;
    }

    // 3. Resolver la franja: existente, ya planificada, o nueva.
    const llave = clave(fechaISO, rutina.horaInicio);
    let franja = franjas.get(llave);

    if (!franja) {
      if (sala.cupoBase === null) {
        // La sala no tiene de donde sacar el cupo. Se reporta una vez por franja
        // y no se inventa un valor por defecto.
        conflictos.push({
          tipo: 'SALA_SIN_CUPO_BASE',
          perfilId: null,
          fecha: fechaISO,
          detalle: `La sala ${sala.nombre} no tiene cupoBase, asi que no se puede crear el turno de las ${rutina.horaInicio}`,
        });
        franjas.set(llave, {
          cupo: null,
          ocupadas: 0,
          turnoExistenteId: null,
          perfilesConReserva: new Set(),
        });
        continue;
      }

      franja = {
        cupo: sala.cupoBase,
        ocupadas: 0,
        turnoExistenteId: null,
        perfilesConReserva: new Set(),
      };
      franjas.set(llave, franja);

      turnosACrear.push({
        salaId: sala.id,
        nombre: rutina.nombre,
        fecha: fechaISO,
        horaInicio: rutina.horaInicio,
        horaFin: rutina.horaFin,
        cupo: sala.cupoBase,
        profesorId: resolverProfesorDeFranja(entrada.horarios, sala.id, fecha, rutina.horaInicio),
      });
    }

    // La franja quedo marcada como "sin cupo base" en una vuelta anterior.
    if (franja.cupo === null) continue;

    // 4. Idempotencia: si el alumno ya tiene reserva ahi, no hay nada que hacer
    //    ni nada que reportar.
    if (franja.perfilesConReserva.has(rutina.perfilId)) continue;

    // 5. Cupo. El PDF lo comprueba ANTES que el pack.
    if (franja.ocupadas >= franja.cupo) {
      conflictos.push({
        tipo: 'CUPO_LLENO',
        perfilId: rutina.perfilId,
        fecha: fechaISO,
        detalle: `El turno de las ${rutina.horaInicio} esta completo (${franja.ocupadas}/${franja.cupo})`,
      });
      continue;
    }

    // 6. Pack: vigencia y tope.
    const perfil = perfilesPorId.get(rutina.perfilId);
    const motivoPack = perfil
      ? motivoFueraDePack(perfil, fecha, planificadasPorPerfil)
      : 'Perfil desconocido';
    if (motivoPack) {
      conflictos.push({
        tipo: 'FUERA_DE_PACK',
        perfilId: rutina.perfilId,
        fecha: fechaISO,
        detalle: motivoPack,
      });
      continue;
    }

    // 7. Planificar.
    reservasACrear.push({
      perfilId: rutina.perfilId,
      salaId: sala.id,
      fecha: fechaISO,
      horaInicio: rutina.horaInicio,
    });
    franja.ocupadas += 1;
    franja.perfilesConReserva.add(rutina.perfilId);
    planificadasPorPerfil.set(
      rutina.perfilId,
      (planificadasPorPerfil.get(rutina.perfilId) ?? 0) + 1,
    );
  }

  return {
    turnosACrear,
    reservasACrear,
    etiquetasDeProfesor,
    conflictos,
    exclusiones,
    resumen: {
      turnos: turnosACrear.length,
      reservas: reservasACrear.length,
      conflictos: conflictos.length,
      exclusiones: exclusiones.length,
    },
  };
}

/** Devuelve el motivo por el que el perfil no puede reservar, o `null` si puede. */
function motivoFueraDePack(
  perfil: PerfilParaPlan,
  fecha: Date,
  planificadasPorPerfil: Map<string, number>,
): string | null {
  if (perfil.vigenciaHasta !== null && fecha.getTime() > perfil.vigenciaHasta.getTime()) {
    return `La vigencia del pack termino el ${aFechaISO(perfil.vigenciaHasta)}`;
  }

  const tope = topeDelPack(perfil.pack, {
    clasesExtra: perfil.clasesExtra,
    vigenciaDesde: null,
    vigenciaHasta: perfil.vigenciaHasta,
  });
  if (tope === null) return null;

  const consumidas = perfil.clasesConsumidas + (planificadasPorPerfil.get(perfil.id) ?? 0);
  if (consumidas >= tope) {
    return `El alumno ya tiene ${consumidas} de ${tope} clases de su pack en este periodo`;
  }

  return null;
}
