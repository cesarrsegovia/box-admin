'use client';

import { useEffect } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { comparaHoras, PATRON_FECHA, PATRON_HORA } from '@boxadmin/shared';
import { Campo } from '@/componentes/formulario';
import { Aviso, Boton } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { destinoDeLoginDesde } from '@/lib/destino-de-login';
import { useSalas } from '@/hooks/use-catalogos';
import { useCrearTurno, type TurnoACrear } from '@/hooks/use-turnos';
import { useUsuarios } from '@/hooks/use-usuarios';
import { mensajeDeFallo } from '../../usuarios/[id]/errores';
import { Seleccion } from '../../usuarios/[id]/controles';

/**
 * Lo que el formulario tiene en pantalla, TODO como texto.
 *
 * `cupo` es texto aqui y numero en el cuerpo: un `<input>` siempre devuelve
 * texto y `@IsInt()` rechaza `"12"`. La conversion esta en `cuerpoDelTurno`.
 */
const esquema = z
  .object({
    salaId: z.string().min(1, 'Elegi una sala'),
    nombre: z
      .string()
      .trim()
      .min(1, 'El turno necesita un nombre')
      .max(80, 'Como mucho 80 caracteres'),
    fecha: z.string().regex(PATRON_FECHA, 'La fecha va como YYYY-MM-DD'),
    horaInicio: z.string().regex(PATRON_HORA, 'La hora va como HH:MM'),
    horaFin: z.string().regex(PATRON_HORA, 'La hora va como HH:MM'),
    cupo: z
      .string()
      .trim()
      .refine((valor) => /^\d+$/.test(valor) && Number(valor) >= 1, 'El cupo es de al menos 1'),
    profesorId: z.string(),
  })
  .refine((datos) => comparaHoras(datos.horaFin, datos.horaInicio) > 0, {
    path: ['horaFin'],
    message: 'La hora de fin tiene que ser despues de la de inicio',
  });

type Datos = z.infer<typeof esquema>;

const VACIO: Datos = {
  salaId: '',
  nombre: '',
  fecha: '',
  horaInicio: '',
  horaFin: '',
  cupo: '',
  profesorId: '',
};

/**
 * EL CUERPO SE ARMA POR LISTA BLANCA, y `profesorId` SOLO VIAJA SI SE ELIGIO.
 *
 * El servicio distingue «ausente» (la resuelve del horario semanal) de
 * «presente» (manda el admin y nadie la pisa). `''` o `null` no son ausente:
 * `@IsNotEmpty()` los rechaza con un 400.
 */
function cuerpoDelTurno(datos: Datos): TurnoACrear {
  const cuerpo: TurnoACrear = {
    salaId: datos.salaId,
    nombre: datos.nombre,
    fecha: datos.fecha,
    horaInicio: datos.horaInicio,
    horaFin: datos.horaFin,
    cupo: Number(datos.cupo),
  };

  if (datos.profesorId !== '') cuerpo.profesorId = datos.profesorId;

  return cuerpo;
}

export default function PaginaDeTurnoNuevo() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();
  const ruta = usePathname();

  const salas = useSalas();
  const profesoras = useUsuarios({ tipo: 'profesor' });
  const crear = useCrearTurno();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Datos>({ resolver: zodResolver(esquema), defaultValues: VACIO });

  /**
   * LAS TRES PETICIONES PUEDEN TRAER EL 401. Un solo booleano y un solo efecto:
   * si cada una empujara por su cuenta, una sesion caducada mandaria al login
   * varias veces y dejaria entradas basura en el historial.
   */
  const sesionCaducada =
    (salas.error instanceof ErrorDeApi && salas.error.esSesionCaducada) ||
    (profesoras.error instanceof ErrorDeApi && profesoras.error.esSesionCaducada) ||
    (crear.error instanceof ErrorDeApi && crear.error.esSesionCaducada);

  useEffect(() => {
    if (!sesionCaducada) return;

    router.push(destinoDeLoginDesde(ruta, '', slug));
  }, [sesionCaducada, router, ruta, slug]);

  // Una sala dada de baja no se ofrece: la API contesta 400 si se la manda.
  const opcionesDeSala = [
    { valor: '', texto: 'Sin elegir' },
    ...(salas.data ?? [])
      .filter((sala) => sala.activa)
      .map((sala) => ({ valor: sala.id, texto: sala.nombre })),
  ];

  // El `perfilId`, no el `id` del usuario: `Turno.profesorId` referencia a
  // `Perfil` (mismo criterio que `turnos/[id]/bloque-profesora.tsx`).
  const opcionesDeProfesora = [
    { valor: '', texto: 'La del horario semanal' },
    ...(profesoras.data ?? [])
      .filter((profesora) => profesora.activo)
      .map((profesora) => ({ valor: profesora.perfilId, texto: profesora.nombreCompleto })),
  ];

  async function enviar(datos: Datos): Promise<void> {
    try {
      const turno = await crear.mutateAsync(cuerpoDelTurno(datos));
      // El id que devolvio la API, no uno inventado.
      router.push(`/${slug}/admin/turnos/${turno.id}`);
    } catch {
      // El fallo vive en `crear.error` y se pinta abajo.
    }
  }

  // Sin sesion no se enseña el mensaje crudo de la API: la pantalla ya se va al login.
  const errorDeLaApi =
    crear.error === null || sesionCaducada ? null : mensajeDeFallo(crear.error, 'ADMIN_OPERATIVO');

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Nuevo turno</h1>

      <form onSubmit={handleSubmit(enviar)} className="flex max-w-xl flex-col gap-4" noValidate>
        {sesionCaducada && <Aviso tono="error">Tu sesion caduco. Te llevamos al login.</Aviso>}
        {errorDeLaApi !== null && <Aviso tono="error">{errorDeLaApi}</Aviso>}

        {salas.isPending && <p className="text-sm text-slate-500">Cargando salas…</p>}
        {salas.error !== null && !sesionCaducada && (
          <Aviso tono="error">
            No se pudieron cargar las salas: sin sala no se puede crear el turno.
          </Aviso>
        )}
        {profesoras.error !== null && !sesionCaducada && (
          <Aviso>
            No pudimos traer las profesoras: el turno saldra con la del horario semanal.
          </Aviso>
        )}

        <Seleccion
          etiqueta="Sala"
          opciones={opcionesDeSala}
          error={errors.salaId?.message}
          {...register('salaId')}
        />
        <Campo
          etiqueta="Nombre de la clase"
          error={errors.nombre?.message}
          {...register('nombre')}
        />
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
        <Campo
          etiqueta="Cupo"
          type="number"
          min={1}
          error={errors.cupo?.message}
          {...register('cupo')}
        />
        <Seleccion
          etiqueta="Profesora"
          opciones={opcionesDeProfesora}
          error={errors.profesorId?.message}
          {...register('profesorId')}
        />

        <div className="flex gap-2">
          <Boton type="submit" cargando={crear.isPending}>
            Crear turno
          </Boton>
        </div>
      </form>
    </section>
  );
}
