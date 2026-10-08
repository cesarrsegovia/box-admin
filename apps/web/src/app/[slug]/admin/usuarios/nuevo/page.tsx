'use client';

import { Suspense, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { type FieldErrors, type UseFormRegister, useForm } from 'react-hook-form';
import { z } from 'zod';
import type { AltaUsuarioRespuesta, TipoUsuarioNegocio } from '@boxadmin/shared';
import { PATRON_FECHA } from '@boxadmin/shared';
import { Campo } from '@/componentes/formulario';
import { Aviso, Boton } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { usePacks, useSalas } from '@/hooks/use-catalogos';
import { useCrearPersona } from '@/hooks/use-usuarios';
import { ClaveTemporal } from './clave-temporal';

/**
 * Lo que el formulario tiene en pantalla, TODO como texto.
 *
 * `clasesExtra` es texto aqui y numero en el cuerpo: un `<input>` siempre
 * devuelve texto, y `@IsInt()` rechaza `"3"` con un 400. La conversion esta en
 * un solo sitio (`cuerpoDelAlta`) y no repartida por los manejadores.
 *
 * Los opcionales no son `optional()`: son cadenas que pueden estar vacias, y es
 * `cuerpoDelAlta` quien decide que una cadena vacia NO SE MANDA. Mandar
 * `telefono: ""` pasa el `@IsOptional()` de la API y guarda una cadena vacia en
 * la base; mandar `vigenciaDesde: ""` no pasa el `@Matches` y es un 400.
 */
const esquema = z.object({
  nombreCompleto: z.string().trim().min(1, 'Hace falta el nombre completo'),
  email: z.string().trim().email('Ese email no parece valido'),
  telefono: z.string().trim(),
  fichaMedica: z.string().trim(),
  packId: z.string(),
  clasesExtra: z
    .string()
    .trim()
    .refine((valor) => valor === '' || /^\d+$/.test(valor), 'Tiene que ser un numero entero'),
  vigenciaDesde: z
    .string()
    .refine((valor) => valor === '' || PATRON_FECHA.test(valor), 'Usa el formato AAAA-MM-DD'),
  vigenciaHasta: z
    .string()
    .refine((valor) => valor === '' || PATRON_FECHA.test(valor), 'Usa el formato AAAA-MM-DD'),
});

type Datos = z.infer<typeof esquema>;

const VACIO: Datos = {
  nombreCompleto: '',
  email: '',
  telefono: '',
  fichaMedica: '',
  packId: '',
  clasesExtra: '',
  vigenciaDesde: '',
  vigenciaHasta: '',
};

/**
 * EL CUERPO SE ARMA POR LISTA BLANCA, Y LA LISTA DEPENDE DEL TIPO.
 *
 * `CrearProfesorDto` acepta CUATRO campos y nada mas. El ValidationPipe global
 * lleva `forbidNonWhitelisted: true`: un `packId` de mas en el alta de un
 * profesor no se ignora, devuelve 400 y el alta no se hace. Esa es la
 * limitacion de TurnoFit que la Fase 1 vino a romper, y la forma de que no
 * vuelva por la puerta de atras es que el cuerpo del profesor se construya
 * ENUMERANDO lo que lleva, nunca copiando el formulario y borrando lo que
 * sobra: lo segundo deja pasar el campo que se agregue mañana.
 */
function cuerpoDelAlta(
  tipo: TipoUsuarioNegocio,
  datos: Datos,
  salaIds: string[],
): Record<string, unknown> {
  const cuerpo: Record<string, unknown> = {
    nombreCompleto: datos.nombreCompleto,
    email: datos.email,
    // Obligatorio como campo aunque vaya vacio: el alta sale con la advertencia
    // SIN_SALAS, que es una decision consciente y no un olvido silencioso.
    salaIds,
  };

  if (datos.telefono !== '') cuerpo.telefono = datos.telefono;

  if (tipo === 'profesor') return cuerpo;

  if (datos.fichaMedica !== '') cuerpo.fichaMedica = datos.fichaMedica;
  if (datos.packId !== '') cuerpo.packId = datos.packId;
  if (datos.clasesExtra !== '') cuerpo.clasesExtra = Number(datos.clasesExtra);
  if (datos.vigenciaDesde !== '') cuerpo.vigenciaDesde = datos.vigenciaDesde;
  if (datos.vigenciaHasta !== '') cuerpo.vigenciaHasta = datos.vigenciaHasta;

  return cuerpo;
}

/**
 * LOS CAMPOS QUE SOLO ACEPTA EL ALTA DE ALUMNO.
 *
 * Son un componente aparte y no un bloque de JSX con un `&&` porque `usePacks`
 * vive DENTRO: un hook no se puede llamar a medias, y teniendolo arriba el alta
 * de un profesor pediria el catalogo de packs para no pintarlo en ningun sitio.
 *
 * No se pintan deshabilitados ni ocultos por CSS: no se pintan. Un campo
 * deshabilitado sigue estando en el formulario, y el dia que alguien le quite
 * el `disabled` el cuerpo del profesor se lleva un 400.
 */
function CamposDeAlumno({
  register,
  errors,
}: {
  register: UseFormRegister<Datos>;
  errors: FieldErrors<Datos>;
}) {
  const packs = usePacks();

  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor="pack" className="text-sm font-medium text-slate-700">
          Pack
        </label>
        <select
          id="pack"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
          {...register('packId')}
        >
          <option value="">Sin pack</option>
          {/* El catalogo trae tambien los dados de baja —la ficha los necesita
              para no mentir sobre el pack de quien ya lo tenia—, pero un alta
              NUEVA no puede estrenar un pack que el gimnasio ya retiro. */}
          {packs.data
            ?.filter((pack) => pack.activo)
            .map((pack) => (
              <option key={pack.id} value={pack.id}>
                {pack.nombre}
              </option>
            ))}
        </select>
      </div>

      <Campo
        etiqueta="Clases extra"
        type="number"
        min={0}
        error={errors.clasesExtra?.message}
        {...register('clasesExtra')}
      />

      <Campo
        etiqueta="Vigencia desde"
        type="date"
        error={errors.vigenciaDesde?.message}
        {...register('vigenciaDesde')}
      />
      <Campo
        etiqueta="Vigencia hasta"
        type="date"
        error={errors.vigenciaHasta?.message}
        {...register('vigenciaHasta')}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor="ficha-medica" className="text-sm font-medium text-slate-700">
          Ficha medica
        </label>
        <textarea
          id="ficha-medica"
          rows={3}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          {...register('fichaMedica')}
        />
      </div>
    </>
  );
}

