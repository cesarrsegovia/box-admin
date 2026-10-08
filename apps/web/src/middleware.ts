import { NextResponse, type NextRequest } from 'next/server';

/**
 * Estampa en cada peticion de pagina la ruta que se pidio.
 *
 * EXISTE POR UNA LIMITACION CONCRETA: un layout del App Router recibe
 * `children` y `params` y nada mas —ni `searchParams` ni la ruta—. Sin esto,
 * una puerta que manda al login no tiene forma de saber de donde esta echando
 * a nadie, y el `volverA` que escribe solo puede ser una constante. Eso es lo
 * que habia: un parametro que aparentaba conservar el destino y lo tiraba.
 *
 * VIVE EN `src/` Y NO EN LA RAIZ DE `apps/web/`. Next busca el middleware en
 * `path.join(appDir, '..')`, y aqui `appDir` es `src/app`. En la raiz del
 * paquete no lo encontraria y no se cargaria —sin aviso ninguno, que es la
 * peor forma de no funcionar.
 *
 * ⚠️ LO QUE SALE DE AQUI NO ES DE FIAR POR VENIR DE AQUI. El matcher no cubre
 * todas las rutas, y en una ruta que no cubra, una cabecera `x-ruta` escrita
 * por el cliente llega al servidor intacta. Quien la lee la valida: ver
 * `rutaPedida` en `lib/ruta-pedida.ts`.
 */
export function middleware(peticion: NextRequest) {
  const { pathname, search } = peticion.nextUrl;

  const cabeceras = new Headers(peticion.headers);
  // La query va pegada: un `?tipo=profesor` es parte de donde estaba el
  // usuario, y volver a la pagina sin su filtro es volver a otra pagina.
  cabeceras.set('x-ruta', `${pathname}${search}`);

  return NextResponse.next({ request: { headers: cabeceras } });
}

export const config = {
  /**
   * Esto corre en CADA peticion que case, asi que lo que sobre aqui es trabajo
   * en cada carga de cada imagen.
   *
   * Quedan fuera `/api/*` (el BFF, que no dibuja pantallas), `/_next/*` y todo
   * lo que tenga punto en el ultimo tramo: eso son estaticos, y ahi caen tanto
   * `/sw.js` —el service worker, que Serwist emite a `public/`— como
   * `/favicon.ico`. Una regla en vez de tres nombres: una lista de nombres se
   * queda corta en cuanto alguien añade un estatico mas.
   *
   * El precio de la regla del punto es que un slug con punto no llevaria
   * cabecera. No es un agujero: sin cabecera se cae a la entrada del area, que
   * es exactamente lo que habia antes de todo esto.
   *
   * TIENE QUE SER UN LITERAL. Next analiza este valor en tiempo de build y los
   * valores calculados los ignora en silencio, asi que no se puede extraer a
   * una constante para compartirla con el test.
   */
  matcher: ['/((?!api|_next/static|_next/image|.*\\.[^/]*$).*)'],
};
