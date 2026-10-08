'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import type { ClaveInvitacionPublica } from '@boxadmin/shared';
import { PATRON_FECHA } from '@boxadmin/shared';
import { Campo } from '@/componentes/formulario';
import { Aviso, Boton } from '@/componentes/ui';
import { usePacks, useSalas } from '@/hooks/use-catalogos';
import { useGuardarClave } from '@/hooks/use-invitaciones';
import { repartirPorCampo } from '../usuarios/[id]/errores';
import { ErrorDeApi } from '@/lib/cliente';

/**
 * LOS CAMPOS QUE LA API ACEPTA. NO HAY UN SEXTO, Y NO ESTA `codigo`.
 *
 * Se exporta para que el spec compare contra ESTA lista y no contra una copia
 * escrita a mano: una lista blanca duplicada deja de ser una lista blanca el dia
 * que una de las dos copias crece.
 *
 * `codigo` no esta porque `ActualizarInvitacionDto` no lo acepta, y no lo acepta
 * por un motivo que no es tecnico: es una credencial YA REPARTIDA. Cambiarla
 * desde aqui dejaria fuera, sin avisar, a todo el que tenga el papel con el
 * codigo viejo. Lo que se hace en su lugar es desactivar esta clave y crear
 * otra, que es justamente lo que ofrece la tabla.
 *
 * Y no esta "oculto" ni "deshabilitado": NO ESTA. Un campo con `hidden` sigue
 * dentro del `<form>` y viaja igual en el cuerpo, y el ValidationPipe global
 * lleva `forbidNonWhitelisted: true`: una clave de mas no se ignora, es un 400
 * que tira la peticion entera.
 */
export const CAMPOS_DE_LA_CLAVE = ['nombre', 'salaIds', 'packId', 'usosMax', 'expiraEn'] as const;

/**
 * Todo texto, tambien lo que la API quiere como numero.
 *
 * Un `<input>` siempre devuelve texto; `@IsInt()` rechaza `"5"` con un 400. La
 * conversion esta en UN sitio (`cuerpoDeLaClave`) y no repartida por los
 * manejadores.
 */
const esquema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, 'Hace falta un nombre para reconocer la clave en el listado')
    .max(80, 'Como mucho 80 caracteres'),
  packId: z.string(),
  usosMax: z
    .string()
    .trim()
    .refine((valor) => valor === '' || /^\d+$/.test(valor), 'Tiene que ser un numero entero')
    // VACIO ES ILIMITADA, Y CERO NO ES VACIO. Una clave con `usosMax: 0` no
    // sirve para nadie; la API la rechaza con `@Min(1)` y aqui se frena antes
    // para que el admin lea por que, en vez de un 400 generico.
    .refine(
      (valor) => valor === '' || Number(valor) >= 1,
      'Dejalo vacio para que sea ilimitada. Cero seria una clave que no sirve para nadie.',
    ),
  expiraEn: z
    .string()
    .refine((valor) => valor === '' || PATRON_FECHA.test(valor), 'Usa el formato AAAA-MM-DD'),
});

type Datos = z.infer<typeof esquema>;

/**
 * EL CUERPO SE ARMA ENUMERANDO, NUNCA COPIANDO EL FORMULARIO.
 *
 * Copiar el objeto del formulario y borrar lo que sobra deja pasar el campo que
 * se agregue mañana; enumerar obliga a tocar esta funcion.
 *
 * Los opcionales vacios NO SE MANDAN VACIOS: `usosMax: ""` no pasa el `@IsInt`
 * y `expiraEn: ""` no pasa el `@IsISO8601`. Los dos serian un 400.
 *
 * Sirve igual para el POST y para el PATCH porque los dos DTO aceptan las
 * mismas cinco claves; el de actualizar solo las hace opcionales.
 */
