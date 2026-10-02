import { Injectable } from '@nestjs/common';
import { primerDiaDelMesUtc, type MetodoPago, type TipoCancelacion } from '@boxadmin/shared';
import { PagosService } from '../pagos/pagos.service';
import { PrismaService } from '../prisma/prisma.service';

/** Un pago, reducido a lo que la caja necesita de el. */
export interface PagoParaCaja {
  metodo: MetodoPago;
  /**
   * Dos decimales SIEMPRE, convertido desde el `Decimal` de Prisma con
   * `.toFixed(2)`.
   *
   * LA REGLA NO ES "NUNCA `.toNumber()`", AUNQUE ASI SE DIGA EN VOZ ALTA: es
   * **nada de coma flotante en la conversion a centavos**. Se comprobo con una
   * mutacion, y la version corta es mentira en un sentido util de saber. Un
   * `Decimal(10, 2)` tiene diez digitos significativos y cabe EXACTO en un
   * double, asi que `monto.toNumber()` por si solo no pierde nada y
   * `.toNumber().toFixed(2)` devuelve el mismo string: la mutacion literal no
   * rompe ningun test porque es codigo correcto. Lo que `.toNumber()` abre es
   * el CAMINO: en cuanto alguien multiplica por cien para pasar a centavos,
   * `0.29 * 100` da 28.999999999999996 y `1.15 * 100` da 114.99999999999999, y
   * un truncado se come un centavo en cada uno. Saliendo de esta capa como
   * texto ese camino no existe, porque el unico conversor a centavos es
   * `aCentavos`, que trabaja sobre digitos. Hay un caso con esos dos montos
   * exactos en `stats.service.spec.ts`.
   */
  monto: string;
}

/** Un alumno con plan contratado, para el pendiente estimado. */
export interface PerfilConPack {
  perfilId: string;
  packId: string;
  /** Dos decimales, o `null` cuando el pack es "a consultar" (precio sin fijar). */
  precioPack: string | null;
}

/** Un turno del mes, reducido a lo que las metricas operativas necesitan. */
export interface TurnoParaMetricas {
  turnoId: string;
  /**
   * EL CUPO DEL TURNO, que es el unico que corresponde a una clase real.
   *
   * `Sala.cupoBase` existe y es el valor POR DEFECTO con el que se crean los
   * turnos, no el que rige: desde la Fase 1 un turno puede tener el suyo
   * propio. Una ocupacion calculada sobre el de la sala no es el porcentaje de
   * ninguna clase que haya ocurrido.
   */
  cupo: number;
}

/** Una reserva de uno de esos turnos, viva o cancelada. */
export interface ReservaParaMetricas {
  turnoId: string;
  /**
   * DE QUIEN ES LA RESERVA. Las metricas operativas no lo miran —cuentan
   * cabezas, no personas— pero la composicion y la asistencia por alumno si, y
   * las tres leen las reservas de los mismos turnos.
   *
   * Viaja aqui en vez de en una segunda consulta por reporte para que las tres
   * cuenten sobre exactamente las mismas filas: dos consultas con dos `where`
   * parecidos son dos conjuntos que algun dia difieren, y el dia que difieran
   * la ocupacion y el consumo del mismo mes no van a cuadrar entre si.
   */
  perfilId: string;
  canceladaEn: Date | null;
  cancelacionTipo: TipoCancelacion | null;
  /** `null` = todavia no se paso lista. NO es "no vino". */
  asistio: boolean | null;
}

/**
 * Un turno con todo lo que hace falta para publicarlo en un listado.
 *
 * Es mas ancho que `TurnoParaMetricas` porque los turnos libres se MUESTRAN
 * —fecha, hora y sala van en la respuesta— mientras que la ocupacion solo los
 * cuenta. Son dos selects distintos a proposito: traer siempre el ancho haria
 * que el reporte barato pagara el caro.
 */
export interface TurnoParaListado {
  turnoId: string;
  salaId: string;
  fecha: Date;
  horaInicio: string;
  horaFin: string;
  cupo: number;
}

/** Nombre y email de un perfil, que viven en `Usuario` y no en `Perfil`. */
export interface DatosDePerfil {
  nombreCompleto: string;
  email: string;
}

/** Un alumno en alta, con el pack que tiene HOY. */
export interface AlumnoActivo {
  perfilId: string;
  nombreCompleto: string;
  /** `null` = sin plan contratado. Se agrupa aparte, nunca se descarta. */
  packId: string | null;
}

