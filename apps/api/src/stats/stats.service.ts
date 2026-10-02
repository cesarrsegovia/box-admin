import { BadRequestException, Injectable } from '@nestjs/common';
import {
  aFechaISO,
  comienzoDeHoyUtc,
  desdeFechaISO,
  primerDiaDelMesUtc,
  ultimoDiaDelMesUtc,
  type AsistenciaDeAlumno,
  type CajaDelMes,
  type CobradoPorMetodo,
  type ComposicionAlumnos,
  type ComposicionPorPack,
  type ConsumoDeAlumno,
  type Importe,
  type JwtPayload,
  type MetodoPago,
  type MetricasOperativas,
  type Operativo,
  type PagoPendiente,
  type Porcentaje,
  type ReporteAsistencia,
  type ReporteTurnosLibres,
  type TipoCancelacion,
  type TurnoLibre,
} from '@boxadmin/shared';
import { aCentavos, aTexto } from '../liquidacion/calcular-importes';
import { LiquidacionService } from '../liquidacion/liquidacion.service';
import { CacheDeStats } from './cache-de-stats';
import type { ConsultaMensualDto } from './dto/consulta-mensual.dto';
import type { ConsultaOperativaDto } from './dto/consulta-operativa.dto';
import type { ConsultaPagosPendientesDto } from './dto/consulta-pagos-pendientes.dto';
import type { ConsultaRangoDto } from './dto/consulta-rango.dto';
import type { ConsultaTurnosLibresDto } from './dto/consulta-turnos-libres.dto';
import {
  StatsDatos,
  type DatosDePerfil,
  type PagoParaCaja,
  type PerfilConPack,
  type ReservaParaMetricas,
  type TurnoParaListado,
  type TurnoParaMetricas,
} from './stats.datos';

/**
 * El metodo de pago que NO es facturacion.
 *
 * Una cortesia es un metodo de pago como cualquier otro y nada obliga a que su
 * monto sea cero —el admin puede registrar "le regale la cuota de 25000"—, asi
 * que sumarla al cobrado haria que un mes en el que el gimnasio regalo clases
 * apareciera como un mes de buena facturacion. Va a `bonificado`, aparte y
 * siempre visible: lo que entro y lo que se regalo son dos hechos distintos.
 */
const METODO_BONIFICADO: MetodoPago = 'CORTESIA';

/**
 * Cuantos meses mira adelante `/stats/turnos-libres` si no se lo dicen.
 *
 * Tres es el horizonte con el que el motor de recurrencia publica meses desde
 * la Fase 2: pedir mas de lo que esta publicado devuelve un reporte que se
 * queda corto sin decir por que.
 */
const MESES_ADELANTE_POR_DEFECTO = 3;

/**
 * El techo, EN EL SERVICE Y NO EN EL DTO.
 *
 * Un `@Max(12)` devolveria 400 a quien pida 24, y la respuesta correcta a "dame
 * dos anos" no es un error: es "te doy uno". Sin tope, en cambio, un parametro
 * grande recorre la tabla entera de turnos y el reporte se convierte en una
 * forma comoda de tirar la base.
 */
const MAX_MESES_ADELANTE = 12;

/**
 * El techo del rango de `/stats/asistencia`, en dias. Mismo criterio y mismo
 * motivo que `MAX_MESES_ADELANTE`: un rango de diez anos recorre todas las
 * reservas del gimnasio, y recortarlo y contestar es mejor respuesta que un
 * 400. El `hasta` que vuelve en el reporte es el recortado, nunca el pedido:
 * devolver el pedido seria decir que se miro un ano que no se miro.
 */
const MAX_DIAS_DE_RANGO = 366;

/** Un dia en milisegundos. */
const MS_POR_DIA = 86_400_000;

/**
 * El grupo de los que no tienen plan contratado.
 *
 * SE AGRUPAN APARTE, NUNCA SE DESCARTAN. Descartarlos haria que los porcentajes
 * de la composicion mintieran sobre el total: con tres alumnos de un pack y uno
 * sin pack, tirar al cuarto da 100% en vez de 75% y el panel afirma que todo el
 * mundo esta en un plan.
 */
const SIN_PACK = 'Sin pack';

/** Un pendiente de un alumno concreto. La Task 7 lo desglosa; la caja lo suma. */
export interface PendienteDeAlumno {
  perfilId: string;
  centavos: number;
}

/**
 * Quien debe, y cuanto se estima que debe.
 *
 * PURA y exportada a proposito: `/stats/pagos-pendientes` devuelve esta misma
 * lista desglosada y la caja devuelve su suma. Calculandolo dos veces, los dos
 * numeros podrian diferir y nadie sabria cual creer.
 *
 * ES UN ESTIMADO Y POR ESO SE LLAMA ASI: el sistema no lleva cuenta corriente.
 * Es lo que costaria ponerse al dia con un pack, no una deuda calculada contra
 * un saldo. Un pack sin precio ("a consultar") aporta cero y no un NaN: no
 * saber cuanto debe alguien no es lo mismo que romper el reporte entero.
 */
export function pendientesDe(
  perfiles: PerfilConPack[],
  alDia: ReadonlySet<string>,
): PendienteDeAlumno[] {
  return perfiles
    .filter((perfil) => !alDia.has(perfil.perfilId))
    .map((perfil) => ({
      perfilId: perfil.perfilId,
      centavos: perfil.precioPack === null ? 0 : aCentavos(perfil.precioPack),
    }));
}

/**
 * Una fraccion con su porcentaje, y el `null` que lo hace honesto.
 *
 * EL NUMERADOR Y EL DENOMINADOR VIAJAN SIEMPRE. Sin ellos, un 0% y un "no se
 * sabe" se ven igual en el panel, y son cosas distintas: `denominador: 0`
 * significa que la pregunta no se puede contestar.
 *
 * POR ESO `porcentaje` ES `null` Y NO CERO cuando no hay denominador. Un cero
 * es una respuesta —"ninguno"— y aqui no hay ninguna respuesta. Es la
 * diferencia entre "este mes no vino nadie" y "este mes nadie paso lista", y
 * con un cero el admin lee la primera cuando pasa la segunda.
 *
 * Dos decimales: el resultado se serializa a JSON y se guarda en el cache, asi
 * que dos llamadas identicas tienen que dar el mismo cuerpo byte a byte y un
 * flotante largo no lo garantiza.
 */
