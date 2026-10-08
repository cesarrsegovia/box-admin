'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  comparaHoras,
  type DiaSemana,
  PATRON_FECHA,
  PATRON_HORA,
  type RutinaPublica,
  type UsuarioDetalle,
} from '@boxadmin/shared';
import { Campo } from '@/componentes/formulario';
import { Confirmar } from '@/componentes/confirmar';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { useSalas } from '@/hooks/use-catalogos';
import { useCrearRutina, useDarDeBajaRutina, useRutinas } from '@/hooks/use-rutinas';
import { Seleccion } from './controles';
import { mensajeDeFallo } from './errores';

/**
 * Los dias fijos de la persona: sus RUTINAS.
 *
 * UNA RUTINA NO ES UN PLAN DE ENTRENAMIENTO. Es una reserva recurrente —sala,
 * dia de la semana, horario y nombre del turno que generara— y es el motor de
 * recurrencia de la Fase 2. Por eso vive dentro de la ficha: la pregunta que
 * contesta es "¿que dias viene Ana?".
 */

/** Indexado por `DiaSemana`: 0 = domingo, como `Date.getUTCDay()`. */
const NOMBRES_DE_DIA: readonly string[] = [
  'domingo',
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
];

/**
 * De `DiaSemana` al orden en que se lee una semana.
 *
 * El contrato numera desde el domingo porque copia a `Date.getUTCDay()`, pero la
 * semana de un gimnasio empieza el lunes —es lo que ya hace `lib/semana.ts`—.
 * Ordenar por el numero crudo pondria el domingo primero, que no es "sin
 * ordenar" sino ordenado de una forma que nadie reconoce.
 */
function ordenDeSemana(dia: DiaSemana): number {
  return (dia + 6) % 7;
}

/** "martes de 18:00 a 19:00". En minusculas: se interpola dentro de frases. */
function descripcionDe(rutina: RutinaPublica): string {
  return `${NOMBRES_DE_DIA[rutina.diaSemana] ?? ''} de ${rutina.horaInicio} a ${rutina.horaFin}`;
}

function conMayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

const esquema = z
  .object({
    salaId: z.string().min(1, 'Elegi una sala'),
    nombre: z.string().min(1, 'El turno necesita un nombre').max(80, 'Como mucho 80 caracteres'),
    diaSemana: z.string(),
    horaInicio: z.string().regex(PATRON_HORA, 'La hora va como HH:MM'),
    horaFin: z.string().regex(PATRON_HORA, 'La hora va como HH:MM'),
    desde: z.string().regex(PATRON_FECHA, 'La fecha va como YYYY-MM-DD'),
  })
  .refine((datos) => comparaHoras(datos.horaFin, datos.horaInicio) > 0, {
    path: ['horaFin'],
    message: 'La hora de fin tiene que ser despues de la de inicio',
  });

type DatosDelAlta = z.infer<typeof esquema>;

