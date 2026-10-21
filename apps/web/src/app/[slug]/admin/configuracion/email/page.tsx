'use client';

import { type FormEvent, useRef, useState } from 'react';
import { rolAlcanza } from '@boxadmin/shared';
import { Campo } from '@/componentes/formulario';
import { Aviso, Boton } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { useConfigSmtp, useGuardarSmtp } from '@/hooks/use-configuracion';
import { useRolDeQuienMira } from '../../rol-del-panel';
import { LasPlantillas } from './plantillas';

/**
 * EL SERVIDOR DE CORREO DEL GIMNASIO: LA UNICA CREDENCIAL DE SERVIDOR DEL PANEL.
 *
 * ---------------------------------------------------------------------------
 * LA CLAVE NO SE PUEDE CONSERVAR, Y LA PANTALLA LO EXPLICA EN VEZ DE FINGIRLO.
 *
 * `ConfiguracionSmtpPublica` no lleva la contraseña ni cifrada ni enmascarada
 * —solo un `tieneClave: boolean`—, y el contrato dice por que: «una mascara
 * sigue confirmando su longitud». Comprobado en el contrato Y en el service:
 * `verSmtp()` arma la respuesta campo a campo y la clave no esta entre ellos.
 *
 * Y `GuardarSmtpDto.clave` es `clave!: string` con `@IsString()`,
 * `@IsNotEmpty()` y `@MaxLength(255)`. MEDIDO CONTRA EL DTO, no deducido: no
 * lleva `@IsOptional()` —a diferencia de `seguro` y `emailDestino`, que si lo
 * llevan y estan ahi mismo—, asi que NO EXISTE «dejá el campo vacio para
 * conservar la que hay». Cambiar el puerto obliga a reescribir la contraseña
 * entera.
 *
 * De ahi sale la unica decision de diseño que importa en este archivo: EL
 * CAMPO ARRANCA VACIO Y SE DICE POR QUE. Un campo con puntitos de relleno que
 * al guardar manda vacio —o peor, que manda los puntitos— es exactamente la
 * mentira que esta fase existe para no cometer: se ve como «la que hay sigue
 * puesta» y es «la API va a contestar 400», o «acabo de guardar ocho puntos
 * como contraseña del correo del gimnasio».
 *
 * Es la misma familia que los tres limites que las pantallas explican desde la
 * Fase 7 —no se puede vaciar el `packId` de un alumno, ni sus vigencias, ni
 * quitar un limite ya puesto a una invitacion—: cuando el contrato no deja
 * hacer algo, se dice, no se disfraza.
 *
 * ---------------------------------------------------------------------------
 * LOS DOS BOOLEANOS DEL CUERPO VIAJAN SIEMPRE. ES EL BUG DE `mostrarPrecios`.
 *
 * `guardarSmtp` hace `seguro: dto.seguro ?? true` y `emailDestino:
 * dto.emailDestino ?? null`. O sea que un formulario que «mande solo lo que
 * cambio» —el reflejo natural con los campos opcionales— le ENCIENDE el TLS a
 * un gimnasio que corre en el puerto 25 sin cifrar, y le BORRA la casilla de
 * respuesta a quien la tuviera puesta. Por eso `seguro` va SIEMPRE con su
 * valor, aunque sea `false`, y `emailDestino` se siembra con lo que dijo el
 * servidor para que guardar el host no lo tire.
 *
 * `emailDestino` vacio se OMITE y no viaja como `''`: el DTO lo valida con
 * `@IsEmail()`, asi que una cadena vacia seria un 400 en vez de un borrado.
 * Omitirlo ES como se borra —`?? null` en el service—, que es lo que quiere
 * quien deja el campo en blanco a proposito.
 *
 * ---------------------------------------------------------------------------
 * UN 404 AL LEER NO ES UN FALLO: ES UN GIMNASIO SIN CORREO CONFIGURADO.
 *
 * `verSmtp()` lanza `NotFoundException('Este gimnasio no tiene SMTP
 * configurado')` cuando NO HAY FILA. Si el 404 se dibujara como los demas
 * errores —el motivo y nada mas—, un gimnasio que todavia no configuro el
 * correo no tendria formulario, y esta pantalla es el UNICO sitio del producto
 * desde el que se puede configurar: seria la bandera apagada que no se dibuja
 * de la Fase 12, pero con el area entera adentro.
 *
 * Asi que el 404 abre el formulario VACIO y lo dice; cualquier otro estado es
 * un fallo de verdad y no hay formulario, porque unos campos vacios encima de
 * una configuracion que SI existe se leen como «mi gimnasio no tiene correo» y
 * guardar encima la pisaria. Es el 404-dibujado-como-dato-vacio de la Fase 10,
 * separado por el ESTADO y no por el mensaje.
 *
 * ---------------------------------------------------------------------------
 * EL EXITO SI PUEDE AFIRMAR ALGO, Y ES LO CONTRARIO QUE EN EL INDICE.
 *
 * `guardarSmtp` llama a `this.envios.verificar(datos)` ANTES de escribir —hay
 * un test del repo que fija ese orden, 'verifica la conexion ANTES de
 * guardar'—, y si verificar falla no se guarda nada. O sea que un guardado que
 * salio bien SI demuestra que el servidor de correo contesto y acepto estos
 * datos. Lo que no demuestra es que un email haya llegado a nadie: eso es la
 * cola, y el boton del indice ya dice lo poco que puede decir de ella.
 *
 * ---------------------------------------------------------------------------
 * EL FALLO DE GUARDADO SE MUESTRA TAL CUAL, Y NO ES HIGIENE: ES LA UNICA PISTA.
 *
 * Cuando la verificacion falla, la API contesta un 400 con
 * `No se pudo conectar al servidor SMTP: ${motivoSeguro(...)}`. `motivoSeguro`
 * ya hizo el trabajo delicado —leido entero: devuelve el `code` de nodemailer
 * si tiene forma de code, y si no el mensaje del servidor con la clave borrada
 * en claro, en sus cuatro formas base64 conocidas, tolerando separadores por el
 * medio, y con cualquier cosa que parezca base64 largo redactada—. Lo que
 * garantiza es que la CLAVE no vuelve en ese texto; lo que NO garantiza es que
 * el texto sea corto, bonito ni familiar: puede ser `ECONNREFUSED`, puede ser
 * `535 5.7.8 Error: authentication failed` y puede ser una parrafada de un
 * servidor ajeno con `[redactado]` por el medio.
 *
 * Reescribirlo por un «no se pudo guardar, intentalo de nuevo» tira lo unico
 * que distingue un host mal tecleado de un puerto cerrado de una contraseña de
 * aplicacion caducada. Se muestra entero y sin tocar.
 *
 * ---------------------------------------------------------------------------
 * LA CLAVE NO ENTRA EN EL ESTADO DE REACT, Y ESTO SE MIDIO.
 *
 * Los demas campos son CONTROLADOS —su valor vive en `borrador` y React lo
 * pinta—. El de la contraseña NO: es el unico campo NO CONTROLADO de la
 * pantalla, se lee con un `ref` en el momento de guardar y se vacia a mano al
 * guardar bien.
 *
 * No es una preferencia de estilo. MEDIDO con el spec de esta tarea, que fallo
 * y por eso existe este parrafo: React, en un input controlado, no solo pone la
 * propiedad `value`, tambien la refleja en el ATRIBUTO `value` del marcado
 * —`setDefaultValue` hace `node.defaultValue = valor`, y `defaultValue` ES el
 * atributo—. O sea que un `<input type="password" value={campos.clave}>` deja
 * la contraseña del servidor de correo ESCRITA en el HTML:
 * `document.body.innerHTML` la lleva, un `outerHTML` en un log la lleva, y la
 * foto del DOM que mandan los reportadores de errores la lleva. El valor de un
 * campo NO controlado vive solo en la PROPIEDAD, que no se serializa.
 *
 * Es el mismo tipo de agujero que el `gcTime`: no lo abre nadie escribiendo
 * algo raro, lo abre la forma normal de escribir un formulario. Y el precio es
 * pequeño: nada en esta pantalla necesita releer la clave —no se valida su
 * contenido, no se dibuja, no se compara—, solo hace falta saber si esta vacia
 * al pulsar guardar.
 *
 * Por eso el campo se escribe a mano y no con `Campo`: el componente compartido
 * pasa el `value` desde arriba, que es justo lo que no se quiere, y el campo
 * mas delicado del panel es el que menos conviene esconder detras de una
 * abstraccion. Lo que se copia de `Campo` es lo accesible —el `htmlFor`, el
 * `aria-invalid` y el `aria-describedby` apuntando al `#clave-error`—.
 *
 * ---------------------------------------------------------------------------
 * LO QUE EL NAVEGADOR HACE SOLO CON UN CAMPO DE CONTRASEÑA.
 *
 * El `autoComplete="off"` del formulario y del campo no es decoracion y
 * tampoco es una garantia: es la UNICA declaracion que el marcado puede hacer
 * sobre algo que, sin ella, el navegador hace sin que nadie escriba una linea
 * de JavaScript. Un `<input type="password">` al lado de un campo de usuario
 * es, para el heuristico de Chrome y de Firefox, un formulario de login: se
 * ofrece a guardar la contraseña, y lo que guarda se sincroniza con la cuenta
 * de quien este sentado en el mostrador y aparece en SU telefono. Es el mismo
 * agujero que la Tarea 1 cerro del lado del JavaScript con
 * `navigator.credentials.store`, alcanzado sin JavaScript ninguno.
 *
 * Los navegadores honran `autocomplete="off"` de forma desigual y eso esta
 * dicho a proposito: la defensa de verdad es que esta pantalla no vuelve a
 * LEER el campo —ni para rellenarlo, ni para copiarlo, ni para guardarlo en
 * ningun sitio— y que la mutacion lleva `gcTime: 0`. El atributo es lo que se
 * puede declarar, no lo que se puede prometer.
 *
 * Y NINGUN CONTROL DE ESTE FORMULARIO LLEVA `name`, que es la parte que no se
 * ve. Un `<form>` sin `action` al que se le envia de forma NATIVA navega a la
 * URL actual con los controles con `name` serializados en la query. El
 * `onSubmit` de React que hace `preventDefault()` solo existe DESPUES de la
 * hidratacion: entre que llega el HTML y que llega el JavaScript —o si el
 * chunk no llega nunca— pulsar Enter en el campo de la contraseña es un envio
 * nativo, y con un `name="clave"` la credencial del servidor de correo acaba
 * en la barra de direcciones, en el historial del mostrador y en el `Referer`
 * del siguiente salto. jsdom no implementa el envio nativo de formularios, asi
 * que ese camino no existe en los tests: lo que se afirma es el MARCADO.
 *
 * ---------------------------------------------------------------------------
 * LAS PLANTILLAS YA ESTAN, Y SON EL OTRO RECURSO DEL MISMO CONTROLLER.
 *
 * `usePlantillas` y `useGuardarPlantilla` son el OTRO recurso del mismo
 * `@Controller('config')`, con su propia clave de cache, y viven en
 * `./plantillas`. Su sitio es un `<LasPlantillas />` hermano de
 * `<ElServidorDeCorreo />` dentro de `PantallaDelEmail`, abajo del todo.
 *
 * LOS DOS RECURSOS SON INDEPENDIENTES Y SE DIBUJAN INDEPENDIENTES: un fallo
 * leyendo el SMTP no borra las plantillas de la pantalla, y al reves tampoco.
 * Cada seccion lleva su `data-seccion` para que un test pueda afirmar sobre
 * una sin que la otra se le cuele; lo que hay DENTRO de la seccion del
 * servidor de correo no cambio ni una linea con la llegada de la Tarea 6.
 *
 * ---------------------------------------------------------------------------
 * ESTE ARCHIVO NO EXPORTA NADA MAS QUE EL `default`. Next 15 lo prohibe en un
 * `page.tsx`, ni `tsc --noEmit` ni los tests lo ven, y el error habla de
 * `OmitWithTag`. Por eso los textos son constantes del modulo SIN exportar y
 * el spec los repite escritos a mano —que ademas es lo unico que le da dientes
 * a las igualdades: importar la constante y compararla contra si misma dejaria
 * pasar en verde cualquier cosa—.
 */

