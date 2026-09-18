/**
 * Token de inyeccion. Hace falta uno explicito porque `AlmacenDeArchivos` es
 * una interfaz de TypeScript, y las interfaces no existen en tiempo de
 * ejecucion: Nest no puede usarlas como clave del contenedor.
 */
export const ALMACEN_DE_ARCHIVOS = Symbol('ALMACEN_DE_ARCHIVOS');

export interface AlmacenDeArchivos {
  /** URL firmada donde el cliente hace PUT del archivo. */
  urlDeSubida(clave: string, tipoMime: string): Promise<string>;
  /** URL firmada de vida corta para leerlo. */
  urlDeDescarga(clave: string): Promise<string>;
  eliminar(clave: string): Promise<void>;
}

/** Vida de las URLs firmadas, en segundos. Corta a proposito: son credenciales. */
export const SEGUNDOS_DE_VIDA = 300;

/**
 * Una clave valida: letras, numeros, guiones, guiones bajos y puntos.
 *
 * Esto NO es cosmetica. La clave acaba siendo parte de una ruta del sistema de
 * ficheros en el adaptador local, asi que una barra o un `..` permitirian
 * escribir o leer fuera del directorio del almacen (path traversal). Se valida
 * en los dos adaptadores, no solo en el local: una clave con caracteres raros
 * tampoco tiene por que llegar a S3.
 */
export const PATRON_DE_CLAVE = /^[A-Za-z0-9_.-]{1,200}$/;

export class ClaveDeArchivoInvalidaError extends Error {
  constructor(clave: string) {
    super(
      `Clave de archivo invalida: ${clave}. Solo se admiten letras, numeros, ` +
        'guiones, guiones bajos y puntos, sin barras ni "..".',
    );
    this.name = 'ClaveDeArchivoInvalidaError';
  }
}

export function exigirClaveValida(clave: string): void {
  if (!PATRON_DE_CLAVE.test(clave) || clave.includes('..')) {
    throw new ClaveDeArchivoInvalidaError(clave);
  }
}
