import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  TIPOS_DE_PLANTILLA,
  type ConfiguracionSmtpPublica,
  type JwtPayload,
  type PlantillaPublica,
  type TipoPlantilla,
} from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import { cifrar, claveDesdeHex, descifrar } from './cifrado';
import type { GuardarPlantillaDto } from './dto/guardar-plantilla.dto';
import type { GuardarSmtpDto } from './dto/guardar-smtp.dto';
import { ENVIOS_DE_EMAIL, type DatosSmtp, type EnviosDeEmail } from './envios.interface';
import { motivoDePlantillaInvalida, PLANTILLAS_POR_DEFECTO } from './plantillas';

/**
 * Un token que PARECE base64 largo. La red de seguridad de `motivoSeguro`.
 *
 * Diecisseis caracteres es el umbral: por debajo empiezan a caer palabras
 * normales de una respuesta SMTP ("ECONNREFUSED" son doce, "authentication"
 * catorce) y el motivo dejaria de ser util.
 *
 * La clase NO lleva '-' ni '_' a proposito: con ellos dentro, una respuesta
 * SMTP que traiga "authentication_failed" (veintiuno) se redactaria entera y el
 * admin se quedaria sin el motivo. El base64url de las agujas CONOCIDAS lo
 * cubre el paso 4 de `motivoSeguro`, que aplana los dos alfabetos al mismo
 * string. Queda como hueco latente el base64url de un token que NO conozcamos:
 * hoy no existe (AUTH LOGIN y AUTH PLAIN usan base64 estandar), pero apareceria
 * el dia que se soporte XOAUTH2 u otro SASL con tokens en base64url.
 */
const PARECE_BASE64 = /[A-Za-z0-9+/=]{16,}/g;

const REDACTADO = '[redactado]';

/**
 * La FORMA de un `code` de error: una palabra corta en mayusculas, como las que
 * pone nodemailer (EAUTH, ECONNREFUSED, ESOCKET, ETIMEDOUT, EENVELOPE, EDNS...)
 * o el propio Node.
 */
const FORMA_DE_CODE = /^[A-Z][A-Z0-9_]{1,30}$/;

const ALFANUMERICO = /[A-Za-z0-9]/;

/**
 * Minimo de caracteres, ya aplanados, para que una aguja entre en el paso
 * fragmentado.
 *
 * El aplanado busca la aguja sin separadores dentro del texto sin separadores,
 * asi que cuanto mas corta es la aguja mas facil es que coincida por casualidad
 * con un trozo cualquiera del mensaje: con una clave de tres letras redactaria
 * un tramo arbitrario y el motivo dejaria de servir. Ocho es el punto en el que
 * una coincidencia fortuita dentro de una respuesta SMTP deja de ser plausible.
 * Las claves cortas y contiguas las sigue cubriendo `borrar`, que es exacto.
 */
const MINIMO_APLANADO = 8;

/** Reemplazo literal y global, sin pasar por un regex que habria que escapar. */
function borrar(texto: string, aguja: string): string {
  return aguja.length === 0 ? texto : texto.split(aguja).join(REDACTADO);
}

/**
 * El texto reducido a `[A-Za-z0-9]`, guardando para cada caracter que sobrevive
 * su indice en el texto original.
 *
 * La clase es esa y no `[A-Za-z0-9+/=]` a proposito: al tirar tambien '+', '/',
 * '=', '-' y '_', el base64 estandar y el base64url del MISMO secreto aplanan
 * al mismo string, y el relleno '=' deja de importar.
 */
function aplanar(texto: string): { plano: string; indices: number[] } {
  const plano: string[] = [];
  const indices: number[] = [];

  for (let i = 0; i < texto.length; i += 1) {
    const caracter = texto[i] as string;
    if (ALFANUMERICO.test(caracter)) {
      plano.push(caracter);
      indices.push(i);
    }
  }

  return { plano: plano.join(''), indices };
}

/**
 * Borra la aguja del texto TOLERANDO separadores por el medio.
 *
 * Se busca el aplanado de la aguja dentro del aplanado del texto y se redacta,
 * en el texto original, el tramo que va del primer caracter al ultimo INCLUSIVE
 * —asi se lleva por delante los separadores de adentro—.
 *
 * No se hace con un regex que meta separadores opcionales entre cada caracter
 * de la aguja: seria ilegible y carne de backtracking catastrofico. El aplanado
 * ademas no puede sobre-redactar, porque el tramo que borra empieza y termina
 * en caracteres del propio secreto.
 *
 * Pide el texto ya normalizado a NFC (lo hace `motivoSeguro` una sola vez).
 */
