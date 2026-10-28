'use client';

import { useState } from 'react';
import {
  PATRON_FECHA,
  rolAlcanza,
  type MetodoPago,
  type PagoPublico,
  type UsuarioDetalle,
} from '@boxadmin/shared';
import { Campo } from '@/componentes/formulario';
import { Confirmar } from '@/componentes/confirmar';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { useAnularPago, usePagos, useRegistrarPago } from '@/hooks/use-dinero';
import { useRolDeQuienMira } from '../../rol-del-panel';
import { Seleccion } from './controles';
import { mensajeDeFallo } from './errores';

/**
 * LOS PAGOS DE ESTA PERSONA: cobrar, ver lo cobrado y deshacer un cobro.
 *
 * ===========================================================================
 * POR QUE VIVE EN LA FICHA Y NO EN UNA PANTALLA PROPIA, Y POR QUE NO HAY UN
 * LISTADO GLOBAL DE PAGOS
 * ===========================================================================
 *
 * Va aqui por lo mismo que las vacaciones en la Fase 10: un pago es DE
 * ALGUIEN. `GET /pagos` acepta `perfilId`, `desde` y `hasta`, y la pregunta que
 * trae a alguien a esta pantalla —«¿este pago de Ana que cubre?», «¿esto fue
 * una sena?»— es siempre la del primero.
 *
 * EL LISTADO GLOBAL —`GET /pagos` sin `perfilId`, o con un rango— NO SE HACE, y
 * son CUATRO medidas y no una preferencia:
 *
 * 1. LA CAJA DE LA FASE 11 YA CONTESTA ESA PREGUNTA, Y MEJOR.
 *    `admin/analisis/caja.tsx` muestra lo cobrado del mes CON SU DESGLOSE POR
 *    METODO, mas lo bonificado y el pendiente estimado. Y lo cuenta sobre la
 *    misma base que este endpoint: `cobrado` se calcula por `Pago.createdAt`
 *    —lo dice su propio docblock— que es exactamente lo que filtran `desde` y
 *    `hasta` aqui («el rango filtra por CUANDO ENTRO el dinero», en
 *    `PagosService.listar`). Son el mismo dato por dos caminos.
 *
 * 2. Y EL SEGUNDO CAMINO TENDRIA QUE SUMAR EN EL NAVEGADOR, que es la puerta
 *    por la que entra el float. La caja suma en `centavos` del lado del
 *    servidor; un listado global que quisiera decir un total tendria que sumar
 *    `PagoPublico.monto`, que son CADENAS, y `caja.tsx` deja escrito que
 *    «`Number(importe.texto)` no aparece en este archivo ni puede aparecer».
 *    Dos pantallas contestando el mismo numero con dos aritmeticas distintas
 *    es la desincronizacion servida: el dia que difieran en un centavo, nadie
 *    sabe cual mirar.
 *
 * 3. UN LISTADO GLOBAL NO PODRIA DECIR DE QUIEN ES CADA FILA. `PagoPublico`
 *    trae `perfilId` y NO trae el nombre. Aqui eso no importa —la ficha es de
 *    una persona y su nombre esta en el encabezado— pero una lista del
 *    gimnasio entero seria una pared de cuid. Resolverlos exigiria bajarse el
 *    padron entero y cruzarlo a mano, que es el remedio del punto 4 con su
 *    propio problema encima.
 *
 * 4. Y NO TIENE TOPE. `PagosService.listar` hace un `findMany` SIN `take` y sin
 *    paginacion: pedirlo sin filtros es bajarse todos los pagos que el gimnasio
 *    registro desde que existe. El unico sitio del producto que hoy pide pagos
 *    sin `perfilId` es la invalidacion de `['pagos', null]` del hook, que es
 *    una clave de cache y no una pantalla.
 *
 * Si algun dia hace falta el detalle fila a fila de un mes —para cuadrar la
 * caja contra el banco, p. ej.— el sitio es la pantalla de analisis, al lado
 * del total que tiene que cuadrar, y no una pantalla nueva que lo repita.
 *
 * ===========================================================================
 * `registradoPor` Y `anuladoPor` SON IDS DE USUARIO, Y NO HAY FORMA DE
 * PONERLES UN NOMBRE DESDE EL CLIENTE. MEDIDO.
 * ===========================================================================
 *
 * En la Fase 11 un caso parecido se resolvio con una segunda peticion al
 * padron. AQUI ESO NO FUNCIONA, y el motivo no es el coste sino que el dato no
 * esta:
 *
 *  - `GET /usuarios` (`UsuariosService.listar`) filtra
 *    `rol: { in: ['ALUMNO', 'PROFESOR'] }` SIEMPRE, con el comentario «nunca
 *    administradores: este endpoint es "Administrar Usuarios" del salon, no la
 *    gestion de cuentas del sistema». Y `registradoPor` es `actor.sub` de una
 *    ruta que pide `ADMIN_OPERATIVO`, y `anuladoPor` de una que pide
 *    `ADMIN_SALON`: SIEMPRE es un administrador. El padron es exactamente la
 *    lista que no los tiene.
 *  - `GET /usuarios/:id` tampoco: para un administrador sin perfil de negocio
 *    `buscarConRelaciones` contesta 404 «El usuario no tiene perfil de
 *    negocio». Y aunque contestara, serian N peticiones —una por id distinto—
 *    desde una ficha cuya lista blanca de peticiones es de seis, y cada una
 *    traeria el correo y el telefono de un administrador para pintar un nombre.
 *  - Y el contexto del panel NO lo tiene. `rol-del-panel.tsx` reparte EL ROL Y
 *    NADA MAS, con un test en `layout.spec.tsx` que fija el conjunto exacto de
 *    props que la puerta le pasa al armazon. Ni siquiera el nombre de quien
 *    esta mirando cruza esa frontera.
 *
 * ASI QUE NO SE PINTA EL CUID. Un identificador delante del mostrador no le
 * sirve a nadie y ademas se lee como un dato roto. Se dice LO QUE SI SE PUEDE
 * DECIR CON VERDAD, que es mas de lo que parece:
 *
 *  - CUANDO se anulo, exacto, desde `anuladoEn`.
 *  - SI lo anulo LA MISMA PERSONA QUE LO COBRO o si fue otra, comparando
 *    `anuladoPor` con `registradoPor`. Son dos ids: la comparacion no necesita
 *    ningun nombre y contesta la pregunta que de verdad se hace quien audita.
 *  - Y que el sistema SI guarda quien fue, para que «no se puede ver aqui» no
 *    se lea como «no quedo registrado».
 *
 * ===========================================================================
 * LAS DOS COSAS QUE ESTA PANTALLA TIENE QUE DECIR
 * ===========================================================================
 *
 * UNA SENA NO PONE AL ALUMNO AL DIA. Lo dice el contrato, palabra por palabra:
 * «Una sena reserva un lugar; no pone al alumno al dia». Es una bandera cuyo
 * EFECTO NO ESTA EN SU NOMBRE —el mismo caso que `mostrarTurnosLibres` en la
 * Fase 12— asi que se dibuja CON LA CONSECUENCIA AL LADO, en la fila y en el
 * formulario, y no en una ayuda que haya que ir a buscar. Confundirla es
 * cobrarle dos veces al alumno o dejarlo entrar gratis.
 *
 * ANULAR NO ES BORRAR. `anuladoEn` y `anuladoPor` son COLUMNAS: la fila se
 * queda. `PagosService.anular` lo dice —«Un pago no se borra: se anula. Es
 * dinero, y borrar la fila reescribe la caja que la Fase 6 va a leer»—. Un pago
 * anulado SIGUE EN LA LISTA y se distingue de uno vigente por un nodo propio,
 * no por un color.
 *
 * Y ANULAR PIDE `ADMIN_SALON` MIENTRAS REGISTRAR PIDE `ADMIN_OPERATIVO`. No es
 * una asimetria que convenga uniformar: el controller la explica mejor que
 * nadie, «registrar un cobro es operativo, deshacerlo es contable». Para un
 * ADMIN_OPERATIVO el boton NO EXISTE EN EL MARCADO y la peticion no sale: un
 * boton que siempre contesta 403 es peor que no estar, y uno escondido con CSS
 * sigue estando.
 */

