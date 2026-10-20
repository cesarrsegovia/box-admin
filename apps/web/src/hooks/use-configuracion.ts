'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConfigCheckIn,
  ConfiguracionSmtpPublica,
  ConfiguracionWebSalon,
  PlantillaPublica,
  PreguntaAdmin,
  TestimonioAdmin,
  TipoPlantilla,
} from '@boxadmin/shared';
import { type ErrorDeApi, pedir } from '@/lib/cliente';

/**
 * LA CONFIGURACION DEL GIMNASIO: CUATRO RECURSOS INDEPENDIENTES, CATORCE
 * ENDPOINTS, Y HASTA HOY SOLO UN `curl`.
 *
 * LAS CATORCE RUTAS SALEN DE LOS CONTROLLERS, leidas una por una, y NINGUNA se
 * dedujo del nombre del modulo —en la Fase 10 una ruta deducida asi era falsa y
 * el 404 se veia en pantalla como un dato vacio—:
 *
 *  - `@Controller('config/web-salon')` en `apps/api/src/web-salon/web-salon.controller.ts`:
 *    `GET /`, `PUT /`, `POST testimonios`, `DELETE testimonios/:id`,
 *    `POST faq`, `DELETE faq/:id`.
 *  - `@Controller('config')` en `apps/api/src/comunicacion/config-email.controller.ts`
 *    —OJO: vive en `comunicacion/`, NO en un modulo `config-email`—:
 *    `GET smtp`, `PUT smtp`, `GET plantillas`, `PUT plantillas/:tipo`.
 *  - `@Controller('config/checkin-qr')` en `apps/api/src/checkin/checkin.controller.ts`
 *    —es el SEGUNDO controller del archivo, debajo de `CheckinController`—:
 *    `GET /`, `PUT /`, `GET imagen`.
 *  - `@Controller('jobs')` en `apps/api/src/jobs/jobs.controller.ts`:
 *    `POST health-check`.
 *
 * NO SON SIETE LECTURAS Y SIETE ESCRITURAS: son CINCO lecturas (las cuatro
 * `GET` de configuracion y la imagen) y NUEVE escrituras. El reparto importa
 * porque cada escritura es un `gcTime: 0` y una invalidacion que decidir, y
 * dos de las nueve no tienen nada que invalidar.
 *
 * LOS CATORCE PIDEN `ADMIN_SALON`, comprobado decorador por decorador. No hay
 * ni uno de `ADMIN_OPERATIVO`: lo que se decide aqui son las credenciales del
 * correo, que sale a internet con el nombre del gimnasio y la firma que va
 * dentro del QR de la pared.
 *
 * LOS CUATRO RECURSOS SON INDEPENDIENTES Y SUS CUATRO CLAVES TAMBIEN. Guardar
 * el SMTP no toca las plantillas aunque los dos salgan del mismo controller, y
 * guardar la ventana del check-in no toca la web publica. La invalidacion es
 * DIRIGIDA por recurso, nunca `invalidateQueries()` pelado: ver el bloque de
 * `src/test/consulta-ajena.ts`.
 *
 * LA CLAVE SMTP ENTRA Y NO VUELVE. `GuardarSmtpDto.clave` viaja en el cuerpo
 * del `PUT`, en claro, de camino al cifrado del servidor; `ConfiguracionSmtpPublica`
 * no la lleva ni enmascarada —solo un `tieneClave`—. Por eso TODAS las
 * mutaciones de este archivo llevan `gcTime: 0` y no por higiene: sin el,
 * TanStack conserva las `variables` de la mutacion CINCO MINUTOS en un
 * `QueryClient` que dura lo que dura la pestaña de la maquina del mostrador.
 * Es el caso del `File` del comprobante de la Fase 7, pero con una credencial
 * de servidor de correo dentro.
 */

/** Las cuatro claves, una por recurso, en un solo sitio. */
export const clavesDeConfig = {
  webSalon: () => ['config', 'web-salon'] as const,
  smtp: () => ['config', 'smtp'] as const,
  plantillas: () => ['config', 'plantillas'] as const,
  checkin: () => ['config', 'checkin-qr'] as const,
};

/**
 * Lo que devuelve encolar el health-check.
 *
 * `jobId` es OPCIONAL y no `string | undefined` como lo declara el controller:
 * `JSON.stringify({ jobId: undefined })` es `{}`, asi que la clave puede no
 * llegar siquiera. Quien lo pinte tiene que contemplar que no este.
 */
export interface JobEncolado {
  jobId?: string;
}

// ---------------------------------------------------------------------------
// Recurso 1: la web publica del salon
// ---------------------------------------------------------------------------

export function useConfigWebSalon() {
  return useQuery({
    queryKey: clavesDeConfig.webSalon(),
    queryFn: () => pedir<ConfiguracionWebSalon>('/config/web-salon'),
  });
}