export function BloqueDeDiasFijos({ usuario }: { usuario: UsuarioDetalle }) {
  const { data: rutinas } = useRutinas(usuario.perfilId);
  const { data: salas } = useSalas();
  const crear = useCrearRutina(usuario.perfilId);
  const darDeBaja = useDarDeBajaRutina(usuario.perfilId);

  const [enCurso, setEnCurso] = useState<RutinaPublica | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const opcionesDeSala = (salas ?? usuario.salas).map((sala) => ({
    valor: sala.id,
    texto: sala.nombre,
  }));

  const {
    register,
    handleSubmit,
    reset: limpiar,
    formState: { errors, isSubmitting },
  } = useForm<DatosDelAlta>({
    resolver: zodResolver(esquema),
    defaultValues: {
      salaId: opcionesDeSala[0]?.valor ?? '',
      nombre: '',
      // Lunes: el primer dia de la semana que lee el gimnasio.
      diaSemana: '1',
      horaInicio: '',
      horaFin: '',
      desde: '',
    },
  });

  /**
   * ACTIVAS Y EN ORDEN DE SEMANA.
   *
   * `DELETE /rutinas/:id` es una baja LOGICA: la fila sigue llegando en el
   * listado con `activa: false`. Pintar lo que viene sin mirar ese campo dejaria
   * la rutina en pantalla justo despues de darla de baja.
   */
  const visibles = [...(rutinas ?? [])]
    .filter((rutina) => rutina.activa)
    .sort(
      (a, b) =>
        ordenDeSemana(a.diaSemana) - ordenDeSemana(b.diaSemana) ||
        comparaHoras(a.horaInicio, b.horaInicio),
    );

  async function agregar(datos: DatosDelAlta): Promise<void> {
    setAviso(null);

    try {
      await crear.mutateAsync({
        // El `perfilId` es el de ESTA persona y no un campo del formulario:
        // ponerlo donde se pueda escribir seria poder crearle dias fijos a otro.
        perfilId: usuario.perfilId,
        salaId: datos.salaId,
        nombre: datos.nombre,
        diaSemana: Number(datos.diaSemana) as DiaSemana,
        horaInicio: datos.horaInicio,
        horaFin: datos.horaFin,
        desde: datos.desde,
      });
      limpiar();
    } catch (fallo) {
      if (!(fallo instanceof ErrorDeApi)) throw fallo;
      setAviso(mensajeDeFallo(fallo, 'ADMIN_OPERATIVO'));
    }
  }

  async function confirmarLaBaja(): Promise<void> {
    if (enCurso === null) return;
    setAviso(null);

    try {
      await darDeBaja.mutateAsync(enCurso.id);
      setEnCurso(null);
    } catch (fallo) {
      setAviso(mensajeDeFallo(fallo, 'ADMIN_OPERATIVO'));
      setEnCurso(null);
    }
  }

  return (
    <Tarjeta>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Dias fijos</h2>

        {aviso !== null && <Aviso tono="error">{aviso}</Aviso>}

        {visibles.length === 0 ? (
          <Aviso>No tiene dias fijos cargados.</Aviso>
        ) : (
          <ul aria-label="Dias fijos" className="flex flex-col gap-2">
            {visibles.map((rutina) => (
              <li
                key={rutina.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2"
              >
                <p className="text-sm font-medium text-slate-900">
                  {conMayuscula(descripcionDe(rutina))}
                </p>
                <p className="text-xs text-slate-500">{rutina.nombre}</p>
                <Boton
                  type="button"
                  tono="secundario"
                  // El nombre accesible lleva el dia y la hora: con siete filas
                  // de "Dar de baja" nadie sabe cual esta pulsando, y con lector
                  // de pantalla menos.
                  aria-label={`Dar de baja el ${descripcionDe(rutina)}`}
                  onClick={() => setEnCurso(rutina)}
                >
                  Dar de baja
                </Boton>
              </li>
            ))}
          </ul>
        )}

        {enCurso !== null && (
          <Confirmar
            pregunta={`Dar de baja el dia fijo del ${descripcionDe(enCurso)}`}
            detalle="Los turnos ya generados NO se tocan: deja de generar los futuros."
            textoDeConfirmar="Dar de baja"
            cargando={darDeBaja.isPending}
            alConfirmar={() => void confirmarLaBaja()}
            alCancelar={() => setEnCurso(null)}
          />
        )}

        <form
          aria-label="Agregar dia fijo"
          onSubmit={(evento) => void handleSubmit(agregar)(evento)}
          className="flex flex-col gap-3 border-t border-slate-200 pt-3"
          noValidate
        >
          <Seleccion
            etiqueta="Sala"
            opciones={opcionesDeSala}
            error={errors.salaId?.message}
            {...register('salaId')}
          />
          <Campo
            etiqueta="Nombre del turno"
            placeholder="Pilates"
            error={errors.nombre?.message}
            {...register('nombre')}
          />
          <Seleccion
            etiqueta="Dia"
            // En orden de semana, igual que la lista de arriba.
            opciones={[1, 2, 3, 4, 5, 6, 0].map((dia) => ({
              valor: String(dia),
              texto: conMayuscula(NOMBRES_DE_DIA[dia] ?? ''),
            }))}
            error={errors.diaSemana?.message}
            {...register('diaSemana')}
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
          {/* `desde` ES OBLIGATORIO en `CrearRutinaDto`. Sin el, el POST es un
              400 del ValidationPipe y el formulario no tendria donde pintarlo. */}
          <Campo
            etiqueta="Desde"
            placeholder="YYYY-MM-DD"
            error={errors.desde?.message}
            {...register('desde')}
          />

          <div>
            <Boton type="submit" cargando={isSubmitting}>
              Agregar dia fijo
            </Boton>
          </div>
        </form>
      </div>
    </Tarjeta>
  );
}