function borrarFragmentada(texto: string, aguja: string): string {
  const { plano: agujaPlana } = aplanar(aguja.normalize('NFC'));
  if (agujaPlana.length < MINIMO_APLANADO) return texto;

  const { plano, indices } = aplanar(texto);

  // Las apariciones no se solapan: se salta a `desde + largo`. Si se solaparan,
  // los tramos a borrar se pisarian y los indices de la segunda dejarian de
  // valer. Sin solape los tramos quedan disjuntos, porque `indices` es
  // estrictamente creciente.
  const apariciones: number[] = [];
  for (
    let desde = plano.indexOf(agujaPlana);
    desde !== -1;
    desde = plano.indexOf(agujaPlana, desde + agujaPlana.length)
  ) {
    apariciones.push(desde);
  }

  // De atras para adelante: borrar un tramo cambia la longitud del texto y
  // moveria los indices de todo lo que venga despues.
  let salida = texto;
  for (let i = apariciones.length - 1; i >= 0; i -= 1) {
    const desde = apariciones[i] as number;
    const inicio = indices[desde] as number;
    const ultimo = indices[desde + agujaPlana.length - 1] as number;
    // `ultimo + 1`, es decir INCLUSIVE: con `ultimo` a secas quedaria suelto el
    // ultimo caracter del secreto.
    salida = `${salida.slice(0, inicio)}${REDACTADO}${salida.slice(ultimo + 1)}`;
  }

  return salida;
}

function enBase64(claro: string): string[] {
  const conRelleno = Buffer.from(claro, 'utf8').toString('base64');
  // Sin el relleno tambien: no todo el mundo que reimprime un token conserva
  // los '=' del final, y sin esta variante la aguja no encontraria nada.
  return [conRelleno, conRelleno.replace(/=+$/, '')];
}