export function porcentajeDe(numerador: number, denominador: number): Porcentaje {
  return {
    numerador,
    denominador,
    porcentaje: denominador === 0 ? null : Math.round((numerador * 10_000) / denominador) / 100,
  };
}

/**
 * Los `cuantos` meses ANTERIORES a uno dado, del mas viejo al mas nuevo.
 *
 * Cuenta en meses absolutos en vez de restarle al mes y corregir el ano a mano:
 * asi enero no es un caso aparte y no hay un `if (mes < 1)` que alguien pueda
 * escribir al reves. Pedir enero de 2026 devuelve octubre, noviembre y
 * diciembre de 2025.
 */
export function mesesAnteriores(
  anio: number,
  mes: number,
  cuantos: number,
): { anio: number; mes: number }[] {
  const absoluto = anio * 12 + (mes - 1);
  const meses: { anio: number; mes: number }[] = [];

  for (let atras = cuantos; atras >= 1; atras -= 1) {
    const indice = absoluto - atras;
    meses.push({ anio: Math.floor(indice / 12), mes: (indice % 12) + 1 });
  }

  return meses;
}

/**
 * Los reportes de solo lectura. Orquesta: cache -> datos -> calculo.
 *
 * EL TENANT SALE SIEMPRE DE `actor.tenantId`, nunca de un query param y nunca
 * deducido del `salaId`. `CacheDeStats` no puede comprobar que el numero que
 * guarda sea del gimnasio que dice ser: si este service se equivoca de tenant,
 * el cache guarda y sirve feliz el numero de otro. Es la unica forma conocida
 * de que un reporte cruce de gimnasio, porque la lectura de Postgres ya la
 * cierra la extension de aislamiento.
 *
 * LA CLAVE DEL CACHE SE ARMA SOLO CON VALORES YA VALIDADOS. Los separadores
 * `:` de la clave no se escapan, asi que un valor con dos puntos podria
 * fabricar la clave de otro reporte. En la caja no llega ninguno —`anio` y
 * `mes` son enteros del DTO y no hay un solo parametro de texto—, pero los
 * reportes que vienen si traen ids por la query, asi que la regla queda escrita
 * aqui: a la clave solo van valores que ya pasaron por una validacion o que
 * volvieron de la base, nunca lo que llego crudo.
 */
@Injectable()
export class StatsService {
  constructor(
    private readonly datos: StatsDatos,
    private readonly cache: CacheDeStats,
    private readonly liquidacion: LiquidacionService,
  ) {}

  /**
   * La caja de un mes: cuatro numeros que no se mezclan.
   *
   * OJO CON LAS BASES: `cobrado` es CAJA —se cuenta por `Pago.createdAt`— y
   * `costoProfesoras` es DEVENGADO —las clases de ese mes—. Un alumno que paga
   * octubre el 28 de septiembre entra en la caja de septiembre. Es la base
   * correcta para "cuanto entro este mes", pero el margen de un mes concreto
   * puede verse raro si alguien cobra muy adelantado. Esta escrito tambien en
   * el contrato y en el README, en vez de inventar una base mixta que nadie
   * podria auditar.
   *
   * UN MES FUTURO NO ES UN ERROR: preguntar por un mes que todavia no paso es
   * legitimo. Lo cobrado, lo bonificado, el costo y el margen salen en cero
   * —no hubo movimiento—, pero `pendienteEstimado` NO: evaluado al cierre de
   * ese mes da "todos pendientes", que es exactamente lo que pasa cuando nadie
   * pago diciembre todavia. Decir "devuelve ceros" a secas era la version
   * anterior de este parrafo y era falsa en el quinto numero.
   *
   * ---
   *
   * POR QUE ESTE ENDPOINT NO ACEPTA UN `salaId`, y no es un olvido.
   *
   * La spec y el plan de la Fase 6A lo pedian (`/stats/caja?mes=&anio=&salaId=`)
   * y se quito a proposito al implementarlo, con Cesar. **Un `Pago` no tiene
   * sala.** Un alumno paga un pack mensual y entrena en las salas que le
   * toquen, asi que repartir su pago entre salas exige inventar exactamente la
   * regla de atribucion de ingresos que la seccion 3 de la spec borro, por
   * contar el mismo peso mas de una vez. Y acotar solo el costo de profesoras
   * —que si sabe de salas, porque cada franja tiene la suya— daria un `margen`
   * que resta el costo de UNA sala a lo cobrado de TODAS: un numero equivocado
   * presentado como correcto.
   *
   * Aceptarlo e ignorarlo tampoco vale, que fue la primera version de esto: un
   * parametro que se acepta y no hace nada es una mentira con codigo 200.
   * Alguien lo manda, recibe un numero y cree que es de esa sala, y eso es peor
   * que no tenerlo porque parece que anduvo. Como no esta en el DTO y el
   * ValidationPipe global corre con `forbidNonWhitelisted`, mandarlo devuelve
   * 400 y la respuesta es honesta: aqui no se puede preguntar eso.
   *
   * `/stats/operativo` SI lleva `salaId` y ahi es limpio, porque un `Turno`
   * tiene sala propia. Esa es la distincion: los reportes que cuentan clases se
   * pueden partir por sala, los que cuentan dinero no.
   */
  async caja(actor: JwtPayload, consulta: ConsultaMensualDto): Promise<CajaDelMes> {
    const { anio, mes } = consulta;

    return this.cache.recordar(actor.tenantId, `caja:${anio}-${mes}`, () =>
      this.calcularCaja(actor, anio, mes),
    );
  }

