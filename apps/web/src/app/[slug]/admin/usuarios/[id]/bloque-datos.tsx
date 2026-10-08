'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PATRON_FECHA, type UsuarioDetalle } from '@boxadmin/shared';
import { Campo } from '@/componentes/formulario';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { usePacks } from '@/hooks/use-catalogos';
import { useActualizarUsuario } from '@/hooks/use-usuarios';
import { AreaDeTexto, Seleccion } from './controles';
import { mensajeDeFallo, repartirPorCampo } from './errores';

/**
 * Los datos editables de la persona. `PATCH /usuarios/:id`.
 *
 * Tres reglas de la API gobiernan este bloque entero:
 *
 * 1. EL EMAIL NO ESTA. `ActualizarUsuarioDto` no lo acepta y el ValidationPipe
 *    global lleva `forbidNonWhitelisted`: mandarlo seria un 400 de la peticion
 *    ENTERA, y se llevaria por delante el telefono que iba al lado. Se muestra
 *    en la cabecera de la ficha, que es donde se lee sin poder tocarlo.
 *
 * 2. LOS CAMPOS DE ALUMNO NO SE DIBUJAN PARA UN PROFESOR. El service los
 *    rechaza con 400 ("Un profesor no tiene packId... Esos campos son de
 *    alumno"), asi que un formulario que los ofreciera estaria ofreciendo algo
 *    que no se puede guardar.
 *
 * 3. LA FICHA MEDICA SOLO EXISTE SI LA API LA MANDO. Ver `CAMPOS` mas abajo.
 */

/** Los campos de alumno, los MISMOS cinco que nombra `usuarios.service.ts`. */
const CAMPOS_DE_ALUMNO = [
  'packId',
  'clasesExtra',
  'cancelacionesUsadas',
  'vigenciaDesde',
  'vigenciaHasta',
] as const;

const enteroNoNegativo = z
  .string()
  .refine((valor) => valor === '' || /^\d+$/.test(valor), 'Un numero entero, de 0 para arriba');

const fechaOpcional = z
  .string()
  .refine((valor) => valor === '' || PATRON_FECHA.test(valor), 'La fecha va como YYYY-MM-DD');

const esquema = z.object({
  nombreCompleto: z
    .string()
    .min(1, 'El nombre no puede quedar vacio')
    .max(120, 'Como mucho 120 caracteres'),
  telefono: z.string().max(40, 'Como mucho 40 caracteres'),
  fichaMedica: z.string().max(2000, 'Como mucho 2000 caracteres'),
  packId: z.string(),
  clasesExtra: enteroNoNegativo,
  cancelacionesUsadas: enteroNoNegativo,
  vigenciaDesde: fechaOpcional,
  vigenciaHasta: fechaOpcional,
});

type Datos = z.infer<typeof esquema>;
type Campos = keyof Datos;

/** Los dos que viajan como numero. El resto van tal cual. */
const NUMERICOS: readonly Campos[] = ['clasesExtra', 'cancelacionesUsadas'];

/**
 * Los que la API NO SABE VACIAR, y por eso un valor vacio no se manda.
 *
 * `packId` es `@IsNotEmpty` y las vigencias son `@Matches(PATRON_FECHA)`:
 * mandarlos como cadena vacia es un 400. Y `undefined` significa "no tocar", no
 * "borrar", asi que hoy NO HAY FORMA de quitarle el pack a un alumno ni de
 * limpiarle una vigencia desde esta pantalla. Es un limite de la API, anotado
 * aqui para que no parezca un olvido del formulario.
 */
const NO_SE_PUEDEN_VACIAR: readonly Campos[] = ['packId', 'vigenciaDesde', 'vigenciaHasta'];

