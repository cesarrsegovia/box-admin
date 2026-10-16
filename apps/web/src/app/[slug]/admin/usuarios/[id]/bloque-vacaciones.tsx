'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  aFechaISO,
  PATRON_FECHA,
  rolAlcanza,
  type UsuarioDetalle,
  type VacacionPublica,
} from '@boxadmin/shared';
import { Campo } from '@/componentes/formulario';
import { Confirmar } from '@/componentes/confirmar';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { useBorrarVacacion, useCrearVacacion, useVacaciones } from '@/hooks/use-vacaciones';
import { useRolDeQuienMira } from '../../rol-del-panel';
import { mensajeDeFallo, repartirPorCampo } from './errores';

/**
 * Cuando la persona NO viene. Vive en la ficha, al lado de los dias fijos.
 *
 * Es la misma decision que las rutinas en la Fase 7 y por el mismo motivo:
 * «que dias viene Ana» y «cuando no viene» son la misma pregunta mirada por
 * los dos lados, y listar todas las vacaciones del gimnasio no es una tarea
 * que nadie haga. Una pantalla propia obligaria a elegir un alumno antes de
 * ver nada, que es justo lo que la ficha ya resolvio.
 *
 * LO QUE HACEN DE VERDAD: `planificarMes` excluye a ESE alumno de los turnos
 * que caigan dentro del rango (`generacion-mes.service.ts`, paso 2 del §5). El
 * turno sigue existiendo para el resto de la clase. O sea que no es una nota
 * de agenda: cambia el mes que se publica.
 *
 * TRES COSAS DE LA API QUE GOBIERNAN ESTE BLOQUE ENTERO:
 *
 * 1. LA RUTA ES `/vacaciones-alumnos`. La resuelve `use-vacaciones.ts`, que
 *    lleva el porque escrito. Aqui importa su consecuencia: un 404 en el GET
 *    se veria en pantalla como «no tiene vacaciones cargadas», asi que el
 *    estado de error NO comparte dibujo con el estado vacio. Ver abajo.
 *
 * 2. LAS TRES OPERACIONES PIDEN `ADMIN_OPERATIVO`, EL `@Get()` TAMBIEN.
 *    Verificado en `apps/api/src/vacaciones/vacaciones.controller.ts`: las tres
 *    llevan `@Roles('ADMIN_OPERATIVO')`. Al reves que en ausencias, donde el
 *    `@Get()` no lleva ninguno. Por eso la puerta de rol de abajo corta tambien
 *    la LECTURA y no solo los controles.
 *
 * 3. EL BORRADO ES REAL, no una baja logica. Al reves que salas, rutinas y
 *    horarios. No hay `activa: false` que filtrar al pintar, y tampoco hay
 *    forma de deshacer desde aqui: el dialogo lo dice.
 */

/** Los campos del formulario, con los nombres QUE USA LA API. */
const esquema = z.object({
  desde: z.string().regex(PATRON_FECHA, 'La fecha va como YYYY-MM-DD'),
  hasta: z.string().regex(PATRON_FECHA, 'La fecha va como YYYY-MM-DD'),
  motivo: z.string().max(200, 'Como mucho 200 caracteres'),
});

type DatosDelAlta = z.infer<typeof esquema>;
type CampoDelAlta = keyof DatosDelAlta;

/**
 * LOS CAMPOS A LOS QUE SE LE PUEDE COLGAR UNA FRASE DE LA API, Y EN ESTE ORDEN.
 *
 * `repartirPorCampo` ordena por LONGITUD del nombre de mayor a menor y la
 * ordenacion es estable, asi que entre `desde` y `hasta` —que miden lo mismo—
 * gana el que este antes en esta lista. Y la frase que mas importa de este
 * formulario, «hasta no puede ser anterior a desde», NOMBRA A LOS DOS: con
 * `desde` delante se colgaria del campo equivocado y señalaria la fecha que
 * seguramente esta bien. `hasta` va primero a proposito, y hay un test que lo
 * fija.
 *
 * `perfilId` NO ESTA, y eso tambien es a proposito. Es el unico otro campo que
 * el DTO valida, y no tiene control que lo pinte: metido aqui, un
 * «perfilId should not be empty» se lo tragaria el reparto en silencio, cuando
 * fuera de la lista cae en `sueltas` y sale en el cartel, que es donde unico
 * se puede leer.
 */