  private async calcularCaja(actor: JwtPayload, anio: number, mes: number): Promise<CajaDelMes> {
    const pagos = await this.datos.pagosDelMes(anio, mes);
    const cobradoPorMetodo = agruparPorMetodo(pagos.filter((p) => p.metodo !== METODO_BONIFICADO));
    const cobrado = cobradoPorMetodo.reduce((total, fila) => total + fila.importe.centavos, 0);
    const bonificado = sumar(pagos.filter((p) => p.metodo === METODO_BONIFICADO));

    const costoProfesoras = await this.costoDeProfesoras(actor, anio, mes);
    const pendienteEstimado = await this.pendienteEstimado(anio, mes);

    return {
      anio,
      mes,
      cobrado: importe(cobrado),
      porMetodo: cobradoPorMetodo,
      bonificado: importe(bonificado),
      costoProfesoras: importe(costoProfesoras),
      // Resta, nunca suma. El costo de las profesoras es lo que SALE, y el
      // margen puede quedar en rojo: un mes flojo con las clases dadas es
      // exactamente eso, y el numero tiene que poder decirlo.
      margen: importe(cobrado - costoProfesoras),
      pendienteEstimado: importe(pendienteEstimado),
    };
  }

  /**
   * El costo de las profesoras del mes, en centavos.
   *
   * Sale de `LiquidacionService`, que es literalmente el mismo calculo que el
   * reporte individual: asi la caja CUADRA POR CONSTRUCCION con lo que el admin
   * ve al abrir la liquidacion de cada profesora. Reimplementar aqui la suma de
   * horas por tarifa daria dos numeros que algun dia difieren, y el dia que
   * difieran la discusion seria con una persona sobre su sueldo.
   *
   * Es una liquidacion por profesora y no una query agregada, a sabiendas: a la
   * escala de un gimnasio son unas pocas, el resultado se cachea cinco minutos,
   * y la alternativa es exactamente la segunda implementacion que el parrafo de
   * arriba descarta.
   */
  private async costoDeProfesoras(actor: JwtPayload, anio: number, mes: number): Promise<number> {
    const profesores = await this.datos.profesores();

    let centavos = 0;
    for (const profesorId of profesores) {
      const liquidacion = await this.liquidacion.delMes(actor, profesorId, anio, mes);
      // `aPagar` y no `dictadas`: si manana la regla de lo que se paga cambia,
      // la caja cambia con ella sin tocar este archivo.
      centavos += liquidacion.importes.aPagar.centavos;
    }

    return centavos;
  }

  /**
   * Lo que se estima pendiente AL CERRAR EL MES PEDIDO, no hoy.
   *
   * El `ultimoDiaDelMesUtc` no es un detalle: sin el, `perfilesAlDia` cae en su
   * default `new Date()` y este numero pasa a ser "quien debe hoy" metido
   * dentro de un reporte indexado por `anio/mes` y cacheado bajo
   * `caja:2026-10`. La caja de marzo de 2020 y la de enero de 2099 devolvian el
   * mismo pendiente, que es un numero que miente sobre su propia fecha. Lo
   * encontro una revision.
   *
   * CON LA FECHA DE CIERRE LA REGLA NO TIENE "HOY" POR NINGUN LADO. Para un mes
   * pasado es un hecho historico —quien no estaba cubierto cuando ese mes
   * cerro— que no cambia al volver a pedirlo manana. Para un mes futuro da
   * "todos pendientes", y es literalmente cierto: nadie pago diciembre todavia.
   */
  private async pendienteEstimado(anio: number, mes: number): Promise<number> {
    const perfiles = await this.datos.perfilesConPack();
    const alDia = await this.datos.perfilesAlDia(
      perfiles.map((perfil) => perfil.perfilId),
      ultimoDiaDelMesUtc(anio, mes),
    );

    return pendientesDe(perfiles, alDia).reduce((total, fila) => total + fila.centavos, 0);
  }

  /**
   * El reporte operativo: el mes pedido y la evolucion del trimestre.
   *
   * ESTE SI LLEVA `salaId`, al reves que la caja, y la asimetria es a
   * proposito: un `Turno` tiene sala propia, asi que acotar las metricas que
   * cuentan clases no exige inventar ninguna regla de atribucion. Un `Pago` no
   * la tiene, y por eso la caja devuelve 400 si se lo mandan. El razonamiento
   * entero esta en el docblock de `caja`.
   *
   * LA COBRANZA ES LA EXCEPCION DENTRO DE ESTE REPORTE Y QUEDA ESCRITO AQUI:
   * no se acota por sala aunque las otras cuatro si. Estar al dia es una
   * propiedad del alumno y de sus pagos, no de una clase, y un alumno tiene
   * acceso a varias salas a la vez; repartirlo seria exactamente la atribucion
   * de ingresos que la caja descarta. Hay un caso que fija que mandar `salaId`
   * NO mueve la cobranza, para que sea una decision cubierta y no un olvido que
   * un dia alguien "arregle".
   *
   * UN MES FUTURO NO ES UN ERROR. Sin turnos, las cuatro metricas de clases
   * salen con denominador cero y `porcentaje: null` —no se sabe, porque no paso
   * nada todavia—, y la cobranza evaluada al cierre de ese mes dice que nadie
   * esta al dia, que es literalmente cierto.
   */
  async operativo(actor: JwtPayload, consulta: ConsultaOperativaDto): Promise<Operativo> {
    const { anio, mes, salaId } = consulta;

    // `salaId` entra a la clave ya validado por el DTO —ver su docblock y el de
    // esta clase—. El `todas` no es decorativo: sin el, `undefined` se
    // interpolaria como el texto "undefined" y la clave diria algo que no
    // significa nada. (Una sala de id vacio NO es el motivo, aunque este
    // comentario lo dijera: por HTTP `?salaId=` llega como `''` y el `@Matches`
    // del DTO lo rechaza con 400 antes de llegar aqui. Lo comprobo una revision.)
    return this.cache.recordar(
      actor.tenantId,
      `operativo:${anio}-${mes}:${salaId ?? 'todas'}`,
      () => this.calcularOperativo(anio, mes, salaId),
    );
  }

