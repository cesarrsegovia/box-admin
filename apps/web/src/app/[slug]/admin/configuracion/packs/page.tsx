'use client';

import { useState } from 'react';
import { rolAlcanza, type PackPublico, type TipoPack } from '@boxadmin/shared';
import { Confirmar } from '@/componentes/confirmar';
import { Campo } from '@/componentes/formulario';
import { Tabla, type ColumnaDeTabla } from '@/componentes/tabla';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { usePacks } from '@/hooks/use-catalogos';
import {
  type PackAGuardar,
  useActualizarPack,
  useCrearPack,
  useDarDeBajaPack,
} from '@/hooks/use-dinero';
import { mensajeDeFallo } from '../../usuarios/[id]/errores';
import { useRolDeQuienMira } from '../../rol-del-panel';

/**
 * EL CATALOGO DE PACKS: la unica pantalla desde la que se crea, se edita y se
 * da de baja un pack en todo el producto.
 *
 * ---------------------------------------------------------------------------
 * EL LISTADO NO ABRE UNA CLAVE PROPIA: USA `usePacks()`, LA DEL CATALOGO.
 *
 * `GET /packs` no lleva `@Roles` y es la misma peticion que ya hacen el alta
 * de alumno, el formulario de invitaciones y el bloque de datos de la ficha,
 * todas por `usePacks()` de `use-catalogos` con la clave `['packs']`. Abrir
 * aqui una `['packs', 'admin']` seria pedir dos veces lo mismo y guardar dos
 * copias que se desincronizan en cuanto una de las dos se invalida: es
 * exactamente lo que se decidio con `useSalas()` en la Fase 10.
 *
 * Y NO HACE FALTA NADA MAS, comprobado en `PacksService.listar`: la rama de
 * personal —`rolAlcanza(actor.rol, 'ADMIN_OPERATIVO')`— no pone `where.activo`
 * si el filtro no lo trae, asi que `GET /packs` a secas ya devuelve los
 * activos Y los de baja, que es justo lo que esta pantalla necesita. Un
 * `?activo=false` seria otra URL, otra clave y otra copia.
 *
 * LAS TRES ESCRITURAS YA INVALIDAN ESA CLAVE: `useInvalidarUnPack` en
 * `use-dinero.ts` hace `invalidateQueries({ queryKey: clavesDeCatalogos.packs() })`
 * en el alta, en la edicion y en la baja. Verificado leyendolo, no supuesto —y
 * por eso esta pantalla no invalida nada por su cuenta—.
 *
 * ---------------------------------------------------------------------------
 * DAR DE BAJA UN PACK NO LE HACE NADA A QUIEN LO TIENE. MEDIDO EN EL SERVICE.
 *
 * `PacksService.darDeBaja` es, entera, un `pack.update({ data: { activo: false } })`
 * mas una linea de historial. NO toca la tabla `Perfil`, no cuenta cuantos
 * alumnos tienen el pack, no reasigna a nadie y NO HAY 409: a diferencia de la
 * baja de una sala de la Fase 10 —que exige cero turnos futuros y contesta
 * «La sala tiene N turno(s)…»—, esta baja sale siempre y con cualquier numero
 * de alumnos detras. El propio service lo dice al justificar que `crear` y
 * `darDeBaja` no invalidan la cache de reportes: «darlo de baja no le cambia
 * el `packId` a ningun perfil ni el precio a ninguno».
 *
 * O SEA QUE EL ALUMNO SE QUEDA EXACTAMENTE COMO ESTABA, y eso tambien esta
 * medido fuera de `packs.service.ts`:
 *
 *  - SU FICHA LO SIGUE MOSTRANDO: `UsuariosService.resolverPack` hace
 *    `pack.findFirst({ where: { id } })` sin mirar `activo`.
 *  - SU PRECIO SIGUE CONTANDO: `stats.datos.ts#perfilesConPack` se baja TODOS
 *    los packs (`pack.findMany({ select: { id, precio } })`, sin filtro) para
 *    armar el `precioPack`, asi que el pendiente de la caja y la cobranza
 *    siguen midiendolo igual.
 *  - Y LOS AVISOS DE PAGO LE SIGUEN LLEGANDO: el procesador de recordatorios
 *    filtra por `packId: { not: null }` y por alumno activo, y no por si el
 *    pack sigue en pie.
 *
 * LO QUE SI CAMBIA es de la puerta para afuera: el catalogo que ve un alumno
 * pasa a esconderlo (`where.activo = true` para quien no es personal), un
 * `GET /packs/:id` suyo contesta 404, y una invitacion nueva con ese `packId`
 * se rechaza con un 400 («exigirPackValido» en `invitaciones.service.ts`).
 *
 * ⚠️ Y HAY UNA ASIMETRIA REAL, anotada y no arreglada porque vive en la API:
 * `UsuariosService` NO comprueba `activo` al asignar un pack, asi que un alta
 * de alumno todavia admite un pack de baja aunque una invitacion no. No se
 * dice en pantalla —es una incoherencia de la API, no algo que el admin pueda
 * decidir— y se reporta aparte.
 *
 * CUANTOS ALUMNOS LO TIENEN, ESTA PANTALLA NO LO SABE Y NO LO INVENTA. El
 * `DELETE` devuelve un `PackPublico` y ahi no hay ningun recuento; tampoco lo
 * hay en el `GET /packs`. Decir «no afecta a nadie» seria una frase
 * tranquilizadora que la respuesta no sostiene, y decir «afecta a N alumnos»
 * seria un numero inventado. Se dice lo que PASA —que es nada— y se dice que
 * el cuanto no se sabe.
 *
 * ---------------------------------------------------------------------------
 * EL PRECIO ES UNA CADENA DE PUNTA A PUNTA, Y NUNCA PASA POR UN `Number`.
 *
 * `PackPublico.precio` llega como `"25000.10"` —`aPackPublico` hace
 * `precio.toFixed(2)` sobre el `Decimal`, no `Number(...)`— y el DTO lo exige
 * con `@Matches(/^\d{1,8}(\.\d{1,2})?$/)`. Un float binario no representa
 * 25000.10, asi que cualquier conversion por el camino cambia el dato: el
 * listado lo pinta TAL CUAL —sin `toLocaleString`, sin `Number`— y
 * `precioEscrito` completa los decimales RECORTANDO LA CADENA, sin aritmetica.
 *
 * ---------------------------------------------------------------------------
 * EL PATCH NO SABE VACIAR UN CAMPO, Y POR ESO LA PANTALLA NO LO OFRECE.
 *
 * `ActualizarPackDto` declara `precio?: string`, `clasesPorMes?: number` y
 * `cancelacionesPermitidas?: number`, todos `@IsOptional()` y NINGUNO
 * `@IsOptional({ nullable })` ni `@ValidateIf`: no hay forma de mandar `null`.
 * Omitir la clave es «no lo toques», no «dejalo sin valor». O sea que un pack
 * que ya tiene precio NO puede volver a «a consultar» desde ninguna pantalla,
 * y lo mismo con el tope de clases y con las cancelaciones.
 *
 * Se dice en el campo en vez de tragarselo: un formulario que acepta el borrado
 * y guarda sin el campo deja al admin creyendo que el pack quedo a consultar.
 * Haria falta un endpoint —o un DTO— que acepte null; esta fase no toca la API.
 *
 * (El alta SI puede nacer sin precio: `JSON.stringify` borra las claves
 * `undefined`, y `CrearPackDto` trata la ausencia como «a consultar».)
 *
 * ---------------------------------------------------------------------------
 * LA PUERTA SE REPITE AQUI, COMO EN LAS TRES PANTALLAS DE LA FASE 12.
 *
 * No hay `layout.tsx` en `configuracion/`: el indice es una pagina hermana, no
 * un envoltorio, y entrar directo a `/mi-gym/admin/configuracion/packs` no
 * monta el indice ni su puerta. Por eso `web/page.tsx`, `email/page.tsx` y
 * `checkin/page.tsx` tienen las cinco lineas de la puerta cada una, y esta
 * tambien. Va ANTES de los hooks y en un componente aparte: no montar
 * `PantallaDePacks` es no tener `usePacks` ni las tres mutaciones.
 *
 * `rol === null` es SIN PROVEEDOR y vale «no alcanza para nada»: falla cerrada.
 * Y `rolAlcanza` es una JERARQUIA, asi que un SUPERADMIN entra tambien.
 *
 * ESTO NO ES LA SEGURIDAD —las cuatro escrituras piden `ADMIN_SALON` en el
 * controller y contestarian 403 igual—: es no ofrecer lo que no se puede hacer.
 *
 * ---------------------------------------------------------------------------
 * ESTE ARCHIVO NO EXPORTA NADA MAS QUE EL `default`. Next 15 lo prohibe en un
 * `page.tsx`, ni `tsc --noEmit` ni los tests lo ven, y el error habla de
 * `OmitWithTag` y «not assignable to never». Por eso los textos son constantes
 * del modulo SIN exportar y el spec los repite escritos a mano — que ademas es
 * lo unico que les da dientes: importarlos seria compararlos contra si mismos.
 */

