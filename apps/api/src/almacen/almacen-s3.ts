import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { exigirClaveValida, SEGUNDOS_DE_VIDA, type AlmacenDeArchivos } from './almacen.interface';

/**
 * Adaptador para cualquier almacen que hable el protocolo de S3: Backblaze B2,
 * DigitalOcean Spaces o el propio S3. Por eso el endpoint es una variable de
 * entorno y no una region fija.
 *
 * `forcePathStyle: true` porque B2 y Spaces no soportan de forma fiable el
 * estilo de host virtual (`bucket.endpoint`).
 *
 * La firma es puramente local: `getSignedUrl` no hace ninguna llamada de red.
 * Verificado empiricamente antes de escribir esto — 14 ms firmando contra un
 * host inexistente.
 */
@Injectable()
export class AlmacenS3 implements AlmacenDeArchivos {
  private readonly cliente: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    this.cliente = new S3Client({
      region: config.getOrThrow<string>('S3_REGION'),
      endpoint: config.getOrThrow<string>('S3_ENDPOINT'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('S3_SECRET_ACCESS_KEY'),
      },
    });
  }

  async urlDeSubida(clave: string, tipoMime: string): Promise<string> {
    exigirClaveValida(clave);

    return getSignedUrl(
      this.cliente,
      new PutObjectCommand({ Bucket: this.bucket, Key: clave, ContentType: tipoMime }),
      { expiresIn: SEGUNDOS_DE_VIDA },
    );
  }

  async urlDeDescarga(clave: string): Promise<string> {
    exigirClaveValida(clave);

    return getSignedUrl(this.cliente, new GetObjectCommand({ Bucket: this.bucket, Key: clave }), {
      expiresIn: SEGUNDOS_DE_VIDA,
    });
  }

  async eliminar(clave: string): Promise<void> {
    exigirClaveValida(clave);

    await this.cliente.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: clave }));
  }
}
