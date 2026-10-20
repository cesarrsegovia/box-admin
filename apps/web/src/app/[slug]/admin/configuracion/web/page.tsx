'use client';

import { type FormEvent, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type ConfiguracionWebSalon, rolAlcanza } from '@boxadmin/shared';
import { Confirmar } from '@/componentes/confirmar';
import { Campo } from '@/componentes/formulario';
import { Aviso, Boton } from '@/componentes/ui';
import { useConfigWebSalon, useGuardarWebSalon } from '@/hooks/use-configuracion';
import { useRolDeQuienMira } from '../../rol-del-panel';
import { CampoLargo, ListaDePreguntas, ListaDeTestimonios } from './listas';

/**
 * LA WEB PUBLICA DEL GIMNASIO: LO QUE SALE A INTERNET SIN SESION.
 *
 * ---------------------------------------------------------------------------
 * ESTA PANTALLA ES MAS ANCHA QUE LA WEB, Y ESO ES EL CONTRATO.
 *
 * `ConfiguracionWebSalon` lleva cosas que `SalonPublico` NO lleva, y el
 * docblock del contrato dice por que: «aqui si viajan las banderas (el admin
 * tiene que poder verlas apagadas para encenderlas) y los ids de los
 * testimonios y las preguntas. Nada de esto sale por el endpoint sin sesion».
 *
 * De ahi salen las dos reglas de esta pantalla:
 *
 *  1. LAS CUATRO BANDERAS SE DIBUJAN SIEMPRE, encendidas o apagadas. Una
 *     bandera apagada que no se dibuja es una bandera que no se puede
 *     encender: la pantalla seria la unica forma de llegar a ella y no la
 *     tendria. Es lo contrario que los tres campos muertos de la Fase 10 —que
 *     NO se dibujan porque no hacen nada—: estos cuatro hacen, y mucho.
 *  2. Y LO ANCHO SE QUEDA ADENTRO. Los ids de las filas no se escriben en el
 *     marcado (ver `listas.tsx`) y no hay ningun sitio de esta pantalla donde
 *     la configuracion entera se serialice —ni en un enlace, ni en un
 *     `data-`, ni en el `href` del enlace a la web publica, que es `/{slug}` a
 *     secas—. El dia que algo de lo ancho viaje de copiloto hacia lo angosto,
 *     el sitio por el que va a salir es un atributo.
 *
 * ---------------------------------------------------------------------------
 * EL `PUT` ES UN REEMPLAZO COMPLETO. LOS CINCO BOOLEANOS VIAJAN SIEMPRE.
 *
 * Esto no es higiene, es el bug mas caro que tiene esta pantalla disponible.
 * `WebSalonService.guardar` hace `dto.mostrarPrecios ?? WEB_SALON_POR_DEFECTO.
 * mostrarPrecios`, y ese valor por defecto es **`true`**. O sea que un
 * formulario que «mande solo lo que esta encendido» —el reflejo natural cuando
 * los campos opcionales se omiten— APAGA todo menos los precios, y los precios
 * LOS ENCIENDE: un gimnasio que los tenia ocultos se encuentra la lista de
 * precios publicada sin que nadie la tocara.
 *
 * Lo mismo con `activa`, cuyo defecto es `false`: omitirla despublica el sitio.
 *
 * Por eso los cinco booleanos van SIEMPRE en el cuerpo, con su valor, aunque
 * sea `false`. Y por eso los textos se omiten cuando estan vacios y no se
 * mandan como `''`: con el reemplazo completo, omitir es como se BORRA un
 * campo —lo dice el DTO—, y un `''` en `imagenPrincipalUrl` o en los colores
 * seria un 400 (`@IsUrl`, `@IsHexColor`) en vez de un borrado.
 *
 * ---------------------------------------------------------------------------
 * `planDestacadoId` SE DEVUELVE TAL CUAL Y NO SE DIBUJA. DECISION, NO OLVIDO.
 *
 * Con el reemplazo completo, un `planDestacadoId` que no viaje vuelve a `null`:
 * guardar el tagline borraria el plan destacado de la landing sin decirselo a
 * nadie. Asi que viaja, con el valor que trajo el servidor.
 *
 * Y no se dibuja un editor porque lo unico que esta pantalla tiene de el es un
 * identificador opaco: elegirlo de verdad pide la LISTA de packs, que es otra
 * consulta (`usePacks`) y otro endpoint, y esta tarea tiene seis. Una caja de
 * texto para pegar a mano un id de base de datos no es un editor, es una
 * trampa. Queda anotado como lo que falta, no tapado con algo que parezca que
 * funciona.
 *
 * ---------------------------------------------------------------------------
 * EL INTERRUPTOR MAESTRO ESCRIBE SOLO, Y ESCRIBE LO DEL SERVIDOR.
 *
 * `activa` no esta en el borrador del formulario: tiene su propio boton y su
 * propia mutacion, y el cuerpo que manda se arma desde lo que dijo el SERVIDOR
 * —no desde lo que haya tecleado a medias en el formulario grande—. Apagar la
 * web tiene que apagar la web y nada mas; con el borrador delante, pulsar
 * «apagar» publicaria de paso el tagline a medio escribir.
 *
 * Y apagar PREGUNTA, diciendo QUE deja de verse —enumerando lo que hoy esta
 * encendido de verdad, no una lista fija: un gimnasio con los precios ocultos
 * no deja de ver los precios—. Encender no pregunta: es el movimiento
 * reversible y el que la persona vino a hacer.
 *
 * ---------------------------------------------------------------------------
 * ESTE ARCHIVO NO EXPORTA NADA MAS QUE EL `default`. Next 15 lo prohibe en un
 * `page.tsx`, ni `tsc --noEmit` ni los tests lo ven, y el error habla de
 * `OmitWithTag`. Por eso los textos son constantes del modulo SIN exportar y
 * el spec los repite escritos a mano —que ademas es lo unico que le da dientes
 * a las igualdades: importar la constante y compararla contra si misma dejaria
 * pasar en verde cualquier cosa—. Lo que si hace falta compartir vive en
 * `listas.tsx`, que no es una ruta.
 */