/** Lo que se dice cuando la lectura falla DE VERDAD (cualquier estado que no sea 404). */
const PRINCIPIO_DEL_FALLO_DE_LECTURA = 'No se pudo leer la configuracion del correo: ';

/** Lo que se dice cuando el `PUT` falla. El motivo de la API va TAL CUAL. */
const PRINCIPIO_DEL_FALLO_DE_GUARDADO = 'No se pudo guardar la configuracion del correo: ';

/**
 * EL EXITO AFIRMA LO QUE LA API SI DEMUESTRA, Y SE PARA DONDE SE TIENE QUE PARAR.
 *
 * La verificacion corre ANTES del guardado y lo aborta si falla, asi que un
 * guardado bueno prueba que el servidor contesto. No prueba que un email haya
 * salido: eso es la cola, y de la cola esta pantalla no sabe nada.
 */
const TEXTO_DEL_EXITO =
  'Guardado. La conexion se prueba ANTES de guardar, asi que esto dice ademas que el servidor de ' +
  'correo contesto y acepto estos datos. No dice que ningun email haya llegado a nadie: eso ' +
  'depende de la cola.';

/**
 * EL 404 NO ES UN FALLO. Se dice que los campos estan vacios PORQUE NO HAY
 * NADA, para que nadie lea el formulario en blanco como una lectura que fallo.
 */