  /**
   * El mismo calculo cuatro veces: el mes pedido y los tres anteriores.
   *
   * La evolucion trimestral NO es un reporte distinto y por eso no tiene una
   * funcion propia. Dos implementaciones de "las metricas de un mes" son la
   * forma conocida de que la columna de septiembre y el numero grande de
   * septiembre acaben discrepando, sin que nadie sepa cual de las dos creer.
   */
  private async calcularOperativo(anio: number, mes: number, salaId?: string): Promise<Operativo> {
    const actual = await this.metricasDelMes(anio, mes, salaId);

    const trimestre: MetricasOperativas[] = [];
    // Del mas viejo al mas nuevo: es como se dibuja una serie de tiempo. El
    // orden lo fija `mesesAnteriores`, no este bucle.
    for (const anterior of mesesAnteriores(anio, mes, 3)) {
      trimestre.push(await this.metricasDelMes(anterior.anio, anterior.mes, salaId));
    }

    return { actual, trimestre };
  }

  /**
   * Las cinco metricas de UN mes. Lo dificil aqui no son las consultas.
   *
   * OCUPACION: reservas vivas sobre la suma de los cupos DE LOS TURNOS. El cupo
   * de la sala (`Sala.cupoBase`) es solo el valor por defecto con el que se crea
   * un turno; desde la Fase 1 cada turno puede tener el suyo, y un porcentaje
   * calculado sobre el de la sala no corresponde a ninguna clase que haya
   * ocurrido.
   *
   * ASISTENCIA: presentes sobre las reservas vivas QUE FUERON MARCADAS, o sea
   * las que tienen `asistio !== null`. El denominador NO son todas las reservas
   * vivas, y esta es la definicion peligrosa del reporte entero: si la profesora
   * no paso lista, eso no es "no vino nadie", es "no se sabe". Con el
   * denominador ingenuo un mes sin listas pasadas muestra 0% y el admin concluye
   * que se le esta yendo la gente.
   *
   * EL DENOMINADOR SE MIRA RESERVA POR RESERVA, NO TURNO POR TURNO, y la
   * correccion vale la pena contarla porque este codigo decia otra cosa y
   * mentia en silencio. Antes preguntaba si el TURNO tenia lista pasada —con
   * `listaPasada`, prestado de `MisClasesService`— y, si la tenia, metia en el
   * denominador TODAS sus reservas vivas. Una reserva que entra DESPUES de que
   * la profesora pasara lista —por `reasignar`, por la lista de espera, por un
   * alta a mano— se queda con `asistio: null` para siempre, y el turno sigue
   * teniendo lista pasada: esa persona entraba al denominador como si hubiera
   * faltado. Medido sobre un turno de tres reservas, el operativo daba 33,33% y
   * `/stats/asistencia` daba 50% sobre exactamente los mismos datos, mientras
   * los dos docblocks afirmaban usar "la MISMA definicion".
   *
   * LO QUE LO DELATABA: ese alumno sale con `porcentaje: null` en su propio
   * reporte. El codigo ya sabia que su caso era "no se sabe" y en el agregado lo
   * contaba como ausencia igual — la mutacion que esta fase declara como la mas
   * peligrosa, en version chica y viviendo dentro del codigo correcto.
   *
   * `listaPasada` SIGUE SIENDO CORRECTO DONDE NACIO y por eso no se toco alli:
   * en `MisClasesService` decide si mostrarle a la profesora la lista de un
   * turno, que es una pregunta sobre el TURNO. Aqui la pregunta es sobre cada
   * reserva, asi que era la lente equivocada; traerlo prestado no fue reutilizar
   * una regla, fue reutilizar una que contestaba otra cosa.
   *
   * CANCELACION: separada en RECUPERABLE y DEFINITIVA, nunca sumadas.
   * Mezclarlas esconde lo unico accionable que tienen: la recuperable es
   * alguien que reprograma, la definitiva es alguien que se esta yendo. El
   * denominador son TODAS las reservas del mes, vivas y canceladas: es "de todo
   * lo que se anoto, cuanto se cayo".
   *
   * Las canceladas NO entran en la ocupacion ni en la asistencia: un lugar que
   * se libero no esta ocupado, y quien cancelo no falto.
   */
  private async metricasDelMes(
    anio: number,
    mes: number,
    salaId?: string,
  ): Promise<MetricasOperativas> {
    const turnos = await this.datos.turnosDelMes(anio, mes, salaId);
    const reservas = await this.datos.reservasDeTurnos(turnos.map((turno) => turno.turnoId));
    const porTurno = agruparPorTurno(reservas);

    let cupos = 0;
    let vivas = 0;
    let marcadas = 0;
    let presentes = 0;

    for (const turno of turnos) {
      const suyas = (porTurno.get(turno.turnoId) ?? []).filter(
        (reserva) => reserva.canceladaEn === null,
      );

      cupos += turno.cupo;
      vivas += suyas.length;
      marcadas += suyas.filter((reserva) => reserva.asistio !== null).length;
      presentes += suyas.filter((reserva) => reserva.asistio === true).length;
    }

    return {
      anio,
      mes,
      ocupacion: porcentajeDe(vivas, cupos),
      asistencia: porcentajeDe(presentes, marcadas),
      cobranza: await this.cobranzaDelMes(anio, mes),
      cancelacionRecuperable: porcentajeDe(
        contarCanceladas(reservas, 'RECUPERABLE'),
        reservas.length,
      ),
      cancelacionDefinitiva: porcentajeDe(
        contarCanceladas(reservas, 'DEFINITIVA'),
        reservas.length,
      ),
    };
  }

