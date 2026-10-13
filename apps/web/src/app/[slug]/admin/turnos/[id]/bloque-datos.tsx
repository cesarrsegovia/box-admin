'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { comparaHoras, PATRON_FECHA, PATRON_HORA, type TurnoPublico } from '@boxadmin/shared';
import { Campo } from '@/componentes/formulario';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { useActualizarTurno } from '@/hooks/use-turnos';
import { mensajeDeFallo, repartirPorCampo } from '../../usuarios/[id]/errores';

/**
 * Los datos editables del turno. `PATCH /turnos/:id`.
 *
 * Tres reglas de la API gobiernan este bloque entero:
 *
 * 1. LA SALA NO ESTA, Y NO ES UN OLVIDO. `ActualizarTurnoDto` no acepta
 *    `salaId`, y el DTO dice por que: «mover un turno de sala invalidaria los
 *    accesos de quienes ya reservaron. Si hace falta, se borra el turno y se
 *    recrea». Y no alcanza con no ENSEÑARLO: el ValidationPipe global lleva
 *    `forbidNonWhitelisted`, asi que un `salaId` escondido en el cuerpo seria un
 *    400 de la peticion ENTERA y se llevaria por delante el cupo que iba al
 *    lado. Por eso el campo no existe, ni oculto ni deshabilitado.
 *
 * 2. SOLO VIAJA LO QUE CAMBIO. Ver `enviar`.
 *
 * 3. BAJAR EL CUPO POR DEBAJO DE LAS RESERVAS ACTIVAS ES UN 409, y lo decide la
 *    API, no esta pantalla. Ver `enviar`.
 */

/** Los CINCO que acepta el DTO. Ni uno mas: lo de mas es un 400. */
const CAMPOS = ['nombre', 'fecha', 'horaInicio', 'horaFin', 'cupo'] as const;

const esquema = z
  .object({
    nombre: z
      .string()
      .min(1, 'El nombre no puede quedar vacio')
      .max(80, 'Como mucho 80 caracteres'),
    fecha: z.string().refine((valor) => PATRON_FECHA.test(valor), 'La fecha va como YYYY-MM-DD'),
    horaInicio: z.string().refine((valor) => PATRON_HORA.test(valor), 'La hora va como HH:MM'),
    horaFin: z.string().refine((valor) => PATRON_HORA.test(valor), 'La hora va como HH:MM'),
    cupo: z
      .string()
      .refine(
        (valor) => /^\d+$/.test(valor) && Number(valor) >= 1,
        'Un numero entero, de 1 para arriba',
      ),
  })
  /**
   * El mismo `exigirHorasCoherentes` que el service, de este lado.
   *
   * Se comprueba con las DOS horas del formulario y no solo con la que se
   * toco: la API compara la que llega contra la que ya tiene guardada, asi que
   * cambiar solo el fin tambien puede dejarlas al reves.
   */
  .refine((datos) => comparaHoras(datos.horaFin, datos.horaInicio) > 0, {
    message: 'La hora de fin tiene que ser despues de la de inicio',
    path: ['horaFin'],
  });

type Datos = z.infer<typeof esquema>;
type Campos = (typeof CAMPOS)[number];