const TEXTO_SIN_CONFIGURAR =
  'Este gimnasio todavia no tiene correo configurado: los avisos no salen por ningun lado. Los ' +
  'campos de abajo estan vacios porque no hay nada guardado, no porque no se haya podido leer.';

/**
 * LO UNICO QUE SE PUEDE DECIR DE LA CLAVE GUARDADA: QUE LA HAY.
 *
 * Ni cuanto mide, ni cuando se puso, ni como empieza. `tieneClave` es un
 * booleano y es TODO lo que la respuesta trae; cualquier otra cosa en esta
 * frase seria inventada o —peor— deducida de algo que el servidor se cuida de
 * no mandar.
 */
const TEXTO_HAY_CLAVE =
  'Hay una contraseña guardada. Que la hay es lo unico que se puede saber de ella desde aca: la ' +
  'API no la devuelve ni enmascarada, porque una mascara ya confirmaria cuanto mide.';

const TEXTO_NO_HAY_CLAVE = 'No hay ninguna contraseña guardada.';

/**
 * EL LIMITE, DICHO ENTERO Y EN LOS DOS CASOS.
 *
 * Va fuera del nodo que cambia con `tieneClave` a proposito: es verdad igual
 * haya clave guardada o no, y asi el spec puede afirmar que los dos montajes
 * dicen EXACTAMENTE lo mismo salvo la frase que debe cambiar.
 */