  /**
   * Cuantos de los que tienen pack estan al dia AL CERRAR ESE MES, no hoy.
   *
   * Es la misma trampa que `pendienteEstimado` de la caja, y aqui muerde mas
   * fuerte: sin la fecha de cierre, `perfilesAlDia` cae en su default
   * `new Date()` y los CUATRO meses del trimestre devuelven el mismo numero. Un
   * grafico de evolucion con la cobranza clavada en los cuatro puntos no se lee
   * como un bug: se lee como "la cobranza no se mueve".
   *
   * Y usa `estaAlDia` de la 5A via `StatsDatos`, nunca una columna ni una
   * consulta propia: una sola verdad sobre quien debe plata.
   */
  private async cobranzaDelMes(anio: number, mes: number): Promise<Porcentaje> {
    const perfiles = await this.datos.perfilesConPack();
    const alDia = await this.datos.perfilesAlDia(
      perfiles.map((perfil) => perfil.perfilId),
      ultimoDiaDelMesUtc(anio, mes),
    );

    return porcentajeDe(alDia.size, perfiles.length);
  }

  /**
   * Donde queda lugar, de hoy en adelante.
   *
   * LA FECHA DE EVALUACION ES HOY, Y AQUI ESO ES LA PREGUNTA Y NO UN DESCUIDO.
   * Es la diferencia con el `pendienteEstimado` de la caja y con la cobranza del
   * operativo, donde un `new Date()` escondido dentro de un reporte indexado por
   * `anio/mes` lo hacia mentir sobre su propia fecha: este reporte NO esta
   * indexado por ningun periodo —no se puede pedir "los turnos libres de marzo
   * de 2024"— asi que "hoy" no se esconde debajo de otra fecha prometida. Y por
   * si acaso, el dia entra en la clave del cache: el reporte de hoy y el de
   * manana no pueden compartir entrada.
   *
   * EL CORTE ES POR DIA Y NO POR HORA, a proposito. Un turno de hoy que ya
   * empezo sigue apareciendo. Filtrar por la hora exigiria combinar `fecha` con
   * `horaInicio`, que el schema declara "hora local del salon" y que el sistema
   * entero interpreta como UTC desde la Fase 1 porque no almacena el huso de
   * ningun gimnasio (ver `instanteDelTurno`): meter esa aproximacion en un
   * reporte lo haria perder turnos de verdad en los bordes del dia. Con el corte
   * por dia el error es visible y en la direccion inofensiva —sobra un turno de
   * esta manana, nunca falta uno de esta tarde—.
   *
   * EL TOPE DE MESES SE APLICA AQUI Y NO EN EL DTO. El porque esta en
   * `MAX_MESES_ADELANTE` y en el docblock de `ConsultaTurnosLibresDto`.
   *
   * Y EL RECORTE VUELVE EN LA RESPUESTA, en `mesesAdelante`. Sin el campo, el
   * reporte hacia lo que el docblock promete —da uno— y no lo decia: quien pidio
   * dos anos leia una lista corta como "no hay mas turnos" en vez de como "no
   * miramos mas alla". Es el mismo criterio que el `hasta` recortado de
   * `/stats/asistencia`, que ya volvia.
   */
  async turnosLibres(
    actor: JwtPayload,
    consulta: ConsultaTurnosLibresDto,
  ): Promise<ReporteTurnosLibres> {
    const desde = comienzoDeHoyUtc();
    const meses = Math.min(
      consulta.mesesAdelante ?? MESES_ADELANTE_POR_DEFECTO,
      MAX_MESES_ADELANTE,
    );

    // `salaId` y `meses` entran a la clave ya validados —el patron de id y el
    // `@IsInt` del DTO—, que es la regla escrita en el docblock de esta clase.
    // El `todas` cubre el `undefined`, que si no se interpolaria como el texto
    // "undefined"; ver el comentario equivalente en `operativo`.
    return this.cache.recordar(
      actor.tenantId,
      `turnos-libres:${aFechaISO(desde)}:${meses}:${consulta.salaId ?? 'todas'}`,
      () => this.calcularTurnosLibres(desde, meses, consulta.salaId),
    );
  }

  private async calcularTurnosLibres(
    desde: Date,
    meses: number,
    salaId?: string,
  ): Promise<ReporteTurnosLibres> {
    const turnos = await this.datos.turnosEnRango(desde, sumarMeses(desde, meses), salaId);
    const reservas = await this.datos.reservasDeTurnos(turnos.map((turno) => turno.turnoId));
    const vivasPorTurno = contarVivasPorTurno(reservas);
    const salas = await this.datos.salasPorId();

    const libres: TurnoLibre[] = [];
    for (const turno of turnos) {
      const reservados = vivasPorTurno.get(turno.turnoId) ?? 0;
      // Solo los que TIENEN lugar. Un turno lleno no es un turno libre, y
      // devolverlo con `libres: 0` obligaria a filtrar en el panel. Un cupo
      // cambiado a la baja puede dejar mas reservas que lugares, y ahi el resto
      // es negativo: tampoco entra, y por eso la comparacion es `<= 0` y no
      // `=== 0`.
      if (turno.cupo - reservados <= 0) continue;

      libres.push({
        turnoId: turno.turnoId,
        salaId: turno.salaId,
        // Una sala que no esta en el catalogo es imposible: `Turno.salaId` es
        // una FK compuesta obligatoria. El `?? ''` existe porque TypeScript no
        // sabe leer una clave foranea, no porque el caso pueda ocurrir.
        salaNombre: salas.get(turno.salaId) ?? '',
        fecha: aFechaISO(turno.fecha),
        horaInicio: turno.horaInicio,
        horaFin: turno.horaFin,
        cupo: turno.cupo,
        reservados,
        libres: turno.cupo - reservados,
      });
    }

    return { mesesAdelante: meses, turnos: libres.sort(porAgenda) };
  }

