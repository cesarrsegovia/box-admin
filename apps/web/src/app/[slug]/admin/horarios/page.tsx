'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { rolAlcanza, type HorarioProfesorPublico } from '@boxadmin/shared';
import { Confirmar } from '@/componentes/confirmar';
import { Tabla, type ColumnaDeTabla } from '@/componentes/tabla';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { destinoDeLoginDesde } from '@/lib/destino-de-login';
import { useSalas } from '@/hooks/use-catalogos';
import { useUsuarios } from '@/hooks/use-usuarios';
import {
  useActualizarHorario,
  useBorrarHorario,
  useCrearHorario,
  useHorarios,
} from '@/hooks/use-horarios';
import { filtrosDeLaBusqueda } from './filtros';
import { mensajeDeFallo, repartirPorCampo } from '../usuarios/[id]/errores';
import { useRolDeQuienMira } from '../rol-del-panel';
import {
  CAMPOS_DE_HORARIO,
  FormularioDeHorario,
  NOMBRES_DE_DIA,
  conMayuscula,
  descripcionDeFranja,
  textoDeTarifa,
  textoDeVigencia,
  type CampoDeHorario,
  type OpcionDeCatalogo,
} from './formulario';

/**
 * LOS HORARIOS FIJOS DE LAS PROFESORAS: el corazon de la fase.
 *
 * Esta pantalla decide dos cosas que no se ven aqui: QUE PROFESORA se asigna
 * sola a cada turno al publicar un mes —`resolverParaFranja` lee justo estas
 * filas— y CON QUE TARIFA entra cada hora en la liquidacion. Por eso los tres
 * choques se distinguen con su texto y por eso la tarifa es dinero y no un
 * numero.
 *
 * TODO AQUI PIDE `ADMIN_OPERATIVO`, LA LECTURA TAMBIEN. Es la diferencia con
 * salas y con ausencias: `GET /salas` no lleva `@Roles` y cualquiera del
 * gimnasio lo lista, pero las CUATRO operaciones de
 * `horarios-profesor.controller.ts` llevan `@Roles('ADMIN_OPERATIVO')`,
 * incluido el `@Get()`. Por eso la pantalla no pide NADA cuando el rol no
 * alcanza: seria un 403 pintado como si la pantalla estuviera rota.
 *
 * `profesorId` ES UN `perfilId`, NO EL ID DEL USUARIO. El modelo relaciona
 * `profesor Perfil @relation(fields: [tenantId, profesorId])` y el servicio lo
 * busca con `perfil.findFirst({ where: { id: profesorId } })`. El catalogo de
 * `useUsuarios` trae los dos campos y el que va al selector es `perfilId`.
 */

const CLASES_DE_CONTROL =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

/**
 * LOS FILTROS ESCRIBEN LA URL, NUNCA `useState`.
 *
 * Un filtro en la URL se comparte por chat ("mira, los horarios de Ana"),
 * sobrevive al boton de atras y vuelve puesto desde el login. En estado se
 * pierde al navegar y la barra de direcciones y la pantalla dicen cosas
 * distintas.
 */