const CAMPOS_CON_CONTROL: readonly CampoDelAlta[] = ['hasta', 'desde', 'motivo'];

/** «2026-12-24 a 2027-01-05», o un dia suelto cuando desde y hasta coinciden. */
export function textoDeFechas(vacacion: VacacionPublica): string {
  return vacacion.desde === vacacion.hasta
    ? vacacion.desde
    : `${vacacion.desde} a ${vacacion.hasta}`;
}

/** Una celda en blanco se lee como «no cargo la pantalla». */
function textoDeMotivo(motivo: string | null): string {
  return motivo === null || motivo.trim() === '' ? 'Sin motivo' : motivo;
}

/**
 * SI YA PASARON, SI ESTAN PASANDO O SI ESTAN POR VENIR.
 *
 * El listado trae TODAS las de la persona, de siempre, y ordenadas por `desde`
 * ascendente —lo fija `orderBy` en el service—, asi que arriba de todo esta lo
 * mas viejo. Sin decir en que estado esta cada rango, «no viene» y «no vino el
 * invierno pasado» se leen igual, y la pregunta que trae a alguien a esta ficha
 * es siempre sobre lo que viene.
 *
 * Las fechas son `YYYY-MM-DD`, donde el orden alfabetico ES el cronologico: no
 * hace falta construir un `Date` por fila para compararlas.
 */
export type EstadoDeVacacion = 'Ya pasaron' | 'En curso' | 'Todavia no empezaron';

export function estadoDe(vacacion: VacacionPublica, hoy: string): EstadoDeVacacion {
  if (vacacion.hasta < hoy) return 'Ya pasaron';
  if (vacacion.desde > hoy) return 'Todavia no empezaron';
  return 'En curso';
}

// ---------------------------------------------------------------------------
// El borrado
// ---------------------------------------------------------------------------

/**
 * Su propio componente porque `useBorrarVacacion` recibe el id AL CONSTRUIRSE.
 *
 * Montado con `key={vacacion.id}`, cada fila tiene su mutacion y no hay forma
 * de que el DELETE salga con el id de otra. Es el mismo reparto que usa la
 * pantalla de cierres.
 */
function BorradoDeVacacion({
  vacacion,
  alTerminar,
}: {
  vacacion: VacacionPublica;
  alTerminar: () => void;
}) {
  const borrar = useBorrarVacacion(vacacion.id);
  const [fallo, setFallo] = useState<string | undefined>(undefined);

  async function confirmar(): Promise<void> {
    setFallo(undefined);

    try {
      await borrar.mutateAsync();
      alTerminar();
    } catch (error) {
      // El motivo se pinta DENTRO del dialogo: detras no se lee, y el dialogo
      // sigue abierto pidiendo que se confirme algo que acaba de fallar.
      setFallo(mensajeDeFallo(error, 'ADMIN_OPERATIVO'));
    }
  }

  return (
    <Confirmar
      // La pregunta nombra las fechas Y el motivo. Con cuatro rangos cargados,
      // un «¿estas seguro?» es una ruleta.
      pregunta={`Borrar las vacaciones del ${textoDeFechas(vacacion)} («${textoDeMotivo(vacacion.motivo)}»)`}
      detalle="Se borran de verdad, no se dan de baja: no hay forma de deshacerlo desde aqui. Al planificar el mes, esos dias le vuelven a generar reserva."
      textoDeConfirmar="Borrar"
      cargando={borrar.isPending}
      error={fallo}
      alConfirmar={() => void confirmar()}
      alCancelar={alTerminar}
    />
  );
}

// ---------------------------------------------------------------------------
// El bloque
// ---------------------------------------------------------------------------

