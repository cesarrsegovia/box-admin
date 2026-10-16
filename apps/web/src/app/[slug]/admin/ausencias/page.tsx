'use client';

import { Suspense, useEffect, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PATRON_FECHA, rolAlcanza, type AusenciaPublica, type SalaPublica } from '@boxadmin/shared';
import { Confirmar } from '@/componentes/confirmar';
import { Campo } from '@/componentes/formulario';
import { Tabla, type ColumnaDeTabla } from '@/componentes/tabla';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { destinoDeLoginDesde } from '@/lib/destino-de-login';
import { useSalas } from '@/hooks/use-catalogos';
import { useAusencias, useBorrarAusencia, useCrearAusencia } from '@/hooks/use-ausencias';
import { filtrosDeLaBusqueda } from './filtros';
import { mensajeDeFallo, repartirPorCampo } from '../usuarios/[id]/errores';
import { useRolDeQuienMira } from '../rol-del-panel';
import { Seleccion } from '../usuarios/[id]/controles';

/**
 * LOS CIERRES: una sala —o el salon entero— que no abre esos dias.
 *
 * Son las exclusiones que el calendario de la Fase 8 respeta: cuando el plan
 * de un mes encuentra una ausencia que tapa una fecha, esa rutina no genera
 * turno y sale como `AUSENCIA_SALA` en la lista de exclusiones. Tambien
 * mueven dinero —`liquidacion.datos.ts` descuenta las horas que caen dentro de
 * un cierre—, aunque esta pantalla no lo enseñe.
 *
 * LOS DOS ROLES DE LA PANTALLA, verificados contra
 * `apps/api/src/ausencias/ausencias.controller.ts`:
 *
 * - `GET /ausencias` NO lleva `@Roles`. Es deliberado y esta escrito alli: «a
 *   un profesor le interesa saber que el salon cierra». Asi que esta pantalla
 *   LEE para cualquiera que entre al panel, y no hay puerta de rol delante de
 *   las consultas. Es lo contrario de horarios, donde hasta el `@Get()` pide
 *   `ADMIN_OPERATIVO` y pedir sin rol seria un 403 pintado como una averia.
 * - `POST` y `DELETE` piden `ADMIN_SALON`, como las cuatro escrituras de
 *   salas. Los controles de escritura NO SE RENDERIZAN para un
 *   `ADMIN_OPERATIVO`: no se esconden ni se deshabilitan, que seria dejarlos
 *   en el DOM a un clic de las herramientas del navegador.
 *
 * NO HAY PATCH DE AUSENCIAS en la API: un cierre mal cargado se borra y se
 * vuelve a crear. Por eso la columna de acciones tiene un solo boton.
 *
 * ---------------------------------------------------------------------------
 * `recuperable` NO SE DIBUJA, Y ES DEUDA ANOTADA, NO UN CONTROL.
 *
 * El campo existe de punta a punta —columna en el schema con `@default(true)`,
 * `@IsOptional()` en el DTO, `dto.recuperable ?? true` al escribir y
 * `recuperable` en `AusenciaPublica`— y NADIE LO LEE: ni
 * `generacion-mes.service.ts`, que es quien aplica las ausencias al plan del
 * mes, ni `calendario.datos.ts`, ni `liquidacion.datos.ts`. Los tres mapean la
 * fila a `{ salaId, desde, hasta }` y tiran el resto.
 *
 * Es el peor de los campos muertos de la fase porque EL NOMBRE PROMETE ALGO
 * CONCRETO: un admin que marque un cierre como recuperable va a creer que a
 * los alumnos se les devuelve la clase, y no se les devuelve nada —la
 * devolucion de una clase es otra cosa, el `tipo=recuperable` de cancelar una
 * reserva—. Ofrecerlo con una advertencia al lado tampoco sirve: una
 * advertencia permanente se vuelve invisible a las dos semanas y lo que queda
 * es la casilla.
 *
 * Hay un test —«NO dibuja el campo recuperable»— que afirma sobre el MARCADO
 * para que el proximo que lea `AusenciaPublica` no lo agregue «porque
 * faltaba».
 * ---------------------------------------------------------------------------
 * LA FRANJA HORARIA TAMPOCO SE OFRECE, Y ES PEOR QUE `recuperable`.
 *
 * `todoElDia`, `horaInicio` y `horaFin` existen de punta a punta —el DTO los
 * acepta, el service los valida y los guarda, `AusenciaPublica` los devuelve— y
 * NINGUN CONSUMIDOR MIRA LA HORA. Verificado uno por uno:
 *
 * - `generacion-mes.service.ts`, que es quien aplica los cierres al plan del
 *   mes, decide con `(a.salaId === null || a.salaId === sala.id) &&
 *   fechaEnRango(fecha, a.desde, a.hasta)`: la hora no entra en la condicion;
 * - `calendario.datos.ts` mapea la fila a `{ salaId, desde, hasta }`;
 * - `liquidacion.datos.ts` mapea a eso mismo mas `motivo`, y
 *   `calcular-liquidacion.ts` la usa otra vez solo con `fechaEnRango`.
 *
 * O sea que un cierre cargado «de 18:00 a 20:00» NO cierra dos horas: CANCELA
 * EL DIA ENTERO, al publicar el mes y al pintar el calendario. `recuperable` es
 * un campo inerte —se guarda y no hace nada—; este HACE ALGO, Y DE MAS: se lleva
 * por delante los turnos de la mañana que deberian existir, y el sintoma
 * aparece a un mes de distancia, cuando el mes publicado sale mal.
 *
 * Por eso el formulario no tiene interruptor ni campos de hora y el cuerpo
 * manda siempre `todoElDia: true`. Y por eso la tabla NO PINTA las horas de una
 * fila que las traiga —puede haberlas, cargadas por `curl` antes de que
 * existiera esta pantalla—: enseñar «18:00 a 20:00» le prometeria al admin un
 * cierre parcial que no existe. Ver `textoDeFranja`.
 * ---------------------------------------------------------------------------
 */