const TEXTO_HAY_QUE_REESCRIBIRLA =
  'La contraseña hay que escribirla entera cada vez que se guarde, aunque lo unico que se cambie ' +
  'sea el puerto: la API la pide siempre y no acepta el campo vacio. No existe un «dejalo en ' +
  'blanco para conservar la que hay», y esta pantalla no va a fingir que exista.';

/** Lo que se dice cuando el campo de la clave esta vacio al intentar guardar. */
const TEXTO_DE_LA_CLAVE_QUE_FALTA =
  'Escribi la contraseña del servidor de correo: no se puede conservar la que hay.';

/** Lo que se dice cuando el puerto no es un numero entero. */
const TEXTO_DEL_PUERTO_ROTO = 'Poné un numero entero de puerto.';

/** Lo que se dice cuando un campo obligatorio esta en blanco. */
const TEXTO_DEL_CAMPO_VACIO = 'Esto no puede quedar en blanco.';

/**
 * Lo que el formulario tiene escrito, como texto: es lo que hay en un input.
 *
 * LA CLAVE NO ESTA AQUI, y es el punto entero de este archivo: su campo no es
 * controlado, asi que su valor no vive en el estado de React ni —lo que de
 * verdad importa— en el atributo `value` del marcado. Ver el docblock de
 * arriba, que lo explica medido.
 */
interface Borrador {
  host: string;
  puerto: string;
  seguro: boolean;
  usuario: string;
  emailOrigen: string;
  emailDestino: string;
}

/**
 * EL BORRADOR DE UN GIMNASIO SIN CONFIGURAR: TODO VACIO Y `seguro` ENCENDIDO.
 *
 * El `true` no es un dato inventado del servidor —no hay fila que leer— sino
 * el unico valor que se puede ofrecer sin mentir: coincide con el defecto del
 * service (`dto.seguro ?? true`) y es el lado seguro de un interruptor que
 * decide si la contraseña sale cifrada por el cable. Y viaja EXPLICITO igual,
 * como el del gimnasio que si tiene fila.
 *
 * El puerto arranca VACIO y no en 587: un numero puesto por nosotros se ve
 * igual que un numero elegido por el gimnasio, y el de al lado —el 465— es el
 * que hace falta cuando `seguro` esta encendido de verdad. Un campo vacio con
 * su aviso es peor de rellenar y mejor de leer.
 */