// ---------------------------------------------------------------------------
// Lo que la pantalla dice, en un solo sitio
// ---------------------------------------------------------------------------

/**
 * LA CONSECUENCIA DE LA SENA, y va pegada a la palabra «sena» siempre.
 *
 * Exportada para que el spec afirme el texto EXACTO y no una subcadena: con un
 * `toContain('no lo pone al dia')`, media frase borrada seguiria pasando.
 */
export const LA_SENA_NO_PONE_AL_DIA =
  'Sena: reserva un lugar y NO lo pone al dia. Para ponerlo al dia hace falta un pago que no sea sena.';

/** Lo que se lee cuando la lista contesto y esta vacia. */
export const SIN_PAGOS =
  'No tiene ningun pago registrado. La lista se pidio y volvio vacia: no es que no hayamos podido mirar.';

/**
 * Lo que se lee cuando la LECTURA falla, y no comparte dibujo con el vacio.
 *
 * Es la trampa de esta pantalla: un fallo pintado como «no tiene pagos» le dice
 * al mostrador que esta persona nunca pago, y lo que se hace con eso es
 * cobrarle de nuevo. Mismo criterio que el bloque de vacaciones.
 */
export const NO_SE_PUDO_LEER = 'No se pudieron leer los pagos: ';

/** Que el sistema SI sabe quien, aunque esta pantalla no pueda nombrarlo. */
export const QUIEN_NO_SE_PUEDE_NOMBRAR =
  'De cada pago queda registrado que administrador lo cobro y cual lo anulo. Esta pantalla no puede ' +
  'mostrar sus nombres: el padron de personas lista alumnos y profesores, nunca administradores.';