/**
 * El motivo de un fallo de conexion SMTP, saneado para poder devolverselo al
 * admin en el cuerpo de un 400.
 *
 * POR QUE EXISTE ESTA FUNCION. `verify()` de nodemailer arma el error EAUTH
 * como `Invalid login: <respuesta literal del servidor>`. Un servidor que
 * reimprime en su respuesta la linea que acaba de recibir devuelve, con
 * AUTH LOGIN, el base64 de la contrasena SOLA; con AUTH PLAIN, el de
 * `\0usuario\0clave`. Interpolar ese mensaje tal cual mandaba la credencial de
 * vuelta al cliente en la respuesta del PUT, contra la seccion 6.1 de la spec
 * ("la contrasena no vuelve nunca"). Y no hace falta un atacante: basta un host
 * mal tecleado que de con un servidor verboso.
 *
 * La seccion 6.2 exige devolver el motivo, asi que tragarselo no vale. El orden
 * es:
 *
 * 0. Si `error` no es un objeto (o es null), no se le tocan `.code` ni
 *    `.message`: se sanea `String(error)` y ya. La firma dice `unknown` y un
 *    `catch` puede recibir cualquier cosa; leerle `.code` a un null convertia
 *    el 400 esperado en un 500 no controlado.
 * 1. El `code` (EAUTH, ECONNREFUSED, ESOCKET, ETIMEDOUT...) si tiene FORMA de
 *    code. Es corto, estable, lo pone nodemailer o el propio Node, y le dice al
 *    admin lo que necesita saber sin arrastrar nada del otro extremo.
 * 2. Si no, el mensaje con la clave borrada LITERAL en sus formas conocidas: en
 *    claro, en base64 sola, y en los dos base64 de AUTH PLAIN.
 * 3. El mismo borrado, pero TOLERANDO separadores por el medio (paso
 *    fragmentado, `borrarFragmentada`).
 * 4. Y despues, cualquier cosa que parezca base64 largo.
 *
 * SOBRE EL PASO 1. Lo que se valida es la FORMA del `code`, no su tipo. Antes
 * bastaba con que fuera un string no vacio y se devolvia tal cual, sin sanear:
 * un `code` que trajera la clave la sacaba entera. Hoy no es alcanzable porque
 * nodemailer pone siempre uno de una veintena de literales fijos, pero esta
 * funcion no se entera del dia en que el `code` deje de venir de nodemailer
 * —un wrapper, un reintento, otro adaptador— y entonces el bypass es total.
 * Validando la forma, cualquier `code` que no sea una palabra en mayusculas se
 * ignora y el mensaje pasa por el saneado como cualquier otro.
 *
 * SOBRE EL PASO 3, que es el que parece de laboratorio y no lo es. El paso 2
 * hace coincidencia exacta y contigua, y la red del paso 4 exige un run
 * contiguo de dieciseis. Un solo caracter fuera de esas clases metido en el
 * medio del secreto —un '\n', un guion, un espacio— parte la aguja en dos
 * trozos que, por debajo de dieciseis cada uno, no agarra NINGUNA de las dos
 * defensas: una clave de treinta caracteres partida 15/15 salia entera.
 *
 * Y llega por el camino real: en nodemailer@10.0.10,
 * `node_modules/.pnpm/nodemailer@10.0.10/node_modules/nodemailer/dist/cjs/smtp-connection/index.js`
 * linea 747, las lineas de continuacion de una respuesta SMTP multilinea se
 * unen con un '\n' literal
 * (`this._responseQueue[this._responseQueue.length - 1] += '\n' + lines[i];`),
 * y ese texto va directo a `err.message`. Un servidor que conteste un 535 en
 * varias lineas ecoando lo que acaba de recibir, partido en el punto justo,
 * produce exactamente eso. Sin este parrafo, el proximo que lea la funcion va a
 * pensar que el paso fragmentado sobra.
 *
 * El paso 3 normaliza a NFC el texto y las agujas antes de aplanar. Sin eso,
 * una clave con 'n~' o tildes que el otro extremo devuelva descompuesta (NFD:
 * identica a la vista, distintos code points) no coincidiria con ninguna aguja,
 * y esos caracteres tampoco entran en la clase del paso 4. OJO: el texto que
 * devuelve esta funcion queda normalizado a NFC. Es un motivo para mostrar, no
 * un dato que se compare byte a byte, asi que da igual; pero queda dicho.
 *
 * El paso 4 NO sobra teniendo el 2 y el 3, y es el punto entero de esta
 * funcion: el 2 y el 3 enumeran los formatos que conocemos hoy, y quien escribe
 * el texto del que salen no somos nosotros sino un servidor ajeno. No sabemos
 * si manda la linea troceada, recodificada, en otro SASL o dentro de una traza.
 * El paso 4 es el reconocimiento explicito de que no controlamos ese texto: por
 * eso redacta por la FORMA del token y no por su valor, y cubre el caso que
 * todavia no se nos ocurrio.
 */
export function motivoSeguro(error: unknown, clave: string, usuario: string): string {
  const fallo =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown; message?: unknown })
      : null;

  if (fallo !== null && typeof fallo.code === 'string' && FORMA_DE_CODE.test(fallo.code)) {
    return fallo.code;
  }

  const mensaje =
    fallo !== null && typeof fallo.message === 'string' ? fallo.message : String(error);

  const agujas = [
    clave,
    ...enBase64(clave),
    // Las dos formas de AUTH PLAIN: authzid vacio, que es la que manda
    // nodemailer, y authzid repetido, que es la que mandan otros clientes.
    ...enBase64(`\0${usuario}\0${clave}`),
    ...enBase64(`${usuario}\0${usuario}\0${clave}`),
  ];

  // El literal se queda: es barato, es exacto y no puede equivocarse. El
  // fragmentado va despues, sobre lo que haya sobrevivido.
  const sinLiterales = agujas.reduce(borrar, mensaje);
  const sinFragmentos = agujas.reduce(borrarFragmentada, sinLiterales.normalize('NFC'));

  return sinFragmentos.replace(PARECE_BASE64, REDACTADO);
}

/** Fila de configuracion tal como vive en la base. */
interface FilaSmtp {
  tenantId: string;
  host: string;
  puerto: number;
  seguro: boolean;
  usuario: string;
  claveCifrada: string;
  emailOrigen: string;
  emailDestino: string | null;
  updatedAt: Date;
}