const BORRADOR_VACIO: Borrador = {
  host: '',
  puerto: '',
  seguro: true,
  usuario: '',
  emailOrigen: '',
  emailDestino: '',
};

/**
 * El texto de un campo como puerto, o `null` si no es una cantidad.
 *
 * ESTO NO ES LA POLITICA, ES EL PARSEO: el rango vive en `GuardarSmtpDto`
 * (`@Min(1)` y `@Max(65535)`) y se queda alli; repetirlo aqui seria una
 * segunda fuente de verdad que el dia que cambie deja la pantalla rechazando
 * lo que la API acepta. Lo que se ataja es que `Number('')` es CERO —un campo
 * vacio viajaria como puerto 0— y que `parseInt` se come la cola de `587abc`.
 */
function puertoDelCampo(texto: string): number | null {
  if (texto.trim() === '') return null;

  const numero = Number(texto);
  return Number.isInteger(numero) ? numero : null;
}

/**
 * El estado HTTP de un fallo de lectura, o `null` si no viene de la API.
 *
 * `useQuery` tipa su error como `Error` a secas —este repo no tiene la
 * aumentacion `Register` de TanStack— asi que el `instanceof` no es ceremonia:
 * es el mismo patron que `analisis`, `ausencias` y `calendario`. Y es la
 * respuesta honesta a un error que NO viene de `pedir` —un fallo de parseo, un
 * bug en el `queryFn`—: eso no es un 404, es un fallo, y cae del lado del
 * fallo.
 */
function estadoDelFallo(error: Error): number | null {
  return error instanceof ErrorDeApi ? error.estado : null;
}