function FiltrosDelListado({
  profesoras,
  salas,
}: {
  profesoras: readonly OpcionDeCatalogo[];
  salas: readonly OpcionDeCatalogo[];
}) {
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();

  const filtros = filtrosDeLaBusqueda(parametros);

  /** Escribe la URL partiendo de la que YA HAY: un filtro no borra al otro. */
  function cambiar(clave: string, valor: string): void {
    const siguientes = new URLSearchParams(parametros.toString());

    if (valor === '') siguientes.delete(clave);
    else siguientes.set(clave, valor);

    const texto = siguientes.toString();

    // UNA sola navegacion por cambio: un `push` de cortesia antes del bueno
    // deja una entrada basura en el historial y un parpadeo en la pantalla.
    router.push(texto === '' ? ruta : `${ruta}?${texto}`);
  }

  return (
    <form aria-label="Filtros" className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        {/* `htmlFor` y no una etiqueta que envuelva al control: envolviendolo,
            el nombre accesible se lleva por delante el texto de las opciones. */}
        {/* «Filtrar por…» y no «Profesora» a secas: el formulario de alta tiene
            su propio selector de profesora y de sala, y dos controles con el
            mismo nombre accesible son indistinguibles para quien navega con
            lector de pantalla —y para quien escribe un test—. */}
        <label htmlFor="filtro-profesora" className="text-xs font-medium text-slate-600">
          Filtrar por profesora
        </label>
        <select
          id="filtro-profesora"
          value={filtros.profesorId ?? ''}
          onChange={(evento) => cambiar('profesorId', evento.target.value)}
          className={CLASES_DE_CONTROL}
        >
          <option value="">Todas</option>
          {profesoras.map((profesora) => (
            <option key={profesora.valor} value={profesora.valor}>
              {profesora.texto}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-sala" className="text-xs font-medium text-slate-600">
          Filtrar por sala
        </label>
        <select
          id="filtro-sala"
          value={filtros.salaId ?? ''}
          onChange={(evento) => cambiar('salaId', evento.target.value)}
          className={CLASES_DE_CONTROL}
        >
          <option value="">Todas</option>
          {salas.map((sala) => (
            <option key={sala.valor} value={sala.valor}>
              {sala.texto}
            </option>
          ))}
        </select>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// La tabla
// ---------------------------------------------------------------------------

/**
 * Las columnas, declaradas y cerradas.
 *
 * `HorarioProfesorPublico` trae ademas `id`, `profesorId` y `salaId`. Ninguno
 * esta aqui: son identificadores que no le dicen nada a quien esta en el
 * mostrador, y lo que se pinta viaja al navegador aunque este tapado por CSS.
 *
 * Es una funcion y no una constante porque la columna de acciones necesita los
 * dos manejadores, y para que los textos vivan al lado de la columna que los
 * usa.
 */
function columnasDeHorarios({
  alEditar,
  alDarDeBaja,
}: {
  alEditar: (horario: HorarioProfesorPublico) => void;
  alDarDeBaja: (horario: HorarioProfesorPublico) => void;
}): readonly ColumnaDeTabla<HorarioProfesorPublico>[] {
  return [
    { encabezado: 'Profesora', celda: (horario) => horario.profesorNombre },
    { encabezado: 'Sala', celda: (horario) => horario.salaNombre },
    {
      encabezado: 'Dia',
      celda: (horario) => conMayuscula(NOMBRES_DE_DIA[horario.diaSemana] ?? 'Dia desconocido'),
    },
    { encabezado: 'Hora', celda: (horario) => `${horario.horaInicio} a ${horario.horaFin}` },
    { encabezado: 'Vigencia', celda: textoDeVigencia },
    /**
     * La tarifa, con la herencia DICHA.
     *
     * `null` no es cero ni es un hueco: es «usa la del gimnasio». Es lo que la
     * liquidacion va a pagar, y confundir los tres estados en esta celda es
     * confundirse al cerrar el mes.
     */
    { encabezado: 'Tarifa', celda: (horario) => textoDeTarifa(horario.tarifaPorHora) },
    /**
     * LA BAJA ES LOGICA: la fila sigue llegando en el listado con
     * `activo: false`, porque la liquidacion de los meses ya cerrados la
     * necesita. Si no se distingue de uno vigente, el admin cuenta horas que
     * ya no se dictan.
     */
    { encabezado: 'Estado', celda: (horario) => (horario.activo ? 'Vigente' : 'De baja') },
    {
      encabezado: 'Acciones',
      celda: (horario) => (
        <span className="flex flex-wrap gap-2">
          <Boton
            type="button"
            tono="secundario"
            // El nombre accesible lleva a quien y cuando: con diez filas de
            // "Editar" nadie sabe cual esta pulsando, y con lector de pantalla
            // menos.
            aria-label={`Editar el horario de ${horario.profesorNombre}, ${descripcionDeFranja(horario)}`}
            onClick={() => alEditar(horario)}
          >
            Editar
          </Boton>
          {/* A lo que ya esta de baja no se le ofrece darle de baja otra vez:
              seria un boton que no cambia nada y que vuelve a escribir el
              `hasta`. Editar si se ofrece, que es como se corrige una fila. */}
          {horario.activo && (
            <Boton
              type="button"
              tono="peligro"
              aria-label={`Dar de baja el horario de ${horario.profesorNombre}, ${descripcionDeFranja(horario)}`}
              onClick={() => alDarDeBaja(horario)}
            >
              Dar de baja
            </Boton>
          )}
        </span>
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// El alta
// ---------------------------------------------------------------------------

/** El 403 traducido, los campos repartidos y lo suelto al cartel. */
function repartirElFallo(error: unknown): {
  porCampo: Partial<Record<CampoDeHorario, string>>;
  aviso: string | null;
} {
  if (!(error instanceof ErrorDeApi))
    return { porCampo: {}, aviso: mensajeDeFallo(error, 'ADMIN_OPERATIVO') };

  /**
   * EL 403 SE TRADUCE ANTES DE REPARTIR: su cuerpo dice «Forbidden», que no
   * nombra ningun campo y acabaria en el cartel tal cual, en ingles.
   */
  if (error.estado === 403) {
    return { porCampo: {}, aviso: mensajeDeFallo(error, 'ADMIN_OPERATIVO') };
  }

  /**
   * LOS TRES CHOQUES LLEGAN POR AQUI, Y CADA UNO CON SU TEXTO.
   *
   * `exigirSinSolape` lanza TRES 409 distintos y los tres dicen que cambiar:
   * «Ya hay otra profesora asignada a esa sala...», «Esa profesora ya esta
   * asignada a otra sala a esa hora...» y «Esa profesora ya tiene ese horario
   * en esa sala». Ninguno nombra un campo del DTO, asi que `repartirPorCampo`
   * los deja sueltos y acaban en el cartel ENTEROS. Sustituirlos por un «se
   * pisa con otro horario» es lo que deja al admin sin saber QUE cambiar: si
   * la sala, si la hora, o si el horario ya estaba puesto.
   */
  const { porCampo, sueltas } = repartirPorCampo(error, CAMPOS_DE_HORARIO);
  return { porCampo, aviso: sueltas.length === 0 ? null : sueltas.join(' ') };
}

function AltaDeHorario({
  profesoras,
  salas,
  yaCargados,
  conFiltros,
}: {
  profesoras: readonly OpcionDeCatalogo[];
  salas: readonly OpcionDeCatalogo[];
  yaCargados: readonly HorarioProfesorPublico[];
  conFiltros: boolean;
}) {
  const crear = useCrearHorario();

  const [intento, setIntento] = useState(0);
  const [porCampo, setPorCampo] = useState<Partial<Record<CampoDeHorario, string>>>({});
  const [aviso, setAviso] = useState<string | null>(null);

  async function enviar(cuerpo: Record<string, unknown>): Promise<void> {
    setPorCampo({});
    setAviso(null);

    try {
      await crear.mutateAsync(cuerpo);
      // `key` nueva: el formulario se desmonta y vuelve limpio. Es mas honesto
      // que resetear ocho campos a mano y olvidarse del noveno.
      setIntento((previo) => previo + 1);
    } catch (error) {
      const repartido = repartirElFallo(error);
      setPorCampo(repartido.porCampo);
      setAviso(repartido.aviso);
    }
  }

  return (
    <Tarjeta>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Nuevo horario
        </h2>

        <FormularioDeHorario
          key={intento}
          modo="alta"
          profesoras={profesoras}
          salas={salas}
          yaCargados={yaCargados}
          conFiltros={conFiltros}
          guardando={crear.isPending}
          porCampo={porCampo}
          aviso={aviso}
          alEnviar={(cuerpo) => void enviar(cuerpo)}
        />
      </div>
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
// La edicion
// ---------------------------------------------------------------------------

/**
 * Se monta con el horario ya elegido para que `useActualizarHorario(id)` tenga
 * un id estable: un hook con un id que cambia debajo es una mutacion apuntando
 * a otra fila.
 */
function EdicionDeHorario({
  horario,
  yaCargados,
  conFiltros,
  alTerminar,
}: {
  horario: HorarioProfesorPublico;
  yaCargados: readonly HorarioProfesorPublico[];
  conFiltros: boolean;
  alTerminar: () => void;
}) {
  const guardar = useActualizarHorario(horario.id);

  const [porCampo, setPorCampo] = useState<Partial<Record<CampoDeHorario, string>>>({});
  const [aviso, setAviso] = useState<string | null>(null);

  async function enviar(cuerpo: Record<string, unknown>): Promise<void> {
    setPorCampo({});
    setAviso(null);

    try {
      await guardar.mutateAsync(cuerpo);
      alTerminar();
    } catch (error) {
      const repartido = repartirElFallo(error);
      setPorCampo(repartido.porCampo);
      setAviso(repartido.aviso);
    }
  }

  return (
    <Tarjeta>
      <div className="flex flex-col gap-3">
        {/* El encabezado dice de QUIEN es el horario y VA FUERA del formulario:
            lo que esta dentro es lo que se puede cambiar, y la profesora y la
            sala no se pueden. */}
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Editando el horario de {horario.profesorNombre} en {horario.salaNombre}
        </h2>
        <p className="text-xs text-slate-500">
          La profesora y la sala no se cambian: moverlas dejaria los turnos ya etiquetados colgando
          de un patron que ya no existe. Para eso se da de baja este horario y se crea otro.
        </p>

        <FormularioDeHorario
          modo="edicion"
          horario={horario}
          yaCargados={yaCargados}
          conFiltros={conFiltros}
          guardando={guardar.isPending}
          porCampo={porCampo}
          aviso={aviso}
          alEnviar={(cuerpo) => void enviar(cuerpo)}
          alCancelar={alTerminar}
        />
      </div>
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
// La baja
// ---------------------------------------------------------------------------

/**
 * Se monta con el horario ya elegido, por lo mismo que la edicion: asi
 * `useBorrarHorario(id)` apunta a ESA fila y no a la que estaba antes.
 */
function BajaDeHorario({
  horario,
  alTerminar,
}: {
  horario: HorarioProfesorPublico;
  alTerminar: () => void;
}) {
  const darDeBaja = useBorrarHorario(horario.id);
  const [fallo, setFallo] = useState<string | undefined>(undefined);

  async function confirmar(): Promise<void> {
    setFallo(undefined);

    try {
      await darDeBaja.mutateAsync();
      alTerminar();
    } catch (error) {
      setFallo(mensajeDeFallo(error, 'ADMIN_OPERATIVO'));
    }
  }

  return (
    <Confirmar
      // La pregunta NOMBRA a la profesora, el dia y la hora. Con diez filas
      // iguales, un «¿estas seguro?» es una ruleta.
      pregunta={`Dar de baja el horario de ${horario.profesorNombre}, ${descripcionDeFranja(horario)} en ${horario.salaNombre}`}
      detalle="Los turnos ya etiquetados NO se tocan: deja de asignarle los futuros y se le cierra la vigencia hoy."
      textoDeConfirmar="Dar de baja"
      cargando={darDeBaja.isPending}
      error={fallo}
      alConfirmar={() => void confirmar()}
      alCancelar={alTerminar}
    />
  );
}

// ---------------------------------------------------------------------------
// La pantalla
// ---------------------------------------------------------------------------

function PanelDeHorarios() {
  const { slug } = useParams<{ slug: string }>();
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();

  const filtros = filtrosDeLaBusqueda(parametros);
  const conFiltros = Object.keys(filtros).length > 0;

  const horarios = useHorarios(filtros);
  const { data: salas, error: errorDeSalas } = useSalas();
  const { data: profesoras, error: errorDeProfesoras } = useUsuarios({ tipo: 'profesor' });

  const [enEdicion, setEnEdicion] = useState<HorarioProfesorPublico | null>(null);
  const [enBaja, setEnBaja] = useState<HorarioProfesorPublico | null>(null);

  /**
   * LAS TRES CONSULTAS PUEDEN TRAER EL 401, no solo la de la lista.
   *
   * Un solo booleano y un solo efecto: si cada una empujara por su cuenta, una
   * sesion caducada con las tres fallando mandaria al login tres veces y
   * dejaria dos entradas basura en el historial.
   */
  const sesionCaducada =
    (horarios.error instanceof ErrorDeApi && horarios.error.esSesionCaducada) ||
    (errorDeSalas instanceof ErrorDeApi && errorDeSalas.esSesionCaducada) ||
    (errorDeProfesoras instanceof ErrorDeApi && errorDeProfesoras.esSesionCaducada);

  useEffect(() => {
    if (!sesionCaducada) return;

    // La puerta del panel mira la sesion en el servidor una vez, al entrar: el
    // token puede caducar con la pantalla abierta. El destino conserva el query
    // porque los filtros viven ahi: volver del login a la lista entera es
    // perder la profesora que la persona acababa de elegir.
    router.push(destinoDeLoginDesde(ruta, parametros.toString(), slug));
  }, [sesionCaducada, router, ruta, parametros, slug]);

  const lista = horarios.data ?? [];

  /** Al selector va el `perfilId`, que es lo que `profesorId` nombra aqui. */
  const opcionesDeProfesora: OpcionDeCatalogo[] = (profesoras ?? []).map((profesora) => ({
    valor: profesora.perfilId,
    texto: profesora.nombreCompleto,
  }));

  const opcionesDeSala: OpcionDeCatalogo[] = (salas ?? []).map((sala) => ({
    valor: sala.id,
    texto: sala.nombre,
  }));

  return (
    <div className="flex flex-col gap-4">
      <FiltrosDelListado profesoras={opcionesDeProfesora} salas={opcionesDeSala} />

      {enEdicion === null ? (
        <AltaDeHorario
          profesoras={opcionesDeProfesora}
          salas={opcionesDeSala}
          yaCargados={lista}
          conFiltros={conFiltros}
        />
      ) : (
        <EdicionDeHorario
          key={enEdicion.id}
          horario={enEdicion}
          yaCargados={lista}
          conFiltros={conFiltros}
          alTerminar={() => setEnEdicion(null)}
        />
      )}

      {enBaja !== null && (
        <BajaDeHorario key={enBaja.id} horario={enBaja} alTerminar={() => setEnBaja(null)} />
      )}

      {horarios.isPending && <p className="text-sm text-slate-500">Cargando…</p>}

      {/* Sin sesion no se enseña el «Unauthorized» crudo de la API, que no le
          dice nada a nadie, y tampoco se ofrece reintentar: seria volver a
          fallar mientras la pantalla ya se esta yendo al login. */}
      {sesionCaducada && <Aviso tono="error">Tu sesion caduco. Te llevamos al login.</Aviso>}

      {horarios.error !== null && !sesionCaducada && (
        <div className="flex flex-col items-start gap-2">
          <Aviso tono="error">{horarios.error.message}</Aviso>
          <Boton tono="secundario" onClick={() => void horarios.refetch()}>
            Reintentar
          </Boton>
        </div>
      )}

      {horarios.data !== undefined && (
        <Tabla
          columnas={columnasDeHorarios({
            alEditar: (horario) => {
              setEnBaja(null);
              setEnEdicion(horario);
            },
            alDarDeBaja: (horario) => setEnBaja(horario),
          })}
          filas={horarios.data}
          claveDeFila={(horario) => horario.id}
          vacio={
            <Aviso>
              {conFiltros
                ? 'No hay horarios que coincidan con estos filtros.'
                : 'Todavia no hay horarios fijos cargados.'}
            </Aviso>
          }
        />
      )}
    </div>
  );
}

/**
 * LA PUERTA DE ROL, y es la que decide si se pide algo.
 *
 * `rol === null` es «sin proveedor», y eso tiene que significar «no alcanza
 * para nada», no «no se sabe, dibujalo igual». El panel entero exige
 * `ADMIN_OPERATIVO` para entrar, asi que en la practica los tres roles que
 * llegan aqui pasan esta puerta: lo que cierra es el camino de que esta
 * pantalla acabe montada fuera del armazon.
 *
 * El contenido vive en otro componente a proposito, para que sus hooks de
 * consulta NO se ejecuten cuando el rol no alcanza. Un `enabled: false` dejaria
 * la peticion escrita y a un refactor de distancia de salir.
 */
function ListadoDeHorarios() {
  const rol = useRolDeQuienMira();

  if (rol === null || !rolAlcanza(rol, 'ADMIN_OPERATIVO')) {
    return (
      <Aviso tono="error">
        Para ver los horarios de las profesoras hace falta ser administrador operativo. Tu rol no
        alcanza.
      </Aviso>
    );
  }

  return <PanelDeHorarios />;
}

/**
 * `useSearchParams` obliga a una frontera de Suspense.
 *
 * Sin ella, `next build` falla en cuanto algo deje esta ruta prerenderizable, y
 * el error ("missing-suspense-with-csr-bailout") aparece lejos de aqui y cuesta
 * de ubicar. El encabezado queda FUERA para que no parpadee.
 */
export default function PaginaDeHorarios() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Horarios de profesor</h1>

      <Suspense fallback={<p className="text-sm text-slate-500">Cargando…</p>}>
        <ListadoDeHorarios />
      </Suspense>
    </section>
  );
}