// ---------------------------------------------------------------------------
// Los textos
// ---------------------------------------------------------------------------

const TITULO = 'Los packs';

/** Lo que se dice mientras el catalogo no llego. */
const CARGANDO = 'Cargando el catalogo de packs…';

/** Lo que se dice cuando la lectura falla. El mensaje de la API va TAL CUAL. */
const PRINCIPIO_DEL_FALLO_DE_LECTURA = 'No se pudo leer el catalogo de packs: ';

/**
 * UN GIMNASIO SIN PACKS NO SE PARECE A UNA LECTURA QUE FALLO.
 *
 * Son los dos unicos estados en los que no hay ni una fila, y son opuestos:
 * uno es un dato verdadero —todavia no se creo ninguno— y el otro es la
 * ausencia de dato. Pintar los dos como una tabla vacia es el error del 404
 * deducido de la Fase 10: una respuesta que no llego, dibujada como un dato.
 */
const NADA_QUE_LISTAR = 'Este gimnasio todavia no tiene ningun pack.';

/** Lo que se dice cuando un pack no tiene precio en el contrato. */
const SIN_PRECIO = 'A consultar';

/**
 * Lo que se dice cuando el contador del tipo es nulo.
 *
 * MEDIDO en `reservas/ventana-pack.ts#topeDelPack`: `if (base === null) return null`,
 * y `null` ahi significa literalmente «sin tope». No es un dato que falte.
 */