/** El formulario del servidor de correo. La mitad de arriba de la pantalla. */
function ElServidorDeCorreo() {
  const config = useConfigSmtp();
  const guardar = useGuardarSmtp();

  /**
   * El borrador es `null` MIENTRAS NADIE ESCRIBIO, y entonces mandan los
   * valores del servidor —menos la clave, que el servidor no manda—.
   *
   * No se siembra con un `useEffect` al llegar la respuesta: eso deja una
   * ventana de un render con los campos vacios y pisa lo que la persona este
   * escribiendo si la consulta se refresca sola. Mismo criterio que el
   * check-in.
   */
  const [borrador, setBorrador] = useState<Borrador | null>(null);

  /**
   * Los errores de campo no se pintan hasta el primer intento de guardar.
   *
   * Un gimnasio sin configurar abre el formulario con cinco campos vacios: con
   * los errores desde el primer render, la pantalla recibe a quien viene a
   * configurar el correo con cinco carteles rojos de cosas que todavia no
   * tuvo ocasion de hacer mal.
   */
  const [seIntentoGuardar, setSeIntentoGuardar] = useState(false);

  /**
   * EL CAMPO DE LA CLAVE, QUE NO ES CONTROLADO: se lee de aqui al guardar.
   *
   * Y un booleano aparte para su error, porque sin valor en el estado no hay
   * nada que recalcular al teclear: el cartel se enciende al intentar guardar
   * con el campo vacio y se apaga en cuanto alguien escribe una tecla.
   */
  const campoDeClave = useRef<HTMLInputElement>(null);
  const [faltaLaClave, setFaltaLaClave] = useState(false);

  if (config.isPending) {
    return <p className="text-sm text-slate-500">Cargando la configuracion del correo…</p>;
  }

  const smtp = config.data;

  /**
   * UN FALLO DE VERDAD NO SE DIBUJA COMO UN GIMNASIO SIN CORREO.
   *
   * El 404 es el gimnasio sin fila y abre el formulario (abajo). Cualquier
   * otro estado —un 503, un 500, un `estado: 0` sin red— es una lectura que no
   * llego: no hay formulario, porque unos campos vacios encima de una
   * configuracion que SI existe se leen como «no hay correo configurado» y
   * guardar encima la pisaria entera.
   */
  if (smtp === undefined && estadoDelFallo(config.error) !== 404) {
    return (
      <section className="flex flex-col gap-4" data-seccion="servidor-de-correo">
        <h1 className="text-2xl font-semibold text-slate-900">El email</h1>
        <Aviso tono="error">
          <span data-fallo="lectura">
            {PRINCIPIO_DEL_FALLO_DE_LECTURA}
            {config.error.message}
          </span>
        </Aviso>
      </section>
    );
  }

  /**
   * LA CLAVE NO APARECE EN ESTA SIEMBRA, PORQUE NO HAY NADA CON QUE SEMBRARLA.
   *
   * `smtp` no la trae y aqui no se inventa. Su campo no es controlado, asi que
   * ni siquiera hay un `''` que poner: nace vacio porque en el marcado no hay
   * ningun `value` ni ningun `defaultValue` que lo llene. Es el campo donde un
   * `?? ''` disfrazado de comodidad —un `'••••••••'`, un `placeholder` con
   * puntos— seria la mentira entera de esta pantalla.
   */
  const campos: Borrador =
    borrador ??
    (smtp === undefined
      ? BORRADOR_VACIO
      : {
          host: smtp.host,
          puerto: String(smtp.puerto),
          seguro: smtp.seguro,
          usuario: smtp.usuario,
          emailOrigen: smtp.emailOrigen,
          emailDestino: smtp.emailDestino ?? '',
        });

  const puerto = puertoDelCampo(campos.puerto);

  /**
   * Los cinco obligatorios del DTO, mirados aqui para no gastar un viaje en
   * aprender lo que ya sabemos. El rango del puerto y el formato del email NO
   * se repiten: esos los dice la API y su mensaje vuelve tal cual.
   */
  const errores = {
    host: campos.host.trim() === '' ? TEXTO_DEL_CAMPO_VACIO : undefined,
    puerto: puerto === null ? TEXTO_DEL_PUERTO_ROTO : undefined,
    usuario: campos.usuario.trim() === '' ? TEXTO_DEL_CAMPO_VACIO : undefined,
    emailOrigen: campos.emailOrigen.trim() === '' ? TEXTO_DEL_CAMPO_VACIO : undefined,
  };

  const hayAlgoMal = Object.values(errores).some((error) => error !== undefined);

  /** Solo se pintan despues del primer intento. Ver `seIntentoGuardar`. */
  const error = (cual: keyof typeof errores): string | undefined =>
    seIntentoGuardar ? errores[cual] : undefined;

  function cambiar(parte: Partial<Borrador>): void {
    setBorrador({ ...campos, ...parte });
  }

  function enviar(evento: FormEvent): void {
    evento.preventDefault();
    setSeIntentoGuardar(true);

    // La clave se lee del DOM, que es el unico sitio donde esta. El `?? ''` es
    // el campo que todavia no se monto, que no es un caso real pero es lo que
    // dice el tipo del `ref`.
    const clave = campoDeClave.current?.value ?? '';
    setFaltaLaClave(clave === '');

    if (hayAlgoMal || puerto === null || clave === '') return;

    guardar.mutate(
      {
        host: campos.host,
        puerto,
        // SIEMPRE, aunque sea `false`: el service hace `dto.seguro ?? true` y
        // omitirlo le enciende el TLS a quien lo tenia apagado.
        seguro: campos.seguro,
        usuario: campos.usuario,
        clave,
        emailOrigen: campos.emailOrigen,
        // Vacio se OMITE y no viaja como `''`: el DTO lo valida con
        // `@IsEmail()`, asi que `''` seria un 400 en vez del borrado que
        // quiere quien dejo el campo en blanco.
        ...(campos.emailDestino.trim() === '' ? {} : { emailDestino: campos.emailDestino }),
      },
      {
        /**
         * AL GUARDAR BIEN SE SUELTA EL BORRADOR Y SE BORRA LA CLAVE A MANO.
         *
         * El borrador se suelta para que lo que se vea sea lo guardado y no lo
         * tecleado —la invalidacion del hook refresca la consulta—. Y el campo
         * de la clave se vacia EXPLICITAMENTE: como no es controlado, nadie lo
         * vacia por el, y lo que quedaria es la credencial del servidor de
         * correo escrita en un campo de una pestaña que no se cierra hasta que
         * cierra el gimnasio.
         */
        onSuccess: () => {
          setBorrador(null);
          setSeIntentoGuardar(false);
          setFaltaLaClave(false);
          if (campoDeClave.current !== null) campoDeClave.current.value = '';
        },
      },
    );
  }

  return (
    <section className="flex flex-col gap-4" data-seccion="servidor-de-correo">
      <h1 className="text-2xl font-semibold text-slate-900">El email</h1>

      <p className="text-sm text-slate-600">
        Los avisos del gimnasio —confirmaciones, cancelaciones, recordatorios— salen por este
        servidor de correo y firmados con esta direccion.
      </p>

      {/* El 404: no hay fila, y se dice. No es un error y no se pinta como uno. */}
      {smtp === undefined && (
        <Aviso tono="info">
          <span data-sin-configurar>{TEXTO_SIN_CONFIGURAR}</span>
        </Aviso>
      )}

      {/* LO UNICO QUE CAMBIA ENTRE «hay clave» Y «no hay clave».
          El valor va en el atributo —`si`/`no`— para que el spec pueda
          afirmarlo sin buscar subcadenas dentro de la frase. */}
      <p
        className="text-sm text-slate-600"
        data-clave-guardada={smtp?.tieneClave === true ? 'si' : 'no'}
      >
        {smtp?.tieneClave === true ? TEXTO_HAY_CLAVE : TEXTO_NO_HAY_CLAVE}
      </p>

      {/* Y EL LIMITE, IGUAL EN LOS DOS CASOS. */}
      <p className="text-sm text-amber-800" data-aviso="hay-que-reescribirla">
        {TEXTO_HAY_QUE_REESCRIBIRLA}
      </p>

      {/* `noValidate` como en la web: la validacion del navegador tapa la
          nuestra con burbujas que no se pueden leer con un lector de pantalla.
          `autoComplete="off"` en el FORMULARIO ademas de en el campo: es donde
          el heuristico del gestor de contraseñas mira primero. Y NINGUN
          control lleva `name`, para que un envio nativo pre-hidratacion no
          tenga nada que serializar en la URL. */}
      <form
        className="flex max-w-lg flex-col gap-3"
        onSubmit={enviar}
        noValidate
        autoComplete="off"
      >
        <Campo
          etiqueta="Servidor (host)"
          id="host"
          value={campos.host}
          error={error('host')}
          onChange={(evento) => cambiar({ host: evento.target.value })}
        />

        <Campo
          etiqueta="Puerto"
          id="puerto"
          type="number"
          // `value` SIEMPRE una cadena: un `||` dibujaria un puerto vacio y un
          // puerto 0 exactamente igual.
          value={campos.puerto}
          error={error('puerto')}
          onChange={(evento) => cambiar({ puerto: evento.target.value })}
        />

        {/* El interruptor va con su consecuencia escrita: lo que decide es si
            la contraseña sale cifrada por el cable, y eso no se adivina del
            nombre «conexion segura». */}
        <div className="flex flex-col gap-1">
          <label htmlFor="seguro" className="flex items-center gap-2 text-sm text-slate-900">
            <input
              id="seguro"
              type="checkbox"
              checked={campos.seguro}
              aria-describedby="seguro-consecuencia"
              onChange={(evento) => cambiar({ seguro: evento.target.checked })}
              className="h-4 w-4 rounded border-slate-300"
            />
            Conexion cifrada (TLS)
          </label>
          <p id="seguro-consecuencia" className="pl-6 text-xs text-amber-800">
            Apagarlo manda el usuario y la contraseña del correo en claro por la red. Casi siempre
            va encendido; el puerto habitual con TLS es el 465 y sin TLS el 587 o el 25.
          </p>
        </div>

        <Campo
          etiqueta="Usuario"
          id="usuario"
          // SIN `autoComplete="username"`: ese valor es justo el que le dice al
          // gestor de contraseñas del navegador «esto de aqui al lado es la
          // credencial de este sitio, ofrecete a guardarla».
          autoComplete="off"
          value={campos.usuario}
          error={error('usuario')}
          onChange={(evento) => cambiar({ usuario: evento.target.value })}
        />

        {/* EL CAMPO DE LA CREDENCIAL. EL UNICO ESCRITO A MANO Y EL UNICO NO
            CONTROLADO.

            SIN `value` y SIN `defaultValue`: en un input controlado React
            refleja el valor en el ATRIBUTO `value` del marcado —medido—, y eso
            deja la contraseña del servidor de correo escrita en el HTML.
            SIN `placeholder`: un `'••••••••'` ahi es la mentira entera de esta
            pantalla en ocho caracteres, y cualquier otro texto en un campo de
            contraseña se confunde con un valor.
            `type="password"` para que no se lea por encima del hombro en el
            mostrador, `autoComplete="off"` por lo del gestor de contraseñas y
            SIN `name` por el envio nativo pre-hidratacion. Lo accesible es lo
            mismo que pone `Campo`: `htmlFor`, `aria-invalid` y el
            `aria-describedby` apuntando al parrafo del error. */}
        <div className="flex flex-col gap-1">
          <label htmlFor="clave" className="text-sm font-medium text-slate-700">
            Contraseña del servidor de correo
          </label>
          <input
            id="clave"
            ref={campoDeClave}
            type="password"
            autoComplete="off"
            aria-invalid={faltaLaClave}
            aria-describedby={faltaLaClave ? 'clave-error' : undefined}
            // Apaga el cartel en cuanto alguien escribe: sin valor en el estado
            // no hay nada que recalcular en el render.
            onChange={() => {
              if (faltaLaClave) setFaltaLaClave(false);
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          {faltaLaClave && (
            <p id="clave-error" className="text-xs text-red-700">
              {TEXTO_DE_LA_CLAVE_QUE_FALTA}
            </p>
          )}
        </div>

        <Campo
          etiqueta="Direccion desde la que salen los emails"
          id="email-origen"
          type="email"
          autoComplete="off"
          value={campos.emailOrigen}
          error={error('emailOrigen')}
          onChange={(evento) => cambiar({ emailOrigen: evento.target.value })}
        />

        <Campo
          etiqueta="Direccion de respuesta (opcional)"
          id="email-destino"
          type="email"
          autoComplete="off"
          value={campos.emailDestino}
          onChange={(evento) => cambiar({ emailDestino: evento.target.value })}
        />

        <Boton type="submit" cargando={guardar.isPending}>
          Guardar el servidor de correo
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

      {/* EL MOTIVO DE LA API, ENTERO Y SIN TOCAR. Es `No se pudo conectar al
          servidor SMTP: …` con lo que haya contestado el servidor de correo ya
          saneado por `motivoSeguro`, y es la unica pista de que esta mal. */}
      {guardar.isError && (
        <Aviso tono="error">
          <span data-resultado="error">
            {PRINCIPIO_DEL_FALLO_DE_GUARDADO}
            {guardar.error.message}
          </span>
        </Aviso>
      )}
    </section>
  );
}

/**
 * LA PANTALLA ENTERA: EL SERVIDOR DE CORREO ARRIBA Y LAS PLANTILLAS DEBAJO.
 *
 * Las dos secciones son HERMANAS y ninguna envuelve a la otra, porque los dos
 * recursos son independientes: tienen su propia clave de cache, su propia
 * consulta y su propio fallo. Si una lectura falla, la otra sigue dibujandose
 * —que es lo que se quiere: no poder leer el SMTP no es motivo para dejar al
 * admin sin poder arreglar un texto, y al reves tampoco—.
 *
 * EL ORDEN NO ES CASUAL: sin servidor de correo configurado no sale ningun
 * email, por buenas que sean las plantillas. Lo que decide si algo llega va
 * antes que lo que decide como se lee.
 */
function PantallaDelEmail() {
  return (
    <div className="flex flex-col gap-8">
      <ElServidorDeCorreo />
      <LasPlantillas />
    </div>
  );
}

/**
 * LA PUERTA, Y NADA MAS QUE LA PUERTA.
 *
 * Un solo hook —leer el contexto— y despues un `return null`. Los cuatro
 * endpoints de correo piden `ADMIN_SALON`, y aqui no hay nada que un operativo
 * pueda hacer: no montar `PantallaDelEmail` es no tener ni las dos consultas ni
 * el campo de la contraseña en el marcado. `rol === null` es SIN PROVEEDOR y
 * vale «no alcanza para nada»: FALLA CERRADA, que con una credencial de
 * servidor detras es la unica forma de fallar que se puede permitir.
 */
export default function PaginaDelEmail() {
  const rol = useRolDeQuienMira();

  if (rol === null || !rolAlcanza(rol, 'ADMIN_SALON')) return null;

  return <PantallaDelEmail />;
}