/** Lo que se dice cuando no se puede leer la configuracion. */
const PRINCIPIO_DEL_FALLO_DE_LECTURA = 'No se pudo leer la configuracion de la web: ';

/** Lo que se dice cuando el `PUT` del formulario falla. El motivo va TAL CUAL. */
const PRINCIPIO_DEL_FALLO_DE_GUARDADO = 'No se pudo guardar la web: ';

const TEXTO_DEL_EXITO = 'Cambios guardados.';

/** Que esta pasando AHORA con el sitio, que es lo primero que hay que saber. */
const ESTADO_ENCENDIDA =
  'La web publica esta ENCENDIDA: cualquiera que entre a la direccion del gimnasio, sin cuenta y ' +
  'sin que nadie le de permiso, ve lo que este marcado aqui abajo.';

const ESTADO_APAGADA =
  'La web publica esta APAGADA: la direccion del gimnasio contesta lo mismo que la de un ' +
  'gimnasio que no existe. Lo de aqui abajo se puede editar y guardar igual, pero no lo ve nadie.';

/**
 * LAS DOS BANDERAS QUE PUBLICAN ALGO QUE NADIE ESCRIBIO PARA PUBLICARSE.
 *
 * Los testimonios y las preguntas los tecleo alguien SABIENDO que son para la
 * web. Los precios y la agenda no: son datos de la operacion del gimnasio, y
 * encender la bandera los saca a una pagina sin sesion.
 *
 * El aviso de los turnos libres viene del contrato, palabra por palabra: «OJO:
 * publica la agenda del gimnasio y cuan vacia esta». Un gimnasio con la agenda
 * vacia esta publicando que esta vacio, y eso no se lee en el nombre del
 * interruptor.
 *
 * VA AL LADO Y ES TEXTO. No en un `title=`, que no existe para quien mira
 * desde un telefono y que ningun lector de pantalla anuncia solo; no detras de
 * un «ver mas», que es donde van las cosas que nadie lee. Es la descripcion
 * accesible del propio control (`aria-describedby`), asi que se oye junto al
 * nombre del interruptor, y es un parrafo visible, asi que se lee junto a el.
 *
 * Y SE DICE ESTE LA BANDERA ENCENDIDA O APAGADA. El momento en que la
 * consecuencia importa es justo ANTES de encenderla.
 */
const CONSECUENCIA_DE_LOS_PRECIOS =
  'Pone la lista de precios de los packs en una pagina que puede leer cualquiera y que los ' +
  'buscadores indexan.';

const CONSECUENCIA_DE_LOS_TURNOS_LIBRES =
  'Publica la agenda: cualquiera ve que turnos quedan libres y, con eso, cuan vacio esta el ' +
  'gimnasio.';