/**
 * Lo que queda cuando la pantalla de la clave se perdio.
 *
 * Pasa al recargar: el alta YA SE HIZO, la persona existe, y la contraseña
 * temporal no esta en ningun sitio del que se pueda sacar. Callarselo —volver a
 * pintar el formulario vacio— deja a alguien creado y sin acceso sin que nadie
 * se entere hasta que intenta entrar.
 */
function ClavePerdida({ slug }: { slug: string }) {
  return (
    <Aviso tono="error">
      <p className="font-medium">
        El alta se hizo, pero la contraseña temporal ya no se puede ver.
      </p>
      <p className="mt-1">
        Se mostraba una sola vez y se perdio al recargar. Pedile a un admin del salon que le genere
        otra desde la ficha de la persona.
      </p>
      <p className="mt-2">
        <a href={`/${slug}/admin/usuarios`} className="underline">
          Volver al listado
        </a>
      </p>
    </Aviso>
  );
}

function AltaDePersona() {
  const { slug } = useParams<{ slug: string }>();
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();

  // La URL la escribe cualquiera: lo que no sea `profesor` es un alumno. Un
  // `?tipo=SUPERADMIN` no puede inventar un endpoint ni medio formulario.
  const tipo: TipoUsuarioNegocio = parametros.get('tipo') === 'profesor' ? 'profesor' : 'alumno';
  const esAlumno = tipo === 'alumno';

  /**
   * LA CLAVE VIVE AQUI Y EN NINGUN OTRO SITIO.
   *
   * Ni en la URL, ni en `localStorage`, ni en `sessionStorage`, ni en la cache
   * de consultas. Muere con el componente. Del cache de MUTACIONES —el unico
   * sitio donde se quedaria sola— la saca el `gcTime: 0` de `useCrearPersona`,
   * que protege tambien a las pantallas que todavia no existen.
   */
  const [alta, setAlta] = useState<AltaUsuarioRespuesta | null>(null);
  const [salaIds, setSalaIds] = useState<string[]>([]);

  const salas = useSalas();
  const crear = useCrearPersona(tipo);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Datos>({ resolver: zodResolver(esquema), defaultValues: VACIO });

  async function enviar(datos: Datos): Promise<void> {
    try {
      const respuesta = await crear.mutateAsync(cuerpoDelAlta(tipo, datos, salaIds));
      setAlta(respuesta);

      // RUTA PROPIA para la clave: un cartel sobre el formulario desaparece con
      // un F5 y nadie se entera de que la persona quedo creada. Lo que viaja es
      // un MARCADOR (`alta=hecha`); la clave NO, ni en la query ni en el hash:
      // la URL se guarda en el historial, se autocompleta y se comparte.
      const siguientes = new URLSearchParams(parametros.toString());
      siguientes.set('alta', 'hecha');
      router.push(`${ruta}?${siguientes.toString()}`);
    } catch {
      // El fallo vive en `crear.error` y se pinta abajo. Sin este `catch` seria
      // un rechazo sin manejar y el formulario quedaria como si nada.
    }
  }

  function terminar(): void {
    if (alta === null) return;

    router.push(`/${slug}/admin/usuarios/${alta.id}`);

    // Desengancha el observador de su mutacion. Con el `gcTime: 0` del hook eso
    // la saca del cache en el acto; sin el, `reset()` solo programaria el
    // recolector para dentro de cinco minutos y no limpiaria nada.
    crear.reset();
  }

  if (alta !== null) {
    return (
      <ClaveTemporal
        nombre={alta.nombreCompleto}
        clave={alta.passwordTemporal}
        advertencias={alta.advertencias}
        alTerminar={terminar}
      />
    );
  }

  // El marcador sigue en la URL pero el estado ya no: es una recarga.
  if (parametros.get('alta') === 'hecha') return <ClavePerdida slug={slug} />;

  const errorDelAlta = crear.error instanceof ErrorDeApi ? crear.error.message : null;

  return (
    <form onSubmit={handleSubmit(enviar)} className="flex max-w-xl flex-col gap-4" noValidate>
      {errorDelAlta !== null && <Aviso tono="error">{errorDelAlta}</Aviso>}

      <Campo
        etiqueta="Nombre completo"
        error={errors.nombreCompleto?.message}
        {...register('nombreCompleto')}
      />
      <Campo etiqueta="Email" type="email" error={errors.email?.message} {...register('email')} />
      <Campo etiqueta="Telefono" type="tel" {...register('telefono')} />

      <fieldset className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-medium text-slate-700">Salas</legend>

        {salas.isPending && <p className="text-sm text-slate-500">Cargando salas…</p>}

        {salas.error !== null && (
          // Que no haya catalogo NO bloquea el alta: se puede crear sin salas y
          // asignarlas despues desde la ficha. Lo que no se puede es callarlo.
          <Aviso tono="error">No se pudieron cargar las salas. Podes asignarlas despues.</Aviso>
        )}

        {salas.data?.map((sala) => (
          <label key={sala.id} className="flex items-center gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={salaIds.includes(sala.id)}
              onChange={(evento) =>
                setSalaIds((actuales) =>
                  evento.target.checked
                    ? [...actuales, sala.id]
                    : actuales.filter((id) => id !== sala.id),
                )
              }
              className="h-4 w-4"
            />
            {sala.nombre}
          </label>
        ))}

        {salaIds.length === 0 && (
          <p className="text-xs text-slate-500">
            Sin salas el alta sale igual, pero la persona no va a poder reservar hasta que se le
            asigne alguna.
          </p>
        )}
      </fieldset>

      {esAlumno && <CamposDeAlumno register={register} errors={errors} />}

      <div className="flex gap-2">
        <Boton type="submit" cargando={crear.isPending}>
          Dar de alta
        </Boton>
      </div>
    </form>
  );
}

/**
 * `useSearchParams` obliga a una frontera de Suspense.
 *
 * Sin ella `next build` falla con "missing-suspense-with-csr-bailout", y el
 * error aparece lejos de aqui.
 */
export default function PaginaDeAlta() {
  return (
    <section className="flex flex-col gap-4">
      <Suspense fallback={<p className="text-sm text-slate-500">Cargando…</p>}>
        <Encabezado />
        <AltaDePersona />
      </Suspense>
    </section>
  );
}

function Encabezado() {
  const parametros = useSearchParams();
  const esProfesor = parametros.get('tipo') === 'profesor';

  return (
    <h1 className="text-2xl font-semibold text-slate-900">
      {esProfesor ? 'Dar de alta a un profesor' : 'Dar de alta a un alumno'}
    </h1>
  );
}
