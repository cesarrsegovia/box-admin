import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { exigirClaveValida, SEGUNDOS_DE_VIDA, type AlmacenDeArchivos } from './almacen.interface';

/**
 * HMAC-SHA256 sobre clave y caducidad juntas.
 *
 * Las dos entran en la firma a proposito: si solo entrara la clave, cualquiera
 * podria estirar la caducidad editando el query param; y si solo entrara la
 * caducidad, una firma valdria para cualquier archivo.
 */
export function firmaDe(secreto: string, clave: string, expira: number): string {
  return createHmac('sha256', secreto).update(`${clave}|${expira}`).digest('hex');
}

/** Comparacion en tiempo constante: comparar firmas con `===` filtra informacion. */
export function firmaValida(esperada: string, recibida: string): boolean {
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(recibida, 'utf8');

  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Almacen de disco para desarrollo y tests.
 *
 * NO es un mock: firma URLs y sirve archivos de verdad, a traves de
 * `AlmacenLocalController`. Es lo que permite que los e2e ejerciten el flujo
 * completo de tres pasos —pedir URL, subir, confirmar— sin credenciales ni red.
 * Un mock dejaria ese flujo sin probar hasta la primera subida real en
 * produccion, que es justo donde este tipo de integracion falla.
 */
@Injectable()
export class AlmacenLocal implements AlmacenDeArchivos {
  private readonly secreto: string;
  private readonly baseUrl: string;
  private readonly directorio: string;

  constructor(config: ConfigService) {
    // Se reutiliza JWT_SECRET en vez de pedir otra variable: este adaptador no
    // corre en produccion, y una variable mas seria una mas que olvidar.
    this.secreto = config.getOrThrow<string>('JWT_SECRET');
    this.baseUrl = config.get<string>('API_BASE_URL') ?? 'http://localhost:3000';
    this.directorio = config.get<string>('ALMACEN_LOCAL_DIR') ?? './var/almacen';
  }

  async urlDeSubida(clave: string, _tipoMime: string): Promise<string> {
    return this.firmar(clave);
  }

  async urlDeDescarga(clave: string): Promise<string> {
    return this.firmar(clave);
  }

  async eliminar(clave: string): Promise<void> {
    exigirClaveValida(clave);
    await rm(this.rutaDe(clave), { force: true });
  }

  /** Ruta en disco. Solo se llama con claves ya validadas. */
  rutaDe(clave: string): string {
    exigirClaveValida(clave);
    return join(this.directorio, clave);
  }

  async asegurarDirectorio(): Promise<void> {
    await mkdir(this.directorio, { recursive: true });
  }

  verificar(clave: string, exp: string | undefined, firma: string | undefined): boolean {
    if (!exp || !firma) return false;

    const expira = Number(exp);
    if (!Number.isInteger(expira) || expira * 1000 <= Date.now()) return false;

    return firmaValida(firmaDe(this.secreto, clave, expira), firma);
  }

  private firmar(clave: string): string {
    exigirClaveValida(clave);

    const expira = Math.floor(Date.now() / 1000) + SEGUNDOS_DE_VIDA;
    const firma = firmaDe(this.secreto, clave, expira);

    return `${this.baseUrl}/archivos-locales/${clave}?exp=${expira}&firma=${firma}`;
  }
}