export function cuerpoDeLaClave(datos: Datos, salaIds: readonly string[]): Record<string, unknown> {
  const cuerpo: Record<string, unknown> = {
    nombre: datos.nombre,
    // Siempre, tambien al editar: `salaIds` presente REEMPLAZA el conjunto
    // entero, y el formulario muestra el conjunto entero.
    salaIds: [...salaIds],
  };

  if (datos.packId !== '') cuerpo.packId = datos.packId;
  if (datos.usosMax !== '') cuerpo.usosMax = Number(datos.usosMax);
  if (datos.expiraEn !== '') cuerpo.expiraEn = datos.expiraEn;

  return cuerpo;
}

function valoresIniciales(clave: ClaveInvitacionPublica | undefined): Datos {
  return {
    nombre: clave?.nombre ?? '',
    packId: clave?.packId ?? '',
    usosMax: clave?.usosMax === null || clave?.usosMax === undefined ? '' : String(clave.usosMax),
    expiraEn:
      clave?.expiraEn === null || clave?.expiraEn === undefined ? '' : clave.expiraEn.slice(0, 10),
  };
}

/**
 * El formulario de una clave de invitacion: el mismo para crear y para editar.
 *
 * `clave` ausente = crear. Lo UNICO que cambia entre los dos modos son los
 * valores de partida, el verbo y los textos; los campos son los mismos, porque
 * los DTO son los mismos. Dos formularios separados se habrian separado de
 * verdad con la tercera modificacion.
 *
 * El `codigo` no se enseña aqui ni como texto: ya esta en su columna de la
 * tabla, y una segunda copia en pantalla es una segunda copia que mantener. El
 * titulo nombra la clave por su NOMBRE, que es para lo que existe el nombre.
 */