const CLASES_DE_CONTROL =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

/**
 * LOS FILTROS ESCRIBEN LA URL, NUNCA `useState`.
 *
 * Un filtro en la URL se comparte por chat («mira, lo que cierra en
 * diciembre»), sobrevive al boton de atras y vuelve puesto desde el login. En
 * estado se pierde al navegar, y la barra de direcciones y la pantalla dicen
 * cosas distintas.
 *
 * EL FILTRO DE SALA NO TIENE UN «TODO EL SALON»: filtrando por una sala, el
 * service devuelve TAMBIEN los cierres del salon entero —`where.OR =
 * [{ salaId }, { salaId: null }]`, y con razon: un cierre del salon afecta a
 * esa sala—. O sea que no hay forma de pedir «solo los del salon entero», y
 * una opcion que prometiera eso mentiria.
 */
function FiltrosDelListado({ salas }: { salas: readonly SalaPublica[] }) {
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
        {/* «Filtrar por…» y no «Sala» a secas: el formulario de alta tiene su
            propio selector de sala, y dos controles con el mismo nombre
            accesible son indistinguibles para quien navega con lector de
            pantalla —y para quien escribe un test—. */}
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
            <option key={sala.id} value={sala.id}>
              {sala.nombre}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-desde" className="text-xs font-medium text-slate-600">
          Filtrar desde
        </label>
        <input
          id="filtro-desde"
          placeholder="YYYY-MM-DD"
          value={filtros.desde ?? ''}
          onChange={(evento) => cambiar('desde', evento.target.value)}
          className={CLASES_DE_CONTROL}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-hasta" className="text-xs font-medium text-slate-600">
          Filtrar hasta
        </label>
        <input
          id="filtro-hasta"
          placeholder="YYYY-MM-DD"
          value={filtros.hasta ?? ''}
          onChange={(evento) => cambiar('hasta', evento.target.value)}
          className={CLASES_DE_CONTROL}
        />
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Como se lee un cierre
// ---------------------------------------------------------------------------

/**
 * `salaId` EN NULL ES «TODO EL SALON», y se dice con palabras.
 *
 * No es un hueco ni un «no lo cargaron»: es el caso mas grave de los dos —el
 * gimnasio entero no abre— y una celda vacia se lee como que la pantalla no
 * termino de cargar. Es la misma distincion que el selector del alta hace
 * entre «Todo el salon» y «todavia no elegi».
 *
 * Una sala que no esta en el catalogo tampoco deja la celda vacia: el catalogo
 * llega por red y puede llegar despues, y un cierre de una sala borrada
 * seguiria en la lista.
 */
function textoDeSala(salaId: string | null, nombres: ReadonlyMap<string, string>): string {
  if (salaId === null) return 'Todo el salon';
  return nombres.get(salaId) ?? 'Sala que ya no esta en el catalogo';
}

/** Un cierre de un dia no se pinta como un rango de ese dia a ese dia. */
function textoDeFechas(ausencia: { desde: string; hasta: string }): string {
  return ausencia.desde === ausencia.hasta
    ? ausencia.desde
    : `${ausencia.desde} a ${ausencia.hasta}`;
}

/**
 * TODO CIERRE ES DE DIA COMPLETO, Y LA TABLA DICE ESO AUNQUE EL DATO DIGA OTRA
 * COSA.
 *
 * Las horas no se pintan nunca. No es que no interesen: es que pintarlas seria
 * la mentira. Un cierre guardado «de 18:00 a 20:00» no cierra dos horas —los
 * tres consumidores deciden con `fechaEnRango(fecha, desde, hasta)` y ninguno
 * mira la hora—, cancela el dia entero. Una celda que dijera «18:00 a 20:00»
 * le prometeria al admin que a las 10 hay clase, y no la hay.
 *
 * Y la columna no desaparece por eso. Filas con horas puede haberlas ya,
 * cargadas por `curl` antes de que existiera esta pantalla, y el contrato las
 * sigue devolviendo: quien cargo una cree que cerro una franja. Callarse
 * dejaria esa creencia intacta. Asi que la fila lo DICE —«el tramo horario
 * guardado no se aplica»— sin repetir las horas, que es lo unico que no se
 * puede leer sin entenderlo al reves.
 *
 * Se mira tambien `horaInicio`/`horaFin` y no solo `todoElDia`: el service hoy
 * pone las horas en null cuando el cierre es de dia completo, pero esta celda
 * no tiene por que depender de eso para no mentir.
 */
function textoDeFranja(ausencia: {
  todoElDia: boolean;
  horaInicio: string | null;
  horaFin: string | null;
}): string {
  const traeHoras =
    !ausencia.todoElDia || ausencia.horaInicio !== null || ausencia.horaFin !== null;

  return traeHoras ? 'Todo el dia (el tramo horario guardado no se aplica)' : 'Todo el dia';
}

/** El motivo es opcional en el DTO: vacio se DICE, no se deja un hueco. */
function textoDeMotivo(motivo: string | null): string {
  return motivo === null || motivo.trim() === '' ? 'Sin motivo' : motivo;
}

/**
 * Las columnas, declaradas y cerradas.
 *
 * `AusenciaPublica` trae ademas `id`, `tenantId` y `recuperable`. Ninguno esta
 * aqui: el `tenantId` es justo el dato que la Fase 0 se ocupo de que no
 * cruzara entre gimnasios y lo que se pinta viaja al navegador aunque este
 * tapado por CSS; `recuperable` es el campo muerto de la cabecera.
 *
 * La columna de acciones SOLO EXISTE para quien puede escribir: una columna
 * vacia para el operativo seria un hueco que se lee como una averia.
 */
function columnasDeAusencias({
  nombresDeSala,
  alBorrar,
}: {
  nombresDeSala: ReadonlyMap<string, string>;
  alBorrar: ((ausencia: AusenciaPublica) => void) | null;
}): readonly ColumnaDeTabla<AusenciaPublica>[] {
  const columnas: ColumnaDeTabla<AusenciaPublica>[] = [
    { encabezado: 'Sala', celda: (ausencia) => textoDeSala(ausencia.salaId, nombresDeSala) },
    { encabezado: 'Fechas', celda: textoDeFechas },
    { encabezado: 'Franja', celda: textoDeFranja },
    { encabezado: 'Motivo', celda: (ausencia) => textoDeMotivo(ausencia.motivo) },
  ];

  if (alBorrar !== null) {
    columnas.push({
      encabezado: 'Acciones',
      celda: (ausencia) => (
        <Boton
          type="button"
          tono="peligro"
          // El nombre accesible lleva QUE cierre es: con diez filas de
          // «Borrar» nadie sabe cual esta pulsando, y con lector de pantalla
          // menos.
          aria-label={`Borrar el cierre de ${textoDeSala(ausencia.salaId, nombresDeSala)}, ${textoDeFechas(ausencia)}`}
          onClick={() => alBorrar(ausencia)}
        >
          Borrar
        </Boton>
      ),
    });
  }

  return columnas;
}

// ---------------------------------------------------------------------------
// El alta
// ---------------------------------------------------------------------------

/**
 * «TODO EL SALON» ES UNA OPCION CON VALOR, no el hueco del selector.
 *
 * `salaId` ausente en el cuerpo significa «cierra el gimnasio entero», y eso
 * no se puede expresar con el `value=""` del placeholder: entonces «cierro
 * todo» y «todavia no elegi» serian el mismo estado y el formulario tendria
 * que adivinar cual de los dos quiso decir la persona. Con dos valores
 * distintos, no elegir nada es un error con su texto y cerrar el salon entero
 * es una eleccion deliberada.
 *
 * El centinela no viaja nunca a la API: al armar el cuerpo se traduce en la
 * AUSENCIA de la clave `salaId`, que es lo que el DTO lee («Ausente = cierra
 * todo el salon»). Un `salaId: null` o un `salaId: ''` serian un 400 del
 * `@IsString()` + `@IsNotEmpty()`.
 */
const TODO_EL_SALON = 'todo-el-salon';

/**
 * Los campos que la API nombra en sus 400. En un solo sitio.
 *
 * NO ESTAN `horaInicio`, `horaFin` NI `todoElDia`, y eso se comprobo contra el
 * DTO y el service antes de sacarlos: los tres mensajes que los nombran
 * —«horaInicio debe tener formato HH:MM en 24 h», «horaFin debe ser posterior
 * a horaInicio», «Un cierre parcial necesita horaInicio y horaFin»— los dispara
 * el `@Matches` de un campo que esta pantalla NO MANDA, o el `!todoElDia` del
 * service, que con `todoElDia: true` fijo no se alcanza.
 *
 * Y si alguna vez llegaran igual, estar fuera de la lista es lo correcto: un
 * campo de esta lista sin control que lo pinte se TRAGA la frase —`porCampo`
 * se la queda y no se dibuja en ningun sitio—, mientras que lo que no casa con
 * ningun campo sale en el cartel de arriba. Mejor una frase rara visible que
 * una frase correcta invisible.
 */
const CAMPOS_DE_AUSENCIA = [
  'salaId',
  // `hasta` ANTES que `desde`: `repartirPorCampo` ordena por longitud y las dos
  // miden cinco letras, asi que entre ellas manda el orden de esta lista. El
  // 400 del service dice «hasta no puede ser anterior a desde» y nombra los
  // dos; el campo que hay que corregir es el `hasta`.
  'hasta',
  'desde',
  'motivo',
] as const;

type CampoDeAusencia = (typeof CAMPOS_DE_AUSENCIA)[number];

interface ValoresDelAlta {
  sala: string;
  desde: string;
  hasta: string;
  motivo: string;
}

const ALTA_VACIA: ValoresDelAlta = {
  sala: '',
  desde: '',
  hasta: '',
  motivo: '',
};

/**
 * LO QUE ESTE FORMULARIO *NO* VALIDA, A PROPOSITO:
 *
 * - que `hasta` no sea anterior a `desde`;
 * - que la sala exista.
 *
 * Las dos las comprueba el servicio y las dos tienen su texto escrito alli
 * —«hasta no puede ser anterior a desde», «Sala inexistente»—. Repetirlas aqui
 * costaria dos cosas: un segundo texto que puede acabar diciendo algo distinto
 * del de la API, y —peor— que ese camino de la API no se ejercitara nunca, con
 * lo que el dia que el mensaje cambie no se enteraria nadie.
 *
 * LO QUE SI SE VALIDA es lo que la pantalla sabe sin preguntar: que se eligio
 * algo en el selector, y que las fechas tienen la FORMA que el DTO pide.
 */
function AltaDeAusencia({ salas }: { salas: readonly SalaPublica[] }) {
  const crear = useCrearAusencia();

  const [valores, setValores] = useState<ValoresDelAlta>(ALTA_VACIA);
  const [locales, setLocales] = useState<Partial<Record<CampoDeAusencia, string>>>({});
  const [porCampo, setPorCampo] = useState<Partial<Record<CampoDeAusencia, string>>>({});
  const [aviso, setAviso] = useState<string | null>(null);

  function cambiar<C extends keyof ValoresDelAlta>(campo: C, valor: ValoresDelAlta[C]): void {
    setValores((previos) => ({ ...previos, [campo]: valor }));
  }

  /** El error que se pinta: el local manda, porque es el que acaba de pasar. */
  function errorDe(campo: CampoDeAusencia): string | undefined {
    return locales[campo] ?? porCampo[campo];
  }

  /**
   * El cuerpo que sale, o `null` si algo no pasa la puerta de aqui.
   *
   * Devuelve el cuerpo en vez de enviarlo para que la decision de QUE se manda
   * sea una funcion de los valores y se pueda leer de un vistazo.
   */
  function cuerpoDelAlta(): Record<string, unknown> | null {
    const fallos: Partial<Record<CampoDeAusencia, string>> = {};

    if (valores.sala === '') {
      fallos.salaId = 'Elegi una sala, o «Todo el salon» si cierra el gimnasio entero.';
    }
    if (!PATRON_FECHA.test(valores.desde)) fallos.desde = 'La fecha va como YYYY-MM-DD.';
    if (!PATRON_FECHA.test(valores.hasta)) fallos.hasta = 'La fecha va como YYYY-MM-DD.';

    if (Object.keys(fallos).length > 0) {
      setLocales(fallos);
      return null;
    }

    return {
      // Todo el salon = SIN la clave. Ver `TODO_EL_SALON`.
      ...(valores.sala === TODO_EL_SALON ? {} : { salaId: valores.sala }),
      desde: valores.desde,
      hasta: valores.hasta,
      /**
       * `todoElDia` VIAJA SIEMPRE, aunque ya no haya interruptor que lo mueva.
       *
       * El service lo resuelve con `dto.todoElDia ?? true`, asi que omitirlo
       * daria hoy el mismo resultado y seria exactamente la puerta que esto
       * cierra: el dia que ese default cambie, un cierre de dia completo
       * pasaria a ser una franja sin horas. Es un valor, no un hueco.
       *
       * Y las horas NO VIAJAN NUNCA: no hay franja que mandar, y mandarlas
       * dejaria en el cuerpo la huella de un cierre parcial que el motor no
       * respeta. Con `todoElDia: true` el service las descarta igual.
       */
      todoElDia: true,
      // El motivo es opcional: vacio se OMITE. Un `motivo: ''` se guardaria
      // como una cadena vacia, que no es lo mismo que «no puso motivo».
      ...(valores.motivo.trim() === '' ? {} : { motivo: valores.motivo.trim() }),
    };
  }

  async function enviar(): Promise<void> {
    setLocales({});
    setPorCampo({});
    setAviso(null);

    const cuerpo = cuerpoDelAlta();
    if (cuerpo === null) return;

    try {
      await crear.mutateAsync(cuerpo);
      setValores(ALTA_VACIA);
    } catch (error) {
      if (!(error instanceof ErrorDeApi)) {
        setAviso(mensajeDeFallo(error, 'ADMIN_SALON'));
        return;
      }

      /**
       * EL 403 SE TRADUCE ANTES DE REPARTIR: su cuerpo dice «Forbidden», que
       * no nombra ningun campo y acabaria en el cartel tal cual, en ingles.
       */
      if (error.estado === 403) {
        setAviso(mensajeDeFallo(error, 'ADMIN_SALON'));
        return;
      }

      const { porCampo: repartido, sueltas } = repartirPorCampo(error, CAMPOS_DE_AUSENCIA);
      setPorCampo(repartido);
      setAviso(sueltas.length === 0 ? null : sueltas.join(' '));
    }
  }

  return (
    <Tarjeta>
      <form
        aria-label="Nuevo cierre"
        onSubmit={(evento) => {
          evento.preventDefault();
          void enviar();
        }}
        className="flex flex-col gap-3"
        noValidate
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Nuevo cierre
        </h2>

        {aviso !== null && <Aviso tono="error">{aviso}</Aviso>}

        <Seleccion
          etiqueta="Que cierra"
          id="cierre-sala"
          value={valores.sala}
          error={errorDe('salaId')}
          onChange={(evento) => cambiar('sala', evento.target.value)}
          opciones={[
            { valor: '', texto: 'Elegi que cierra' },
            { valor: TODO_EL_SALON, texto: 'Todo el salon' },
            ...salas.map((sala) => ({ valor: sala.id, texto: sala.nombre })),
          ]}
        />

        <Campo
          etiqueta="Desde"
          id="cierre-desde"
          placeholder="YYYY-MM-DD"
          value={valores.desde}
          error={errorDe('desde')}
          onChange={(evento) => cambiar('desde', evento.target.value)}
        />
        <Campo
          etiqueta="Hasta"
          id="cierre-hasta"
          placeholder="YYYY-MM-DD"
          value={valores.hasta}
          error={errorDe('hasta')}
          onChange={(evento) => cambiar('hasta', evento.target.value)}
        />

        {/* NO HAY INTERRUPTOR DE «TODO EL DIA» NI CAMPOS DE HORA: el cierre es
            siempre de dia completo. Ver la cabecera del archivo. Tampoco
            deshabilitados —un control gris invita a rellenarlo igual— ni con
            una advertencia al lado, que a las dos semanas es invisible y lo
            que queda es el control. */}

        <Campo
          etiqueta="Motivo"
          id="cierre-motivo"
          placeholder="Opcional: feriado, reforma, evento"
          maxLength={200}
          value={valores.motivo}
          error={errorDe('motivo')}
          onChange={(evento) => cambiar('motivo', evento.target.value)}
        />

        <div>
          <Boton type="submit" cargando={crear.isPending}>
            Crear cierre
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
// El borrado
// ---------------------------------------------------------------------------

/**
 * Se monta con el cierre YA ELEGIDO para que `useBorrarAusencia(id)` tenga un
 * id estable: un hook con un id que cambia debajo es una mutacion apuntando a
 * otra fila.
 */
function BorradoDeAusencia({
  ausencia,
  nombresDeSala,
  alTerminar,
}: {
  ausencia: AusenciaPublica;
  nombresDeSala: ReadonlyMap<string, string>;
  alTerminar: () => void;
}) {
  const borrar = useBorrarAusencia(ausencia.id);
  const [fallo, setFallo] = useState<string | undefined>(undefined);

  async function confirmar(): Promise<void> {
    setFallo(undefined);

    try {
      await borrar.mutateAsync();
      alTerminar();
    } catch (error) {
      setFallo(mensajeDeFallo(error, 'ADMIN_SALON'));
    }
  }

  return (
    <Confirmar
      // La pregunta NOMBRA el motivo, que es, y las fechas. Con cinco feriados
      // cargados, un «¿estas seguro?» es una ruleta, y el borrado NO ES
      // LOGICO: el service borra la fila de verdad y no hay PATCH para
      // deshacerlo.
      pregunta={`Borrar el cierre «${textoDeMotivo(ausencia.motivo)}» de ${textoDeSala(ausencia.salaId, nombresDeSala)}, ${textoDeFechas(ausencia)}`}
      detalle="Se borra de verdad, no se da de baja. Los turnos que ese cierre estaba tapando vuelven a generarse al publicar el mes."
      textoDeConfirmar="Borrar"
      cargando={borrar.isPending}
      error={fallo}
      alConfirmar={() => void confirmar()}
      alCancelar={alTerminar}
    />
  );
}

// ---------------------------------------------------------------------------
// La pantalla
// ---------------------------------------------------------------------------

function PanelDeAusencias() {
  const { slug } = useParams<{ slug: string }>();
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();
  const rol = useRolDeQuienMira();

  const filtros = filtrosDeLaBusqueda(parametros);
  const conFiltros = Object.keys(filtros).length > 0;

  const ausencias = useAusencias(filtros);
  const { data: salas, error: errorDeSalas } = useSalas();

  const [enBorrado, setEnBorrado] = useState<AusenciaPublica | null>(null);

  /**
   * SIN PROVEEDOR DE ROL, NO SE ESCRIBE.
   *
   * El contexto lo pone el armazon del panel. Si esta pantalla acabara fuera
   * de ese armazon el rol llega `null`, y eso tiene que significar «no alcanza
   * para nada», no «no se sabe, dibujalo igual».
   */
  const puedeEscribir = rol !== null && rolAlcanza(rol, 'ADMIN_SALON');

  /**
   * LAS DOS CONSULTAS PUEDEN TRAER EL 401, no solo la de la lista.
   *
   * Un solo booleano y un solo efecto: si cada una empujara por su cuenta, una
   * sesion caducada con las dos fallando mandaria al login dos veces y dejaria
   * una entrada basura en el historial.
   */
  const sesionCaducada =
    (ausencias.error instanceof ErrorDeApi && ausencias.error.esSesionCaducada) ||
    (errorDeSalas instanceof ErrorDeApi && errorDeSalas.esSesionCaducada);

  useEffect(() => {
    if (!sesionCaducada) return;

    // La puerta del panel mira la sesion en el servidor una vez, al entrar: el
    // token puede caducar con la pantalla abierta. El destino conserva el
    // query porque los filtros viven ahi: volver del login a la lista entera
    // es perder el mes que la persona acababa de acotar.
    router.push(destinoDeLoginDesde(ruta, parametros.toString(), slug));
  }, [sesionCaducada, router, ruta, parametros, slug]);

  const catalogo = salas ?? [];
  const nombresDeSala = new Map(catalogo.map((sala) => [sala.id, sala.nombre]));

  return (
    <div className="flex flex-col gap-4">
      <FiltrosDelListado salas={catalogo} />

      {puedeEscribir && <AltaDeAusencia salas={catalogo} />}

      {enBorrado !== null && (
        <BorradoDeAusencia
          key={enBorrado.id}
          ausencia={enBorrado}
          nombresDeSala={nombresDeSala}
          alTerminar={() => setEnBorrado(null)}
        />
      )}

      {ausencias.isPending && <p className="text-sm text-slate-500">Cargando…</p>}

      {/* Sin sesion no se enseña el «Unauthorized» crudo de la API, que no le
          dice nada a nadie, y tampoco se ofrece reintentar: seria volver a
          fallar mientras la pantalla ya se esta yendo al login. */}
      {sesionCaducada && <Aviso tono="error">Tu sesion caduco. Te llevamos al login.</Aviso>}

      {ausencias.error !== null && !sesionCaducada && (
        <div className="flex flex-col items-start gap-2">
          <Aviso tono="error">{ausencias.error.message}</Aviso>
          <Boton tono="secundario" onClick={() => void ausencias.refetch()}>
            Reintentar
          </Boton>
        </div>
      )}

      {ausencias.data !== undefined && (
        <Tabla
          columnas={columnasDeAusencias({
            nombresDeSala,
            alBorrar: puedeEscribir ? (ausencia) => setEnBorrado(ausencia) : null,
          })}
          filas={ausencias.data}
          claveDeFila={(ausencia) => ausencia.id}
          vacio={
            <Aviso>
              {conFiltros
                ? 'No hay cierres que coincidan con estos filtros.'
                : 'Todavia no hay cierres cargados.'}
            </Aviso>
          }
        />
      )}
    </div>
  );
}

/**
 * `useSearchParams` obliga a una frontera de Suspense.
 *
 * Sin ella, `next build` falla en cuanto algo deje esta ruta prerenderizable, y
 * el error ("missing-suspense-with-csr-bailout") aparece lejos de aqui y cuesta
 * de ubicar. El encabezado queda FUERA para que no parpadee.
 */
export default function PaginaDeAusencias() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Cierres</h1>
      <p className="text-sm text-slate-600">
        Los dias en que una sala —o el salon entero— no abre. El calendario los respeta: lo que
        caiga dentro de un cierre no genera turno. Un cierre es siempre de dia completo.
      </p>

      <Suspense fallback={<p className="text-sm text-slate-500">Cargando…</p>}>
        <PanelDeAusencias />
      </Suspense>
    </section>
  );
}
