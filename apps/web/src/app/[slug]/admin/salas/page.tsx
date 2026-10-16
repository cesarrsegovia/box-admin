'use client';

import { useEffect, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { rolAlcanza, type SalaPublica } from '@boxadmin/shared';
import { Campo } from '@/componentes/formulario';
import { Tabla, type ColumnaDeTabla } from '@/componentes/tabla';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { SIN_QUERY, destinoDeLoginDesde } from '@/lib/destino-de-login';
import { useSalas } from '@/hooks/use-catalogos';
import { useCrearSala } from '@/hooks/use-salas-admin';
import { mensajeDeFallo, repartirPorCampo } from '../usuarios/[id]/errores';
import { useRolDeQuienMira } from '../rol-del-panel';
import { textoDeAjuste } from './ajuste-heredable';

/**
 * EL LISTADO DE SALAS.
 *
 * USA `useSalas()` DEL CATALOGO, y no un hook de lista propio. `GET /salas` no
 * acepta ningun filtro y el service ya recorta por rol: para un
 * `ADMIN_OPERATIVO` o superior devuelve TODAS, incluidas las de baja. O sea que
 * una «lista de administracion» seria byte por byte la misma peticion que la
 * del catalogo, bajo otra clave: dos peticiones identicas en la misma pantalla
 * y dos copias del mismo dato que pueden quedar desincronizadas. Por eso
 * `use-salas-admin.ts` no tiene hook de lista, y por eso toda escritura de alli
 * invalida la clave del catalogo.
 *
 * NO HAY FILTROS y por tanto no hay nada que guardar en la URL: sin
 * `useSearchParams` esta pantalla tampoco necesita la frontera de Suspense que
 * el listado de turnos si paga.
 */

/**
 * Las columnas, declaradas y cerradas.
 *
 * `SalaPublica` trae ademas `id`, `tenantId`, `exclusiva`, `soloCuposLiberados`
 * y los dos de minutos. Ninguno esta aqui:
 *
 * - `tenantId` es justo el dato que la Fase 0 se ocupo de que no cruzara entre
 *   gimnasios, y lo que se pinta viaja al navegador aunque este tapado por CSS;
 * - `exclusiva` es un campo MUERTO —ver la ficha—;
 * - los otros tres son ajuste fino y viven en la ficha. Una tabla de nueve
 *   columnas en el mostrador no se lee.
 *
 * Es una funcion y no una constante por simetria con el listado de turnos y
 * para que los textos del estado nulo esten al lado de la columna que los usa.
 */
function columnasDeSalas(): readonly ColumnaDeTabla<SalaPublica>[] {
  return [
    { encabezado: 'Nombre', celda: (sala) => sala.nombre },
    /**
     * LA BAJA SE DICE CON UNA PALABRA, no solo con un color ni con la ausencia
     * de algo. La baja es LOGICA: la sala sigue en la lista, y si no se
     * distingue de una activa el admin la elige para un pack o para un horario
     * y descubre el problema al publicar el mes.
     */
    { encabezado: 'Estado', celda: (sala) => (sala.activa ? 'Activa' : 'De baja') },
    { encabezado: 'Visible para alumnos', celda: (sala) => (sala.visibleAlumnos ? 'Sí' : 'No') },
    {
      encabezado: 'Cupo base',
      // `null` aqui NO es «hereda»: el Tenant no tiene `cupoBase` a proposito.
      celda: (sala) => textoDeAjuste(sala.cupoBase, { textoDeNulo: 'Sin definir' }),
    },
    {
      encabezado: 'Lista de espera',
      celda: (sala) =>
        textoDeAjuste(sala.listaEsperaHabilitada, { textoDeNulo: 'Hereda del gimnasio' }),
    },
  ];
}

/**
 * EL ALTA, con el nombre y nada mas.
 *
 * `CrearSalaDto` acepta los ocho ajustes, pero pedirlos todos en el alta seria
 * obligar a decidir la lista de espera y los minutos de cancelacion de una sala
 * que todavia no existe. Los defaults del schema son razonables y los cuatro
 * heredables nacen en null, que es el estado «todavia no lo decidi». Se afina
 * en la ficha.
 *
 * `POST /salas` pide `ADMIN_SALON`: este bloque NO SE RENDERIZA para un
 * `ADMIN_OPERATIVO`. No se esconde ni se deshabilita —un boton deshabilitado
 * sigue en el DOM, a un clic de las herramientas del navegador—.
 */
function AltaDeSala() {
  const crear = useCrearSala();

  const [nombre, setNombre] = useState('');
  const [errorDelNombre, setErrorDelNombre] = useState<string | undefined>(undefined);
  const [aviso, setAviso] = useState<string | null>(null);

  async function enviar(): Promise<void> {
    setAviso(null);
    setErrorDelNombre(undefined);

    const limpio = nombre.trim();
    if (limpio === '') {
      setErrorDelNombre('Ponele un nombre.');
      return;
    }

    try {
      await crear.mutateAsync({ nombre: limpio });
      setNombre('');
    } catch (error) {
      if (!(error instanceof ErrorDeApi)) throw error;

      /**
       * EL 403 SE TRADUCE, antes de repartir nada.
       *
       * Su cuerpo dice «Forbidden» y eso no nombra ningun campo, asi que
       * `repartirPorCampo` lo dejaria suelto y acabaria en el cartel tal cual:
       * una palabra en ingles que manda a quien la lee a mirar la red cuando
       * lo que tiene que hacer es llamar al dueño del salon.
       */
      if (error.estado === 403) {
        setAviso(mensajeDeFallo(error, 'ADMIN_SALON'));
        return;
      }

      // El 400 del ValidationPipe SI nombra el campo invalido.
      const { porCampo, sueltas } = repartirPorCampo(error, ['nombre'] as const);
      setErrorDelNombre(porCampo.nombre);
      setAviso(sueltas.length === 0 ? null : sueltas.join(' '));
    }
  }

  return (
    <Tarjeta>
      <form
        aria-label="Nueva sala"
        onSubmit={(evento) => {
          evento.preventDefault();
          void enviar();
        }}
        className="flex flex-col gap-3"
        noValidate
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Nueva sala</h2>

        {aviso !== null && <Aviso tono="error">{aviso}</Aviso>}

        <Campo
          etiqueta="Nombre de la sala"
          value={nombre}
          error={errorDelNombre}
          onChange={(evento) => setNombre(evento.target.value)}
        />

        <div>
          <Boton type="submit" cargando={crear.isPending}>
            Crear sala
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}

export default function PaginaDeSalas() {
  const { slug } = useParams<{ slug: string }>();
  const ruta = usePathname();
  const router = useRouter();
  const rol = useRolDeQuienMira();

  const { data: salas, isPending, error, refetch } = useSalas();

  /**
   * SIN PROVEEDOR DE ROL, NADA.
   *
   * El contexto lo pone el armazon del panel. Si esta pantalla acabara fuera de
   * ese armazon el rol llega `null`, y eso tiene que significar «no alcanza
   * para nada», no «no se sabe, dibujalo igual».
   */
  const puedeEscribir = rol !== null && rolAlcanza(rol, 'ADMIN_SALON');

  const sesionCaducada = error instanceof ErrorDeApi && error.esSesionCaducada;

  useEffect(() => {
    if (!sesionCaducada) return;

    // La puerta del panel mira la sesion en el servidor una vez, al entrar: el
    // token puede caducar con la pantalla abierta. `SIN_QUERY` es una decision
    // con nombre, no un hueco: este listado no tiene filtros que conservar.
    router.push(destinoDeLoginDesde(ruta, SIN_QUERY, slug));
  }, [sesionCaducada, router, ruta, slug]);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Salas</h1>

      {puedeEscribir && <AltaDeSala />}

      {isPending && <p className="text-sm text-slate-500">Cargando…</p>}

      {/* Sin sesion no se enseña el «Unauthorized» crudo de la API, que no le
          dice nada a nadie, y tampoco se ofrece reintentar: seria volver a
          fallar mientras la pantalla ya se esta yendo al login. */}
      {sesionCaducada && <Aviso tono="error">Tu sesion caduco. Te llevamos al login.</Aviso>}

      {error !== null && !sesionCaducada && (
        <div className="flex flex-col items-start gap-2">
          <Aviso tono="error">{error.message}</Aviso>
          <Boton tono="secundario" onClick={() => void refetch()}>
            Reintentar
          </Boton>
        </div>
      )}

      {salas !== undefined && (
        <Tabla
          columnas={columnasDeSalas()}
          filas={salas}
          claveDeFila={(sala) => sala.id}
          enlaceDeFila={(sala) => `/${slug}/admin/salas/${sala.id}`}
          vacio={<Aviso>Todavia no hay salas en el gimnasio.</Aviso>}
        />
      )}
    </section>
  );
}