function PanelDeVacaciones({ usuario }: { usuario: UsuarioDetalle }) {
  const {
    data: vacaciones,
    isPending,
    error,
    refetch,
  } = useVacaciones({
    // EL `perfilId`, NO EL `id` DEL USUARIO. Son dos columnas distintas y las
    // dos son cuid: mandar la equivocada no es un error, es una lista vacia
    // —en la Fase 8 quedo un filtro roto exactamente asi—.
    perfilId: usuario.perfilId,
  });

  const crear = useCrearVacacion();

  const [enBorrado, setEnBorrado] = useState<VacacionPublica | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset: limpiar,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DatosDelAlta>({
    resolver: zodResolver(esquema),
    defaultValues: { desde: '', hasta: '', motivo: '' },
  });

  const hoy = aFechaISO(new Date());

  async function agregar(datos: DatosDelAlta): Promise<void> {
    setAviso(null);

    /**
     * NO SE COMPRUEBA AQUI QUE `hasta` NO SEA ANTERIOR A `desde`.
     *
     * Lo comprueba el service y lo dice con su propia frase. Una comprobacion
     * local con otro texto seria un segundo mensaje que puede acabar diciendo
     * algo distinto, y —peor— dejaria ese camino de la API sin ejercitar nunca.
     */
    const cuerpo: Record<string, unknown> = {
      perfilId: usuario.perfilId,
      desde: datos.desde,
      hasta: datos.hasta,
    };

    // El motivo vacio se OMITE: `motivo: ''` se guardaria como cadena vacia,
    // que no es lo mismo que «no puso motivo». La columna nace en null.
    if (datos.motivo !== '') cuerpo.motivo = datos.motivo;

    try {
      await crear.mutateAsync(cuerpo);
      limpiar();
    } catch (fallo) {
      if (!(fallo instanceof ErrorDeApi)) throw fallo;

      if (fallo.estado === 403) {
        setAviso(mensajeDeFallo(fallo, 'ADMIN_OPERATIVO'));
        return;
      }

      // El error va al campo que la API nombra; lo que no nombra ninguno, al
      // cartel. Inventarle un campo seria señalar el equivocado.
      const { porCampo, sueltas } = repartirPorCampo(fallo, CAMPOS_CON_CONTROL);

      for (const [campo, mensaje] of Object.entries(porCampo)) {
        setError(campo as CampoDelAlta, { message: mensaje });
      }

      setAviso(sueltas.length === 0 ? null : sueltas.join(' '));
    }
  }

  return (
    <Tarjeta>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Vacaciones</h2>

        {aviso !== null && <Aviso tono="error">{aviso}</Aviso>}

        {isPending && <p className="text-sm text-slate-500">Cargando…</p>}

        {/**
         * EL FALLO AL LEER NO SE DIBUJA COMO «no tiene vacaciones».
         *
         * Es la trampa concreta de este endpoint: un 404 —la ruta mal deducida,
         * que ya paso— devuelve una lista que la pantalla no tiene, y el estado
         * vacio diria que el alumno viene todos los dias. El mes se publicaria
         * con las reservas que habia que excluir.
         */}
        {error !== null && (
          <div className="flex flex-col items-start gap-2">
            <Aviso tono="error">{error.message}</Aviso>
            <Boton tono="secundario" onClick={() => void refetch()}>
              Reintentar
            </Boton>
          </div>
        )}

        {vacaciones !== undefined &&
          (vacaciones.length === 0 ? (
            <Aviso>No tiene vacaciones cargadas.</Aviso>
          ) : (
            <ul aria-label="Vacaciones" className="flex flex-col gap-2">
              {vacaciones.map((vacacion) => (
                <li
                  key={vacacion.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2"
                >
                  <p className="text-sm font-medium text-slate-900">{textoDeFechas(vacacion)}</p>
                  <p className="text-xs text-slate-500">{estadoDe(vacacion, hoy)}</p>
                  <p className="text-xs text-slate-500">{textoDeMotivo(vacacion.motivo)}</p>
                  <Boton
                    type="button"
                    tono="secundario"
                    // El nombre accesible lleva las fechas: con cuatro filas de
                    // «Borrar» nadie sabe cual esta pulsando, y con lector de
                    // pantalla menos.
                    aria-label={`Borrar las vacaciones del ${textoDeFechas(vacacion)}`}
                    onClick={() => setEnBorrado(vacacion)}
                  >
                    Borrar
                  </Boton>
                </li>
              ))}
            </ul>
          ))}

        {enBorrado !== null && (
          <BorradoDeVacacion
            key={enBorrado.id}
            vacacion={enBorrado}
            alTerminar={() => setEnBorrado(null)}
          />
        )}

        <form
          aria-label="Cargar vacaciones"
          onSubmit={(evento) => void handleSubmit(agregar)(evento)}
          className="flex flex-col gap-3 border-t border-slate-200 pt-3"
          noValidate
        >
          {/* Las etiquetas NO son «Desde» y «Hasta»: el bloque de dias fijos, en
              esta misma ficha, ya tiene un campo «Desde», y `Campo` deriva el
              `id` de la etiqueta. Dos controles con el mismo `id` rompen el
              `htmlFor` de los dos. */}
          <Campo
            etiqueta="No viene desde"
            placeholder="YYYY-MM-DD"
            error={errors.desde?.message}
            {...register('desde')}
          />
          <Campo
            etiqueta="No viene hasta"
            placeholder="YYYY-MM-DD"
            error={errors.hasta?.message}
            {...register('hasta')}
          />
          <Campo
            etiqueta="Motivo"
            placeholder="Viaje"
            error={errors.motivo?.message}
            {...register('motivo')}
          />

          <div>
            <Boton type="submit" cargando={isSubmitting}>
              Cargar vacaciones
            </Boton>
          </div>
        </form>
      </div>
    </Tarjeta>
  );
}

/**
 * LA PUERTA, y es la que decide si se pide algo.
 *
 * Dos condiciones, y ninguna es cosmetica:
 *
 * 1. UN PROFESOR NO LLEVA VACACIONES POR AQUI. El modelo se llama
 *    `VacacionAlumno` y `planificarMes` solo las cruza contra los `perfilId`
 *    que tienen RUTINAS en la sala —o sea, contra quien viene a clase—. La
 *    ausencia de una profesora se gestiona con sus horarios asignados
 *    (`HorarioProfesorAsignado`), que son otra cosa y otra pantalla. Cargarle
 *    vacaciones a una profesora HOY no es un error de la API —el service solo
 *    comprueba que el perfil exista— pero no hace absolutamente nada: seria un
 *    control que promete tapar sus clases y las deja en pie.
 *
 * 2. SIN ROL NO SE LEE. `rol === null` es «sin proveedor», y eso significa «no
 *    alcanza para nada», no «no se sabe, pedilo igual». Aqui corta tambien la
 *    LECTURA, al reves que en cierres: el `@Get()` de este controller SI lleva
 *    `@Roles('ADMIN_OPERATIVO')`, asi que pedir sin rol seria un 403 pintado
 *    como una averia.
 *
 * El contenido vive en otro componente a proposito, para que sus hooks de
 * consulta NO se ejecuten cuando no se puede. Un `enabled: false` dejaria la
 * peticion escrita y a un refactor de distancia de salir.
 */
export function BloqueDeVacaciones({ usuario }: { usuario: UsuarioDetalle }) {
  const rolDeQuienMira = useRolDeQuienMira();

  if (usuario.rol === 'PROFESOR') return null;

  if (rolDeQuienMira === null || !rolAlcanza(rolDeQuienMira, 'ADMIN_OPERATIVO')) {
    return (
      <Tarjeta>
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Vacaciones
          </h2>
          <Aviso tono="error">
            Para esto hace falta ser administrador operativo. Tu rol no alcanza.
          </Aviso>
        </div>
      </Tarjeta>
    );
  }

  return <PanelDeVacaciones usuario={usuario} />;
}