  /**
   * Quien debe, con nombre y apellido. Es trabajo de recepcion, no de caja.
   *
   * LA FECHA DE EVALUACION ES HOY, Y ESTA ESCRITO AQUI A PROPOSITO. Este
   * reporte contesta "a quien le reclamo AHORA", que es una pregunta del
   * presente y no de un periodo: no se puede pedir "los morosos de marzo", asi
   * que "hoy" no queda escondido debajo de otra fecha prometida —que es
   * exactamente lo que lo hacia un error en el `pendienteEstimado` de la caja y
   * en la cobranza del operativo—. El dia entra en la clave del cache para que
   * el reporte de hoy y el de manana no compartan entrada.
   *
   * POR ESO NO TIENE QUE COINCIDIR AL CENTAVO CON EL `pendienteEstimado` DE LA
   * CAJA, y conviene saberlo antes de que alguien lo reporte como un bug: es la
   * MISMA lista, calculada por la MISMA funcion pura `pendientesDe` sobre los
   * MISMOS perfiles; lo unico que cambia es la fecha a la que se pregunta si
   * cada uno esta al dia, que alli es el cierre del mes pedido y aqui es hoy.
   * Dos fechas distintas pueden dar dos conjuntos distintos, y las dos
   * respuestas son correctas para su pregunta.
   *
   * NO ACEPTA `salaId`. El razonamiento entero esta en
   * `ConsultaPagosPendientesDto`, que esta vacio justamente para poder
   * rechazarlo con un 400 en vez de aceptarlo y no hacer nada.
   */
  async pagosPendientes(
    actor: JwtPayload,
    _consulta: ConsultaPagosPendientesDto,
  ): Promise<PagoPendiente[]> {
    const hoy = comienzoDeHoyUtc();

    return this.cache.recordar(actor.tenantId, `pagos-pendientes:${aFechaISO(hoy)}`, () =>
      this.calcularPagosPendientes(hoy),
    );
  }

  private async calcularPagosPendientes(hoy: Date): Promise<PagoPendiente[]> {
    const perfiles = await this.datos.perfilesConPack();
    const alDia = await this.datos.perfilesAlDia(
      perfiles.map((perfil) => perfil.perfilId),
      hoy,
    );

    // La MISMA funcion pura que la caja, no una copia del filtro. Dos
    // implementaciones de "quien debe" son dos numeros que algun dia difieren, y
    // el dia que difieran nadie sabria cual creer.
    const pendientes = pendientesDe(perfiles, alDia);
    if (pendientes.length === 0) return [];

    const packPorPerfil = new Map(perfiles.map((perfil) => [perfil.perfilId, perfil.packId]));
    const packs = await this.datos.packsPorId();
    const datos = await this.datos.datosDePerfiles(pendientes.map((fila) => fila.perfilId));

    // El mes EN CURSO, derivado del mismo `hoy` que decide quien esta al dia:
    // dos relojes distintos dentro del mismo reporte serian dos fechas que algun
    // dia caen en meses distintos.
    const inicioDelMes = primerDiaDelMesUtc(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1);
    const cancelaciones = await this.datos.cancelacionesPorPerfil(
      inicioDelMes,
      sumarMeses(inicioDelMes, 1),
    );

    return pendientes
      .map((fila) => {
        const quien = datos.get(fila.perfilId) ?? PERFIL_SIN_USUARIO;
        const pack = packs.get(packPorPerfil.get(fila.perfilId) ?? '');

        return {
          perfilId: fila.perfilId,
          nombreCompleto: quien.nombreCompleto,
          email: quien.email,
          // Un pack borrado deja al alumno con un nombre que no existe. `null`
          // y no `''`: "no se sabe cual" y "se llama vacio" son cosas distintas.
          packNombre: pack?.nombre ?? null,
          pendienteEstimado: importe(fila.centavos),
          cancelacionesDelMes: cancelaciones.get(fila.perfilId) ?? 0,
        };
      })
      .sort(porNombre);
  }

  /**
   * Cuantos alumnos hay en cada pack, y cuantas clases tomo cada uno.
   *
   * LOS QUE NO TIENEN PACK SE AGRUPAN APARTE Y NO SE DESCARTAN. El porque esta
   * en `SIN_PACK`: descartarlos hace que los porcentajes mientan sobre el total.
   *
   * EL CONSUMO SALE DE LAS RESERVAS, NUNCA DE UN CONTADOR GUARDADO. Es la regla
   * de la Fase 1 y la misma por la que `pagoAlDia` se borro del schema en la
   * 5A: un contador es una segunda copia de una verdad que ya esta en las
   * reservas, y la copia es la que se desincroniza. Cuentan las VIVAS: una
   * reserva cancelada no es una clase tomada.
   *
   * LIMITACION CONOCIDA Y DELIBERADA: el reparto por pack es la foto de HOY,
   * aunque el consumo sea del mes pedido. El sistema no guarda historial de
   * packs —`Perfil.packId` es el actual y punto—, asi que la composicion de un
   * mes pasado se dibuja con los planes de hoy. Inventar un historial a partir
   * de los pagos daria un reparto plausible y equivocado, que es justo lo que la
   * seccion 6 de la spec dice que hay que evitar.
   */
  async composicionAlumnos(
    actor: JwtPayload,
    consulta: ConsultaMensualDto,
  ): Promise<ComposicionAlumnos> {
    const { anio, mes } = consulta;

    return this.cache.recordar(actor.tenantId, `composicion:${anio}-${mes}`, () =>
      this.calcularComposicion(anio, mes),
    );
  }

  private async calcularComposicion(anio: number, mes: number): Promise<ComposicionAlumnos> {
    const alumnos = await this.datos.alumnosActivos();
    const packs = await this.datos.packsPorId();

    const turnos = await this.datos.turnosDelMes(anio, mes);
    const reservas = await this.datos.reservasDeTurnos(turnos.map((turno) => turno.turnoId));
    const vivasPorPerfil = contarVivasPorPerfil(reservas);

    const porPackId = new Map<string | null, number>();
    for (const alumno of alumnos) {
      porPackId.set(alumno.packId, (porPackId.get(alumno.packId) ?? 0) + 1);
    }

    const porPack: ComposicionPorPack[] = [...porPackId.entries()].map(([packId, cuantos]) => ({
      packId,
      packNombre: packId === null ? SIN_PACK : (packs.get(packId)?.nombre ?? SIN_PACK),
      alumnos: cuantos,
      // Sin alumnos no hay ninguna fila, asi que aqui el denominador nunca es
      // cero y el porcentaje es siempre un numero. Es el unico porcentaje de la
      // fase que no necesita el `null` de `porcentajeDe`, y por eso el contrato
      // lo declara `number` y no `number | null`.
      porcentaje: Math.round((cuantos * 10_000) / alumnos.length) / 100,
    }));

    const consumo: ConsumoDeAlumno[] = alumnos
      .map((alumno) => ({
        perfilId: alumno.perfilId,
        nombreCompleto: alumno.nombreCompleto,
        clasesTomadas: vivasPorPerfil.get(alumno.perfilId) ?? 0,
      }))
      .sort(porNombre);

    return { anio, mes, totalAlumnos: alumnos.length, porPack: porPack.sort(porGrupo), consumo };
  }

