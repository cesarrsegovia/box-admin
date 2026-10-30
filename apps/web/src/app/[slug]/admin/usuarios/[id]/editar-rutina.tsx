'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { type DiaSemana, PATRON_FECHA, type RutinaPublica } from '@boxadmin/shared';
import { Campo } from '@/componentes/formulario';
import { Aviso, Boton } from '@/componentes/ui';
import { type CambiosDeRutina, useActualizarRutina } from '@/hooks/use-rutinas';
import { Seleccion } from './controles';
import {
  descripcionDe,
  esquemaBase,
  finDespuesDeInicio,
  OPCIONES_DE_DIA,
  REGLA_DE_HORAS,
} from './dias-fijos';
import { mensajeDeFallo } from './errores';

/**
 * Editar UN dia fijo, en linea, debajo de su fila.
 *
 * La sala NO se edita: `ActualizarRutinaDto` no la acepta.
 */

const FECHA_INVALIDA = 'La fecha va como YYYY-MM-DD';

/** `hasta` vacio es una rutina sin fin. */
function esquemaPara(original: RutinaPublica) {
  return (
    esquemaBase
      .extend({
        hasta: z
          .string()
          .refine((valor) => valor === '' || PATRON_FECHA.test(valor), FECHA_INVALIDA),
      })
      .refine(finDespuesDeInicio, REGLA_DE_HORAS)
      // `hasta` no se puede borrar: el servicio hace `dto.hasta ? ... : undefined`
      // y deja la fecha vieja. Mandar `''` seria un 400 o, peor, un cambio que
      // parece hecho y no lo esta.
      .refine((datos) => !(datos.hasta === '' && original.hasta !== null), {
        path: ['hasta'],
        message: 'Para que no tenga fin, hay que darla de baja y crear otra.',
      })
      // Las fechas son `YYYY-MM-DD`: ordenadas como texto, ordenan como fechas.
      .refine((datos) => datos.hasta === '' || datos.hasta >= datos.desde, {
        path: ['hasta'],
        message: 'La fecha de fin no puede ser anterior al inicio',
      })
  );
}

type DatosDeLaEdicion = z.infer<ReturnType<typeof esquemaPara>>;

/** Lo que cambio, y nada mas. Un PATCH con todo seria pisar a quien edito en paralelo. */
function cambiosEntre(original: RutinaPublica, datos: DatosDeLaEdicion): CambiosDeRutina {
  const cambios: CambiosDeRutina = {};
  if (datos.nombre !== original.nombre) cambios.nombre = datos.nombre;
  const dia = Number(datos.diaSemana) as DiaSemana;
  if (dia !== original.diaSemana) cambios.diaSemana = dia;
  if (datos.horaInicio !== original.horaInicio) cambios.horaInicio = datos.horaInicio;
  if (datos.horaFin !== original.horaFin) cambios.horaFin = datos.horaFin;
  if (datos.desde !== original.desde) cambios.desde = datos.desde;
  if (datos.hasta !== '' && datos.hasta !== original.hasta) cambios.hasta = datos.hasta;
  return cambios;
}

export function EditarRutina({
  rutina,
  perfilId,
  alTerminar,
  alCancelar,
}: {
  rutina: RutinaPublica;
  perfilId: string;
  /** Se guardo: quien lo monta cierra el formulario y avisa. */
  alTerminar: () => void;
  alCancelar: () => void;
}) {
  const actualizar = useActualizarRutina(perfilId);
  // LA LINEA BASE ES LA RUTINA DE CUANDO SE ABRIO. Un refetch en medio traeria
  // otros valores, y comparar contra ellos convertiria un campo que nadie toco
  // en un «cambio» que pisa lo que otra persona acaba de guardar.
  const [original] = useState(rutina);
  const [aviso, setAviso] = useState<string | null>(null);
  const [sinCambios, setSinCambios] = useState(false);

  const [esquema] = useState(() => esquemaPara(original));

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DatosDeLaEdicion>({
    resolver: zodResolver(esquema),
    defaultValues: {
      nombre: original.nombre,
      diaSemana: String(original.diaSemana),
      horaInicio: original.horaInicio,
      horaFin: original.horaFin,
      desde: original.desde,
      hasta: original.hasta ?? '',
    },
  });

  // Los ids llevan la rutina: el alta del bloque tiene los mismos rotulos y
  // dos controles con el mismo id romperian la relacion label/control.
  const idDe = (campo: string) => `editar-${rutina.id}-${campo}`;

  async function guardar(datos: DatosDeLaEdicion): Promise<void> {
    setAviso(null);
    setSinCambios(false);

    const cambios = cambiosEntre(original, datos);
    if (Object.keys(cambios).length === 0) {
      setSinCambios(true);
      return;
    }

    try {
      await actualizar.mutateAsync({ id: rutina.id, cambios });
      alTerminar();
    } catch (fallo) {
      setAviso(mensajeDeFallo(fallo, 'ADMIN_OPERATIVO'));
    }
  }

  return (
    <form
      aria-label={`Editar el ${descripcionDe(original)}`}
      onSubmit={(evento) => void handleSubmit(guardar)(evento)}
      className="flex basis-full flex-col gap-3 rounded-lg bg-slate-50 p-3"
      noValidate
    >
      {/* Fijo y ANTES de enviar: es para decidir, no para enterarse. Mover las
          reservas ya generadas esta fuera de alcance. */}
      <Aviso>
        El cambio rige para los meses que se publiquen de ahora en adelante. Las reservas ya
        generadas no se mueven.
      </Aviso>

      {aviso !== null && <Aviso tono="error">{aviso}</Aviso>}
      {sinCambios && <Aviso alerta>No hay cambios para guardar.</Aviso>}

      <Campo
        etiqueta="Nombre del turno"
        id={idDe('nombre')}
        autoFocus
        error={errors.nombre?.message}
        {...register('nombre')}
      />
      <Seleccion
        etiqueta="Dia"
        id={idDe('dia')}
        opciones={OPCIONES_DE_DIA}
        error={errors.diaSemana?.message}
        {...register('diaSemana')}
      />
      <Campo
        etiqueta="Hora de inicio"
        id={idDe('hora-inicio')}
        placeholder="HH:MM"
        error={errors.horaInicio?.message}
        {...register('horaInicio')}
      />
      <Campo
        etiqueta="Hora de fin"
        id={idDe('hora-fin')}
        placeholder="HH:MM"
        error={errors.horaFin?.message}
        {...register('horaFin')}
      />
      <Campo
        etiqueta="Desde"
        id={idDe('desde')}
        placeholder="YYYY-MM-DD"
        error={errors.desde?.message}
        {...register('desde')}
      />
      <Campo
        etiqueta="Hasta"
        id={idDe('hasta')}
        placeholder="Sin fin"
        error={errors.hasta?.message}
        {...register('hasta')}
      />

      <div className="flex gap-2">
        <Boton type="submit" cargando={isSubmitting}>
          Guardar cambios
        </Boton>
        <Boton type="button" tono="secundario" onClick={alCancelar}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}