/** Un pack, reducido a lo que los reportes muestran de el. */
export interface PackParaReporte {
  nombre: string;
  /** Dos decimales, o `null` cuando el pack es "a consultar" (precio sin fijar). */
  precio: string | null;
}

/**
 * Las consultas de los reportes. Ni una regla de negocio.
 *
 * Mismo reparto que `liquidacion.datos.ts` desde la Fase 4 y que la Fase 2
 * antes: aqui no entra una decision, y en el service no entra una query.
 *
 * TODAS las lecturas van por `prisma.db`, el cliente con la extension de
 * aislamiento: el `tenantId` lo inyecta ella a partir del contexto de la
 * peticion, asi que ninguna firma de este archivo lo recibe ni podria
 * falsificarlo. Lo que el service SI tiene que acertar es el tenant con el que
 * cachea; ver el docblock de `CacheDeStats`.
 */
@Injectable()
export class StatsDatos {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pagos: PagosService,
  ) {}

  /**
   * Pagos NO anulados cuyo `createdAt` cae en el mes. Base CAJA, no devengado:
   * cuenta cuando entro el dinero, no el periodo que cubre. Es el mismo
   * criterio que fijo la 5A para `GET /pagos`, y esta explicado en el contrato
   * de `CajaDelMes` y en el README.
   *
   * EL RANGO ES SEMIABIERTO `[mes, mes siguiente)`. No se usa
   * `ultimoDiaDelMesUtc` aunque exista y parezca lo natural: devuelve la
   * MEDIANOCHE del ultimo dia, y `createdAt` es un timestamp, asi que un
   * `lte` contra ella se comeria en silencio todos los cobros del dia 31 a
   * partir de las 00:00. Con el limite superior exclusivo no hay ningun
   * instante que quede fuera ni que se cuente dos veces entre dos meses
   * consecutivos.
   */
  async pagosDelMes(anio: number, mes: number): Promise<PagoParaCaja[]> {
    const filas = await this.prisma.db.pago.findMany({
      where: {
        anuladoEn: null,
        createdAt: { gte: inicioDelMes(anio, mes), lt: inicioDelMesSiguiente(anio, mes) },
      },
      select: { monto: true, metodo: true },
    });

    return filas.map((fila) => ({ metodo: fila.metodo, monto: fila.monto.toFixed(2) }));
  }

  /**
   * Los perfiles de las profesoras del gimnasio.
   *
   * NO filtra por `activo`: una profesora dada de baja en noviembre trabajo en
   * octubre y hay que pagarle octubre. Darla de baja cierra el `hasta` de sus
   * horarios, que es lo que de verdad acota las horas.
   *
   * Son dos consultas planas y no un `where` sobre la relacion `usuario` a
   * proposito: el rol vive en `Usuario` y el id que la liquidacion necesita
   * vive en `Perfil`, y un filtro anidado se vuelve invisible para cualquier
   * doble de Prisma que compare campo a campo —o sea, se vuelve un `where` que
   * ningun test puede comprobar que este—.
   */
  async profesores(): Promise<string[]> {
    const usuarios = await this.prisma.db.usuario.findMany({
      where: { rol: 'PROFESOR' },
      select: { id: true },
    });
    if (usuarios.length === 0) return [];

    const perfiles = await this.prisma.db.perfil.findMany({
      where: { usuarioId: { in: usuarios.map((u) => u.id) } },
      select: { id: true },
    });

    return perfiles.map((perfil) => perfil.id);
  }

  /**
   * Los ALUMNOS EN ALTA con plan contratado, con el precio de su pack resuelto.
   *
   * Quien NO tiene pack no sale: no debe nada porque no contrato nada. Si
   * saliera, el reporte de morosos se llenaria de gente que nunca se anoto a
   * ninguna cosa (y el pendiente estimado de la caja, de ceros).
   *
   * Y QUIEN SE FUE TAMPOCO SALE. Este metodo no filtraba ni por rol ni por
   * `activo`, y `alumnosActivos()` si: la misma persona era "no es alumno" para
   * la composicion y "alumno que debe" para la cobranza, el pendiente de la caja
   * y los morosos. Nadie habia tomado esa decision; estaba heredada.
   *
   * LO PEOR ERA LA COBRANZA, QUE DECAIA PARA SIEMPRE. `darDeBaja` no limpia el
   * `packId`, asi que cada ex-alumno se quedaba en el denominador sin poder
   * volver a estar al dia jamas: el indicador bajaba solo a medida que el
   * gimnasio acumulaba historia. Un numero que baja solo es exactamente el
   * numero plausible y equivocado que la seccion 6 de la spec existe para
   * evitar.
   *
   * LA REGLA, ESCRITA UNA VEZ PARA LOS CUATRO REPORTES: recepcion no llama a
   * quien se fue; la cobranza mide a los alumnos que el gimnasio TIENE, no a los
   * que tuvo; y el pendiente de la caja de un mes es lo que ese mes quedo sin
   * cobrar de su gente, no una deuda historica acumulada. Una sola poblacion,
   * una sola verdad sobre quien es alumno — la misma que `alumnosActivos()`.
   *
   * EL FILTRO DE ROL NO ES REDUNDANTE con el de pack. Hoy una profesora no
   * tiene pack y caeria sola, pero nada en el schema lo impide: `Perfil.packId`
   * es opcional para todos, y el dia que alguien le asigne un pack a una
   * profesora —para probar algo, para darle clases— apareceria en los morosos.
   */
  async perfilesConPack(): Promise<PerfilConPack[]> {
    const usuarios = await this.prisma.db.usuario.findMany({
      where: { rol: 'ALUMNO', activo: true },
      select: { id: true },
    });
    if (usuarios.length === 0) return [];

    const perfiles = await this.prisma.db.perfil.findMany({
      where: { usuarioId: { in: usuarios.map((usuario) => usuario.id) }, packId: { not: null } },
      select: { id: true, packId: true },
    });
    if (perfiles.length === 0) return [];

    const packs = await this.prisma.db.pack.findMany({ select: { id: true, precio: true } });
    const precioPorPack = new Map(
      packs.map((pack) => [pack.id, pack.precio === null ? null : pack.precio.toFixed(2)]),
    );

    return perfiles.map((perfil) => ({
      perfilId: perfil.id,
      // El `where` ya descarto los nulos; el `?? ''` solo existe porque Prisma
      // tipa la columna como opcional y TypeScript no sabe leer el `where`.
      packId: perfil.packId ?? '',
      // Un pack que ya no esta o cuyo precio esta "a consultar" vale null, no
      // cero: son dos cosas distintas y el reporte las dice distinto.
      precioPack: precioPorPack.get(perfil.packId ?? '') ?? null,
    }));
  }

  /**
   * Los turnos del mes, opcionalmente acotados a una sala.
   *
   * EL `salaId` AQUI SI ES LIMPIO, al reves que en la caja: un `Turno` tiene
   * sala propia, asi que acotar no exige inventar ninguna regla de atribucion.
   * El porque de la asimetria esta entero en el docblock de `StatsService.caja`.
   *
   * EL RANGO ES SEMIABIERTO `[mes, mes siguiente)` igual que el de los pagos,
   * aunque `fecha` sea `@db.Date` y un `lte` contra `ultimoDiaDelMesUtc`
   * tambien funcionaria hoy. Es el mismo rango escrito de la misma forma en los
   * dos sitios: el dia que alguien le ponga hora a esta columna, este metodo no
   * empieza a comerse en silencio los turnos del dia 31.
   */
  async turnosDelMes(anio: number, mes: number, salaId?: string): Promise<TurnoParaMetricas[]> {
    const filas = await this.prisma.db.turno.findMany({
      where: {
        fecha: { gte: inicioDelMes(anio, mes), lt: inicioDelMesSiguiente(anio, mes) },
        ...(salaId === undefined ? {} : { salaId }),
      },
      select: { id: true, cupo: true },
    });

    return filas.map((fila) => ({ turnoId: fila.id, cupo: fila.cupo }));
  }

  /**
   * Las reservas de esos turnos, VIVAS Y CANCELADAS.
   *
   * Las canceladas tienen que venir: son el numerador de las dos metricas de
   * cancelacion y parte de su denominador. Quien filtre lo que no necesita es
   * cada metrica, aqui no entra esa decision.
   *
   * Es una consulta plana con `in` y no un `include` desde el turno a
   * proposito, por el mismo motivo que `profesores()`: una relacion anidada se
   * vuelve invisible para un doble de Prisma que compara campo a campo, o sea
   * se vuelve un `where` que ningun test puede comprobar que este.
   */
  async reservasDeTurnos(turnoIds: string[]): Promise<ReservaParaMetricas[]> {
    if (turnoIds.length === 0) return [];

    const filas = await this.prisma.db.reserva.findMany({
      where: { turnoId: { in: turnoIds } },
      select: {
        turnoId: true,
        perfilId: true,
        canceladaEn: true,
        cancelacionTipo: true,
        asistio: true,
      },
    });

    return filas.map((fila) => ({
      turnoId: fila.turnoId,
      perfilId: fila.perfilId,
      canceladaEn: fila.canceladaEn,
      cancelacionTipo: fila.cancelacionTipo,
      asistio: fila.asistio,
    }));
  }

  /**
   * Los turnos de un rango de dias, opcionalmente acotados a una sala.
   *
   * EL `salaId` AQUI SI ES LIMPIO, igual que en `turnosDelMes` y al reves que
   * en la caja: un `Turno` tiene sala propia.
   *
   * EL RANGO ES SEMIABIERTO `[desde, hasta)` como todos los de este archivo, y
   * quien llama es el responsable de pasar como `hasta` el dia SIGUIENTE al
   * ultimo que quiere incluir. Es la misma forma que `[mes, mes siguiente)` y
   * por el mismo motivo: `fecha` es `@db.Date` hoy, y el dia que alguien le
   * ponga hora a esa columna ningun metodo de aqui empieza a comerse en
   * silencio el ultimo dia del rango.
   *
   * EL ORDEN NO SE PIDE A POSTGRES y lo fija quien llama. El resultado de estos
   * reportes se serializa a JSON y se guarda en el cache, asi que dos llamadas
   * identicas tienen que dar el mismo cuerpo byte a byte; un `orderBy` aqui
   * seria ademas invisible para el doble de Prisma, que compara campo a campo y
   * no ordena.
   */
  async turnosEnRango(desde: Date, hasta: Date, salaId?: string): Promise<TurnoParaListado[]> {
    const filas = await this.prisma.db.turno.findMany({
      where: {
        fecha: { gte: desde, lt: hasta },
        ...(salaId === undefined ? {} : { salaId }),
      },
      select: { id: true, salaId: true, fecha: true, horaInicio: true, horaFin: true, cupo: true },
    });

    return filas.map((fila) => ({
      turnoId: fila.id,
      salaId: fila.salaId,
      fecha: fila.fecha,
      horaInicio: fila.horaInicio,
      horaFin: fila.horaFin,
      cupo: fila.cupo,
    }));
  }

  /** Los nombres de las salas, para poder mostrar un turno sin pedir su sala una por una. */
  async salasPorId(): Promise<Map<string, string>> {
    const filas = await this.prisma.db.sala.findMany({ select: { id: true, nombre: true } });

    return new Map(filas.map((fila) => [fila.id, fila.nombre]));
  }

  /**
   * El nombre y el email de unos perfiles concretos.
   *
   * SON DOS CONSULTAS PLANAS Y NO UN `include`, por el mismo motivo que
   * `profesores()`: `nombreCompleto` y `email` viven en `Usuario`, `Perfil`
   * solo guarda el `usuarioId`, y una relacion anidada se vuelve invisible para
   * un doble de Prisma que compara campo a campo —o sea, se vuelve un `where`
   * que ningun test puede comprobar que este—.
   *
   * NO FILTRA POR `activo` NI POR ROL. Quien llama ya decidio de quien quiere
   * los datos; este metodo solo los resuelve.
   */
  async datosDePerfiles(perfilIds: string[]): Promise<Map<string, DatosDePerfil>> {
    if (perfilIds.length === 0) return new Map();

    const perfiles = await this.prisma.db.perfil.findMany({
      where: { id: { in: perfilIds } },
      select: { id: true, usuarioId: true },
    });
    if (perfiles.length === 0) return new Map();

    const usuarios = await this.prisma.db.usuario.findMany({
      where: { id: { in: perfiles.map((perfil) => perfil.usuarioId) } },
      select: { id: true, nombreCompleto: true, email: true },
    });
    const porUsuario = new Map(usuarios.map((usuario) => [usuario.id, usuario]));

    const datos = new Map<string, DatosDePerfil>();
    for (const perfil of perfiles) {
      const usuario = porUsuario.get(perfil.usuarioId);
      if (usuario === undefined) continue;
      datos.set(perfil.id, { nombreCompleto: usuario.nombreCompleto, email: usuario.email });
    }

    return datos;
  }

  /**
   * Los ALUMNOS en alta, con el pack que tienen hoy.
   *
   * EL FILTRO DE ROL NO ES DECORATIVO Y ES LO QUE SALVA LA COMPOSICION. Una
   * profesora tiene `Perfil` y no tiene pack, asi que sin el `rol: 'ALUMNO'`
   * caeria en el grupo "Sin pack" e inflaria con el personal del gimnasio el
   * reporte que dice cuantos ALUMNOS hay en cada plan.
   *
   * Y FILTRA POR `activo`, que es lo que "perfiles activos" significa en el
   * contrato: un alumno dado de baja no esta en ningun pack hoy. ES EL MISMO
   * FILTRO QUE `perfilesConPack()`, y eso ahora es deliberado: los cuatro
   * reportes que cuentan alumnos cuentan la misma gente. Hasta la revision de la
   * Task 8 estaban distintos y la misma persona era "no es alumno" aqui y
   * "alumno que debe" alla; el razonamiento entero esta en el docblock de
   * `perfilesConPack`. La unica diferencia que queda entre los dos metodos es la
   * que corresponde: aquel pide ademas tener pack, este agrupa tambien a los que
   * no tienen.
   */
  async alumnosActivos(): Promise<AlumnoActivo[]> {
    const usuarios = await this.prisma.db.usuario.findMany({
      where: { rol: 'ALUMNO', activo: true },
      select: { id: true, nombreCompleto: true },
    });
    if (usuarios.length === 0) return [];

    const porUsuario = new Map(usuarios.map((usuario) => [usuario.id, usuario.nombreCompleto]));
    const perfiles = await this.prisma.db.perfil.findMany({
      where: { usuarioId: { in: usuarios.map((usuario) => usuario.id) } },
      select: { id: true, usuarioId: true, packId: true },
    });

    const alumnos: AlumnoActivo[] = [];
    for (const perfil of perfiles) {
      const nombreCompleto = porUsuario.get(perfil.usuarioId);
      if (nombreCompleto === undefined) continue;
      alumnos.push({ perfilId: perfil.id, nombreCompleto, packId: perfil.packId });
    }

    return alumnos;
  }

  /**
   * El catalogo de packs, por id.
   *
   * El precio sale como texto de dos decimales, igual que en `perfilesConPack`:
   * el unico conversor a centavos es `aCentavos`, que trabaja sobre digitos, y
   * saliendo de esta capa como texto el camino del float no existe. El porque
   * entero esta en el docblock de `PagoParaCaja.monto`.
   */
  async packsPorId(): Promise<Map<string, PackParaReporte>> {
    const filas = await this.prisma.db.pack.findMany({
      select: { id: true, nombre: true, precio: true },
    });

    return new Map(
      filas.map((fila) => [
        fila.id,
        { nombre: fila.nombre, precio: fila.precio === null ? null : fila.precio.toFixed(2) },
      ]),
    );
  }

  /**
   * Cuantas reservas cancelo cada perfil en un rango, por `canceladaEn`.
   *
   * ES LA FECHA DE LA CANCELACION Y NO LA DEL TURNO, y la distincion importa:
   * el reporte de morosos pregunta "quien esta cancelando ultimamente", que es
   * una conducta con fecha propia. Alguien que en octubre se da de baja de todo
   * noviembre cancelo en octubre.
   *
   * Las reservas vivas tienen `canceladaEn: null` y quedan fuera solas: un
   * `null` no entra en ningun rango.
   */
  async cancelacionesPorPerfil(desde: Date, hasta: Date): Promise<Map<string, number>> {
    const filas = await this.prisma.db.reserva.findMany({
      where: { canceladaEn: { gte: desde, lt: hasta } },
      select: { perfilId: true },
    });

    const porPerfil = new Map<string, number>();
    for (const fila of filas) {
      porPerfil.set(fila.perfilId, (porPerfil.get(fila.perfilId) ?? 0) + 1);
    }

    return porPerfil;
  }

  /**
   * Cuales de esos perfiles estan al dia.
   *
   * Delega en `PagosService`, que es la UNICA implementacion de `estaAlDia`
   * desde la 5A. Reescribir la regla aqui crearia una segunda verdad sobre
   * quien debe plata, y la que discrepe va a ser la que nadie mire.
   */
  async perfilesAlDia(perfilIds: string[], ahora: Date = new Date()): Promise<Set<string>> {
    return this.pagos.perfilesAlDia(this.prisma.db, perfilIds, ahora);
  }
}

function inicioDelMes(anio: number, mes: number): Date {
  return primerDiaDelMesUtc(anio, mes);
}

/** Diciembre pasa a enero del ano siguiente; lo resuelve `primerDiaDelMesUtc`. */
function inicioDelMesSiguiente(anio: number, mes: number): Date {
  return mes === 12 ? primerDiaDelMesUtc(anio + 1, 1) : primerDiaDelMesUtc(anio, mes + 1);
}