/** La pregunta del dialogo de apagar. Nombra la accion, no «¿estas seguro?». */
const PREGUNTA_DE_APAGAR = 'Apagar la web publica del gimnasio';

const TEXTO_DE_APAGAR = 'Apagar la web';

/** Lo que el formulario grande tiene escrito. Todo texto: es lo que hay en un input. */
interface Borrador {
  colorPrimario: string;
  colorSecundario: string;
  tituloPrincipal: string;
  tagline: string;
  sobreElSalon: string;
  imagenPrincipalUrl: string;
  whatsapp: string;
  instagram: string;
  linkExtra: string;

  mostrarPrecios: boolean;
  mostrarTestimonios: boolean;
  mostrarFAQ: boolean;
  mostrarTurnosLibres: boolean;
}

/**
 * Los campos de texto, en un sitio solo.
 *
 * La lista se recorre para armar el cuerpo: asi un campo nuevo no puede
 * quedarse fuera del `PUT` por olvidarse de una linea, que con el reemplazo
 * completo significa BORRARLO en el servidor.
 */
const CAMPOS_DE_TEXTO = [
  'colorPrimario',
  'colorSecundario',
  'tituloPrincipal',
  'tagline',
  'sobreElSalon',
  'imagenPrincipalUrl',
  'whatsapp',
  'instagram',
  'linkExtra',
] as const;

type CampoDeTexto = (typeof CAMPOS_DE_TEXTO)[number];

/** Lo que dice el servidor, pasado a lo que se puede teclear: `null` es ''. */
function borradorDe(web: ConfiguracionWebSalon): Borrador {
  return {
    colorPrimario: web.colorPrimario,
    colorSecundario: web.colorSecundario,
    tituloPrincipal: web.tituloPrincipal ?? '',
    tagline: web.tagline ?? '',
    sobreElSalon: web.sobreElSalon ?? '',
    imagenPrincipalUrl: web.imagenPrincipalUrl ?? '',
    whatsapp: web.whatsapp ?? '',
    instagram: web.instagram ?? '',
    linkExtra: web.linkExtra ?? '',
    mostrarPrecios: web.mostrarPrecios,
    mostrarTestimonios: web.mostrarTestimonios,
    mostrarFAQ: web.mostrarFAQ,
    mostrarTurnosLibres: web.mostrarTurnosLibres,
  };
}

/**
 * El cuerpo del `PUT`. Ver el docblock de arriba: los cinco booleanos SIEMPRE,
 * los textos vacios OMITIDOS, y el `planDestacadoId` de vuelta tal cual.
 */
function cuerpoDeLaWeb(
  campos: Borrador,
  activa: boolean,
  planDestacadoId: string | null,
): Record<string, unknown> {
  const cuerpo: Record<string, unknown> = {
    activa,
    mostrarPrecios: campos.mostrarPrecios,
    mostrarTestimonios: campos.mostrarTestimonios,
    mostrarFAQ: campos.mostrarFAQ,
    mostrarTurnosLibres: campos.mostrarTurnosLibres,
  };

  for (const clave of CAMPOS_DE_TEXTO) {
    const valor = campos[clave].trim();
    if (valor !== '') cuerpo[clave] = valor;
  }

  if (planDestacadoId !== null) cuerpo.planDestacadoId = planDestacadoId;

  return cuerpo;
}

/** «a, b y c». Con una sola parte, la parte; con ninguna, nada. */
function enumerar(partes: string[]): string {
  if (partes.length <= 1) return partes.join('');

  return `${partes.slice(0, -1).join(', ')} y ${partes.at(-1) ?? ''}`;
}

/**
 * QUE DEJA DE VERSE AL APAGAR: lo que hoy esta encendido, no una lista fija.
 *
 * La portada va siempre —es lo que el endpoint publico devuelve sin depender
 * de ninguna bandera— y las otras cuatro solo si su bandera lo esta. Una lista
 * escrita a mano diria «dejan de verse los precios» a un gimnasio que los
 * tiene ocultos: una frase falsa dentro del dialogo que decide si se apaga el
 * sitio.
 */