const SIN_TOPE = 'Sin limite';

const ACTIVO = 'Activo';
const DE_BAJA = 'De baja';

/** Lo que se dice cuando el importe escrito no es un importe. */
const PRECIO_ROTO = 'Poné un importe con hasta dos decimales, como 12500.00.';

/** `@IsInt()` y `@Min(1)` en los dos contadores del DTO. */
const CLASES_ROTAS = 'Poné un numero entero de clases, 1 o mas.';

/** `@IsInt()` y `@Min(0)`: cero cancelaciones es un valor, no un campo vacio. */
const CANCELACIONES_ROTAS = 'Poné un numero entero de cancelaciones, 0 o mas.';

const NOMBRE_VACIO = 'El pack necesita un nombre.';

/** Ver el bloque de «el PATCH no sabe vaciar un campo». */
const NO_SE_PUEDE_VACIAR =
  'No se puede volver a dejarlo vacio desde aca: la API admite cambiar este valor, no borrarlo.';

const NADA_QUE_GUARDAR = 'No cambiaste nada.';

const PRINCIPIO_DEL_FALLO_DEL_ALTA = 'No se pudo crear el pack: ';
const PRINCIPIO_DEL_FALLO_DE_GUARDADO = 'No se pudo guardar el pack: ';

/**
 * EL ALTA DICE LO QUE HIZO Y, EN LA MISMA FRASE, LO QUE NO.
 *
 * Crear un pack no se lo asigna a nadie: `PacksService.crear` escribe una fila
 * en `Pack` y nada mas, y el `packId` de un perfil se toca desde la ficha del
 * alumno (`bloque-datos.tsx`). Un «pack creado» suelto delante del mostrador
 * se lee como «ya se lo puedo cobrar a alguien».
 */
const ALTA_HECHA =
  'Pack creado. Todavia no lo tiene nadie: el pack de cada alumno se elige en su ficha.';

/**
 * EL GUARDADO DICE LO QUE ARRASTRA, porque no es solo esta pantalla.
 *
 * MEDIDO en `PacksService.actualizar`, que invalida la cache de reportes con
 * un comentario que lo explica: «EL PRECIO DE UN PACK ES EL `pendienteEstimado`
 * DE TODOS SUS ALUMNOS». Cambiar el precio cambe en el acto lo que la caja
 * dice que falta cobrar y lo que recepcion ve al lado de cada nombre.
 */
const EDICION_HECHA =
  'Pack guardado. Si cambiaste el precio, cambia tambien lo que la caja dice que falta cobrarle a ' +
  'cada alumno que tiene este pack.';

/** La pregunta de la baja NOMBRA el pack. La arma `preguntaDeLaBaja`. */
const PRINCIPIO_DE_LA_PREGUNTA = 'Dar de baja el pack ';

/**
 * LO QUE LA BAJA LE HACE A QUIEN YA TIENE EL PACK: NADA, Y SE DICE ASI.
 *
 * Las tres mitades estan medidas y ninguna se supone — ver el bloque de la
 * cabecera—. La ultima frase es la mas importante: la respuesta del DELETE no
 * trae ningun recuento, asi que el cuanto no se afirma.
 */
const LO_QUE_PASA_CON_QUIEN_LO_TIENE =
  'A los alumnos que ya lo tienen no les pasa nada: conservan el pack, lo siguen viendo en su ' +
  'ficha y su precio sigue contando en la caja y en la cobranza. Lo que cambia es que deja de ' +
  'verse en el catalogo de los alumnos y deja de poder elegirse en una invitacion nueva. Cuantos ' +
  'alumnos lo tienen, la API no lo dice en ningun sitio y esta pantalla no lo inventa.';

const TEXTO_DE_CONFIRMAR_LA_BAJA = 'Dar de baja';

const BAJA_HECHA =
  'Pack dado de baja. Sigue existiendo y quien lo tenia lo conserva: para volver a ofrecerlo, ' +
  'poné «Activo» en «Sí» y guarda.';

const YA_ESTA_DE_BAJA = 'Este pack ya esta de baja.';

/** Los cinco encabezados de la tabla, en este orden. */
const ENCABEZADOS = ['Pack', 'Tipo', 'Clases', 'Precio', 'Estado'] as const;

// ---------------------------------------------------------------------------
// Leer un campo de texto: un valor, un vacio, o algo roto
// ---------------------------------------------------------------------------

