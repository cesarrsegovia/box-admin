/**
 * EL UNICO FETCH DEL NAVEGADOR QUE HABLA CON LA API.
 *
 * Siempre contra `/api/bx`, nunca contra la API directamente: el token vive en
 * una cookie httpOnly que este codigo no puede leer, y es el proxy del servidor
 * quien lo añade. Si alguna pantalla llamara a la API por su cuenta, tendria
 * que llevar el token consigo y todo el diseño se vendria abajo.
 *
 * ---------------------------------------------------------------------------
 * ESTA FRASE DECIA «EL UNICO FETCH DEL NAVEGADOR», A SECAS, Y YA NO ERA CIERTA.
 *
 * Dejo de serlo cuatro fases despues de escribirse, sin que nadie lo notara,
 * porque una medicion anotada en un comentario envejece en silencio: parece
 * documentacion. Hoy hay CUATRO sitios del navegador que llaman al `fetch`
 * global por fuera de aqui, los cuatro a proposito y ninguno contra la API —
 * las tres pantallas que llaman a `/api/auth/…` para que el BFF escriba o
 * borre la cookie httpOnly, y el `PUT` del comprobante a la URL firmada del
 * almacen. (El servidor tiene los suyos, empezando por el proxy que hay al
 * otro lado de este mismo archivo.)
 *
 * No hace falta creerle a este parrafo: estan CONTADOS, con su motivo y en los
 * dos sentidos, en `lib/el-unico-fetch.spec.ts`. El quinto no entra sin que
 * alguien lo decida y lo escriba en esa tabla.
 */

export class ErrorDeApi extends Error {
  /** El codigo HTTP. `0` cuando la peticion no llego a salir (sin red). */
  readonly estado: number;

  /**
   * El cuerpo JSON tal como vino, cuando lo hubo.
   *
   * Hay respuestas de error que son DATOS y no solo un texto: el 409 del
   * check-in lleva un `motivo` de cuatro valores sobre el que la pantalla
   * tiene que ramificar. Sin esto, el unico camino seria que esa pantalla se
   * saltara `pedir` y hablara con el proxy por su cuenta.
   */
  readonly cuerpo: unknown;

  constructor(mensaje: string, estado: number, cuerpo?: unknown) {
    super(mensaje);
    this.name = 'ErrorDeApi';
    this.estado = estado;
    this.cuerpo = cuerpo;
  }

  /** Sin sesion: quien lo reciba deberia mandar al alumno al login. */
  get esSesionCaducada(): boolean {
    return this.estado === 401;
  }

  /** La peticion no salio del navegador. */
  get esSinConexion(): boolean {
    return this.estado === 0;
  }
}

export interface OpcionesDePeticion {
  metodo?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  cuerpo?: unknown;
  senal?: AbortSignal;
}

export async function pedir<T = unknown>(
  ruta: string,
  opciones: OpcionesDePeticion = {},
): Promise<T> {
  const metodo = opciones.metodo ?? 'GET';

  let respuesta: Response;
  try {
    respuesta = await fetch(`/api/bx${ruta}`, {
      method: metodo,
      headers: opciones.cuerpo === undefined ? undefined : { 'content-type': 'application/json' },
      body: opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo),
      signal: opciones.senal,
      // Las cookies van solas por ser mismo origen, pero explicitarlo evita
      // sorpresas si algun dia cambia el default.
      credentials: 'same-origin',
    });
  } catch {
    // `fetch` solo rechaza cuando la peticion no llega a salir. Es el caso del
    // alumno sin conexion intentando reservar.
    throw new ErrorDeApi('Sin conexion. Comproba tu red y volve a intentarlo.', 0);
  }

  if (respuesta.status === 204) return null as T;

  const texto = await respuesta.text();
  const datos: unknown = texto === '' ? null : JSON.parse(texto);

  if (!respuesta.ok) {
    // El mensaje de la API se escribio para el alumno ("Este turno esta
    // completo (1/1), pero puedes anotarte..."). Sustituirlo por uno generico
    // seria tirar la parte util.
    const mensaje =
      typeof datos === 'object' && datos !== null && 'message' in datos
        ? String((datos as { message: unknown }).message)
        : `Error ${respuesta.status}`;

    throw new ErrorDeApi(mensaje, respuesta.status, datos);
  }

  return datos as T;
}
