'use client';

import { useState } from 'react';
import type { MiClase, TurnoDisponible } from '@boxadmin/shared';
import { AvisoOffline } from '@/componentes/aviso-offline';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { useAccionesDeTurno } from '@/hooks/use-acciones-de-turno';
import { useMisClases, useTurnosDisponibles } from '@/hooks/use-calendario';
import { diasDeLaSemana, semanaDe, sumarSemanas } from '@/lib/semana';
import { accionDeTurno, textoDeDisponibilidad } from '@/lib/textos-disponibilidad';

const NOMBRES_DE_DIA = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo'];

function hoyEnIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type Acciones = ReturnType<typeof useAccionesDeTurno>;

export function VistaDeSemana() {
  const [ancla, setAncla] = useState(hoyEnIso);
  const { desde, hasta } = semanaDe(ancla);

  const disponibles = useTurnosDisponibles(desde, hasta);
  const misClases = useMisClases(desde, hasta);
  const acciones = useAccionesDeTurno(desde, hasta);

  const reservadoPorTurno = new Map<string, MiClase>(
    (misClases.data ?? []).map((clase) => [clase.turnoId, clase]),
  );

  const porDia = new Map<string, TurnoDisponible[]>();
  for (const turno of disponibles.data ?? []) {
    porDia.set(turno.fecha, [...(porDia.get(turno.fecha) ?? []), turno]);
  }

  // Solo se muestra el error de UNA mutacion: apilar cuatro avisos por una
  // accion fallida es ruido, y el alumno acaba de hacer una sola cosa.
  const mutacionFallida = [
    acciones.reservar,
    acciones.cancelar,
    acciones.anotarme,
    acciones.salirme,
  ].find((m) => m.isError);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-2">
        <Boton tono="secundario" onClick={() => setAncla(sumarSemanas(ancla, -1))}>
          ← Anterior
        </Boton>
        <p className="text-sm font-medium text-slate-700">
          {desde} a {hasta}
        </p>
        <Boton tono="secundario" onClick={() => setAncla(sumarSemanas(ancla, 1))}>
          Siguiente →
        </Boton>
      </header>

      <AvisoOffline actualizadoEn={misClases.dataUpdatedAt} />

      {mutacionFallida !== undefined && (
        <Aviso tono="error">
          {mutacionFallida.error?.message ?? 'No se pudo completar la accion'}
        </Aviso>
      )}

      {disponibles.isError && (
        <Aviso tono="error">
          {disponibles.error instanceof Error
            ? disponibles.error.message
            : 'No se pudo cargar el calendario'}
        </Aviso>
      )}

      {disponibles.isPending && <p className="text-sm text-slate-500">Cargando tu semana…</p>}

      {diasDeLaSemana(desde).map((fecha, indice) => {
        const turnos = porDia.get(fecha) ?? [];

        return (
          <section key={fecha} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-slate-900">
              {NOMBRES_DE_DIA[indice]} {fecha.slice(8)}
            </h2>

            {turnos.length === 0 ? (
              <p className="text-sm text-slate-400">Sin clases</p>
            ) : (
              turnos.map((turno) => (
                <FilaDeTurno
                  key={turno.turnoId}
                  turno={turno}
                  reserva={reservadoPorTurno.get(turno.turnoId)}
                  acciones={acciones}
                />
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

function FilaDeTurno({
  turno,
  reserva,
  acciones,
}: {
  turno: TurnoDisponible;
  reserva: MiClase | undefined;
  acciones: Acciones;
}) {
  const accion = accionDeTurno(turno.disponibilidad);
  const explicacion = textoDeDisponibilidad(turno.disponibilidad);

  return (
    <Tarjeta>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-slate-900">
            {turno.horaInicio}–{turno.horaFin} · {turno.nombre}
          </p>
          <p className="text-xs text-slate-500">{explicacion}</p>
        </div>

        {accion === 'reservar' && (
          <Boton
            cargando={acciones.reservar.isPending}
            onClick={() => acciones.reservar.mutate(turno.turnoId)}
          >
            Reservar
          </Boton>
        )}

        {accion === 'cancelar' && reserva !== undefined && (
          <Boton
            tono="peligro"
            disabled={!reserva.puedeCancelar}
            title={reserva.puedeCancelar ? undefined : 'Ya paso el plazo para cancelar'}
            cargando={acciones.cancelar.isPending}
            onClick={() =>
              acciones.cancelar.mutate({ turnoId: turno.turnoId, reservaId: reserva.reservaId })
            }
          >
            Cancelar
          </Boton>
        )}

        {accion === 'anotarme' && (
          <Boton
            tono="secundario"
            cargando={acciones.anotarme.isPending}
            onClick={() => acciones.anotarme.mutate(turno.turnoId)}
          >
            Lista de espera
          </Boton>
        )}

        {/* `salirme` no se ofrece todavia: TurnoDisponible no trae el id de la
            entrada en la cola, que es lo que pide el endpoint. Ver la
            desviacion documentada en use-acciones-de-turno.ts. */}
        {(accion === 'ninguna' || accion === 'salirme') && (
          <span className="text-xs text-slate-400">Sin acciones</span>
        )}
      </div>
    </Tarjeta>
  );
}