/**
 * Lo que hay escrito en un campo, visto como lo ve la peticion.
 *
 * Los tres casos hacen falta separados: `vacio` significa cosas distintas en
 * el alta («a consultar») y en la edicion («borrar», que la API no sabe), y
 * `roto` nunca puede confundirse con ninguno de los dos — `Number('')` es `0`,
 * y un cero de clases no es un campo sin llenar.
 */
type Escrito<T> = { clase: 'vacio' } | { clase: 'roto' } | { clase: 'valor'; valor: T };

/** El mismo patron que `@Matches` en los dos DTO de packs. */
const PATRON_PRECIO = /^\d{1,8}(\.\d{1,2})?$/;

/**
 * El importe escrito, como CADENA y con dos decimales.
 *
 * NO PASA POR `Number` NI UNA VEZ, y no es una precaucion de estilo: el patron
 * del DTO acepta `25000.1`, asi que lo que esta funcion tiene que hacer es
 * completar el segundo decimal. Hacerlo con `Number(texto).toFixed(2)` es la
 * forma obvia, funciona para los importes chicos y es el error que esta fase
 * persigue: un float binario no representa 25000.10 y el dinero deja de ser el
 * mismo dato. Se recorta la cadena por el punto y se rellena con ceros.
 */
function precioEscrito(texto: string): Escrito<string> {
  const limpio = texto.trim();
  if (limpio === '') return { clase: 'vacio' };
  if (!PATRON_PRECIO.test(limpio)) return { clase: 'roto' };

  const punto = limpio.indexOf('.');
  const entera = punto === -1 ? limpio : limpio.slice(0, punto);
  const decimales = punto === -1 ? '' : limpio.slice(punto + 1);

  return { clase: 'valor', valor: `${entera}.${decimales.padEnd(2, '0')}` };
}

/**
 * Un entero escrito, con su minimo.
 *
 * `Number.isInteger` y no `parseInt`, que se come la cola de `12abc` y
 * devuelve `12`. Y el vacio se corta antes: `Number('')` es `0`, y mandar un
 * cero que nadie escribio es peor que no mandar nada.
 */
function enteroEscrito(texto: string, minimo: number): Escrito<number> {
  const limpio = texto.trim();
  if (limpio === '') return { clase: 'vacio' };

  const numero = Number(limpio);
  if (!Number.isInteger(numero) || numero < minimo) return { clase: 'roto' };

  return { clase: 'valor', valor: numero };
}

// ---------------------------------------------------------------------------
// El borrador: lo que hay en los campos, que es texto
// ---------------------------------------------------------------------------

/** Los cinco campos del formulario, tal y como viven en un `<input>`. */
interface Borrador {
  nombre: string;
  tipo: TipoPack;
  /** El contador DEL TIPO ELEGIDO. Ver `CamposDePack`. */
  clases: string;
  precio: string;
  cancelaciones: string;
}

/** Los nombres de campo que la API usa en sus mensajes de validacion. */
type CampoDePack = 'nombre' | 'tipo' | 'clases' | 'precio' | 'cancelaciones';

type ErroresDeCampo = Partial<Record<CampoDePack, string>>;

const BORRADOR_NUEVO: Borrador = {
  nombre: '',
  tipo: 'MENSUAL',
  clases: '',
  precio: '',
  cancelaciones: '',
};

/** El contador que le toca a un pack segun su tipo, como texto. */
function clasesDe(pack: PackPublico): string {
  const contador = pack.tipo === 'MENSUAL' ? pack.clasesPorMes : pack.clasesTotales;
  return contador === null ? '' : String(contador);
}

function borradorDe(pack: PackPublico): Borrador {
  return {
    nombre: pack.nombre,
    tipo: pack.tipo,
    clases: clasesDe(pack),
    // El precio TAL CUAL llego: es una cadena y se queda cadena.
    precio: pack.precio ?? '',
    cancelaciones:
      pack.cancelacionesPermitidas === null ? '' : String(pack.cancelacionesPermitidas),
  };
}

/**
 * UN SOLO CONTADOR EN PANTALLA, el del tipo elegido.
 *
 * `validarCoherencia` en el service tira un 400 si llega `clasesTotales` con
 * `tipo: 'MENSUAL'` o al reves. Dibujar los dos campos invitaria a llenar los
 * dos, y el formulario tendria que acordarse de no mandar uno. Con un solo
 * campo, lo que no se puede mandar no existe.
 */
function etiquetaDeClases(tipo: TipoPack): string {
  return tipo === 'MENSUAL' ? 'Clases por mes' : 'Clases en total';
}

