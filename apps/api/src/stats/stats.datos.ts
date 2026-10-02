import { Injectable } from '@nestjs/common';
import { primerDiaDelMesUtc, type MetodoPago } from '@boxadmin/shared';
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
   * Los alumnos con plan contratado, con el precio de su pack resuelto.
   *
   * Quien NO tiene pack no sale: no debe nada porque no contrato nada. Si
   * saliera, el reporte de morosos se llenaria de gente que nunca se anoto a
   * ninguna cosa (y el pendiente estimado de la caja, de ceros).
   */
  async perfilesConPack(): Promise<PerfilConPack[]> {
    const perfiles = await this.prisma.db.perfil.findMany({
      where: { packId: { not: null } },
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
