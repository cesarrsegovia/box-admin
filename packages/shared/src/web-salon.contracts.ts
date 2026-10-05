/**
 * Contratos de la web publica del salon (Fase 6B).
 *
 * Todo lo de aqui sale por `GET /public/salon/:slug`, que es el UNICO endpoint
 * sin sesion que lee datos de un gimnasio.
 */

export interface TestimonioPublico {
  nombre: string;
  texto: string;
}

export interface PreguntaPublica {
  pregunta: string;
  respuesta: string;
}

/**
 * Un plan tal y como sale en la landing. NO es `PackPublico` de
 * `nucleo.contracts`, que es el pack entero que ve el panel: ese lleva `id`,
 * `tenantId`, `salaId` y `activo`, y nada de eso tiene por que salir de un
 * endpoint sin sesion. El plan de la Fase 6B lo llamaba tambien `PackPublico`
 * y el nombre ya estaba cogido; se renombro en vez de ensanchar el que existe,
 * porque fusionarlos seria exactamente la forma de que un dia el `tenantId`
 * acabe en una pagina indexada.
 */
export interface PackEnLanding {
  nombre: string;
  /** String con dos decimales, o `null` si el pack no tiene precio cargado. */
  precio: string | null;
  destacado: boolean;
}

export interface TurnoLibrePublico {
  /** `YYYY-MM-DD`. */
  fecha: string;
  /** `HH:MM`. */
  horaInicio: string;
  clase: string;
  salaNombre: string;
}

/**
 * Lo que ve cualquiera, sin sesion.
 *
 * SE AUDITA POR LO QUE NO TIENE: ni un email, ni un id de perfil, ni el nombre
 * de una profesora, ni cuantos alumnos hay. Lo que no esta en esta interfaz no
 * sale del servidor.
 *
 * Los cuatro campos opcionales de abajo van `undefined` --y por tanto NO viajan
 * en el JSON-- cuando su bandera esta apagada. No viajan con un `false` al
 * lado: si el servidor los manda y el cliente los esconde, los precios ya estan
 * en el HTML, en la cache del navegador y en el primer "ver codigo fuente".
 */
export interface SalonPublico {
  nombre: string;
  colorPrimario: string;
  colorSecundario: string;
  tituloPrincipal: string | null;
  tagline: string | null;
  sobreElSalon: string | null;
  /**
   * URL EXTERNA, https. Nunca una del almacen de la Fase 3A: ese firma con
   * vencimiento, y en una landing indexada el enlace muere y queda un 403 que
   * nadie ve.
   */
  imagenPrincipalUrl: string | null;
  whatsapp: string | null;
  instagram: string | null;
  linkExtra: string | null;

  packs?: PackEnLanding[];
  testimonios?: TestimonioPublico[];
  preguntas?: PreguntaPublica[];
  turnosLibres?: TurnoLibrePublico[];
}

/**
 * Un testimonio tal y como lo ve el admin que lo administra.
 *
 * Lleva `id` y `orden`, que `TestimonioPublico` no lleva: el `id` hace falta
 * para poder borrarlo y el `orden` para entender por que sale donde sale.
 * NO se fusionan los dos tipos por el mismo motivo por el que `PackEnLanding`
 * no es `PackPublico`: el dia que alguien ensanche uno, el otro no se entera.
 */
export interface TestimonioAdmin {
  id: string;
  nombre: string;
  texto: string;
  orden: number;
}

/** Ver `TestimonioAdmin`. */
export interface PreguntaAdmin {
  id: string;
  pregunta: string;
  respuesta: string;
  orden: number;
}

/**
 * La configuracion de la web tal y como la ve y la edita el ADMIN_SALON.
 *
 * Es deliberadamente MAS ancha que `SalonPublico`: aqui si viajan las banderas
 * (el admin tiene que poder verlas apagadas para encenderlas) y los ids de los
 * testimonios y las preguntas. Nada de esto sale por el endpoint sin sesion.
 */
export interface ConfiguracionWebSalon {
  activa: boolean;
  colorPrimario: string;
  colorSecundario: string;
  tituloPrincipal: string | null;
  tagline: string | null;
  sobreElSalon: string | null;
  imagenPrincipalUrl: string | null;
  whatsapp: string | null;
  instagram: string | null;
  linkExtra: string | null;

  mostrarPrecios: boolean;
  mostrarTestimonios: boolean;
  mostrarFAQ: boolean;
  /** OJO: publica la agenda del gimnasio y cuan vacia esta. */
  mostrarTurnosLibres: boolean;

  planDestacadoId: string | null;

  testimonios: TestimonioAdmin[];
  preguntas: PreguntaAdmin[];
}