/** El cartel del rol que no alcanza para LEER los pagos. */
export const NI_SIQUIERA_PARA_VERLOS =
  'Para ver los pagos hace falta ser administrador operativo. Tu rol no alcanza.';

export const MONTO_INVALIDO =
  'El monto va con hasta 8 enteros y como mucho 2 decimales, como 25000.10.';
export const FECHA_INVALIDA = 'La fecha va como YYYY-MM-DD.';

/**
 * EL MISMO PATRON QUE EL DTO (`apps/api/src/pagos/dto/crear-pago.dto.ts`),
 * copiado a proposito y no deducido.
 *
 * Se valida aqui para que el error se pueda colgar DEL CAMPO en vez de volver
 * como una frase suelta de `ValidationPipe`, pero el patron es el mismo para
 * que la pantalla no rechace nada que la API aceptaria ni al reves. Y NO ES UN
 * `Number.isNaN(Number(monto))`: esa comprobacion aceptaria `25000.123` y
 * `1e5`, que son dos 400 distintos, y ademas obligaria a construir el float que
 * todo este archivo existe para no construir.
 */
const PATRON_MONTO = /^\d{1,8}(\.\d{1,2})?$/;

/** Los cuatro de `MetodoPago`, en el orden en que los usa el mostrador. */
const METODOS: readonly { valor: MetodoPago; texto: string }[] = [
  { valor: 'EFECTIVO', texto: 'Efectivo' },
  { valor: 'TRANSFERENCIA', texto: 'Transferencia' },
  { valor: 'CORTESIA', texto: 'Cortesia' },
  { valor: 'OTRO', texto: 'Otro' },
];

// ---------------------------------------------------------------------------
// Como se lee un pago
// ---------------------------------------------------------------------------

/**
 * ANULADO SE DECIDE POR `anuladoEn`, NO POR `anuladoPor`.
 *
 * Es la misma columna que mira `estaAlDia` del lado del servidor
 * (`apps/api/src/pagos/estado-de-pago.ts` recibe `anuladoEn` y no el otro), asi
 * que la pantalla y el `pagoAlDia` derivado de la ficha no pueden discrepar
 * sobre que pagos cuentan. El contrato tipa los dos campos por separado
 * (`anuladoPor: string | null`), asi que un anulado sin autor es representable:
 * se dibuja como anulado igual, y la frase de quien lo hizo es la que se calla.
 */
export function estaAnulado(pago: PagoPublico): boolean {
  return pago.anuladoEn !== null;
}