export function FormularioDeClave({
  clave,
  alTerminar,
  alCancelar,
}: {
  /** Ausente = se esta creando una clave nueva. */
  clave?: ClaveInvitacionPublica;
  alTerminar: () => void;
  alCancelar: () => void;
}) {
  const salas = useSalas();
  const packs = usePacks();
  const guardar = useGuardarClave(clave?.id);

  const [salaIds, setSalaIds] = useState<readonly string[]>(clave?.salaIds ?? []);
  // Se enciende al intentar enviar, no al desmarcar: avisar mientras alguien
  // esta cambiando de opinion es ruido.
  const [faltanSalas, setFaltanSalas] = useState(false);

  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Datos>({ resolver: zodResolver(esquema), defaultValues: valoresIniciales(clave) });

  const fallo = guardar.error instanceof ErrorDeApi ? guardar.error : null;
  const repartido = fallo === null ? null : repartirPorCampo(fallo, CAMPOS_DE_LA_CLAVE);

  async function enviar(datos: Datos): Promise<void> {
    /**
     * SIN SALA NO SALE LA PETICION.
     *
     * `@ArrayNotEmpty()` la rechazaria con un 400, asi que mandarla igual seria
     * un viaje de ida y vuelta para enseñar un error que ya se sabia. Y el
     * motivo no es de formato: una clave sin salas produce alumnos que se
     * registran bien y despues no pueden reservar nada.
     */
    if (salaIds.length === 0) {
      setFaltanSalas(true);
      return;
    }

    try {
      await guardar.mutateAsync(cuerpoDeLaClave(datos, salaIds));
      alTerminar();
    } catch {
      // El fallo vive en `guardar.error` y se pinta abajo. Sin este `catch`
      // seria un rechazo sin manejar.
    }
  }

  function alternarSala(id: string, marcada: boolean): void {
    setSalaIds((actuales) =>
      marcada ? [...actuales, id] : actuales.filter((otra) => otra !== id),
    );
    setFaltanSalas(false);
  }

  return (
    <form
      onSubmit={handleSubmit(enviar)}
      className="flex max-w-xl flex-col gap-4 rounded-xl border border-slate-300 bg-white p-4 shadow-sm"
      noValidate
    >
      <h2 className="text-lg font-semibold text-slate-900">
        {clave === undefined
          ? 'Crear una clave de invitacion'
          : `Editar la clave "${clave.nombre}"`}
      </h2>

      {repartido !== null && repartido.sueltas.length > 0 && (
        <Aviso tono="error">{repartido.sueltas.join(' ')}</Aviso>
      )}

      <Campo
        etiqueta="Nombre"
        maxLength={80}
        error={errors.nombre?.message ?? repartido?.porCampo.nombre}
        {...register('nombre')}
      />

      <fieldset className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">Salas que otorga</legend>

        {salas.isPending && <p className="text-sm text-slate-500">Cargando salas…</p>}

        {salas.error !== null && (
          // Sin catalogo no hay forma de elegir una sala, y sin sala la API
          // rechaza la clave. Aqui SI bloquea, al reves que en el alta de
          // personas: alla se podian asignar despues desde la ficha.
          <Aviso tono="error">
            No se pudieron cargar las salas, y una clave necesita al menos una. Volve a intentarlo.
          </Aviso>
        )}

        {salas.data?.map((sala) => (
          <label key={sala.id} className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              name="salaIds"
              value={sala.id}
              checked={salaIds.includes(sala.id)}
              onChange={(evento) => alternarSala(sala.id, evento.target.checked)}
              className="h-4 w-4"
            />
            {sala.nombre}
          </label>
        ))}

        {(faltanSalas || repartido?.porCampo.salaIds !== undefined) && (
          <p className="text-xs text-red-700" role="alert">
            {repartido?.porCampo.salaIds ??
              'Marca al menos una sala: sin salas, quien se registre con esta clave no va a poder reservar nada.'}
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="pack" className="text-sm font-medium text-slate-700">
          Pack
        </label>
        {/*
          CONTROLADO, Y NO `register`.
          Un `<select>` no controlado no puede tener seleccionado un `value`
          cuyo `<option>` todavia no existe, y el catalogo de packs llega
          DESPUES del primer pintado. Con `register`, al editar una clave que ya
          tiene pack el selector se queda en "Sin pack" mientras el formulario
          sigue teniendo el pack dentro: la pantalla dice una cosa y el cuerpo
          manda otra. Controlado, React le vuelve a poner el valor en cuanto las
          opciones aparecen. Lo cazo el test de "llega con lo que la clave ya
          tiene".
        */}
        <Controller
          control={control}
          name="packId"
          render={({ field }) => (
            <select
              {...field}
              id="pack"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">Sin pack</option>
              {/* Solo los activos: la API rechaza invitar con un pack dado de
                  baja ("No se puede invitar con un pack dado de baja"), asi que
                  ofrecerlo seria ofrecer un 400. */}
              {packs.data
                ?.filter((pack) => pack.activo)
                .map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.nombre}
                  </option>
                ))}
            </select>
          )}
        />
        {repartido?.porCampo.packId !== undefined && (
          <p className="text-xs text-red-700">{repartido.porCampo.packId}</p>
        )}
      </div>

      <Campo
        etiqueta="Usos maximos"
        type="number"
        min={1}
        placeholder="Vacio = ilimitada"
        error={errors.usosMax?.message ?? repartido?.porCampo.usosMax}
        {...register('usosMax')}
      />

      <Campo
        etiqueta="Vence el"
        type="date"
        error={errors.expiraEn?.message ?? repartido?.porCampo.expiraEn}
        {...register('expiraEn')}
      />

      {clave !== undefined && (
        // Lo que la API NO sabe hacer, dicho donde se intenta y no en un ticket.
        // `ActualizarInvitacionDto` no acepta nulls para quitar un limite ya
        // puesto, asi que vaciar el campo no lo borra: lo deja como estaba.
        <p className="text-xs text-slate-500">
          Vaciar &laquo;Usos maximos&raquo; o &laquo;Vence el&raquo; los deja como estaban: la API
          no sabe quitar un limite ya puesto. Para una clave sin limites, desactiva esta y crea
          otra.
        </p>
      )}

      <div className="flex gap-2">
        <Boton type="submit" cargando={guardar.isPending}>
          {clave === undefined ? 'Crear clave' : 'Guardar cambios'}
        </Boton>
        <Boton type="button" tono="secundario" onClick={alCancelar}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}
