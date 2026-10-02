import { Injectable } from '@nestjs/common';
import {
  ultimoDiaDelMesUtc,
  type CajaDelMes,
  type CobradoPorMetodo,
  type Importe,
  type JwtPayload,
  type MetodoPago,
} from '@boxadmin/shared';
import { aCentavos, aTexto } from '../liquidacion/calcular-importes';
import { LiquidacionService } from '../liquidacion/liquidacion.service';
import { CacheDeStats } from './cache-de-stats';
import type { ConsultaMensualDto } from './dto/consulta-mensual.dto';
import { StatsDatos, type PagoParaCaja, type PerfilConPack } from './stats.datos';

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