/**
 * EL INSTANTE TAL COMO LO ESCRIBIO EL SERVIDOR, sin pasar por la zona del
 * navegador.
 *
 * `anuladoEn` y `createdAt` son ISO 8601 completo en UTC. Se recorta la cadena
 * en vez de construir un `Date` y formatearlo, por dos motivos que apuntan al
 * mismo sitio:
 *
 *  - TODO ESTE PRODUCTO CUENTA LOS DIAS EN UTC. `desdeFechaISO` devuelve la
 *    medianoche UTC y `aFechaISO` recorta un ISO. Un `toLocaleString()` aqui
 *    pintaria el unico instante del panel que NO esta en esa base.
 *  - Y EL MISMO PAGO SE LEERIA DISTINTO EN DOS MAQUINAS DEL MISMO MOSTRADOR.
 *    Una anulacion a las 00:30 UTC es «ayer» en Buenos Aires y «hoy» en el
 *    servidor; con dos pantallas abiertas al lado, la discusion sobre que dia
 *    se anulo el cobro no tiene arreglo.
 *
 * Se devuelve la fecha y la hora por separado para que la fila pueda nombrarlas
 * sin volver a cortar la cadena en otro sitio con otro criterio.
 */
export function instanteLegible(iso: string): { fecha: string; hora: string } {
  return { fecha: iso.slice(0, 10), hora: iso.slice(11, 16) };
}

/**
 * QUE SE PUEDE DECIR DE QUIEN ANULO, SIN INVENTAR UN NOMBRE.
 *
 * La comparacion de los dos ids contesta la pregunta util —«¿lo deshizo quien
 * lo cobro o lo deshizo otro?»— sin resolver ninguno de los dos. Ver el bloque
 * de arriba sobre por que no hay forma de ponerles nombre.
 */
export function quienLoAnulo(pago: PagoPublico): string {
  if (pago.anuladoPor === null) return 'No quedo registrado quien lo anulo.';

  return pago.anuladoPor === pago.registradoPor
    ? 'Lo anulo el mismo administrador que lo cobro.'
    : 'Lo anulo un administrador distinto del que lo cobro.';
}

/** «25000.10 del 2026-10-01 al 2026-10-31», para nombrar UN pago entre varios. */
export function comoSeLlamaEsePago(pago: PagoPublico): string {
  return `${pago.monto} que cubre del ${pago.cubreDesde} al ${pago.cubreHasta}`;
}

// ---------------------------------------------------------------------------
// La anulacion
// ---------------------------------------------------------------------------

/**
 * EL DIALOGO NOMBRA EL MONTO Y LAS FECHAS, y no es cosmetica.
 *
 * Con cuatro pagos cargados, un «¿estas seguro?» es una ruleta sobre dinero.
 * Y el detalle dice lo que anular ES —la fila se queda— porque quien pulsa
 * «Anular» esperando que el pago desaparezca va a volver a pulsarlo cuando siga
 * viendolo.
 *
 * `useAnularPago` recibe el id del USUARIO (para invalidar su ficha) y el del
 * PAGO va en las variables, asi que este componente no necesita un hook por
 * fila: lo monta la fila que se esta anulando y se desmonta al terminar.
 */
function AnulacionDeUnPago({
  usuarioId,
  pago,
  alTerminar,
}: {
  usuarioId: string;
  pago: PagoPublico;
  alTerminar: () => void;
}) {
  const anular = useAnularPago(usuarioId);
  const [fallo, setFallo] = useState<string | undefined>(undefined);

  async function confirmar(): Promise<void> {
    setFallo(undefined);

    try {
      await anular.mutateAsync(pago.id);
      alTerminar();
    } catch (error) {
      // Dentro del dialogo: detras no se lee, y el dialogo sigue abierto
      // pidiendo que se confirme algo que acaba de fallar.
      setFallo(mensajeDeFallo(error, 'ADMIN_SALON'));
    }
  }

  return (
    <Confirmar
      pregunta={`Anular el pago de ${comoSeLlamaEsePago(pago)}`}
      detalle="El pago NO se borra: queda en la lista marcado como anulado, con quien lo anulo y cuando. Deja de contar para el estado de pago y baja la caja del mes."
      textoDeConfirmar="Anular"
      cargando={anular.isPending}
      error={fallo}
      alConfirmar={() => void confirmar()}
      alCancelar={alTerminar}
    />
  );
}

// ---------------------------------------------------------------------------
// Una fila
// ---------------------------------------------------------------------------

