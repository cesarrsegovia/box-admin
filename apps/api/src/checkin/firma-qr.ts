import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Separador de dominio: la misma APP_ENCRYPTION_KEY cifra las credenciales
 * SMTP desde la Fase 5B. Sin este prefijo, las dos usarian la clave para cosas
 * distintas sin decirlo, que es como se construye un problema que nadie ve.
 *
 * Lleva `:v1:` para que, el dia que haya que cambiar el formato de la firma, se
 * pueda emitir la nueva sin invalidar en silencio los carteles ya impresos:
 * basta con aceptar las dos durante la transicion.
 */
const PROPOSITO = 'checkin-qr:v1:';

/**
 * HMAC del tenant, en base64url y sin relleno: va en una URL.
 *
 * `claveDeApp` es la APP_ENCRYPTION_KEY tal y como llega del entorno (los 64
 * caracteres hex), NO el Buffer que devuelve `claveDesdeHex`. Es deliberado:
 * `cifrado.ts` usa los 32 bytes decodificados y aqui se usan los 64 caracteres
 * del texto, asi que ni siquiera el material de clave coincide entre los dos
 * usos. El separador de dominio de arriba sigue siendo la garantia principal;
 * esto es una segunda capa gratis.
 */
export function firmarTenant(tenantId: string, claveDeApp: string): string {
  return createHmac('sha256', claveDeApp)
    .update(PROPOSITO + tenantId)
    .digest('base64url');
}

/**
 * Comparacion en tiempo constante.
 *
 * Con `===`, el tiempo de respuesta depende de cuantos caracteres acerto el
 * atacante, y eso deja adivinar la firma byte a byte. Aqui el ataque es poco
 * realista —haria falta martillar el endpoint miles de veces— pero el costo de
 * hacerlo bien es una linea, y la que se escribe mal se copia a sitios donde si
 * importa.
 *
 * NINGUN TEST SOSTIENE ESTA LINEA, y no puede sostenerla: cambiarla por un
 * `===` no altera ni un resultado, solo el tiempo que tarda en darlo, y un test
 * de tiempos en CI es intermitente por construccion. Lo que la sostiene es este
 * comentario. Si alguien la "simplifica", que sea sabiendo lo que quita.
 */
export function verificarFirma(tenantId: string, firma: string, claveDeApp: string): boolean {
  const esperada = Buffer.from(firmarTenant(tenantId, claveDeApp));
  const recibida = Buffer.from(firma);

  // `timingSafeEqual` LANZA si los largos difieren, asi que hay que mirarlo
  // antes. Comparar el largo no filtra nada util: es publico y fijo.
  if (esperada.length !== recibida.length) return false;

  return timingSafeEqual(esperada, recibida);
}