  /**
   * Cuanto asistio cada alumno en un rango de dias.
   *
   * EL DENOMINADOR SON LAS RESERVAS MARCADAS, NO TODAS: `presentes + ausentes`,
   * o sea las que tienen `asistio !== null`. Es EXACTAMENTE la misma definicion
   * que la asistencia del operativo —y desde la revision de la Task 8 lo es de
   * verdad; antes las dos lo afirmaban y daban numeros distintos sobre los
   * mismos datos, ver el docblock de `metricasDelMes`—. Es la definicion
   * peligrosa del reporte entero: si la profesora no paso lista eso no es "no
   * vino", es "no se sabe", y `asistio` vale `null` justamente para poder
   * decirlo. Con el denominador ingenuo, un alumno de un mes sin listas aparece
   * con 0% y el admin lo llama para preguntarle por que falto a todo.
   *
   * POR ESO EL PORCENTAJE ES `null` Y NUNCA CERO cuando no se le paso lista ni
   * una vez. Un cero es una respuesta —"no vino a ninguna"— y aqui no hay
   * ninguna respuesta.
   *
   * LAS CANCELADAS NO ENTRAN NI ARRIBA NI ABAJO: quien cancelo no falto.
   *
   * SOLO APARECEN LOS ALUMNOS CON AL MENOS UNA RESERVA VIVA EN EL RANGO. Quien
   * no se anoto a nada no tiene una asistencia que reportar, y listarlo con tres
   * ceros seria afirmar algo que no se midio.
   *
   * EL RANGO INVERTIDO ES UN 400 y no una lista vacia: `desde > hasta` no es una
   * pregunta rara, es una pregunta mal escrita, y contestarla con `[]` la deja
   * pasar por "este alumno no vino nunca".
   */
  async asistencia(actor: JwtPayload, consulta: ConsultaRangoDto): Promise<ReporteAsistencia> {
    const desde = desdeFechaISO(consulta.desde);
    const pedido = desdeFechaISO(consulta.hasta);

    if (pedido.getTime() < desde.getTime()) {
      throw new BadRequestException('El rango esta invertido: hasta es anterior a desde.');
    }

    // Se recorta y se contesta, en vez de devolver un 400. Mismo criterio que el
    // tope de `mesesAdelante`; ver `MAX_DIAS_DE_RANGO`.
    const tope = new Date(desde.getTime() + (MAX_DIAS_DE_RANGO - 1) * MS_POR_DIA);
    const hasta = pedido.getTime() > tope.getTime() ? tope : pedido;

    // Los tres valores estan ya validados: las dos fechas por `PATRON_FECHA` y
    // ademas reescritas desde un `Date`, y el `perfilId` por el patron de id.
    return this.cache.recordar(
      actor.tenantId,
      `asistencia:${aFechaISO(desde)}:${aFechaISO(hasta)}:${consulta.perfilId ?? 'todos'}`,
      () => this.calcularAsistencia(desde, hasta, consulta.perfilId),
    );
  }

  private async calcularAsistencia(
    desde: Date,
    hasta: Date,
    perfilId?: string,
  ): Promise<ReporteAsistencia> {
    // `hasta` es el ULTIMO DIA INCLUIDO y la consulta pide `[desde, hasta + 1)`:
    // el rango de `StatsDatos` es semiabierto, como todos los de ese archivo.
    const turnos = await this.datos.turnosEnRango(desde, new Date(hasta.getTime() + MS_POR_DIA));
    const reservas = await this.datos.reservasDeTurnos(turnos.map((turno) => turno.turnoId));

    const cuentas = new Map<string, { presentes: number; ausentes: number }>();
    for (const reserva of reservas) {
      if (reserva.canceladaEn !== null) continue;
      if (perfilId !== undefined && reserva.perfilId !== perfilId) continue;

      const suyas = cuentas.get(reserva.perfilId) ?? { presentes: 0, ausentes: 0 };
      if (reserva.asistio === true) suyas.presentes += 1;
      // `=== false` y no un `else`: con `asistio: null` no se paso lista, y meter
      // ese caso en los ausentes es exactamente la mutacion que convierte un "no
      // se sabe" en un "no vino".
      else if (reserva.asistio === false) suyas.ausentes += 1;
      cuentas.set(reserva.perfilId, suyas);
    }

    const datos = await this.datos.datosDePerfiles([...cuentas.keys()]);

    const alumnos: AsistenciaDeAlumno[] = [...cuentas.entries()]
      .map(([id, suyas]) => ({
        perfilId: id,
        nombreCompleto: (datos.get(id) ?? PERFIL_SIN_USUARIO).nombreCompleto,
        presentes: suyas.presentes,
        ausentes: suyas.ausentes,
        // La MISMA funcion que los porcentajes del operativo, por su `null`.
        porcentaje: porcentajeDe(suyas.presentes, suyas.presentes + suyas.ausentes).porcentaje,
      }))
      .sort(porNombre);

    return { desde: aFechaISO(desde), hasta: aFechaISO(hasta), alumnos };
  }
}

function contarCanceladas(reservas: ReservaParaMetricas[], tipo: TipoCancelacion): number {
  return reservas.filter((reserva) => reserva.cancelacionTipo === tipo).length;
}

/**
 * Lo que se devuelve de un perfil cuyo `Usuario` no aparece.
 *
 * NO PUEDE OCURRIR: `Perfil.usuarioId` es una FK compuesta obligatoria contra
 * `Usuario`, y Postgres no se olvida. Existe porque TypeScript no sabe leer una
 * clave foranea, y porque un `!` aqui convertiria una fila rara en un 500 del
 * reporte entero en vez de en una fila con el nombre vacio.
 */