/**
 * Cada dato en SU atributo y no en una frase corrida.
 *
 * Con todo junto en un `textContent`, un spec solo puede afirmar con
 * `toContain`, y `toContain('0.00')` pasa sobre un `10.00` igual que
 * `not.toContain('0%')` pasa sobre un `100%`. Con atributos propios la
 * afirmacion es una igualdad exacta sobre el nodo que se quiso mirar.
 */
function FilaDePago({
  pago,
  puedeAnular,
  alPedirAnular,
}: {
  pago: PagoPublico;
  puedeAnular: boolean;
  alPedirAnular: (pago: PagoPublico) => void;
}) {
  const anulado = estaAnulado(pago);
  const entro = instanteLegible(pago.createdAt);

  return (
    <li
      data-pago={pago.id}
      className="flex flex-col gap-1 border-b border-slate-100 pb-2 last:border-b-0"
    >
      <p className="text-sm font-medium text-slate-900">
        {/* El monto TAL CUAL lo manda la API: es una cadena con dos decimales y
            no pasa por ningun `Number()`. `25000.10` convertido y vuelto a
            pintar seria `25000.1`, que es otro texto y otro dinero. */}
        <span data-monto>{pago.monto}</span> · <span data-metodo>{pago.metodo}</span>
      </p>

      <p className="text-xs text-slate-600">
        Cubre del <span data-cubre-desde>{pago.cubreDesde}</span> al{' '}
        <span data-cubre-hasta>{pago.cubreHasta}</span>
      </p>

      <p className="text-xs text-slate-500">
        Entro el <span data-entro>{entro.fecha}</span>
      </p>

      {/* LA SENA, CON SU CONSECUENCIA PEGADA. Nunca la palabra sola: su efecto
          no esta en su nombre. */}
      {pago.esSena && (
        <p data-sena className="text-xs font-medium text-amber-700">
          {LA_SENA_NO_PONE_AL_DIA}
        </p>
      )}

      {pago.nota !== null && pago.nota !== '' && (
        <p data-nota className="text-xs text-slate-600">
          {pago.nota}
        </p>
      )}

      {/* ANULADO Y VIGENTE SON DOS NODOS DISTINTOS, no el mismo con otra clase.
          Un color no lo lee un lector de pantalla y no lo distingue un test. */}
      {anulado ? (
        <p data-anulado className="text-xs font-medium text-red-700">
          Anulado el <span data-anulado-fecha>{instanteLegible(pago.anuladoEn ?? '').fecha}</span> a
          las <span data-anulado-hora>{instanteLegible(pago.anuladoEn ?? '').hora}</span> (UTC).{' '}
          <span data-anulado-quien>{quienLoAnulo(pago)}</span>
        </p>
      ) : (
        <p data-vigente className="text-xs text-slate-500">
          Vigente.
        </p>
      )}

      {/* EL BOTON NO EXISTE PARA QUIEN NO PUEDE ANULAR, y tampoco para un pago
          ya anulado: `PagosService.anular` contesta 409 «Ese pago ya estaba
          anulado». Ofrecer un boton que solo puede fallar es ofrecer un error. */}
      {puedeAnular && !anulado && (
        <div>
          <Boton
            type="button"
            tono="secundario"
            // El nombre accesible lleva el monto y las fechas: con cuatro filas
            // de «Anular» nadie sabe cual esta pulsando.
            aria-label={`Anular el pago de ${comoSeLlamaEsePago(pago)}`}
            onClick={() => alPedirAnular(pago)}
          >
            Anular
          </Boton>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// El formulario de cobro
// ---------------------------------------------------------------------------

/**
 * REGISTRAR UN COBRO. `POST /pagos`, ADMIN_OPERATIVO.
 *
 * Los cinco campos obligatorios del DTO estan los cinco en pantalla, y
 * `esSena` VIAJA SIEMPRE, incluso en `false`. El hook ya lo exige en su tipo y
 * deja escrito por que: el defecto del servidor es `false` hoy, pero un
 * booleano con consecuencias LO DECIDE LA PANTALLA, para que el dia que alguien
 * cambie el `?? false` del service no cambie en silencio lo que cobra el
 * mostrador. Es la leccion de la Fase 12.
 *
 * `cubreDesde` y `cubreHasta` VIAJAN SIEMPRE por un motivo distinto: no son
 * opcionales en el DTO. Omitir uno no es «desde hoy», es un 400.
 *
 * EL MONTO NUNCA PASA POR UN NUMBER. Vive en un `useState<string>`, se valida
 * con el patron del DTO y se manda tal cual se escribio. Un `Number(monto)` por
 * el camino convierte `25000.10` en `25000.1` —un decimal, no dos— y en los
 * casos malos en `25000.100000000001`.
 *
 * ⚠️ MEDIDO EN LA FASE 12 Y DICHO AQUI: un `<input>` controlado de React
 * ESCRIBE SU VALOR EN EL ATRIBUTO del marcado (React sincroniza `defaultValue`,
 * que *es* el atributo `value`). O sea que lo que el mostrador teclee en estos
 * campos esta en el HTML del documento, no solo en la propiedad `.value`. Para
 * el monto y las fechas da igual —se ven en pantalla— pero la NOTA es texto
 * libre sobre una persona, y conviene saber que no esta escondida en ningun
 * sitio: se vacia al enviar y no queda en la cache de mutaciones porque el hook
 * lleva `gcTime: 0`.
 */
function FormularioDeCobro({ usuario }: { usuario: UsuarioDetalle }) {
  const registrar = useRegistrarPago(usuario.id);

  const [monto, setMonto] = useState('');
  const [metodo, setMetodo] = useState<MetodoPago>('EFECTIVO');
  const [cubreDesde, setCubreDesde] = useState('');
  const [cubreHasta, setCubreHasta] = useState('');
  const [esSena, setEsSena] = useState(false);
  const [nota, setNota] = useState('');

  const [errorDeMonto, setErrorDeMonto] = useState<string | undefined>(undefined);
  const [errorDeDesde, setErrorDeDesde] = useState<string | undefined>(undefined);
  const [errorDeHasta, setErrorDeHasta] = useState<string | undefined>(undefined);
  const [aviso, setAviso] = useState<string | null>(null);

  async function enviar(): Promise<void> {
    setAviso(null);
    setErrorDeMonto(undefined);
    setErrorDeDesde(undefined);
    setErrorDeHasta(undefined);

    const montoMal = !PATRON_MONTO.test(monto);
    const desdeMal = !PATRON_FECHA.test(cubreDesde);
    const hastaMal = !PATRON_FECHA.test(cubreHasta);

    if (montoMal) setErrorDeMonto(MONTO_INVALIDO);
    if (desdeMal) setErrorDeDesde(FECHA_INVALIDA);
    if (hastaMal) setErrorDeHasta(FECHA_INVALIDA);
    // Los tres se comprueban antes de cortar: con un `return` por campo, quien
    // se equivoca en dos ve el segundo error recien despues de arreglar el
    // primero.
    if (montoMal || desdeMal || hastaMal) return;

    /**
     * NO SE COMPRUEBA AQUI QUE `cubreHasta` NO SEA ANTERIOR A `cubreDesde`.
     *
     * Lo comprueba el service y lo dice con su propia frase («cubreHasta no
     * puede ser anterior a cubreDesde»). Una comprobacion local con otro texto
     * seria un segundo mensaje que algun dia dice algo distinto, y dejaria ese
     * camino de la API sin ejercitar nunca. Mismo criterio que el alta de
     * vacaciones en esta misma ficha.
     */
    try {
      await registrar.mutateAsync({
        // EL `perfilId` Y NO EL `id` DEL USUARIO: son dos tablas. El hook recibe
        // el del usuario —para invalidar la ficha, cuyo `pagoAlDia` es
        // derivado— y el cuerpo lleva el del perfil. La ficha es el unico sitio
        // que tiene los dos.
        perfilId: usuario.perfilId,
        monto,
        metodo,
        cubreDesde,
        cubreHasta,
        // SIEMPRE, aunque sea `false`. Ver el docblock de arriba.
        esSena,
        // La nota vacia se OMITE: `nota: ''` se guardaria como cadena vacia,
        // que no es lo mismo que «no puso nota». La columna nace en null.
        ...(nota === '' ? {} : { nota }),
      });

      setMonto('');
      setCubreDesde('');
      setCubreHasta('');
      setEsSena(false);
      setNota('');
    } catch (fallo) {
      if (!(fallo instanceof ErrorDeApi)) throw fallo;
      setAviso(mensajeDeFallo(fallo, 'ADMIN_OPERATIVO'));
    }
  }

  return (
    <form
      aria-label="Registrar un cobro"
      onSubmit={(evento) => {
        evento.preventDefault();
        void enviar();
      }}
      className="flex flex-col gap-3 border-t border-slate-200 pt-3"
      noValidate
    >
      {aviso !== null && <Aviso tono="error">{aviso}</Aviso>}

      <Campo
        etiqueta="Monto"
        id="pago-monto"
        // `type="text"` y no `type="number"`: un `number` devuelve `.value`
        // normalizado por el navegador —`25000.10` puede volver `25000.1`— y
        // ademas acepta notacion exponencial. Es dinero y viaja como cadena.
        type="text"
        inputMode="decimal"
        placeholder="25000.10"
        value={monto}
        error={errorDeMonto}
        onChange={(evento) => setMonto(evento.target.value)}
      />

      <Seleccion
        etiqueta="Metodo"
        id="pago-metodo"
        opciones={METODOS.map((uno) => ({ valor: uno.valor, texto: uno.texto }))}
        value={metodo}
        onChange={(evento) => setMetodo(evento.target.value as MetodoPago)}
      />

      {/**
       * LAS ETIQUETAS NO SON «Cubre desde» NI «Cubre hasta», Y NO ES UN
       * CAPRICHO: EL BLOQUE DE ESTADO DE PAGO, EN ESTA MISMA FICHA, YA TIENE UN
       * CAMPO «Cubre hasta».
       *
       * `Campo` deriva el `id` de la etiqueta, asi que dos controles con la
       * misma etiqueta comparten `id` y rompen el `htmlFor` DE LOS DOS: el
       * `<label>` de la cortesia apuntaria al campo del cobro o al reves, segun
       * el orden de montaje. Es la misma trampa que el bloque de vacaciones
       * documenta con «Desde», y que aqui estuvo a punto de morder: tres tests
       * de `page.spec.tsx` escriben en «Cubre hasta» para fijar una cortesia.
       *
       * El `id` ademas va ESCRITO y no derivado, para que renombrar la etiqueta
       * manana no cambie en silencio con que se empareja el control.
       */}
      <Campo
        etiqueta="Periodo cubierto desde"
        id="pago-cubre-desde"
        placeholder="YYYY-MM-DD"
        value={cubreDesde}
        error={errorDeDesde}
        onChange={(evento) => setCubreDesde(evento.target.value)}
      />
      <Campo
        etiqueta="Periodo cubierto hasta"
        id="pago-cubre-hasta"
        placeholder="YYYY-MM-DD"
        value={cubreHasta}
        error={errorDeHasta}
        onChange={(evento) => setCubreHasta(evento.target.value)}
      />

      {/* LA CASILLA LLEVA LA CONSECUENCIA AL LADO, no detras de un signo de
          interrogacion. Marcarla sin saber que hace es cobrar un mes y que el
          alumno siga debiendo. */}
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={esSena} onChange={() => setEsSena((antes) => !antes)} />
          Es una sena
        </label>
        <p data-sena-explicada className="text-xs text-amber-700">
          {LA_SENA_NO_PONE_AL_DIA}
        </p>
      </div>

      {/* «Nota del cobro» y no «Nota»: el bloque de estado de pago ya tiene una
          «Nota» en esta misma ficha. Mismo motivo que las dos fechas de arriba. */}
      <Campo
        etiqueta="Nota del cobro"
        id="pago-nota"
        value={nota}
        onChange={(evento) => setNota(evento.target.value)}
      />

      <div>
        <Boton type="submit" cargando={registrar.isPending}>
          Registrar cobro
        </Boton>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// El panel
// ---------------------------------------------------------------------------

function PanelDePagos({ usuario }: { usuario: UsuarioDetalle }) {
  const rolDeQuienMira = useRolDeQuienMira();

  /**
   * ANULAR PIDE `ADMIN_SALON`, Y `rolAlcanza` ES JERARQUIA NUMERICA.
   *
   * No una lista de roles exactos: `JERARQUIA[rol] >= JERARQUIA[minimo]`, con
   * ADMIN_SALON 40 y SUPERADMIN por encima. Un
   * `rolDeQuienMira === 'ADMIN_SALON'` dejaria al SUPERADMIN sin el boton, que
   * es el error que la comparacion directa comete siempre.
   */
  const puedeAnular = rolDeQuienMira !== null && rolAlcanza(rolDeQuienMira, 'ADMIN_SALON');

  const {
    data: pagos,
    isPending,
    error,
    refetch,
  } = usePagos({
    // EL `perfilId`, NO EL `id` DEL USUARIO. Son dos columnas distintas y las
    // dos son cuid: mandar la equivocada no es un error, es una lista vacia.
    perfilId: usuario.perfilId,
  });

  const [enAnulacion, setEnAnulacion] = useState<PagoPublico | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {isPending && <p className="text-sm text-slate-500">Cargando los pagos…</p>}

      {/* EL FALLO AL LEER NO SE DIBUJA COMO «no tiene pagos». Un 500 o una red
          caida pintados como una lista vacia le dicen al mostrador que esta
          persona nunca pago, y lo que se hace con eso es cobrarle otra vez. */}
      {error !== null && (
        <div data-fallo-al-leer className="flex flex-col items-start gap-2">
          <Aviso tono="error">
            {NO_SE_PUDO_LEER}
            {error.message}
          </Aviso>
          <Boton type="button" tono="secundario" onClick={() => void refetch()}>
            Reintentar
          </Boton>
        </div>
      )}

      {pagos !== undefined &&
        (pagos.length === 0 ? (
          <div data-sin-pagos>
            <Aviso>{SIN_PAGOS}</Aviso>
          </div>
        ) : (
          <>
            <ul aria-label="Pagos" className="flex flex-col gap-2">
              {pagos.map((pago) => (
                <FilaDePago
                  key={pago.id}
                  pago={pago}
                  puedeAnular={puedeAnular}
                  alPedirAnular={setEnAnulacion}
                />
              ))}
            </ul>
            <p data-sin-nombres className="text-xs text-slate-500">
              {QUIEN_NO_SE_PUEDE_NOMBRAR}
            </p>
          </>
        ))}

      {enAnulacion !== null && (
        <AnulacionDeUnPago
          key={enAnulacion.id}
          usuarioId={usuario.id}
          pago={enAnulacion}
          alTerminar={() => setEnAnulacion(null)}
        />
      )}

      <FormularioDeCobro usuario={usuario} />
    </div>
  );
}

/**
 * LA PUERTA, y corta tambien la LECTURA.
 *
 * `GET /pagos` lleva `@Roles('ADMIN_OPERATIVO')` igual que el POST, asi que
 * pedirlo sin rol seria un 403 pintado como una averia. `rol === null` es «sin
 * proveedor», y eso significa «no alcanza para nada», no «no se sabe, pedilo
 * igual»: fallar hacia el lado que no da permisos de mas es lo unico seguro
 * cuando el contexto falta. Mismo criterio que el bloque de vacaciones.
 *
 * El contenido vive en otro componente A PROPOSITO, para que `usePagos` NO se
 * ejecute cuando no se puede. Un `enabled: false` dejaria la peticion escrita y
 * a un refactor de distancia de salir, y la respuesta —los cobros de una
 * persona— quedaria en la cache de TanStack igual que si se hubiera dibujado.
 *
 * NO SE ESCONDE A LOS PROFESORES, al reves que las vacaciones. Alli el modelo
 * se llama `VacacionAlumno` y el planificador solo las cruza contra quien tiene
 * rutinas; aqui `PagosService.crear` solo comprueba que el `Perfil` exista y no
 * mira su rol —se busco y no esta—, asi que una profesora que ademas toma
 * clases se cobra igual que cualquiera. Esconder el bloque en su ficha seria
 * inventar una regla que la API no tiene.
 */
export function BloqueDePagos({ usuario }: { usuario: UsuarioDetalle }) {
  const rolDeQuienMira = useRolDeQuienMira();

  return (
    <Tarjeta>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Pagos</h2>

        {rolDeQuienMira === null || !rolAlcanza(rolDeQuienMira, 'ADMIN_OPERATIVO') ? (
          <Aviso tono="error">{NI_SIQUIERA_PARA_VERLOS}</Aviso>
        ) : (
          <PanelDePagos usuario={usuario} />
        )}
      </div>
    </Tarjeta>
  );
}