export function BloqueDeDatos({ turno }: { turno: TurnoPublico }) {
  const guardar = useActualizarTurno(turno.id);
  const [aviso, setAviso] = useState<string | null>(null);

  const valoresIniciales: Datos = {
    nombre: turno.nombre,
    fecha: turno.fecha,
    horaInicio: turno.horaInicio,
    horaFin: turno.horaFin,
    cupo: String(turno.cupo),
  };

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, dirtyFields, isSubmitting },
  } = useForm<Datos>({ resolver: zodResolver(esquema), defaultValues: valoresIniciales });

  async function enviar(datos: Datos): Promise<void> {
    setAviso(null);

    /**
     * SOLO LO QUE CAMBIO.
     *
     * `dirtyFields` de react-hook-form compara contra `defaultValues`, asi que
     * un campo escrito y vuelto a dejar como estaba no viaja. Mandar el
     * formulario entero pisaria con valores viejos lo que otro admin cambio
     * mientras esta ficha estaba abierta —y en un turno eso es la hora a la que
     * se presenta la gente—, y ademas mandaria un `cupo` que no se toco a un
     * endpoint que lo contrasta con las reservas: un 409 por un campo que nadie
     * queria guardar.
     */
    const cambios: Record<string, string | number> = {};

    for (const campo of CAMPOS) {
      if (dirtyFields[campo] !== true) continue;

      // `cupo` es el unico que viaja como numero: el DTO lo valida con `@IsInt`
      // y una cadena seria un 400.
      cambios[campo] = campo === 'cupo' ? Number(datos[campo]) : datos[campo];
    }

    if (Object.keys(cambios).length === 0) {
      setAviso('No cambiaste nada.');
      return;
    }

    try {
      await guardar.mutateAsync(cambios);
      // Los nuevos valores pasan a ser los "originales": sin esto, el proximo
      // guardado volveria a mandar lo mismo por seguir marcado como sucio.
      reset(datos);
    } catch (fallo) {
      if (!(fallo instanceof ErrorDeApi)) throw fallo;

      if (fallo.estado === 403) {
        setAviso(mensajeDeFallo(fallo, 'ADMIN_OPERATIVO'));
        return;
      }

      /**
       * EL ERROR VA AL CAMPO QUE LA API NOMBRA.
       *
       * Vale para los dos fallos que de verdad devuelve este endpoint: el 400
       * del ValidationPipe, que nombra el campo invalido, y el 409 del cupo,
       * cuyo mensaje —«El turno ya tiene 3 reserva(s) activa(s); el cupo no
       * puede bajar de ahi»— nombra `cupo` y trae ademas el dato que el admin
       * necesita: hasta donde SI puede bajarlo.
       */
      const { porCampo, sueltas } = repartirPorCampo(fallo, CAMPOS);

      for (const [campo, mensaje] of Object.entries(porCampo)) {
        setError(campo as Campos, { message: mensaje });
      }

      setAviso(sueltas.length === 0 ? null : sueltas.join(' '));
    }
  }

  return (
    <Tarjeta>
      <form
        aria-label="Datos del turno"
        onSubmit={(evento) => void handleSubmit(enviar)(evento)}
        className="flex flex-col gap-3"
        noValidate
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Datos</h2>

        {aviso !== null && <Aviso tono="error">{aviso}</Aviso>}

        <Campo etiqueta="Nombre" error={errors.nombre?.message} {...register('nombre')} />
        <Campo
          etiqueta="Fecha"
          placeholder="YYYY-MM-DD"
          error={errors.fecha?.message}
          {...register('fecha')}
        />
        <Campo
          etiqueta="Hora de inicio"
          placeholder="HH:MM"
          error={errors.horaInicio?.message}
          {...register('horaInicio')}
        />
        <Campo
          etiqueta="Hora de fin"
          placeholder="HH:MM"
          error={errors.horaFin?.message}
          {...register('horaFin')}
        />
        {/*
          EL CUPO SE MANDA AUNQUE LA PANTALLA SOSPECHE QUE VA A FALLAR.

          El recuento que tiene la ficha es el de la ultima lectura: entre esa
          lectura y el clic, alguien pudo cancelar. Adivinar el 409 aqui le
          negaria al admin un cambio que la API SI aceptaria, y lo haria con un
          mensaje inventado en vez del de la API, que dice el numero exacto.
        */}
        <Campo
          etiqueta="Cupo"
          inputMode="numeric"
          error={errors.cupo?.message}
          {...register('cupo')}
        />

        <div>
          <Boton type="submit" cargando={isSubmitting}>
            Guardar datos
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}