function CamposDePack({
  borrador,
  errores,
  prefijo,
  alCambiar,
}: {
  borrador: Borrador;
  errores: ErroresDeCampo;
  /** Los `id` tienen que ser unicos: el alta y la edicion conviven en pantalla. */
  prefijo: string;
  alCambiar: (borrador: Borrador) => void;
}) {
  const idTipo = `${prefijo}-tipo`;

  return (
    <>
      <Campo
        etiqueta="Nombre"
        id={`${prefijo}-nombre`}
        value={borrador.nombre}
        error={errores.nombre}
        onChange={(evento) => alCambiar({ ...borrador, nombre: evento.target.value })}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor={idTipo} className="text-sm font-medium text-slate-700">
          Tipo
        </label>
        <select
          id={idTipo}
          value={borrador.tipo}
          aria-invalid={errores.tipo !== undefined}
          onChange={(evento) =>
            alCambiar({ ...borrador, tipo: evento.target.value === 'TOTAL' ? 'TOTAL' : 'MENSUAL' })
          }
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="MENSUAL">Mensual</option>
          <option value="TOTAL">Total</option>
        </select>
        {errores.tipo !== undefined && <p className="text-xs text-red-700">{errores.tipo}</p>}
      </div>

      <Campo
        etiqueta={etiquetaDeClases(borrador.tipo)}
        id={`${prefijo}-clases`}
        type="number"
        min={1}
        value={borrador.clases}
        error={errores.clases}
        onChange={(evento) => alCambiar({ ...borrador, clases: evento.target.value })}
      />

      {/* `type="text"` Y NO `type="number"`: un campo numerico deja al
          navegador normalizar lo escrito y devuelve el `value` por una via que
          no es la cadena que se tecleo. El dinero se escribe y se manda como
          texto, y el patron lo comprueba `precioEscrito`. */}
      <Campo
        etiqueta="Precio"
        id={`${prefijo}-precio`}
        type="text"
        inputMode="decimal"
        value={borrador.precio}
        error={errores.precio}
        onChange={(evento) => alCambiar({ ...borrador, precio: evento.target.value })}
      />

      <Campo
        etiqueta="Cancelaciones permitidas"
        id={`${prefijo}-cancelaciones`}
        type="number"
        min={0}
        value={borrador.cancelaciones}
        error={errores.cancelaciones}
        onChange={(evento) => alCambiar({ ...borrador, cancelaciones: evento.target.value })}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// El alta
// ---------------------------------------------------------------------------

/**
 * Crear un pack. `POST /packs`, ADMIN_SALON.
 *
 * LO QUE ESTA VACIO SE OMITE, no viaja como cadena vacia ni como cero:
 * `JSON.stringify` borra las claves `undefined` y `CrearPackDto` trata la
 * ausencia como «sin valor» en los tres opcionales. Un `precio: ''` seria un
 * 400 del `@Matches` y un `cancelacionesPermitidas: 0` seria una decision que
 * nadie tomo.
 */
function AltaDePack() {
  const crear = useCrearPack();

  const [borrador, setBorrador] = useState<Borrador>(BORRADOR_NUEVO);
  const [errores, setErrores] = useState<ErroresDeCampo>({});
  const [fallo, setFallo] = useState<string | null>(null);
  const [hecho, setHecho] = useState(false);

  async function enviar(): Promise<void> {
    setFallo(null);
    setHecho(false);

    const nuevos: ErroresDeCampo = {};
    const cuerpo: PackAGuardar = { tipo: borrador.tipo };

    const nombre = borrador.nombre.trim();
    if (nombre === '') nuevos.nombre = NOMBRE_VACIO;
    else cuerpo.nombre = nombre;

    const precio = precioEscrito(borrador.precio);
    if (precio.clase === 'roto') nuevos.precio = PRECIO_ROTO;
    else if (precio.clase === 'valor') cuerpo.precio = precio.valor;

    const clases = enteroEscrito(borrador.clases, 1);
    if (clases.clase === 'roto') nuevos.clases = CLASES_ROTAS;
    else if (clases.clase === 'valor') {
      if (borrador.tipo === 'MENSUAL') cuerpo.clasesPorMes = clases.valor;
      else cuerpo.clasesTotales = clases.valor;
    }

    const cancelaciones = enteroEscrito(borrador.cancelaciones, 0);
    if (cancelaciones.clase === 'roto') nuevos.cancelaciones = CANCELACIONES_ROTAS;
    else if (cancelaciones.clase === 'valor') {
      cuerpo.cancelacionesPermitidas = cancelaciones.valor;
    }

    setErrores(nuevos);
    if (Object.keys(nuevos).length > 0) return;

    try {
      await crear.mutateAsync(cuerpo);
      // El formulario se vacia: lo siguiente que se escriba es otro pack, no
      // una correccion del que acaba de nacer.
      setBorrador(BORRADOR_NUEVO);
      setHecho(true);
    } catch (error) {
      setFallo(mensajeDeFallo(error, 'ADMIN_SALON'));
    }
  }

  return (
    <Tarjeta>
      <form
        aria-label="Crear un pack"
        className="flex max-w-sm flex-col gap-3"
        noValidate
        onSubmit={(evento) => {
          evento.preventDefault();
          void enviar();
        }}
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Crear un pack
        </h2>

        <CamposDePack
          borrador={borrador}
          errores={errores}
          prefijo="alta"
          alCambiar={setBorrador}
        />

        <div>
          <Boton type="submit" cargando={crear.isPending}>
            Crear el pack
          </Boton>
        </div>

        {/* `alerta` porque el resultado aparece DESPUES de pulsar y en otro
            sitio: sin el, quien usa lector de pantalla pulsa y no pasa nada. */}
        {hecho && (
          <Aviso tono="exito" alerta>
            <span data-resultado="alta">{ALTA_HECHA}</span>
          </Aviso>
        )}

        {fallo !== null && (
          <Aviso tono="error">
            <span data-fallo="alta">
              {PRINCIPIO_DEL_FALLO_DEL_ALTA}
              {fallo}
            </span>
          </Aviso>
        )}
      </form>
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
// La edicion y la baja de UN pack
// ---------------------------------------------------------------------------

/**
 * SOLO LO QUE CAMBIO, comparado contra el pack cargado.
 *
 * Mandar el formulario entero no es «lo mismo pero de mas»: el PATCH de la API
 * pisa cada clave que llega, asi que guardar el nombre con el formulario
 * completo reescribiria con los valores que esta pantalla leyo hace cinco
 * minutos lo que otro admin acabe de cambiar — y en silencio, porque el PATCH
 * contesta 200. Es la misma regla que los ocho ajustes de la ficha de sala.
 *
 * Se compara contra el DATO y no contra un «esto lo toque»: un campo escrito y
 * devuelto a como estaba no viaja.
 *
 * EL CONTADOR TIENE UNA REGLA PROPIA, medida en `PacksService.actualizar`: al
 * cambiar de tipo el service NO hereda el contador viejo —`const porMes =
 * cambiaTipo ? dto.clasesPorMes : (dto.clasesPorMes ?? existente.clasesPorMes)`—
 * y ademas anula el del tipo viejo. O sea que con el tipo cambiado el contador
 * nuevo viaja aunque el texto no se haya tocado, y el viejo NO viaja nunca:
 * mandarlo seria el 400 de coherencia.
 */
function cambiosDe(pack: PackPublico, borrador: Borrador, activo: boolean) {
  const errores: ErroresDeCampo = {};
  const cuerpo: PackAGuardar = {};

  const nombre = borrador.nombre.trim();
  if (nombre === '') errores.nombre = NOMBRE_VACIO;
  else if (nombre !== pack.nombre) cuerpo.nombre = nombre;

  const cambiaTipo = borrador.tipo !== pack.tipo;
  if (cambiaTipo) cuerpo.tipo = borrador.tipo;

  if (activo !== pack.activo) cuerpo.activo = activo;

  const precio = precioEscrito(borrador.precio);
  if (precio.clase === 'roto') errores.precio = PRECIO_ROTO;
  else if (precio.clase === 'vacio') {
    if (pack.precio !== null) errores.precio = NO_SE_PUEDE_VACIAR;
  } else if (precio.valor !== pack.precio) cuerpo.precio = precio.valor;

  // Con el tipo cambiado no hay contador anterior contra el que comparar: el
  // service anula el viejo y el nuevo nace de lo que mande este PATCH.
  const clasesAntes = cambiaTipo
    ? null
    : borrador.tipo === 'MENSUAL'
      ? pack.clasesPorMes
      : pack.clasesTotales;
  const clases = enteroEscrito(borrador.clases, 1);
  if (clases.clase === 'roto') errores.clases = CLASES_ROTAS;
  else if (clases.clase === 'vacio') {
    if (clasesAntes !== null) errores.clases = NO_SE_PUEDE_VACIAR;
  } else if (clases.valor !== clasesAntes) {
    if (borrador.tipo === 'MENSUAL') cuerpo.clasesPorMes = clases.valor;
    else cuerpo.clasesTotales = clases.valor;
  }

  const cancelaciones = enteroEscrito(borrador.cancelaciones, 0);
  if (cancelaciones.clase === 'roto') errores.cancelaciones = CANCELACIONES_ROTAS;
  else if (cancelaciones.clase === 'vacio') {
    if (pack.cancelacionesPermitidas !== null) errores.cancelaciones = NO_SE_PUEDE_VACIAR;
  } else if (cancelaciones.valor !== pack.cancelacionesPermitidas) {
    cuerpo.cancelacionesPermitidas = cancelaciones.valor;
  }

  return { errores, cuerpo };
}

/** La pregunta de la baja NOMBRA el pack: una pestaña vieja da de baja el que no era. */
function preguntaDeLaBaja(pack: PackPublico): string {
  return `${PRINCIPIO_DE_LA_PREGUNTA}${pack.nombre}`;
}

function EdicionDePack({ pack, alCerrar }: { pack: PackPublico; alCerrar: () => void }) {
  const guardar = useActualizarPack(pack.id);
  const baja = useDarDeBajaPack(pack.id);

  /**
   * El borrador nace del pack y NO se resiembra con un `useEffect`.
   *
   * El componente se monta con `key={pack.id}`, asi que elegir otro pack es un
   * montaje nuevo y el estado arranca del pack nuevo. Un `useEffect` que
   * siguiera a la consulta pisaria lo que la persona este escribiendo cada vez
   * que el catalogo se refresque solo.
   */
  const [borrador, setBorrador] = useState<Borrador>(() => borradorDe(pack));
  const [activo, setActivo] = useState<boolean>(pack.activo);
  const [errores, setErrores] = useState<ErroresDeCampo>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  const [confirmando, setConfirmando] = useState(false);
  const [falloDeLaBaja, setFalloDeLaBaja] = useState<string | null>(null);
  const [dadoDeBaja, setDadoDeBaja] = useState(false);

  async function enviar(): Promise<void> {
    setAviso(null);
    setFallo(null);
    setGuardado(false);

    const { errores: nuevos, cuerpo } = cambiosDe(pack, borrador, activo);
    setErrores(nuevos);
    if (Object.keys(nuevos).length > 0) return;

    if (Object.keys(cuerpo).length === 0) {
      setAviso(NADA_QUE_GUARDAR);
      return;
    }

    try {
      await guardar.mutateAsync(cuerpo);
      setGuardado(true);
    } catch (error) {
      setFallo(mensajeDeFallo(error, 'ADMIN_SALON'));
    }
  }

  async function darDeBaja(): Promise<void> {
    setFalloDeLaBaja(null);

    try {
      await baja.mutateAsync();
      setConfirmando(false);
      setDadoDeBaja(true);
    } catch (error) {
      setFalloDeLaBaja(mensajeDeFallo(error, 'ADMIN_SALON'));
    }
  }

  return (
    <Tarjeta>
      <div className="flex max-w-sm flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Editar <span data-pack-elegido>{pack.nombre}</span>
          </h2>
          <Boton type="button" tono="secundario" onClick={alCerrar}>
            Cerrar
          </Boton>
        </div>

        <form
          aria-label="Editar el pack"
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(evento) => {
            evento.preventDefault();
            void enviar();
          }}
        >
          <CamposDePack
            borrador={borrador}
            errores={errores}
            prefijo="edicion"
            alCambiar={setBorrador}
          />

          {/* LAS DOS PUERTAS A LA MISMA BAJA, como en la ficha de una sala.
              `ActualizarPackDto` admite `activo`, asi que el PATCH da de baja
              igual que el DELETE — y ademas es la UNICA forma de reactivar un
              pack, que es lo que el DELETE no sabe hacer. */}
          <div className="flex flex-col gap-1">
            <label htmlFor="edicion-activo" className="text-sm font-medium text-slate-700">
              Activo
            </label>
            <select
              id="edicion-activo"
              value={activo ? 'true' : 'false'}
              onChange={(evento) => setActivo(evento.target.value === 'true')}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="true">Sí</option>
              <option value="false">No</option>
            </select>
          </div>

          <div>
            <Boton type="submit" cargando={guardar.isPending}>
              Guardar el pack
            </Boton>
          </div>
        </form>

        {aviso !== null && (
          <Aviso tono="info" alerta>
            <span data-resultado="sin-cambios">{aviso}</span>
          </Aviso>
        )}

        {guardado && (
          <Aviso tono="exito" alerta>
            <span data-resultado="guardado">{EDICION_HECHA}</span>
          </Aviso>
        )}

        {fallo !== null && (
          <Aviso tono="error">
            <span data-fallo="guardado">
              {PRINCIPIO_DEL_FALLO_DE_GUARDADO}
              {fallo}
            </span>
          </Aviso>
        )}

        <section className="flex flex-col items-start gap-2 border-t border-slate-200 pt-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Baja</h3>

          {/* Un pack ya de baja no se vuelve a dar de baja: el DELETE es
              idempotente y contestaria 200 con la misma fila, o sea un gesto
              que parece hacer algo y no hace nada. */}
          {!pack.activo || dadoDeBaja ? (
            <p className="text-sm text-slate-600">
              <span data-resultado="baja">{dadoDeBaja ? BAJA_HECHA : YA_ESTA_DE_BAJA}</span>
            </p>
          ) : confirmando ? (
            <Confirmar
              pregunta={preguntaDeLaBaja(pack)}
              detalle={LO_QUE_PASA_CON_QUIEN_LO_TIENE}
              textoDeConfirmar={TEXTO_DE_CONFIRMAR_LA_BAJA}
              cargando={baja.isPending}
              error={falloDeLaBaja ?? undefined}
              alConfirmar={() => void darDeBaja()}
              alCancelar={() => {
                setConfirmando(false);
                setFalloDeLaBaja(null);
              }}
            />
          ) : (
            <Boton type="button" tono="peligro" onClick={() => setConfirmando(true)}>
              Dar de baja el pack
            </Boton>
          )}
        </section>
      </div>
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
// El listado
// ---------------------------------------------------------------------------

/**
 * Las CINCO columnas, y ni una mas.
 *
 * `salaId` NO se dibuja y tampoco se edita, y es una decision tomada y no un
 * olvido: pintarlo crudo seria un identificador que no le dice nada a nadie, y
 * pintar el nombre de la sala pide un segundo catalogo (`useSalas()`) con su
 * propio fallo de lectura dentro de esta pantalla. Mientras no se dibuje,
 * tampoco se manda: el PATCH solo lleva lo que cambio, asi que la sala de un
 * pack sobrevive intacta a cada guardado de aqui. Queda reportado como lo
 * unico de `PackPublico` que ninguna pantalla sabe cambiar.
 *
 * EL PRECIO VA TAL CUAL, sin `toLocaleString` ni separadores: es la cadena que
 * mando la API y cualquier formateo la haria pasar por un `Number`.
 */
function columnasDe(alElegir: (id: string) => void): readonly ColumnaDeTabla<PackPublico>[] {
  return [
    {
      encabezado: 'Pack',
      celda: (pack) => (
        <button
          type="button"
          data-pack={pack.id}
          onClick={() => alElegir(pack.id)}
          className="font-medium text-slate-900 underline underline-offset-2"
        >
          {pack.nombre}
        </button>
      ),
    },
    {
      encabezado: 'Tipo',
      celda: (pack) => (pack.tipo === 'MENSUAL' ? 'Mensual' : 'Total'),
    },
    {
      encabezado: 'Clases',
      celda: (pack) => {
        const contador = pack.tipo === 'MENSUAL' ? pack.clasesPorMes : pack.clasesTotales;
        if (contador === null) return SIN_TOPE;
        return pack.tipo === 'MENSUAL' ? `${contador} por mes` : `${contador} en total`;
      },
    },
    {
      encabezado: 'Precio',
      celda: (pack) => pack.precio ?? SIN_PRECIO,
    },
    {
      /**
       * EL ESTADO SE DISTINGUE POR UN ATRIBUTO PROPIO Y NO POR EL COLOR.
       *
       * El `data-estado` es lo que permite afirmar «este esta de baja» sin
       * buscar una subcadena dentro de la fila, y es lo unico que un lector de
       * pantalla y un test leen igual que un ojo.
       */
      encabezado: 'Estado',
      celda: (pack) => (
        <span
          data-estado={pack.activo ? 'activo' : 'de-baja'}
          className={pack.activo ? 'text-slate-700' : 'font-medium text-red-700'}
        >
          {pack.activo ? ACTIVO : DE_BAJA}
        </span>
      ),
    },
  ];
}

/** La pantalla ya pasada la puerta. Aqui dentro viven TODOS los hooks. */
function PantallaDePacks() {
  const packs = usePacks();
  const [elegido, setElegido] = useState<string | null>(null);

  if (packs.isPending) return <p className="text-sm text-slate-500">{CARGANDO}</p>;

  /**
   * UN FALLO AL LEER NO SE DIBUJA COMO UN GIMNASIO SIN PACKS.
   *
   * No hay tabla, no hay cartel de «todavia no hay ninguno» y no hay
   * formulario de alta: hay el motivo. Dejar el alta puesta encima de un
   * catalogo que no se pudo leer es como se crea el pack que ya existia.
   */
  if (packs.data === undefined) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">{TITULO}</h1>
        <Aviso tono="error">
          <span data-fallo="lectura">
            {PRINCIPIO_DEL_FALLO_DE_LECTURA}
            {packs.error.message}
          </span>
        </Aviso>
      </section>
    );
  }

  const lista = packs.data;
  const pack = lista.find((candidato) => candidato.id === elegido);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">{TITULO}</h1>
      <p className="text-sm text-slate-600">
        Lo que el gimnasio vende: cuantas clases da cada pack y cuanto cuesta. El pack de cada
        alumno se elige en su ficha; aca se define el catalogo.
      </p>

      {/* EL ORDEN LO DA EL SERVIDOR —`orderBy: { nombre: 'asc' }`— y esta
          pantalla no reordena: dos criterios de orden sobre la misma lista son
          dos listas distintas segun quien mire. */}
      <Tabla
        etiqueta="El catalogo de packs"
        columnas={columnasDe(setElegido)}
        filas={lista}
        claveDeFila={(fila) => fila.id}
        vacio={<p className="text-sm text-slate-600">{NADA_QUE_LISTAR}</p>}
      />

      {pack !== undefined && (
        <EdicionDePack key={pack.id} pack={pack} alCerrar={() => setElegido(null)} />
      )}

      <AltaDePack />
    </section>
  );
}

/**
 * LA PUERTA, Y NADA MAS QUE LA PUERTA.
 *
 * Un solo hook —leer el contexto— y despues un `return null`. Todo lo que pide
 * algo esta del otro lado.
 */
export default function PaginaDePacks() {
  const rol = useRolDeQuienMira();

  if (rol === null || !rolAlcanza(rol, 'ADMIN_SALON')) return null;

  return <PantallaDePacks />;
}