export function BloqueDeDatos({ usuario }: { usuario: UsuarioDetalle }) {
  const guardar = useActualizarUsuario(usuario.id);
  const { data: packs } = usePacks();
  const [aviso, setAviso] = useState<string | null>(null);

  const esProfesor = usuario.rol === 'PROFESOR';

  /**
   * LA FICHA MEDICA SE DIBUJA SI Y SOLO SI LA API LA MANDO.
   *
   * `GET /usuarios/:id` OMITE la clave cuando quien mira no alcanza
   * `ADMIN_SALON`; `PATCH /usuarios/:id` en cambio la ACEPTA de cualquier
   * `ADMIN_OPERATIVO`. Dibujar el campo igual lo pintaria vacio, y guardar un
   * telefono mandaria `fichaMedica: ''`: el historial clinico de alguien
   * borrado por corregir un numero, sin que nadie llegue a verlo.
   *
   * La condicion es la PRESENCIA DE LA CLAVE y no el rol dibujado por otro
   * lado: si fueran dos fuentes, el dia que la API cambie de criterio solo se
   * entera una.
   */
  const veLaFichaMedica = 'fichaMedica' in usuario;

  const visibles: readonly Campos[] = [
    'nombreCompleto',
    'telefono',
    ...(veLaFichaMedica ? (['fichaMedica'] as const) : []),
    ...(esProfesor ? [] : CAMPOS_DE_ALUMNO),
  ];

  const valoresIniciales: Datos = {
    nombreCompleto: usuario.nombreCompleto,
    telefono: usuario.telefono ?? '',
    fichaMedica: usuario.fichaMedica ?? '',
    packId: usuario.packId ?? '',
    clasesExtra: String(usuario.clasesExtra),
    cancelacionesUsadas: String(usuario.cancelacionesUsadas),
    vigenciaDesde: usuario.vigenciaDesde ?? '',
    vigenciaHasta: usuario.vigenciaHasta ?? '',
  };

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, dirtyFields, isSubmitting },
  } = useForm<Datos>({ resolver: zodResolver(esquema), defaultValues: valoresIniciales });

  /**
   * Las opciones del pack.
   *
   * La opcion vacia solo existe si la persona NO tiene pack: con uno puesto,
   * ofrecer "sin pack" seria ofrecer algo que la API rechaza (`@IsNotEmpty`), y
   * el admin descubriria el limite con un 400 despues de guardar.
   */
  const opcionesDePack = [
    ...(usuario.packId === null ? [{ valor: '', texto: 'Sin pack' }] : []),
    ...(packs ?? []).map((pack) => ({
      valor: pack.id,
      texto: pack.activo ? pack.nombre : `${pack.nombre} (de baja)`,
    })),
  ];

  async function enviar(datos: Datos): Promise<void> {
    setAviso(null);

    /**
     * SOLO LO QUE CAMBIO.
     *
     * `dirtyFields` de react-hook-form compara contra `defaultValues`, asi que
     * un campo escrito y vuelto a dejar como estaba no viaja. Mandar el
     * formulario entero haria dos cosas malas: pisaria con valores viejos lo
     * que otro admin cambio mientras esta ficha estaba abierta, y para un
     * profesor mandaria los campos de alumno —que estan en el objeto aunque no
     * se dibujen— y la peticion entera seria un 400.
     */
    const cambios: Record<string, string | number> = {};

    for (const campo of visibles) {
      if (dirtyFields[campo] !== true) continue;

      const valor = datos[campo];
      if (valor === '' && NO_SE_PUEDEN_VACIAR.includes(campo)) continue;

      cambios[campo] = NUMERICOS.includes(campo) ? Number(valor) : valor;
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

      // EL ERROR VA AL CAMPO QUE LA API NOMBRA. Un "el email ya existe" flotando
      // sobre un formulario de siete campos no dice cual.
      const { porCampo, sueltas } = repartirPorCampo(fallo, visibles);

      for (const [campo, mensaje] of Object.entries(porCampo)) {
        setError(campo as Campos, { message: mensaje });
      }

      setAviso(sueltas.length === 0 ? null : sueltas.join(' '));
    }
  }

  return (
    <Tarjeta>
      <form
        aria-label="Datos"
        onSubmit={(evento) => void handleSubmit(enviar)(evento)}
        className="flex flex-col gap-3"
        noValidate
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Datos</h2>

        {aviso !== null && <Aviso tono="error">{aviso}</Aviso>}

        <Campo
          etiqueta="Nombre completo"
          error={errors.nombreCompleto?.message}
          {...register('nombreCompleto')}
        />
        <Campo etiqueta="Telefono" error={errors.telefono?.message} {...register('telefono')} />

        {veLaFichaMedica && (
          <AreaDeTexto
            etiqueta="Ficha medica"
            error={errors.fichaMedica?.message}
            {...register('fichaMedica')}
          />
        )}

        {!esProfesor && (
          <>
            <Seleccion
              etiqueta="Pack"
              opciones={opcionesDePack}
              error={errors.packId?.message}
              {...register('packId')}
            />
            <Campo
              etiqueta="Clases extra"
              inputMode="numeric"
              error={errors.clasesExtra?.message}
              {...register('clasesExtra')}
            />
            <Campo
              etiqueta="Cancelaciones usadas"
              inputMode="numeric"
              error={errors.cancelacionesUsadas?.message}
              {...register('cancelacionesUsadas')}
            />
            <Campo
              etiqueta="Vigencia desde"
              placeholder="YYYY-MM-DD"
              error={errors.vigenciaDesde?.message}
              {...register('vigenciaDesde')}
            />
            <Campo
              etiqueta="Vigencia hasta"
              placeholder="YYYY-MM-DD"
              error={errors.vigenciaHasta?.message}
              {...register('vigenciaHasta')}
            />
          </>
        )}

        <div>
          <Boton type="submit" cargando={isSubmitting}>
            Guardar datos
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}