/**
 * Tras cualquiera de las SEIS escrituras de la web: la web, y nada mas.
 *
 * Las seis invalidan LA MISMA clave —no solo el `PUT`— porque
 * `ConfiguracionWebSalon` lleva `testimonios` y `preguntas` DENTRO: un
 * testimonio nuevo cambia la respuesta del `GET /config/web-salon`, que es la
 * unica consulta que lo pinta. Es el contrato, no una comodidad: no hay un
 * `GET /config/web-salon/testimonios` al que apuntar.
 */
function useInvalidarWebSalon() {
  const cliente = useQueryClient();
  return () => void cliente.invalidateQueries({ queryKey: clavesDeConfig.webSalon() });
}

export function useGuardarWebSalon() {
  const invalidar = useInvalidarWebSalon();

  return useMutation<ConfiguracionWebSalon, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) =>
      pedir<ConfiguracionWebSalon>('/config/web-salon', { metodo: 'PUT', cuerpo: datos }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

export function useCrearTestimonio() {
  const invalidar = useInvalidarWebSalon();

  return useMutation<TestimonioAdmin, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) =>
      pedir<TestimonioAdmin>('/config/web-salon/testimonios', { metodo: 'POST', cuerpo: datos }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

/**
 * El borrado toma el `id` en las VARIABLES y no en el hook.
 *
 * La pantalla lista N testimonios con su boton de borrar en cada fila, y un
 * hook por fila seria un hook dentro de un bucle. Mismo criterio que
 * `useCambiarActiva` en `use-invitaciones`.
 *
 * Responde 204 SIN CUERPO —`@HttpCode(204)` y `Promise<void>` en el
 * controller—, asi que el tipo de dato es `null`: es lo que devuelve `pedir`
 * ante un 204. Si el hook esperara la fila de vuelta, el admin veria un error
 * despues de un borrado que SI ocurrio.
 */
export function useBorrarTestimonio() {
  const invalidar = useInvalidarWebSalon();

  return useMutation<null, ErrorDeApi, string>({
    mutationFn: (id) => pedir<null>(`/config/web-salon/testimonios/${id}`, { metodo: 'DELETE' }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

export function useCrearPregunta() {
  const invalidar = useInvalidarWebSalon();

  return useMutation<PreguntaAdmin, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) =>
      pedir<PreguntaAdmin>('/config/web-salon/faq', { metodo: 'POST', cuerpo: datos }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

/** Ver `useBorrarTestimonio`: mismo 204 y mismo `id` en las variables. */
export function useBorrarPregunta() {
  const invalidar = useInvalidarWebSalon();

  return useMutation<null, ErrorDeApi, string>({
    mutationFn: (id) => pedir<null>(`/config/web-salon/faq/${id}`, { metodo: 'DELETE' }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

// ---------------------------------------------------------------------------
// Recurso 2: el servidor de correo
// ---------------------------------------------------------------------------

/**
 * Lo que la API devuelve del SMTP: host, puerto, usuario... y NUNCA la clave.
 *
 * La respuesta se usa TAL CUAL, sin mezclarle nada de lo que se mando. Es la
 * tentacion obvia del formulario —«ya que la tengo, la dejo puesta para que no
 * haya que reescribirla»— y seria reinventar en el cliente el unico dato que
 * el servidor se cuida de no devolver.
 */
export function useConfigSmtp() {
  return useQuery({
    queryKey: clavesDeConfig.smtp(),
    queryFn: () => pedir<ConfiguracionSmtpPublica>('/config/smtp'),
  });
}

/**
 * El unico sitio del panel por el que pasa una credencial de servidor.
 *
 * Invalida `['config', 'smtp']` y NADA MAS. Las plantillas salen del mismo
 * `@Controller('config')` y son el vecino al que un `invalidateQueries()`
 * pelado —o un `['config']` a secas, que empareja por prefijo— arrastraria sin
 * que ningun test de ruta, de metodo ni de cuerpo lo notara.
 */
export function useGuardarSmtp() {
  const cliente = useQueryClient();

  return useMutation<ConfiguracionSmtpPublica, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) =>
      pedir<ConfiguracionSmtpPublica>('/config/smtp', { metodo: 'PUT', cuerpo: datos }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: clavesDeConfig.smtp() }),
    gcTime: 0,
  });
}

// ---------------------------------------------------------------------------
// Recurso 3: las plantillas de email
// ---------------------------------------------------------------------------

/** Las cinco plantillas, las propias y las del codigo (`esPorDefecto`). */
export function usePlantillas() {
  return useQuery({
    queryKey: clavesDeConfig.plantillas(),
    queryFn: () => pedir<PlantillaPublica[]>('/config/plantillas'),
  });
}

/** Lo que el formulario de una plantilla tiene en la mano al guardar. */
export interface PlantillaAGuardar {
  tipo: TipoPlantilla;
  asunto: string;
  cuerpoHtml: string;
}

/**
 * EL TIPO VIAJA EN LA URL Y SE QUITA DEL CUERPO.
 *
 * El formulario tiene las tres cosas juntas, y por eso el `tipo` llega aqui
 * dentro del mismo objeto: el reparto lo hace ESTE hook y no la pantalla.
 * `GuardarPlantillaDto` solo declara `asunto` y `cuerpoHtml`, y la API corre
 * con `forbidNonWhitelisted`: un `tipo` de mas en el cuerpo convierte un
 * guardado valido en un 400. Y al reves, un `tipo` que se quedara fuera de la
 * URL mandaria el texto a `/config/plantillas/undefined`, que el controller
 * rechaza a mano contra `TIPOS_DE_PLANTILLA`.
 *
 * Se toma en las VARIABLES y no en el hook por lo mismo que los borrados: son
 * cinco plantillas en una pantalla.
 */
export function useGuardarPlantilla() {
  const cliente = useQueryClient();

  return useMutation<PlantillaPublica, ErrorDeApi, PlantillaAGuardar>({
    mutationFn: ({ tipo, ...cuerpo }) =>
      pedir<PlantillaPublica>(`/config/plantillas/${tipo}`, { metodo: 'PUT', cuerpo }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: clavesDeConfig.plantillas() }),
    gcTime: 0,
  });
}

// ---------------------------------------------------------------------------
// Recurso 4: la ventana del check-in y el cartel del QR
// ---------------------------------------------------------------------------

export function useConfigCheckIn() {
  return useQuery({
    queryKey: clavesDeConfig.checkin(),
    queryFn: () => pedir<ConfigCheckIn>('/config/checkin-qr'),
  });
}

/**
 * Guardar la ventana NO invalida la imagen, y no es un olvido.
 *
 * El PNG lleva la firma del gimnasio, que no depende de `minutosAntes` ni de
 * `minutosDespues`: mover la ventana no cambia un pixel del cartel que ya esta
 * pegado en la pared. Y la imagen no es una consulta de React Query, asi que
 * no hay clave que invalidar aunque se quisiera.
 */
export function useGuardarCheckIn() {
  const cliente = useQueryClient();

  return useMutation<ConfigCheckIn, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) =>
      pedir<ConfigCheckIn>('/config/checkin-qr', { metodo: 'PUT', cuerpo: datos }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: clavesDeConfig.checkin() }),
    gcTime: 0,
  });
}

/**
 * LA IMAGEN DEL QR NO SE PIDE CON `pedir`, Y ESTO ES UNA RUTA, NO UN HOOK.
 *
 * `GET /config/checkin-qr/imagen` responde `Content-Type: image/png` y un
 * cuerpo binario. `pedir` hace `await respuesta.text()` y `JSON.parse`: con un
 * PNG dentro eso revienta con un `SyntaxError` que no dice nada de lo que
 * pasa. Asi que esta ruta va como `src` de un `<img>` y no por el cliente.
 *
 * LLEVA LA COOKIE SOLA, comprobado y no supuesto:
 *
 *  1. El endpoint pide `ADMIN_SALON`, asi que la peticion necesita sesion.
 *  2. La sesion es la cookie `bx_access`, que es `httpOnly` —no se puede
 *     adjuntar desde JavaScript ni aunque se quisiera— con `path: '/'` y
 *     `sameSite: 'lax'` (`src/lib/cookies.ts`).
 *  3. La URL cuelga de `/api/bx`, el proxy de `src/app/api/bx/[...ruta]/route.ts`,
 *     que corre en NUESTRO origen: una imagen de MISMO ORIGEN manda las
 *     cookies sola, y `lax` solo bloquea cross-site. Es la misma premisa por
 *     la que `pedir` se conforma con `credentials: 'same-origin'`.
 *  4. El proxy devuelve las cabeceras de la API salvo tres de longitud y
 *     codificacion, asi que el `image/png` y el `Cache-Control: no-store`
 *     llegan intactos al navegador.
 *  5. `urlDeApi` admite los tres segmentos (`config`, `checkin-qr`, `imagen`):
 *     son letras, numeros y guiones, que es justo lo que deja pasar.
 *
 * SIN `?t=Date.now()` NI NINGUN OTRO ROMPE-CACHES. El cartel no cambia al
 * guardar la ventana, la API ya manda `no-store`, y un `src` que dependa del
 * reloj vuelve a pedir el PNG en cada render.
 */
export const RUTA_DE_LA_IMAGEN_DEL_QR = '/api/bx/config/checkin-qr/imagen';

// ---------------------------------------------------------------------------
// Fuera de los cuatro recursos: la prueba de vida de la cola
// ---------------------------------------------------------------------------

/**
 * Encola un `ping` para ver si Redis y BullMQ contestan. NO INVALIDA NADA.
 *
 * No es un quinto recurso: no tiene `GET`, no tiene clave y no cambia ninguna
 * configuracion. Lo unico que devuelve es el `jobId` del trabajo encolado, y
 * no hay ninguna consulta en el panel que ese dato deje rancia. Una
 * invalidacion «por las dudas» aqui seria un refetch de todo el panel cada vez
 * que alguien toca el boton de diagnostico.
 */
export function useEncolarHealthCheck() {
  return useMutation<JobEncolado, ErrorDeApi, void>({
    mutationFn: () => pedir<JobEncolado>('/jobs/health-check', { metodo: 'POST' }),
    gcTime: 0,
  });
}