@Injectable()
export class ConfigEmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
    @Inject(ENVIOS_DE_EMAIL) private readonly envios: EnviosDeEmail,
    private readonly config: ConfigService,
  ) {}

  async guardarSmtp(actor: JwtPayload, dto: GuardarSmtpDto): Promise<ConfiguracionSmtpPublica> {
    const datos: DatosSmtp = {
      host: dto.host,
      puerto: dto.puerto,
      seguro: dto.seguro ?? true,
      usuario: dto.usuario,
      clave: dto.clave,
      emailOrigen: dto.emailOrigen,
    };

    // ANTES de guardar, como pide el checklist del PDF. Guardar una
    // configuracion que no conecta deja al gimnasio creyendo que sus emails
    // salen, y el primer aviso llega cuando un alumno no recibio el suyo.
    //
    // El ORDEN lo fija un test ('verifica la conexion ANTES de guardar', en
    // config-email.service.spec.ts): comprueba que tras un verificar que falla
    // no se llamo ni a create ni a update. Mover este bloque debajo del
    // guardado lo rompe, que es exactamente lo que tiene que pasar.
    try {
      await this.envios.verificar(datos);
    } catch (error) {
      // El mensaje NO se interpola crudo: puede traer la contrasena. Ver
      // motivoSeguro, arriba.
      throw new BadRequestException(
        `No se pudo conectar al servidor SMTP: ${motivoSeguro(error, dto.clave, dto.usuario)}`,
      );
    }

    const claveCifrada = cifrar(dto.clave, this.claveDeApp());

    // Los campos que se escriben igual al crear y al actualizar. NO lleva
    // tenantId: en el `create` lo pone la extension, y en el `data` de un
    // `update` seria un intento de mover la fila a otro gimnasio, que la
    // extension lee como ataque y bloquea (ReasignacionDeTenantError).
    const campos = {
      host: dto.host,
      puerto: dto.puerto,
      seguro: dto.seguro ?? true,
      usuario: dto.usuario,
      claveCifrada,
      emailOrigen: dto.emailOrigen,
      emailDestino: dto.emailDestino ?? null,
    };

    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      // Esto NO es un `upsert`, y no se puede convertir en uno: la extension de
      // aislamiento lo tiene en OPERACIONES_UNICAS y lanza
      // UnsafeUniqueOperationError ("upsert sobre ConfiguracionSMTP no admite el
      // filtro de tenant porque su where solo acepta campos unicos"). Da igual
      // que aqui el where llevara el tenantId: la extension falla cerrada por
      // diseno y no inspecciona el where para hacer excepciones. Comprobado con
      // un test, que esta al final de config-email.service.spec.ts.
      //
      // No se pierde nada respecto al upsert: los dos caminos corren dentro de
      // la misma transaccion, que ya serializa la lectura y la escritura.
      const existente = await cliente.configuracionSMTP.findFirst({});

      if (existente === null) {
        await cliente.configuracionSMTP.create({
          // La extension inyecta el tenantId, pero el tipo generado por Prisma
          // lo exige bajo strict. Mismo caso que HistorialService.registrar.
          data: { tenantId: actor.tenantId, ...campos },
        });
      } else {
        await cliente.configuracionSMTP.update({
          where: { tenantId: actor.tenantId },
          data: campos,
        });
      }

      await this.historial.registrar(
        {
          actor,
          entidad: 'ConfiguracionSMTP',
          entidadId: actor.tenantId,
          accion: 'ACTUALIZADA',
          // El detalle lleva el host y el usuario, NUNCA la clave: esto se
          // guarda en una tabla que cualquiera con acceso de lectura puede ver.
          detalle: { host: dto.host, usuario: dto.usuario },
        },
        cliente,
      );
    });

    return await this.verSmtp();
  }

  async verSmtp(): Promise<ConfiguracionSmtpPublica> {
    const fila = (await this.prisma.db.configuracionSMTP.findFirst({})) as FilaSmtp | null;
    if (!fila) throw new NotFoundException('Este gimnasio no tiene SMTP configurado');

    return {
      host: fila.host,
      puerto: fila.puerto,
      seguro: fila.seguro,
      usuario: fila.usuario,
      emailOrigen: fila.emailOrigen,
      emailDestino: fila.emailDestino,
      // Ni la clave ni su version cifrada: una mascara sigue confirmando la
      // longitud, y el texto cifrado es material para atacarlo con calma.
      tieneClave: fila.claveCifrada.length > 0,
      actualizadoEn: fila.updatedAt.toISOString(),
    };
  }

  /**
   * Los datos de conexion listos para enviar, con la clave descifrada.
   *
   * Solo lo llaman los processors, y el valor vive en memoria el tiempo de un
   * envio. `null` = el gimnasio no configuro SMTP, y entonces no se manda nada.
   *
   * Lo que devuelve NO se loguea en ningun nivel, ni en debug: un objeto con la
   * clave en claro dentro de un `console.log` de depuracion se queda ahi para
   * siempre.
   */
  async datosDeEnvio(): Promise<{ smtp: DatosSmtp; copia: string | null } | null> {
    const fila = (await this.prisma.db.configuracionSMTP.findFirst({})) as FilaSmtp | null;
    if (!fila) return null;

    return {
      smtp: {
        host: fila.host,
        puerto: fila.puerto,
        seguro: fila.seguro,
        usuario: fila.usuario,
        clave: descifrar(fila.claveCifrada, this.claveDeApp()),
        emailOrigen: fila.emailOrigen,
      },
      copia: fila.emailDestino,
    };
  }

  async listarPlantillas(): Promise<PlantillaPublica[]> {
    const propias = await this.prisma.db.plantillaEmail.findMany({});
    const porTipo = new Map(propias.map((p) => [p.tipo as TipoPlantilla, p]));

    return TIPOS_DE_PLANTILLA.map((tipo) => {
      const propia = porTipo.get(tipo);
      const usada = propia ?? PLANTILLAS_POR_DEFECTO[tipo];

      return {
        tipo,
        asunto: usada.asunto,
        cuerpoHtml: usada.cuerpoHtml,
        esPorDefecto: propia === undefined,
      };
    });
  }

  async guardarPlantilla(
    actor: JwtPayload,
    tipo: TipoPlantilla,
    dto: GuardarPlantillaDto,
  ): Promise<PlantillaPublica> {
    // ANTES de escribir, igual que `guardarSmtp` verifica la conexion antes de
    // guardarla, y por el mismo motivo: aqui hay un humano mirando.
    //
    // Una plantilla mal formada —un `{{#if x}}` sin cerrar— no da error al
    // guardarse: lo da al RENDERIZARSE, o sea dentro del processor, o sea tres
    // dias despues y en bucle, porque los jobs se reintentan. Y con la cola
    // llena de trabajo muerto el admin no tiene forma de saber que lo rompio el
    // ultimo cambio que hizo a un texto.
    //
    // El motivo se devuelve tal cual: es el error de Handlebars sobre el texto
    // que el propio admin acaba de escribir, no hay credencial que sanear.
    const motivo = motivoDePlantillaInvalida(dto);
    if (motivo !== null) {
      throw new BadRequestException(`La plantilla no es valida: ${motivo}`);
    }

    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      // Tampoco es un `upsert`, por lo mismo que en guardarSmtp: la extension
      // lo bloquea aunque el where fuera el @@unique([tenantId, tipo]) entero.
      // El `update` va por `id` —el where de un update SI admite campos no
      // unicos y la extension le inyecta ademas el tenantId—, y el `findFirst`
      // previo ya venia filtrado por gimnasio, asi que la fila es de este.
      const existente = await cliente.plantillaEmail.findFirst({ where: { tipo } });

      if (existente === null) {
        await cliente.plantillaEmail.create({
          data: {
            tenantId: actor.tenantId,
            tipo,
            asunto: dto.asunto,
            cuerpoHtml: dto.cuerpoHtml,
          },
        });
      } else {
        await cliente.plantillaEmail.update({
          where: { id: existente.id },
          data: { asunto: dto.asunto, cuerpoHtml: dto.cuerpoHtml },
        });
      }

      await this.historial.registrar(
        { actor, entidad: 'PlantillaEmail', entidadId: tipo, accion: 'ACTUALIZADA' },
        cliente,
      );
    });

    return { tipo, asunto: dto.asunto, cuerpoHtml: dto.cuerpoHtml, esPorDefecto: false };
  }

  /** La plantilla del gimnasio para un tipo, o null si usa la del codigo. */
  async plantillaDe(tipo: TipoPlantilla): Promise<{ asunto: string; cuerpoHtml: string } | null> {
    const fila = await this.prisma.db.plantillaEmail.findFirst({ where: { tipo } });
    return fila === null ? null : { asunto: fila.asunto, cuerpoHtml: fila.cuerpoHtml };
  }

  private claveDeApp(): Buffer {
    return claveDesdeHex(this.config.get<string>('APP_ENCRYPTION_KEY') as string);
  }
}