function loQueDejaDeVerse(web: ConfiguracionWebSalon): string {
  const partes = ['la portada con el nombre, el titulo y el texto del gimnasio'];

  if (web.mostrarPrecios) partes.push('los precios de los packs');
  if (web.mostrarTestimonios) partes.push('los testimonios');
  if (web.mostrarFAQ) partes.push('las preguntas frecuentes');
  if (web.mostrarTurnosLibres) partes.push('los turnos libres');

  return enumerar(partes);
}

/**
 * Un interruptor con su nombre al lado y, cuando la tiene, su consecuencia
 * DEBAJO Y VISIBLE.
 *
 * Vive aqui dentro y sin exportar por lo de siempre: `page.tsx` no puede
 * exportar nada mas que el `default`.
 */
function Interruptor({
  id,
  etiqueta,
  consecuencia,
  marcado,
  alCambiar,
}: {
  id: string;
  etiqueta: string;
  consecuencia?: string;
  marcado: boolean;
  alCambiar: (marcado: boolean) => void;
}) {
  const idConsecuencia = `${id}-consecuencia`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex items-center gap-2 text-sm text-slate-900">
        <input
          id={id}
          type="checkbox"
          checked={marcado}
          // La consecuencia es la descripcion ACCESIBLE del control, no un
          // parrafo suelto que casualmente esta cerca: asi un lector de
          // pantalla la lee junto al nombre del interruptor.
          aria-describedby={consecuencia === undefined ? undefined : idConsecuencia}
          onChange={(evento) => alCambiar(evento.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        {etiqueta}
      </label>

      {consecuencia !== undefined && (
        <p id={idConsecuencia} className="pl-6 text-xs text-amber-800">
          {consecuencia}
        </p>
      )}
    </div>
  );
}

/** La pantalla ya pasada la puerta. Aqui dentro viven TODOS los hooks. */
function PantallaDeLaWeb() {
  const { slug } = useParams<{ slug: string }>();
  const config = useConfigWebSalon();

  /**
   * DOS MUTACIONES CONTRA EL MISMO `PUT`, Y HACEN FALTA LAS DOS.
   *
   * El formulario y el interruptor maestro son dos acciones distintas con dos
   * resultados que se pintan en dos sitios distintos —el del interruptor va
   * DENTRO del dialogo—. Con una sola instancia, un fallo al apagar encenderia
   * el cartel de error del formulario, que esta en la otra punta de la
   * pantalla y habla de otra cosa.
   */
  const guardar = useGuardarWebSalon();
  const interruptor = useGuardarWebSalon();

  /**
   * El borrador es `null` MIENTRAS NADIE ESCRIBIO, y entonces manda el
   * servidor. No se siembra con un `useEffect` al llegar la respuesta: eso
   * deja una ventana de un render con los campos vacios y pisa lo que la
   * persona este escribiendo cada vez que la consulta se refresca —que aqui
   * pasa DE VERDAD, porque dar de alta un testimonio invalida esta misma
   * clave—.
   */
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [apagando, setApagando] = useState(false);

  const web = config.data;

  if (config.isPending) {
    return <p className="text-sm text-slate-500">Cargando la configuracion de la web…</p>;
  }

  /**
   * UN FALLO AL LEER NO SE DIBUJA COMO UNA WEB SIN CONFIGURAR.
   *
   * Es el 404-pintado-como-dato-vacio de la Fase 10, y aqui la forma vacia es
   * PLAUSIBLE: un gimnasio que nunca toco la web tiene exactamente esto —la
   * web apagada, los textos en blanco y las dos listas sin nada—, asi que un
   * fallo dibujado con los campos vacios se lee como «mi web esta sin
   * configurar» y no como «no se pudo leer». Peor todavia: el formulario
   * seguiria ahi, y guardarlo escribiria esos blancos encima de lo que si hay.
   *
   * Asi que no hay formulario, no hay banderas, no hay listas y no hay
   * interruptor: hay el motivo.
   */
  if (web === undefined) {
    return (
      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">La web publica</h1>
        <Aviso tono="error">
          <span data-fallo="lectura">
            {PRINCIPIO_DEL_FALLO_DE_LECTURA}
            {config.error.message}
          </span>
        </Aviso>
      </section>
    );
  }

  const campos: Borrador = borrador ?? borradorDe(web);

  function cambiar(parte: Partial<Borrador>): void {
    setBorrador({ ...campos, ...parte });
  }

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    if (web === undefined) return;

    guardar.mutate(cuerpoDeLaWeb(campos, web.activa, web.planDestacadoId), {
      // Al volver, manda otra vez el servidor: la invalidacion refresca la
      // consulta y el borrador tiene que soltar el mando para que lo que se
      // vea sea lo guardado y no lo tecleado.
      onSuccess: () => setBorrador(null),
    });
  }

  /**
   * El interruptor maestro manda LO DEL SERVIDOR con `activa` cambiada: ver el
   * docblock de arriba. No toca el borrador, asi que lo que haya a medio
   * escribir sigue a medio escribir.
   */
  function cambiarLaWeb(activa: boolean): void {
    if (web === undefined) return;

    interruptor.mutate(cuerpoDeLaWeb(borradorDe(web), activa, web.planDestacadoId), {
      onSuccess: () => setApagando(false),
    });
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">La web publica</h1>

      {/* QUE PASA AHORA MISMO CON EL SITIO. Va en un nodo propio para poder
          afirmar sobre EL, por igualdad, sin buscar subcadenas sueltas. */}
      <section className="flex flex-col items-start gap-2">
        <p className="text-sm text-slate-700" data-estado>
          {web.activa ? ESTADO_ENCENDIDA : ESTADO_APAGADA}
        </p>

        {/* El enlace SOLO cuando la web esta encendida: ofrecer «ver la web
            publica» con la web apagada lleva al 404 que ella misma provoca.
            Y el `href` es `/{slug}` a secas —ningun dato de configuracion
            viaja de copiloto en la URL—. */}
        {web.activa && (
          <Link href={`/${slug}`} className="text-sm underline">
            Ver la web publica
          </Link>
        )}

        {web.activa ? (
          <Boton type="button" tono="peligro" onClick={() => setApagando(true)}>
            Apagar la web publica
          </Boton>
        ) : (
          <Boton type="button" cargando={interruptor.isPending} onClick={() => cambiarLaWeb(true)}>
            Encender la web publica
          </Boton>
        )}

        {/* LA CONFIRMACION DICE QUE DEJA DE VERSE, no «¿estas seguro?».
            `Confirmar` no sabe decirlo solo: su `pregunta` es obligatoria y no
            tiene valor por defecto justamente para que cada pantalla escriba
            la frase entera. */}
        {apagando && (
          <Confirmar
            pregunta={PREGUNTA_DE_APAGAR}
            detalle={
              `Ahora mismo se ve, sin cuenta y desde cualquier sitio: ${loQueDejaDeVerse(web)}. ` +
              'Al apagarla deja de verse todo eso. No se borra nada: volver a encenderla lo ' +
              'devuelve tal cual.'
            }
            textoDeConfirmar={TEXTO_DE_APAGAR}
            cargando={interruptor.isPending}
            error={interruptor.isError ? interruptor.error.message : undefined}
            alConfirmar={() => cambiarLaWeb(false)}
            alCancelar={() => setApagando(false)}
          />
        )}
      </section>

      <form className="flex flex-col gap-4" onSubmit={enviar} noValidate>
        <fieldset className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-700">Que se publica</legend>

          {/* LAS CUATRO, SIEMPRE, ENCENDIDAS O APAGADAS: una bandera apagada
              que no se dibuja no se puede encender desde ningun sitio. */}
          <Interruptor
            id="mostrar-precios"
            etiqueta="Mostrar los precios de los packs"
            consecuencia={CONSECUENCIA_DE_LOS_PRECIOS}
            marcado={campos.mostrarPrecios}
            alCambiar={(valor) => cambiar({ mostrarPrecios: valor })}
          />

          <Interruptor
            id="mostrar-testimonios"
            etiqueta="Mostrar los testimonios"
            marcado={campos.mostrarTestimonios}
            alCambiar={(valor) => cambiar({ mostrarTestimonios: valor })}
          />

          <Interruptor
            id="mostrar-faq"
            etiqueta="Mostrar las preguntas frecuentes"
            marcado={campos.mostrarFAQ}
            alCambiar={(valor) => cambiar({ mostrarFAQ: valor })}
          />

          <Interruptor
            id="mostrar-turnos-libres"
            etiqueta="Mostrar los turnos libres"
            consecuencia={CONSECUENCIA_DE_LOS_TURNOS_LIBRES}
            marcado={campos.mostrarTurnosLibres}
            alCambiar={(valor) => cambiar({ mostrarTurnosLibres: valor })}
          />
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-700">La portada</legend>

          <Campo
            etiqueta="Titulo principal"
            id="titulo-principal"
            value={campos.tituloPrincipal}
            onChange={(evento) => cambiar({ tituloPrincipal: evento.target.value })}
          />

          <Campo
            etiqueta="Tagline"
            id="tagline"
            value={campos.tagline}
            onChange={(evento) => cambiar({ tagline: evento.target.value })}
          />

          <CampoLargo
            etiqueta="Sobre el gimnasio"
            id="sobre-el-salon"
            filas={5}
            valor={campos.sobreElSalon}
            alCambiar={(valor) => cambiar({ sobreElSalon: valor })}
          />

          <Campo
            etiqueta="URL de la imagen principal (https)"
            id="imagen-principal-url"
            value={campos.imagenPrincipalUrl}
            onChange={(evento) => cambiar({ imagenPrincipalUrl: evento.target.value })}
          />

          {/* LOS COLORES VAN EN CAJAS DE TEXTO Y NO EN UN `type="color"`.
              `@IsHexColor` acepta `#abc` y `#aabbccdd`, y el selector nativo
              del navegador solo entiende `#rrggbb`: lo que no entiende lo
              reescribe a `#000000` sin avisar. O sea que convertiria «no se
              dibujar tu color» en «tu color es negro», que es una mentira con
              forma de dato — justo el fallo que este panel se pasa la vida
              evitando. */}
          <Campo
            etiqueta="Color primario (#rrggbb)"
            id="color-primario"
            value={campos.colorPrimario}
            onChange={(evento) => cambiar({ colorPrimario: evento.target.value })}
          />

          <Campo
            etiqueta="Color secundario (#rrggbb)"
            id="color-secundario"
            value={campos.colorSecundario}
            onChange={(evento) => cambiar({ colorSecundario: evento.target.value })}
          />
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-700">Como contactar</legend>

          <Campo
            etiqueta="WhatsApp"
            id="whatsapp"
            value={campos.whatsapp}
            onChange={(evento) => cambiar({ whatsapp: evento.target.value })}
          />

          <Campo
            etiqueta="Instagram"
            id="instagram"
            value={campos.instagram}
            onChange={(evento) => cambiar({ instagram: evento.target.value })}
          />

          <Campo
            etiqueta="Otro enlace (https)"
            id="link-extra"
            value={campos.linkExtra}
            onChange={(evento) => cambiar({ linkExtra: evento.target.value })}
          />
        </fieldset>

        {/* Un campo vacio se BORRA, y conviene decirlo antes y no despues: con
            el reemplazo completo del `PUT`, dejar el tagline en blanco y
            guardar lo borra en el servidor. */}
        <p className="text-xs text-slate-500">
          Lo que quede vacio se borra: guardar escribe estos campos tal como estan.
        </p>

        <Boton type="submit" cargando={guardar.isPending} className="self-start">
          Guardar los cambios
        </Boton>
      </form>

      {/* `alerta` porque el resultado aparece DESPUES de pulsar y en otro sitio
          de la pantalla: sin el, quien usa un lector de pantalla pulsa y para
          el no pasa nada. */}
      {guardar.isSuccess && (
        <Aviso tono="exito" alerta>
          <span data-resultado="exito">{TEXTO_DEL_EXITO}</span>
        </Aviso>
      )}

      {guardar.isError && (
        <Aviso tono="error">
          <span data-resultado="error">
            {PRINCIPIO_DEL_FALLO_DE_GUARDADO}
            {guardar.error.message}
          </span>
        </Aviso>
      )}

      <ListaDeTestimonios testimonios={web.testimonios} />
      <ListaDePreguntas preguntas={web.preguntas} />
    </section>
  );
}

/**
 * LA PUERTA, Y NADA MAS QUE LA PUERTA.
 *
 * Un solo hook —leer el contexto— y despues un `return null`: todo lo que pide
 * algo esta del otro lado, asi que no montar la pantalla es no tener ninguna
 * de las seis peticiones. `rol === null` es SIN PROVEEDOR y vale «no alcanza
 * para nada»: falla cerrada. Y `rolAlcanza` es una jerarquia, asi que un
 * SUPERADMIN entra; comparar con `rol === 'ADMIN_SALON'` lo dejaria fuera de
 * su propio sistema.
 */
export default function PaginaDeLaWeb() {
  const rol = useRolDeQuienMira();

  if (rol === null || !rolAlcanza(rol, 'ADMIN_SALON')) return null;

  return <PantallaDeLaWeb />;
}