const PERFIL_SIN_USUARIO: DatosDePerfil = { nombreCompleto: '', email: '' };

/**
 * El mismo dia, `meses` meses despues, en UTC.
 *
 * Cuenta sumandole al mes y deja que `Date.UTC` normalice, en vez de corregir el
 * ano a mano: asi diciembre no es un caso aparte y no hay un `if (mes > 12)` que
 * alguien pueda escribir al reves. Un 31 de enero mas un mes cae en el 3 de
 * marzo, y para un limite superior EXCLUSIVO eso es inofensivo: el rango sobra
 * dos dias, nunca falta ninguno.
 */
function sumarMeses(desde: Date, meses: number): Date {
  return new Date(
    Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth() + meses, desde.getUTCDate()),
  );
}

/** Reservas VIVAS por turno. Una cancelada no ocupa lugar. */
function contarVivasPorTurno(reservas: ReservaParaMetricas[]): Map<string, number> {
  const porTurno = new Map<string, number>();

  for (const reserva of reservas) {
    if (reserva.canceladaEn !== null) continue;
    porTurno.set(reserva.turnoId, (porTurno.get(reserva.turnoId) ?? 0) + 1);
  }

  return porTurno;
}

/**
 * Reservas VIVAS por alumno: su consumo del periodo.
 *
 * Derivado y no un contador guardado, como todo el consumo desde la Fase 1. Una
 * cancelada no es una clase tomada, sea RECUPERABLE o DEFINITIVA: las dos
 * liberan el lugar, y la diferencia entre ellas es si la clase vuelve al pack,
 * que es otra pregunta.
 */
function contarVivasPorPerfil(reservas: ReservaParaMetricas[]): Map<string, number> {
  const porPerfil = new Map<string, number>();

  for (const reserva of reservas) {
    if (reserva.canceladaEn !== null) continue;
    porPerfil.set(reserva.perfilId, (porPerfil.get(reserva.perfilId) ?? 0) + 1);
  }

  return porPerfil;
}

/**
 * EL ORDEN DE TODAS LAS LISTAS DE PERSONAS DE ESTA FASE.
 *
 * Alfabetico por nombre, y el id desempata. El desempate no es paranoia: dos
 * alumnos pueden llamarse igual, y sin el, `sort` deja esas dos filas en el
 * orden en que vino la base. Estas respuestas se serializan a JSON y se guardan
 * en el cache, asi que dos llamadas identicas tienen que dar el mismo cuerpo
 * byte a byte.
 */
function porNombre(
  a: { nombreCompleto: string; perfilId: string },
  b: { nombreCompleto: string; perfilId: string },
): number {
  if (a.nombreCompleto !== b.nombreCompleto) return a.nombreCompleto < b.nombreCompleto ? -1 : 1;
  return a.perfilId < b.perfilId ? -1 : a.perfilId > b.perfilId ? 1 : 0;
}

/**
 * Los packs alfabeticos y "Sin pack" SIEMPRE AL FINAL.
 *
 * No es cosmetica: "Sin pack" no es un plan del catalogo, es el grupo de los que
 * no contrataron ninguno. Dejarlo caer entre la "S" y la "T" lo disfrazaria de
 * un pack mas en la unica lista donde la distincion importa. Y el id desempata,
 * por lo mismo que `porNombre`.
 */
function porGrupo(a: ComposicionPorPack, b: ComposicionPorPack): number {
  if (a.packId === null) return b.packId === null ? 0 : 1;
  if (b.packId === null) return -1;
  if (a.packNombre !== b.packNombre) return a.packNombre < b.packNombre ? -1 : 1;
  return a.packId < b.packId ? -1 : a.packId > b.packId ? 1 : 0;
}

/**
 * Los turnos como se leen en una agenda: por dia, por hora, y el id desempata.
 *
 * El `horaInicio` es "HH:MM" con ceros a la izquierda y 24 h, asi que el orden
 * lexicografico coincide con el cronologico y no hace falta parsear nada; es la
 * misma propiedad en la que se apoya `comparaHoras` desde la Fase 1.
 */
function porAgenda(a: TurnoLibre, b: TurnoLibre): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  if (a.horaInicio !== b.horaInicio) return a.horaInicio < b.horaInicio ? -1 : 1;
  return a.turnoId < b.turnoId ? -1 : a.turnoId > b.turnoId ? 1 : 0;
}

function agruparPorTurno(reservas: ReservaParaMetricas[]): Map<string, ReservaParaMetricas[]> {
  const porTurno = new Map<string, ReservaParaMetricas[]>();

  for (const reserva of reservas) {
    const suyas = porTurno.get(reserva.turnoId);
    if (suyas) suyas.push(reserva);
    else porTurno.set(reserva.turnoId, [reserva]);
  }

  return porTurno;
}

function importe(centavos: number): Importe {
  return { centavos, texto: aTexto(centavos) };
}

function sumar(pagos: PagoParaCaja[]): number {
  return pagos.reduce((total, pago) => total + aCentavos(pago.monto), 0);
}

/**
 * El desglose por metodo, en orden alfabetico.
 *
 * El orden es fijo y no "el que venga de la base": la respuesta se serializa a
 * JSON y se guarda en el cache, asi que dos llamadas identicas tienen que dar
 * el mismo cuerpo byte a byte. Solo aparecen los metodos con movimiento: un
 * `EFECTIVO: 0.00` en un mes sin efectivo es ruido.
 */
function agruparPorMetodo(pagos: PagoParaCaja[]): CobradoPorMetodo[] {
  const centavosPorMetodo = new Map<MetodoPago, number>();

  for (const pago of pagos) {
    const acumulado = centavosPorMetodo.get(pago.metodo) ?? 0;
    centavosPorMetodo.set(pago.metodo, acumulado + aCentavos(pago.monto));
  }

  return [...centavosPorMetodo.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([metodo, centavos]) => ({ metodo, importe: importe(centavos) }));
}
