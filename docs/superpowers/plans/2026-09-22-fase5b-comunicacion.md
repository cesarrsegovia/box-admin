# Fase 5B — Comunicación: plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usa `superpowers:subagent-driven-development` o
> `superpowers:executing-plans` para ejecutar este plan tarea a tarea. Los pasos usan casillas
> (`- [ ]`) para poder marcarlos.

**Objetivo:** que el gimnasio configure su propio SMTP con la credencial cifrada, que los eventos del
ciclo de vida de una reserva y de un pack manden email y push solos, y que el hook de notificaciones
—inerte desde la Fase 3A— deje de serlo.

**Arquitectura:** dos puertos con adaptador (`ENVIOS_DE_EMAIL`, `ENVIOS_PUSH`) como el almacén de la
3A, dos funciones puras (el cifrado y `resolverMensaje`) y cuatro processors de BullMQ. **Nada se
envía dentro de una transacción**: se encola.

**Stack:** NestJS 10 · Prisma 7 · BullMQ 5 · nodemailer · handlebars · web-push · Next 15 en la PWA.

**Spec:** `docs/superpowers/specs/2026-09-22-fase5b-comunicacion.md`

---

## Antes de empezar: las trampas de este repositorio

1. **Comprueba `docker info` antes de nada.** Docker Desktop se ha caído solo **nueve** veces desde la
   Fase 2. Si está muerto: `"/c/Program Files/Docker/Docker/Docker Desktop.exe" &` y esperar.
2. **Nunca `docker compose up` a secas.** Solo `docker compose up -d postgres postgres-test redis`:
   levantar el servicio `api` arranca una segunda API que **le roba los jobs a Redis**. En esta fase
   eso es especialmente venenoso — media fase son jobs.
3. **Los e2e necesitan `dotenv`.** `pnpm exec jest --config test/jest-e2e.json` a secas usa los
   límites estrictos del throttler y la suite muere con **429**. Usa `pnpm test:e2e`, o
   `pnpm exec dotenv -e ../../.env.test -- jest --config ./test/jest-e2e.json <archivo>`.
4. **`prisma migrate dev` no funciona sin interactividad si la migración es destructiva.** Esta no lo
   es (solo añade), así que `migrate dev` debería bastar. Si aun así se queja, el camino es
   `migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` a un archivo y
   luego `migrate deploy`. **Ojo**: en Prisma 7 no existen `--from-url` ni `--from-schema`.
5. **`.env` apunta al 5434 y `.env.test` al 5433.**
6. **Nunca corras `pnpm lint`**: lleva `--fix`. Usa `prettier --check`, y `--write` solo sobre
   archivos nuevos de esta fase.
7. **`prisma migrate reset` y `docker compose down -v` necesitan permiso explícito de Cesar.**
8. **Después de tocar `schema.prisma`**, `pnpm exec dotenv -e ../../.env -- prisma generate`.
9. **Para editar desde Python**: trabaja en `str`, escribe con `encoding='utf-8'` y `newline=''`. Un
   literal de bytes con `ñ` o `§` revienta con `SyntaxError`.

**Los commits los hace Cesar.** Nada de `git add`, `commit`, `push`, `stash`, `checkout` ni `reset`.

---

## Estructura de archivos

### Se crean — API

| Archivo | Responsabilidad |
|---|---|
| `src/comunicacion/cifrado.ts` · `.spec.ts` | **Función pura**: AES-256-GCM con versión |
| `src/comunicacion/envios.interface.ts` | Los dos puertos y sus tipos |
| `src/comunicacion/email-memoria.ts` · `email-smtp.ts` | Los dos adaptadores de email |
| `src/comunicacion/push-memoria.ts` · `push-webpush.ts` | Los dos adaptadores de push |
| `src/comunicacion/plantillas.ts` · `.spec.ts` | Las seis por defecto y `resolverMensaje` |
| `src/comunicacion/comunicacion.module.ts` | El módulo dinámico que elige adaptadores |
| `src/comunicacion/config-email.service.ts` · `.controller.ts` · `.spec.ts` | `/config/smtp` y `/config/plantillas` |
| `src/comunicacion/dto/*.ts` | Los tres DTO |
| `src/comunicacion/mensajero.service.ts` · `.spec.ts` | Junta plantilla + SMTP + envío. Lo usan los cuatro processors |
| `src/push/push.service.ts` · `.controller.ts` · `.module.ts` · `.spec.ts` | Las suscripciones |
| `src/jobs/notificaciones/colas.ts` | Los nombres de cola y los payloads |
| `src/jobs/notificaciones/notificacion-reserva.processor.ts` · `.spec.ts` | Confirmación y cancelación |
| `src/jobs/notificaciones/notificacion-lista-espera.processor.ts` · `.spec.ts` | El cupo liberado |
| `src/jobs/notificaciones/recordatorio-pago.processor.ts` · `.spec.ts` | Diario |
| `src/jobs/notificaciones/vencimiento-pack.processor.ts` · `.spec.ts` | Diario |
| `src/jobs/notificaciones/registro-de-crones.ts` · `.spec.ts` | Registra los recurrentes si `JOBS_RECURRENTES=1` |
| `test/comunicacion.e2e-spec.ts` | La cadena completa |

### Se crean — PWA

| Archivo | Responsabilidad |
|---|---|
| `apps/web/src/app/api/bx/push/route.ts` | Las dos rutas del BFF |
| `apps/web/src/componentes/boton-de-push.tsx` · `.spec.tsx` | Pedir permiso y suscribirse |
| `apps/web/src/lib/push.ts` · `.spec.ts` | Conversión de la clave VAPID y el registro |

### Se modifican

| Archivo | Cambio |
|---|---|
| `apps/api/prisma/schema.prisma` | Tres modelos, un enum, `Tenant.diasAvisoVencimiento` |
| `src/common/tenant/tenant-scoped.extension.ts` | Clasificar los tres modelos nuevos |
| `src/common/historial/historial.service.ts` | `'ConfiguracionSMTP'`, `'PlantillaEmail'` |
| `src/config/validar-entorno.ts` · `.spec.ts` | `APP_ENCRYPTION_KEY`, `EMAIL_TIPO`, `PUSH_TIPO` |
| `src/notificaciones/notificaciones.service.ts` · `.spec.ts` | Deja de loguear: encola |
| `src/reservas/reservas.service.ts` | Encola confirmación y cancelación |
| `src/mi-calendario/mi-calendario.service.ts` | Encola las del alumno |
| `src/jobs/jobs.module.ts` | Las cuatro colas y sus processors |
| `src/app.module.ts` | `ComunicacionModule.forRoot()`, `PushModule` |
| `test/helpers.ts` | Las tablas nuevas en el TRUNCATE |
| `packages/shared/src/comunicacion.contracts.ts` | **Nuevo**, exportado |
| `apps/web/src/app/sw.ts` | El handler `push` |
| `apps/web/src/app/[slug]/(alumno)/perfil/page.tsx` | El botón |
| `.env.example` · `.env.test.example` · `README.md` · `PROGRESO.md` | Documentación |

---

## Task 0: Dependencias, schema, entorno

**Files:**
- Modificar: `apps/api/package.json`, `apps/api/prisma/schema.prisma`,
  `src/common/tenant/tenant-scoped.extension.ts`, `src/common/historial/historial.service.ts`,
  `src/config/validar-entorno.ts` y su spec, `test/helpers.ts`, `.env`, `.env.test`, los dos
  `.example`

- [ ] **Step 1: Infraestructura y dependencias**

```bash
cd /d/Dev/box-admin && docker info > /dev/null && docker compose up -d postgres postgres-test redis
cd apps/api && pnpm add nodemailer handlebars web-push && pnpm add -D @types/nodemailer @types/web-push
```

⚠️ **Instalar en `apps/api` puede llevarse por delante el cliente de Prisma.** Si después `tsc` falla
con decenas de `Parameter 'tx' implicitly has an 'any' type`, es eso:

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec dotenv -e ../../.env -- prisma generate
```

⚠️ **Comprueba los `engines` de lo que instales.** El ecosistema está dejando atrás Node 20 y este
monorepo está en `>=20 <21`; en la Fase 3B hubo que fijar tres paquetes por eso. Si algo se queja,
fija la mayor que soporte Node 20 en vez de subir el motor.

- [ ] **Step 2: El enum y los tres modelos**

En `schema.prisma`, junto a los demás enums:

```prisma
/// Enum y no `String` libre como el PDF. Mismo criterio que TipoCancelacion,
/// EstadoComprobante y MetodoPago.
enum TipoPlantilla {
  CONFIRMACION
  CANCELACION
  RECORDATORIO_PAGO
  LISTA_ESPERA
  VENCIMIENTO_PACK
}
```

Y al final del archivo:

```prisma
model ConfiguracionSMTP {
  tenantId String @id
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  // El PDF guardaba emailOrigen, la clave y emailDestino, y con eso nodemailer
  // no puede abrir una conexion: faltan el servidor, el puerto y el usuario.
  host    String
  puerto  Int
  seguro  Boolean @default(true)
  usuario String

  /// AES-256-GCM con APP_ENCRYPTION_KEY y prefijo de version. NUNCA viaja de
  /// vuelta al cliente, ni cifrada ni enmascarada.
  claveCifrada String

  emailOrigen String
  /// Copia interna al salon. `null` = no se copia a nadie.
  emailDestino String?

  updatedAt DateTime @updatedAt

  @@map("configuraciones_smtp")
}

model PlantillaEmail {
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  tipo       TipoPlantilla
  asunto     String
  cuerpoHtml String

  updatedAt DateTime @updatedAt

  @@unique([tenantId, tipo])
  @@map("plantillas_email")
}

model SuscripcionPush {
  id       String @id @default(cuid())
  // El PDF NO le ponia tenantId. Sin el, la extension de aislamiento no puede
  // clasificarla y toda query sobre ella se bloquea.
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  perfilId String
  perfil   Perfil @relation(fields: [tenantId, perfilId], references: [tenantId, id], onDelete: Cascade)

  endpoint String
  p256dh   String
  auth     String

  createdAt DateTime @default(now())

  @@unique([tenantId, perfilId, endpoint])
  @@index([tenantId, perfilId])
  @@map("suscripciones_push")
}
```

En `model Tenant`, junto a la configuración heredable:

```prisma
  /// Con cuantos dias de antelacion avisar de un pack por vencer. El checklist
  /// del PDF dice "con la anticipacion configurada" y no habia donde.
  diasAvisoVencimiento Int @default(7)
```

Y las relaciones inversas: en `Tenant`, `configuracionSmtp ConfiguracionSMTP?`,
`plantillasEmail PlantillaEmail[]` y `suscripcionesPush SuscripcionPush[]`; en `Perfil`,
`suscripcionesPush SuscripcionPush[]`.

- [ ] **Step 3: Validar, migrar, generar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec dotenv -e ../../.env -- prisma validate
pnpm exec dotenv -e ../../.env -- prisma migrate dev --name fase5b_comunicacion
pnpm exec dotenv -e ../../.env.test -- prisma migrate deploy
pnpm exec dotenv -e ../../.env -- prisma generate
```

Esperado: schema válido, migración creada y aplicada a las dos bases, cliente regenerado.

- [ ] **Step 4: Clasificar los tres modelos**

En `tenant-scoped.extension.ts`, dentro de `MODELOS_CON_TENANT`:

```ts
  'Pago',
  'ConfiguracionSMTP',
  'PlantillaEmail',
  'SuscripcionPush',
] as const;
```

⚠️ `ConfiguracionSMTP` tiene `tenantId` como **clave primaria**, no como columna suelta. Sigue siendo
"modelo con tenant" para la extensión: lo que le importa es que la columna exista para poder
inyectarla en el `where`.

- [ ] **Step 5: Correr los meta-tests**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/common/tenant --silent
```

Esperado: 115 en verde. Si dice que un modelo no está clasificado, falta uno de los tres.

- [ ] **Step 6: Las entidades auditables**

En `historial.service.ts`, en `EntidadAuditable`:

```ts
  | 'Pago'
  | 'ConfiguracionSMTP'
  | 'PlantillaEmail';
```

- [ ] **Step 7: El TRUNCATE**

En `test/helpers.ts`:

```ts
    'TRUNCATE TABLE ' +
      '"suscripciones_push", "plantillas_email", "configuraciones_smtp", ' +
      '"pagos", "horarios_profesor_asignados", "comprobantes", "listas_espera", ' +
```

- [ ] **Step 8: Las variables de entorno**

En `src/config/validar-entorno.ts`, añade a `VARIABLES_REQUERIDAS`:

```ts
  'ALMACEN_TIPO',
  'APP_ENCRYPTION_KEY',
  'EMAIL_TIPO',
  'PUSH_TIPO',
] as const;
```

Y después de la comprobación de `ALMACEN_TIPO`, tres validaciones más:

```ts
  // 32 bytes en hexadecimal: es la longitud que exige aes-256-gcm. Validarlo
  // aqui y no en el primer cifrado hace que un despliegue mal configurado muera
  // al arrancar en vez de la primera vez que alguien guarda su SMTP.
  const clave = config.APP_ENCRYPTION_KEY;
  if (typeof clave !== 'string' || !/^[0-9a-fA-F]{64}$/.test(clave)) {
    throw new Error(
      'APP_ENCRYPTION_KEY debe ser 32 bytes en hexadecimal (64 caracteres). ' +
        // Comillas DOBLES fuera y escapadas dentro: con comillas simples fuera,
        // prettier reescribe la linea y el paso queda sucio nada mas pegarlo.
        "Generala con: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }

  const email = config.EMAIL_TIPO;
  if (email !== 'memoria' && email !== 'smtp') {
    throw new Error(`EMAIL_TIPO debe ser "memoria" o "smtp", no ${JSON.stringify(email)}.`);
  }

  const push = config.PUSH_TIPO;
  if (push !== 'memoria' && push !== 'web-push') {
    throw new Error(`PUSH_TIPO debe ser "memoria" o "web-push", no ${JSON.stringify(push)}.`);
  }

  // Las VAPID NO se exigen: sin ellas el push se desactiva y el email sigue
  // saliendo. Es una capacidad del despliegue, no un estado roto — a diferencia
  // de la clave de cifrado, que si falta deja credenciales ilegibles en la base.
```

Añade los casos correspondientes a `validar-entorno.spec.ts`, siguiendo los que ya hay para
`ALMACEN_TIPO`: falta la clave, clave de longitud equivocada, clave con caracteres no hexadecimales,
`EMAIL_TIPO` inválido, y **que las VAPID ausentes NO impiden arrancar**.

- [ ] **Step 9: Rellenar los `.env`**

En `.env` y `.env.example` (y sus gemelos de test), al final:

```bash
# Cifrado de credenciales SMTP. 32 bytes en hexadecimal.
# Generar con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
APP_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000

# `memoria` guarda lo que se habria enviado y no toca la red; `smtp` envia de
# verdad con nodemailer. En tests y en desarrollo, siempre `memoria`.
EMAIL_TIPO=memoria
PUSH_TIPO=memoria

# Sin estas dos, el push se desactiva y POST /push/suscripcion responde 503.
# Generar con: pnpm dlx web-push generate-vapid-keys
# VAPID_PUBLIC_KEY=
# VAPID_PRIVATE_KEY=

# Registrar los jobs diarios. Apagado por defecto: un cron registrado al
# arrancar dispara en CADA jest que levanta la aplicacion.
JOBS_RECURRENTES=0
```

⚠️ En `.env` y `.env.test` pon una clave **de verdad** generada con el comando, no la de ceros del
ejemplo. En los `.example` va la de ceros, que es visiblemente falsa.

- [ ] **Step 10: Comprobar que arranca**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec tsc --noEmit && pnpm test 2>&1 | tail -5
```

Esperado: limpio y verde. Los tests todavía no usan nada nuevo; esto comprueba que el entorno valida.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): modelos de comunicacion y las variables que exige

ConfiguracionSMTP guarda ademas host, puerto y usuario: con lo que el PDF
listaba, nodemailer no puede abrir una conexion. SuscripcionPush gana el
tenantId que le faltaba, sin el cual la extension de aislamiento no puede
clasificarla y bloquea toda query.

APP_ENCRYPTION_KEY se exige al arrancar y se valida su longitud: un
despliegue mal configurado muere ya, no la primera vez que alguien guarda
su SMTP. Las VAPID no se exigen: sin ellas el push se desactiva.
```

---

## Task 1: El cifrado

**Files:**
- Crear: `apps/api/src/comunicacion/cifrado.ts` y `cifrado.spec.ts`

- [ ] **Step 1: Escribir los tests**

Crear `apps/api/src/comunicacion/cifrado.spec.ts`:

```ts
import { cifrar, claveDesdeHex, descifrar } from './cifrado';

const CLAVE = claveDesdeHex('a'.repeat(64));
const OTRA = claveDesdeHex('b'.repeat(64));

describe('cifrado de credenciales', () => {
  it('cifrar y descifrar da la vuelta', () => {
    expect(descifrar(cifrar('mi-password-smtp', CLAVE), CLAVE)).toBe('mi-password-smtp');
  });

  it('el texto cifrado NO contiene el claro', () => {
    // Suena obvio y es justo lo que un cifrado mal montado no cumple.
    expect(cifrar('mi-password-smtp', CLAVE)).not.toContain('mi-password-smtp');
  });

  it('dos cifrados del mismo texto son distintos', () => {
    // El IV es aleatorio. Si dos cifrados coincidieran, un observador de la
    // base sabria que dos gimnasios usan la misma contrasena.
    expect(cifrar('igual', CLAVE)).not.toBe(cifrar('igual', CLAVE));
  });

  it('lleva el prefijo de version', () => {
    expect(cifrar('x', CLAVE).startsWith('v1:')).toBe(true);
  });

  it('descifrar con OTRA clave falla en vez de devolver basura', () => {
    // GCM autentica: no descifra mal en silencio.
    expect(() => descifrar(cifrar('secreto', CLAVE), OTRA)).toThrow();
  });

  it('un cifrado manipulado falla', () => {
    const original = cifrar('secreto', CLAVE);
    const partes = original.split(':');
    // Se toca el ultimo byte del texto cifrado.
    const datos = Buffer.from(partes[3]!, 'base64');
    datos[datos.length - 1] = datos[datos.length - 1]! ^ 0xff;
    partes[3] = datos.toString('base64');

    expect(() => descifrar(partes.join(':'), CLAVE)).toThrow();
  });

  it('una version desconocida falla con un mensaje que lo dice', () => {
    expect(() => descifrar('v9:a:b:c', CLAVE)).toThrow(/version/i);
  });

  it('una clave que no son 32 bytes se rechaza', () => {
    expect(() => claveDesdeHex('abcd')).toThrow(/32 bytes/);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/comunicacion --silent
```

Esperado: FALLA con `Cannot find module './cifrado'`.

- [ ] **Step 3: Implementar**

Crear `apps/api/src/comunicacion/cifrado.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITMO = 'aes-256-gcm';
const VERSION_ACTUAL = 'v1';
const BYTES_DE_IV = 12;

/**
 * Convierte la clave hexadecimal del entorno en el buffer de 32 bytes que pide
 * aes-256-gcm, validando la longitud.
 */
export function claveDesdeHex(hex: string): Buffer {
  const clave = Buffer.from(hex, 'hex');
  if (clave.length !== 32) {
    throw new Error(
      `La clave de cifrado debe ser 32 bytes (64 caracteres hex); llegaron ${clave.length}.`,
    );
  }

  return clave;
}

/**
 * Cifra un secreto para guardarlo en la base.
 *
 * El formato lleva VERSION delante: `v1:<iv>:<tag>:<datos>`, todo en base64.
 * Sin la version, rotar la clave obligaria a que cada gimnasio volviera a
 * teclear su contrasena SMTP — y hasta que lo hiciera, sus emails dejarian de
 * salir sin un error que lo explicara. Esta fase no implementa la rotacion;
 * implementa el formato que la hace posible.
 *
 * El IV es aleatorio en cada llamada: con uno fijo, dos gimnasios con la misma
 * contrasena tendrian el mismo texto cifrado, y eso ya es informacion.
 */
export function cifrar(claro: string, clave: Buffer): string {
  const iv = randomBytes(BYTES_DE_IV);
  const cifrador = createCipheriv(ALGORITMO, clave, iv);
  const datos = Buffer.concat([cifrador.update(claro, 'utf8'), cifrador.final()]);

  return [
    VERSION_ACTUAL,
    iv.toString('base64'),
    cifrador.getAuthTag().toString('base64'),
    datos.toString('base64'),
  ].join(':');
}

/**
 * Descifra. Lanza si la clave no es la correcta o si el texto fue manipulado:
 * GCM autentica, asi que no devuelve basura en silencio.
 */
export function descifrar(guardado: string, clave: Buffer): string {
  const [version, iv, tag, datos] = guardado.split(':');

  if (version !== VERSION_ACTUAL) {
    throw new Error(
      `Version de cifrado desconocida: ${String(version)}. ` +
        'Este valor se cifro con un formato que esta version no sabe leer.',
    );
  }
  if (!iv || !tag || !datos) {
    throw new Error('El valor cifrado no tiene la forma v1:<iv>:<tag>:<datos>.');
  }

  const descifrador = createDecipheriv(ALGORITMO, clave, Buffer.from(iv, 'base64'));
  descifrador.setAuthTag(Buffer.from(tag, 'base64'));

  return Buffer.concat([
    descifrador.update(Buffer.from(datos, 'base64')),
    descifrador.final(),
  ]).toString('utf8');
}
```

- [ ] **Step 4: Correr y ver pasar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/comunicacion --silent
```

Esperado: 8 en verde.

- [ ] **Step 5: Mutación — el IV fijo**

Cambia `const iv = randomBytes(BYTES_DE_IV);` por `const iv = Buffer.alloc(BYTES_DE_IV, 0);`.

Esperado: falla `dos cifrados del mismo texto son distintos`. Si pasa, ese test no prueba nada y el
cifrado filtra información sin que nadie lo note.

**Deshaz la mutación.**

- [ ] **Step 6: Mutación — sin autenticar**

Quita la línea `descifrador.setAuthTag(...)`.

Esperado: falla **`cifrar y descifrar da la vuelta`**, con `Unsupported state or unable to
authenticate data`.

⚠️ **No fallan los dos tests que uno esperaria** (`descifrar con OTRA clave falla` y `un cifrado
manipulado falla`), y el motivo importa: sin `setAuthTag`, `final()` lanza SIEMPRE, con el texto
intacto o manipulado. Esos dos tests solo asertan que lanza, asi que siguen en verde — pasarian
tambien con la autenticacion rota.

Node lanza el MISMO mensaje en los tres casos —sin `setAuthTag`, con otra clave y con datos
manipulados—, asi que atar esos tests al texto del error tampoco cerraria el hueco.

Y no hace falta, porque no hay hueco: cada test cubre una clase de fallo distinta.

| Mutacion | Sintoma | Quien la caza |
|---|---|---|
| Quitar `setAuthTag` | falla SIEMPRE, hasta el caso feliz | el round-trip |
| Pasar a un modo no autenticado (`aes-256-ctr`) | no falla NUNCA: descifra basura en silencio | `otra clave falla` y `manipulado falla` |

La segunda es la peligrosa, y es justo la que solo esos dos tests ven: con `aes-256-ctr` el
round-trip seguiria en verde.

**Deshaz la mutación.**

**Mensaje de commit sugerido para Cesar:**

```
feat(api): cifrado de credenciales con AES-256-GCM y version

El formato es v1:<iv>:<tag>:<datos>. La version delante es lo que hace
posible rotar la clave algun dia sin que cada gimnasio tenga que volver a
teclear su contrasena SMTP.

El IV es aleatorio en cada cifrado: con uno fijo, dos gimnasios con la
misma contrasena tendrian el mismo texto cifrado, y eso ya es
informacion. GCM autentica, asi que descifrar con otra clave falla en vez
de devolver basura.
```

---
## Task 2: Los contratos compartidos

**Files:**
- Crear: `packages/shared/src/comunicacion.contracts.ts`
- Modificar: `packages/shared/src/index.ts`

- [ ] **Step 1: Escribirlos**

Crear `packages/shared/src/comunicacion.contracts.ts`:

```ts
// ---------------------------------------------------------------------------
// Fase 5B — Comunicacion
// ---------------------------------------------------------------------------

export type TipoPlantilla =
  | 'CONFIRMACION'
  | 'CANCELACION'
  | 'RECORDATORIO_PAGO'
  | 'LISTA_ESPERA'
  | 'VENCIMIENTO_PACK';

export const TIPOS_DE_PLANTILLA: TipoPlantilla[] = [
  'CONFIRMACION',
  'CANCELACION',
  'RECORDATORIO_PAGO',
  'LISTA_ESPERA',
  'VENCIMIENTO_PACK',
];

/**
 * La configuracion SMTP tal como la ve el admin.
 *
 * NO lleva la contrasena, ni cifrada ni enmascarada: una mascara sigue
 * confirmando su longitud. Solo dice si hay una guardada.
 */
export interface ConfiguracionSmtpPublica {
  host: string;
  puerto: number;
  seguro: boolean;
  usuario: string;
  emailOrigen: string;
  emailDestino: string | null;
  tieneClave: boolean;
  /** ISO 8601. */
  actualizadoEn: string;
}

export interface PlantillaPublica {
  tipo: TipoPlantilla;
  asunto: string;
  cuerpoHtml: string;
  /** `true` = es la del codigo; el gimnasio no configuro la suya. */
  esPorDefecto: boolean;
}

/** Lo que el navegador entrega al suscribirse. */
export interface SuscripcionPushEntrada {
  endpoint: string;
  p256dh: string;
  auth: string;
}
```

- [ ] **Step 2: Exportar y compilar**

En `packages/shared/src/index.ts`, después de `export * from './pagos.contracts';`:

```ts
export * from './comunicacion.contracts';
```

```bash
cd /d/Dev/box-admin/packages/shared && pnpm build && pnpm exec jest --silent
```

Esperado: compila y los 86 siguen verdes.

**Mensaje de commit sugerido para Cesar:**

```
feat(shared): contratos de comunicacion

La configuracion SMTP publica NO lleva la contrasena, ni enmascarada: una
mascara sigue confirmando su longitud. Solo dice si hay una guardada.
```

---

## Task 3: Los dos puertos y sus cuatro adaptadores

**Files:**
- Crear: `src/comunicacion/envios.interface.ts`, `email-memoria.ts`, `email-smtp.ts`,
  `push-memoria.ts`, `push-webpush.ts`, `comunicacion.module.ts`
- Test: `src/comunicacion/email-memoria.spec.ts`
- Modificar: `src/app.module.ts`

- [ ] **Step 1: Los puertos**

Crear `apps/api/src/comunicacion/envios.interface.ts`:

```ts
/**
 * Tokens de inyeccion. Hacen falta explicitos porque las interfaces de
 * TypeScript no existen en tiempo de ejecucion: Nest no puede usarlas como
 * clave del contenedor. Mismo patron que ALMACEN_DE_ARCHIVOS desde la Fase 3A.
 */
export const ENVIOS_DE_EMAIL = Symbol('ENVIOS_DE_EMAIL');
export const ENVIOS_PUSH = Symbol('ENVIOS_PUSH');

/** Los datos de conexion, ya descifrados. Viven en memoria y no se loguean. */
export interface DatosSmtp {
  host: string;
  puerto: number;
  seguro: boolean;
  usuario: string;
  clave: string;
  emailOrigen: string;
}

export interface MensajeDeEmail {
  para: string;
  /** Copia interna al salon, si la configuro. */
  copia: string | null;
  asunto: string;
  html: string;
}

export interface EnviosDeEmail {
  enviar(smtp: DatosSmtp, mensaje: MensajeDeEmail): Promise<void>;
  /**
   * Abre la conexion y la cierra. Lanza con el motivo si no se puede.
   * El adaptador de memoria siempre resuelve: no hay contra que conectar.
   */
  verificar(smtp: DatosSmtp): Promise<void>;
}

export interface DestinoPush {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface MensajePush {
  titulo: string;
  cuerpo: string;
  /** Adonde lleva al tocarla. */
  url: string;
}

/** Que hacer con la suscripcion despues del intento. */
export type ResultadoPush = 'ENVIADO' | 'CADUCADA' | 'FALLO';

export interface EnviosPush {
  /** `false` = el push esta desactivado (sin VAPID). */
  readonly habilitado: boolean;
  enviar(destino: DestinoPush, mensaje: MensajePush): Promise<ResultadoPush>;
}
```

- [ ] **Step 2: El test del adaptador de memoria**

Crear `apps/api/src/comunicacion/email-memoria.spec.ts`:

```ts
import { EmailEnMemoria } from './email-memoria';

const SMTP = {
  host: 'smtp.test',
  puerto: 587,
  seguro: true,
  usuario: 'u',
  clave: 'secreta',
  emailOrigen: 'gym@test.io',
};

describe('EmailEnMemoria', () => {
  it('guarda lo enviado con su destinatario y su cuerpo', async () => {
    const envios = new EmailEnMemoria();

    await envios.enviar(SMTP, { para: 'ana@x.io', copia: null, asunto: 'Hola', html: '<p>hey</p>' });

    expect(envios.enviados).toHaveLength(1);
    expect(envios.enviados[0]).toMatchObject({ para: 'ana@x.io', asunto: 'Hola' });
  });

  it('NO guarda la contrasena del SMTP', async () => {
    // El adaptador de memoria existe para los tests, y un test que guardara la
    // credencial la acabaria imprimiendo en el primer fallo.
    const envios = new EmailEnMemoria();

    await envios.enviar(SMTP, { para: 'a@x.io', copia: null, asunto: 'x', html: 'y' });

    expect(JSON.stringify(envios.enviados)).not.toContain('secreta');
  });

  it('limpiar vacia la bandeja', async () => {
    const envios = new EmailEnMemoria();
    await envios.enviar(SMTP, { para: 'a@x.io', copia: null, asunto: 'x', html: 'y' });

    envios.limpiar();

    expect(envios.enviados).toEqual([]);
  });

  it('verificar siempre resuelve: no hay contra que conectar', async () => {
    await expect(new EmailEnMemoria().verificar(SMTP)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Correr y ver fallar, luego implementar los cuatro adaptadores**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/comunicacion --silent
```

Esperado: FALLA con `Cannot find module './email-memoria'`.

Crear `apps/api/src/comunicacion/email-memoria.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { DatosSmtp, EnviosDeEmail, MensajeDeEmail } from './envios.interface';

/** Lo enviado, mas de donde salio. SIN la contrasena. */
export interface EmailGuardado extends MensajeDeEmail {
  desde: string;
  host: string;
}

/**
 * El adaptador que usan los tests y el desarrollo: guarda lo que se habria
 * enviado y no toca la red.
 *
 * Deliberadamente NO guarda `smtp.clave`. Este objeto acaba impreso en el
 * primer `expect` que falla, y una credencial en la salida de un test es una
 * credencial filtrada.
 */
@Injectable()
export class EmailEnMemoria implements EnviosDeEmail {
  private readonly logger = new Logger(EmailEnMemoria.name);
  readonly enviados: EmailGuardado[] = [];

  async enviar(smtp: DatosSmtp, mensaje: MensajeDeEmail): Promise<void> {
    this.enviados.push({ ...mensaje, desde: smtp.emailOrigen, host: smtp.host });
    this.logger.log(`[memoria] email a ${mensaje.para}: ${mensaje.asunto}`);
  }

  // El parametro va con guion bajo y NO se omite: el test llama
  // `new EmailEnMemoria().verificar(SMTP)` sobre la clase concreta, y sin el
  // parametro eso es TS2554. Mismo patron que `AlmacenLocal.urlDeSubida`.
  async verificar(_smtp: DatosSmtp): Promise<void> {
    // No hay contra que conectar. Es una diferencia real de comportamiento
    // entre entornos y esta documentada en el README.
  }

  limpiar(): void {
    this.enviados.length = 0;
  }
}
```

Crear `apps/api/src/comunicacion/email-smtp.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { DatosSmtp, EnviosDeEmail, MensajeDeEmail } from './envios.interface';

/**
 * El adaptador real.
 *
 * Crea un transporte POR ENVIO en vez de cachearlo: la configuracion es de cada
 * gimnasio y puede cambiar en cualquier momento, y un transporte cacheado
 * seguiria usando la contrasena vieja hasta reiniciar.
 *
 * NUNCA loguea `smtp.clave`, ni en debug. El manual de TurnoFit avisaba de esto
 * explicitamente y es la clase de cosa que se cuela en un console.log de
 * depuracion y se queda ahi.
 */
@Injectable()
export class EmailPorSmtp implements EnviosDeEmail {
  async enviar(smtp: DatosSmtp, mensaje: MensajeDeEmail): Promise<void> {
    const transporte = this.transporte(smtp);
    try {
      await transporte.sendMail({
        from: smtp.emailOrigen,
        to: mensaje.para,
        ...(mensaje.copia === null ? {} : { cc: mensaje.copia }),
        subject: mensaje.asunto,
        html: mensaje.html,
      });
    } finally {
      transporte.close();
    }
  }

  async verificar(smtp: DatosSmtp): Promise<void> {
    const transporte = this.transporte(smtp);
    try {
      await transporte.verify();
    } finally {
      transporte.close();
    }
  }

  private transporte(smtp: DatosSmtp): Transporter {
    return createTransport({
      host: smtp.host,
      port: smtp.puerto,
      secure: smtp.seguro,
      auth: { user: smtp.usuario, pass: smtp.clave },
    });
  }
}
```

Crear `apps/api/src/comunicacion/push-memoria.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { DestinoPush, EnviosPush, MensajePush, ResultadoPush } from './envios.interface';

@Injectable()
export class PushEnMemoria implements EnviosPush {
  readonly habilitado = true;
  readonly enviados: { endpoint: string; mensaje: MensajePush }[] = [];

  /** Endpoints que el doble debe tratar como caducados, para probar la limpieza. */
  readonly caducados = new Set<string>();

  async enviar(destino: DestinoPush, mensaje: MensajePush): Promise<ResultadoPush> {
    if (this.caducados.has(destino.endpoint)) return 'CADUCADA';

    this.enviados.push({ endpoint: destino.endpoint, mensaje });
    return 'ENVIADO';
  }

  limpiar(): void {
    this.enviados.length = 0;
    this.caducados.clear();
  }
}
```

Crear `apps/api/src/comunicacion/push-webpush.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sendNotification, setVapidDetails } from 'web-push';
import type { DestinoPush, EnviosPush, MensajePush, ResultadoPush } from './envios.interface';

@Injectable()
export class PushPorWebPush implements EnviosPush {
  private readonly logger = new Logger(PushPorWebPush.name);
  readonly habilitado: boolean;

  constructor(config: ConfigService) {
    const publica = config.get<string>('VAPID_PUBLIC_KEY');
    const privada = config.get<string>('VAPID_PRIVATE_KEY');
    this.habilitado = Boolean(publica && privada);

    if (this.habilitado) {
      // El "subject" es obligatorio para web-push y sirve para que el servicio
      // del navegador sepa a quien reclamar si algo va mal.
      setVapidDetails(
        config.get<string>('VAPID_SUBJECT') ?? 'mailto:soporte@boxadmin.local',
        publica as string,
        privada as string,
      );
    } else {
      this.logger.warn('Sin claves VAPID: las notificaciones push quedan desactivadas.');
    }
  }

  async enviar(destino: DestinoPush, mensaje: MensajePush): Promise<ResultadoPush> {
    if (!this.habilitado) return 'FALLO';

    try {
      await sendNotification(
        { endpoint: destino.endpoint, keys: { p256dh: destino.p256dh, auth: destino.auth } },
        JSON.stringify(mensaje),
      );
      return 'ENVIADO';
    } catch (error) {
      // 404 y 410 significan que la suscripcion ya no existe en el navegador.
      // Quien llama la borra: sin eso, la tabla se llena de endpoints muertos a
      // los que se reintenta cada dia.
      const codigo = (error as { statusCode?: number }).statusCode;
      if (codigo === 404 || codigo === 410) return 'CADUCADA';

      this.logger.warn(`Fallo el push a ${destino.endpoint.slice(0, 40)}...: ${String(error)}`);
      return 'FALLO';
    }
  }
}
```

- [ ] **Step 4: El módulo que elige**

Crear `apps/api/src/comunicacion/comunicacion.module.ts`:

```ts
import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailEnMemoria } from './email-memoria';
import { EmailPorSmtp } from './email-smtp';
import { ENVIOS_DE_EMAIL, ENVIOS_PUSH } from './envios.interface';
import { PushEnMemoria } from './push-memoria';
import { PushPorWebPush } from './push-webpush';

/**
 * Los adaptadores se eligen al arrancar, no en cada llamada: un error de
 * configuracion sale al levantar la aplicacion y no la primera vez que alguien
 * espera un email. Mismo patron que AlmacenModule desde la Fase 3A.
 *
 * El modulo es global —`global: true` en el DynamicModule, no el decorador
 * `@Global`, que aqui no se puede usar— porque los cuatro processors, el
 * servicio de configuracion y el de push necesitan los puertos, y encadenar
 * imports por todo el arbol solo para eso no aporta nada.
 */
@Module({})
export class ComunicacionModule {
  static forRoot(): DynamicModule {
    const emailEnMemoria = (process.env.EMAIL_TIPO ?? 'memoria') === 'memoria';
    const pushEnMemoria = (process.env.PUSH_TIPO ?? 'memoria') === 'memoria';

    return {
      module: ComunicacionModule,
      global: true,
      providers: [
        {
          // Sin `inject`: esta factory no recibe nada. La configuracion SMTP es
          // de cada gimnasio y llega como argumento de `enviar`, no del entorno.
          // El patron del repositorio es inyectar lo que se usa, ver almacen.module.
          provide: ENVIOS_DE_EMAIL,
          useFactory: () => (emailEnMemoria ? new EmailEnMemoria() : new EmailPorSmtp()),
        },
        {
          provide: ENVIOS_PUSH,
          inject: [ConfigService],
          useFactory: (config: ConfigService) =>
            pushEnMemoria ? new PushEnMemoria() : new PushPorWebPush(config),
        },
      ],
      exports: [ENVIOS_DE_EMAIL, ENVIOS_PUSH],
    };
  }
}
```

En `apps/api/src/app.module.ts`, añade `ComunicacionModule.forRoot()` a `imports`, junto a
`AlmacenModule.forRoot()`.

- [ ] **Step 5: Correr y comprobar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/comunicacion --silent && pnpm exec tsc --noEmit
```

Esperado: 10 del cifrado + 4 del adaptador de memoria, y `tsc` limpio.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): puertos de email y push con sus adaptadores

Mismo patron que el almacen desde la Fase 3A: la interfaz vive aparte y
el adaptador lo elige una variable de entorno al arrancar. El de memoria
guarda lo que se habria enviado, sin la contrasena — este objeto acaba
impreso en el primer expect que falla.

El adaptador SMTP crea un transporte por envio en vez de cachearlo: la
configuracion es de cada gimnasio y un transporte cacheado seguiria
usando la contrasena vieja hasta reiniciar.
```

---

## Task 4: Las plantillas y `resolverMensaje`

**Files:**
- Crear: `apps/api/src/comunicacion/plantillas.ts` y `plantillas.spec.ts`

- [ ] **Step 1: Escribir la tabla de casos**

Crear `apps/api/src/comunicacion/plantillas.spec.ts`:

```ts
import { $Enums } from '@prisma/client';
import { TIPOS_DE_PLANTILLA } from '@boxadmin/shared';
import { PLANTILLAS_POR_DEFECTO, resolverMensaje } from './plantillas';

const DATOS = {
  alumno: 'Ana Perez',
  gimnasio: 'Box Palermo',
  clase: 'Pilates',
  fecha: '2026-09-07',
  hora: '18:00',
};

describe('resolverMensaje', () => {
  it('sin plantilla propia usa la del codigo', () => {
    const { asunto, html } = resolverMensaje(null, 'CONFIRMACION', DATOS);

    // Contra el contenido real, no contra otra llamada a la misma funcion: eso
    // ultimo pasaria aunque `resolverMensaje` devolviera siempre lo mismo.
    expect(asunto).toContain('Pilates');
    expect(html).toContain('Ana Perez');
    expect(html).toContain('18:00');
  });

  it('la del gimnasio gana a la del codigo', () => {
    const propia = { asunto: 'Che {{alumno}}', cuerpoHtml: '<p>{{clase}} el {{fecha}}</p>' };

    const { asunto, html } = resolverMensaje(propia, 'CONFIRMACION', DATOS);

    expect(asunto).toBe('Che Ana Perez');
    expect(html).toBe('<p>Pilates el 2026-09-07</p>');
  });

  it('un dato que la plantilla no usa no molesta', () => {
    const propia = { asunto: 'Hola', cuerpoHtml: '<p>{{alumno}}</p>' };

    expect(resolverMensaje(propia, 'CONFIRMACION', DATOS).html).toBe('<p>Ana Perez</p>');
  });

  it('un hueco sin dato queda vacio, no rompe', () => {
    const propia = { asunto: '{{noExiste}}', cuerpoHtml: '<p>{{tampoco}}</p>' };

    const { asunto, html } = resolverMensaje(propia, 'CONFIRMACION', DATOS);

    expect(asunto).toBe('');
    expect(html).toBe('<p></p>');
  });

  it('el HTML del dato sale ESCAPADO', () => {
    // Las plantillas las escribe el admin y los datos vienen de nombres que
    // eligen los alumnos. Con {{{ }}} en vez de {{ }}, un alumno llamado
    // <script> seria XSS contra el admin que previsualiza.
    const propia = { asunto: 'x', cuerpoHtml: '<p>{{alumno}}</p>' };

    const { html } = resolverMensaje(propia, 'CONFIRMACION', {
      ...DATOS,
      alumno: '<script>alert(1)</script>',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('el contrato de TipoPlantilla no se separo del enum de Prisma', () => {
    // Son dos listas de cinco valores en archivos distintos: el union de
    // `packages/shared` y el enum del schema. TypeScript no puede ver la deriva
    // —el union es solo strings— asi que el dia que alguien anada un tipo al
    // schema y olvide el contrato, el fallo sale en RUNTIME al guardar.
    //
    // Mismo criterio que el centinela de clasificacion de modelos en
    // `tenant-scoped.extension.spec.ts`, que existe por la misma razon. Vive
    // aqui y no en `packages/shared` porque ese paquete no depende de Prisma, y
    // no deberia.
    // La fuente es `$Enums` y NO `Prisma.dmmf.datamodel.enums`, que es lo que
    // usa el centinela de modelos: en Prisma 7 el dmmf del cliente en runtime
    // trae `models` pero deja `enums` VACIO, asi que aquello revienta con
    // `Cannot read properties of undefined`. `$Enums` lo genera `prisma
    // generate` desde el schema, o sea que la fuente sigue siendo la misma.
    const delEsquema = Object.keys($Enums.TipoPlantilla);

    expect([...TIPOS_DE_PLANTILLA].sort()).toEqual([...delEsquema].sort());
  });

  it('hay una plantilla por defecto para cada tipo', () => {
    // Si alguien anade un tipo al enum y se olvida del texto, el email saldria
    // vacio. Esto lo caza antes.
    for (const [tipo, plantilla] of Object.entries(PLANTILLAS_POR_DEFECTO)) {
      expect(plantilla.asunto.length).toBeGreaterThan(0);
      expect(plantilla.cuerpoHtml.length).toBeGreaterThan(0);
      expect(tipo.length).toBeGreaterThan(0);
    }
    expect(Object.keys(PLANTILLAS_POR_DEFECTO)).toHaveLength(5);
  });

  it('las plantillas por defecto se renderizan sin dejar huecos', () => {
    for (const tipo of Object.keys(PLANTILLAS_POR_DEFECTO)) {
      const { asunto, html } = resolverMensaje(null, tipo as never, DATOS);
      expect(asunto).not.toContain('{{');
      expect(html).not.toContain('{{');
    }
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/comunicacion/plantillas --silent
```

Esperado: FALLA con `Cannot find module './plantillas'`.

- [ ] **Step 3: Implementar**

Crear `apps/api/src/comunicacion/plantillas.ts`:

```ts
import Handlebars from 'handlebars';
import type { TipoPlantilla } from '@boxadmin/shared';

export interface PlantillaCruda {
  asunto: string;
  cuerpoHtml: string;
}

/** Lo que una plantilla puede interpolar. Todo string: no hay formateo aqui. */
export type DatosDePlantilla = Record<string, string>;

/**
 * Las plantillas del codigo.
 *
 * Son constantes y no filas sembradas por gimnasio: un gimnasio nuevo funciona
 * sin configurar nada, y mejorar un texto por defecto es un cambio de codigo en
 * vez de una migracion de datos.
 *
 * El HTML es deliberadamente pobre. Un email con estilos elaborados se ve
 * distinto en cada cliente de correo y estos tienen que llegar legibles a todos.
 */
export const PLANTILLAS_POR_DEFECTO: Record<TipoPlantilla, PlantillaCruda> = {
  CONFIRMACION: {
    asunto: 'Reservaste {{clase}} para el {{fecha}}',
    cuerpoHtml:
      '<p>Hola {{alumno}},</p>' +
      '<p>Te reservamos <strong>{{clase}}</strong> el {{fecha}} a las {{hora}}.</p>' +
      '<p>{{gimnasio}}</p>',
  },
  CANCELACION: {
    asunto: 'Cancelaste {{clase}} del {{fecha}}',
    cuerpoHtml:
      '<p>Hola {{alumno}},</p>' +
      '<p>Cancelamos tu lugar en <strong>{{clase}}</strong> del {{fecha}} a las {{hora}}.</p>' +
      '<p>{{gimnasio}}</p>',
  },
  LISTA_ESPERA: {
    asunto: 'Se liberó un lugar en {{clase}}',
    cuerpoHtml:
      '<p>Hola {{alumno}},</p>' +
      '<p>Se liberó un lugar en <strong>{{clase}}</strong> del {{fecha}} a las {{hora}} ' +
      'y te lo asignamos. Ya no estás en la lista de espera.</p>' +
      '<p>{{gimnasio}}</p>',
  },
  RECORDATORIO_PAGO: {
    asunto: 'Tenés un pago pendiente en {{gimnasio}}',
    cuerpoHtml:
      '<p>Hola {{alumno}},</p>' +
      '<p>Nos figura un pago pendiente. Si ya lo hiciste, subí el comprobante desde la ' +
      'aplicación y lo revisamos.</p>' +
      '<p>{{gimnasio}}</p>',
  },
  VENCIMIENTO_PACK: {
    asunto: 'Tu pack vence el {{fecha}}',
    cuerpoHtml:
      '<p>Hola {{alumno}},</p>' +
      '<p>Tu pack vence el {{fecha}}. Pasá por el salón o escribinos para renovarlo.</p>' +
      '<p>{{gimnasio}}</p>',
  },
};

/**
 * Que plantilla gana y como queda renderizada.
 *
 * PURA: ni base de datos ni red. Es donde vive toda la logica de esta parte de
 * la fase, y por eso se puede probar con una tabla de casos.
 *
 * Se renderiza con `{{ }}`, que Handlebars ESCAPA por defecto. Es deliberado y
 * no se puede relajar: las plantillas las escribe el admin, pero los datos
 * salen de nombres que eligen los alumnos, y un alumno llamado
 * `<script>alert(1)</script>` no puede convertirse en XSS contra el admin que
 * previsualiza su plantilla.
 */
export function resolverMensaje(
  propia: PlantillaCruda | null,
  tipo: TipoPlantilla,
  datos: DatosDePlantilla,
): { asunto: string; html: string } {
  const plantilla = propia ?? PLANTILLAS_POR_DEFECTO[tipo];

  return {
    asunto: Handlebars.compile(plantilla.asunto, { noEscape: false })(datos),
    html: Handlebars.compile(plantilla.cuerpoHtml, { noEscape: false })(datos),
  };
}
```

- [ ] **Step 4: Correr y ver pasar**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/comunicacion --silent
```

Esperado: 29 en verde, en cuatro suites.

- [ ] **Step 5: Mutación — el escapado**

Cambia los dos `{ noEscape: false }` por `{ noEscape: true }`.

Esperado: falla `el HTML del dato sale ESCAPADO`. Es la mutación que protege el único XSS que esta
fase puede introducir.

**Deshaz la mutación.**

**Mensaje de commit sugerido para Cesar:**

```
feat(api): plantillas por defecto y el renderizado

Las cinco viven en el codigo, no en filas sembradas: un gimnasio nuevo
funciona sin configurar nada y mejorar un texto es un cambio de codigo en
vez de una migracion de datos.

Se renderiza con {{ }}, que escapa por defecto. No es cosmetica: las
plantillas las escribe el admin pero los datos salen de nombres que
eligen los alumnos.
```

---
## Task 5: La configuración de SMTP y de plantillas

**Files:**
- Crear: `src/comunicacion/dto/guardar-smtp.dto.ts`, `dto/guardar-plantilla.dto.ts`
- Crear: `src/comunicacion/config-email.service.ts` · `.spec.ts` · `.controller.ts`
- Modificar: `src/comunicacion/comunicacion.module.ts`

- [ ] **Step 1: Los DTO**

Crear `apps/api/src/comunicacion/dto/guardar-smtp.dto.ts`:

```ts
import { IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class GuardarSmtpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  puerto!: number;

  @IsOptional()
  @IsBoolean()
  seguro?: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  usuario!: string;

  /**
   * En claro SOLO aqui, de camino al cifrado. Nunca vuelve al cliente y nunca
   * se loguea.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  clave!: string;

  @IsEmail()
  @MaxLength(180)
  emailOrigen!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(180)
  emailDestino?: string;
}
```

Crear `apps/api/src/comunicacion/dto/guardar-plantilla.dto.ts`:

```ts
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class GuardarPlantillaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  asunto!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  cuerpoHtml!: string;
}
```

- [ ] **Step 2: Escribir los tests del servicio**

Crear `apps/api/src/comunicacion/config-email.service.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { cifrar, claveDesdeHex } from './cifrado';
import { ConfigEmailService } from './config-email.service';

const ACTOR = { sub: 'admin-1', tenantId: 't1', rol: 'ADMIN_SALON' } as never;
const HEX = 'a'.repeat(64);
const CLAVE = claveDesdeHex(HEX);

const ALTA = {
  host: 'smtp.test',
  puerto: 587,
  usuario: 'u',
  clave: 'la-secreta',
  emailOrigen: 'gym@test.io',
} as never;

function crearServicio(estado: { config?: Record<string, unknown> | null } = {}) {
  const db = {
    configuracionSMTP: {
      findFirst: jest.fn().mockResolvedValue(estado.config ?? null),
      upsert: jest.fn().mockImplementation(({ create }: { create: Record<string, unknown> }) =>
        Promise.resolve({ ...create, updatedAt: new Date('2026-09-22T00:00:00.000Z') }),
      ),
    },
    plantillaEmail: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(db)),
  };
  const envios = { enviar: jest.fn(), verificar: jest.fn().mockResolvedValue(undefined) };
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockReturnValue(HEX) };

  return {
    servicio: new ConfigEmailService(
      { db } as never,
      historial as never,
      envios as never,
      config as never,
    ),
    db,
    envios,
  };
}

describe('ConfigEmailService.guardarSmtp', () => {
  it('guarda la clave CIFRADA, nunca en claro', async () => {
    const { servicio, db } = crearServicio();

    await servicio.guardarSmtp(ACTOR, ALTA);

    const guardado = db.configuracionSMTP.upsert.mock.calls[0]![0].create.claveCifrada;
    expect(guardado).not.toContain('la-secreta');
    expect(guardado.startsWith('v1:')).toBe(true);
  });

  it('verifica la conexion ANTES de guardar', async () => {
    const { servicio, db, envios } = crearServicio();
    envios.verificar.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(servicio.guardarSmtp(ACTOR, ALTA)).rejects.toThrow(BadRequestException);
    // Lo importante: no se guardo nada.
    expect(db.configuracionSMTP.upsert).not.toHaveBeenCalled();
  });

  it('el error de conexion llega con el motivo', async () => {
    const { servicio, envios } = crearServicio();
    envios.verificar.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(servicio.guardarSmtp(ACTOR, ALTA)).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe('ConfigEmailService.verSmtp', () => {
  it('NO devuelve la contrasena, ni cifrada', async () => {
    const { servicio } = crearServicio({
      config: {
        tenantId: 't1',
        host: 'smtp.test',
        puerto: 587,
        seguro: true,
        usuario: 'u',
        claveCifrada: cifrar('la-secreta', CLAVE),
        emailOrigen: 'gym@test.io',
        emailDestino: null,
        updatedAt: new Date(),
      },
    });

    const publica = await servicio.verSmtp();

    expect(JSON.stringify(publica)).not.toContain('la-secreta');
    expect(JSON.stringify(publica)).not.toContain('v1:');
    expect(publica.tieneClave).toBe(true);
  });

  it('404 si el gimnasio no configuro nada', async () => {
    const { servicio } = crearServicio({ config: null });

    await expect(servicio.verSmtp()).rejects.toThrow(NotFoundException);
  });
});

describe('ConfigEmailService.listarPlantillas', () => {
  it('devuelve las cinco, marcando cuales son del codigo', async () => {
    const { servicio, db } = crearServicio();
    db.plantillaEmail.findMany.mockResolvedValue([
      { tipo: 'CONFIRMACION', asunto: 'Mia', cuerpoHtml: '<p>mia</p>' },
    ]);

    const todas = await servicio.listarPlantillas();

    expect(todas).toHaveLength(5);
    expect(todas.find((p) => p.tipo === 'CONFIRMACION')).toMatchObject({
      asunto: 'Mia',
      esPorDefecto: false,
    });
    expect(todas.find((p) => p.tipo === 'CANCELACION')!.esPorDefecto).toBe(true);
  });
});
```

- [ ] **Step 3: Correr, ver fallar e implementar**

Crear `apps/api/src/comunicacion/config-email.service.ts`:

```ts
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
import { PLANTILLAS_POR_DEFECTO } from './plantillas';

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
    try {
      await this.envios.verificar(datos);
    } catch (error) {
      throw new BadRequestException(
        `No se pudo conectar al servidor SMTP: ${(error as Error).message}`,
      );
    }

    const claveCifrada = cifrar(dto.clave, this.claveDeApp());

    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      await cliente.configuracionSMTP.upsert({
        where: { tenantId: actor.tenantId },
        create: {
          tenantId: actor.tenantId,
          host: dto.host,
          puerto: dto.puerto,
          seguro: dto.seguro ?? true,
          usuario: dto.usuario,
          claveCifrada,
          emailOrigen: dto.emailOrigen,
          emailDestino: dto.emailDestino ?? null,
        },
        update: {
          host: dto.host,
          puerto: dto.puerto,
          seguro: dto.seguro ?? true,
          usuario: dto.usuario,
          claveCifrada,
          emailOrigen: dto.emailOrigen,
          emailDestino: dto.emailDestino ?? null,
        },
      });

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
    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      await cliente.plantillaEmail.upsert({
        where: { tenantId_tipo: { tenantId: actor.tenantId, tipo } },
        create: {
          tenantId: actor.tenantId,
          tipo,
          asunto: dto.asunto,
          cuerpoHtml: dto.cuerpoHtml,
        },
        update: { asunto: dto.asunto, cuerpoHtml: dto.cuerpoHtml },
      });

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
```

⚠️ **`upsert` está prohibido por la extensión de aislamiento** (`OPERACIONES_UNICAS`), porque su
`where` solo admite campos únicos y no se le puede inyectar el filtro de tenant. Aquí el `where`
**ya lleva el tenantId** —es la clave primaria en un caso y parte del `@@unique` en el otro—, así que
la llamada es segura, pero la extensión la bloqueará igual.

**Comprueba esto antes de dar la tarea por buena** y, si falla, sustituye los dos `upsert` por un
`findFirst` seguido de `create` o `update` dentro de la misma transacción. Es el camino que la
extensión sí permite y no pierde nada: la transacción ya serializa.

- [ ] **Step 4: El controlador**

Crear `apps/api/src/comunicacion/config-email.controller.ts`:

```ts
import { BadRequestException, Body, Controller, Get, Param, Put } from '@nestjs/common';
import {
  TIPOS_DE_PLANTILLA,
  type ConfiguracionSmtpPublica,
  type JwtPayload,
  type PlantillaPublica,
  type TipoPlantilla,
} from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ConfigEmailService } from './config-email.service';
import { GuardarPlantillaDto } from './dto/guardar-plantilla.dto';
import { GuardarSmtpDto } from './dto/guardar-smtp.dto';

// ADMIN_SALON y no ADMIN_OPERATIVO: son credenciales, y son los textos que
// salen firmados con el nombre del gimnasio.
@Controller('config')
export class ConfigEmailController {
  constructor(private readonly config: ConfigEmailService) {}

  @Roles('ADMIN_SALON')
  @Put('smtp')
  guardarSmtp(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: GuardarSmtpDto,
  ): Promise<ConfiguracionSmtpPublica> {
    return this.config.guardarSmtp(actor, dto);
  }

  @Roles('ADMIN_SALON')
  @Get('smtp')
  verSmtp(): Promise<ConfiguracionSmtpPublica> {
    return this.config.verSmtp();
  }

  @Roles('ADMIN_SALON')
  @Get('plantillas')
  listarPlantillas(): Promise<PlantillaPublica[]> {
    return this.config.listarPlantillas();
  }

  @Roles('ADMIN_SALON')
  @Put('plantillas/:tipo')
  guardarPlantilla(
    @CurrentUser() actor: JwtPayload,
    @Param('tipo') tipo: string,
    @Body() dto: GuardarPlantillaDto,
  ): Promise<PlantillaPublica> {
    // El tipo viene de la URL, asi que no pasa por el ValidationPipe: se
    // comprueba a mano contra el enum en vez de dejar que llegue a Prisma.
    if (!TIPOS_DE_PLANTILLA.includes(tipo as TipoPlantilla)) {
      throw new BadRequestException(
        `Tipo de plantilla desconocido: ${tipo}. Los validos son ${TIPOS_DE_PLANTILLA.join(', ')}.`,
      );
    }

    return this.config.guardarPlantilla(actor, tipo as TipoPlantilla, dto);
  }
}
```

Añade `ConfigEmailService` a `providers` y `ConfigEmailController` a `controllers` en
`comunicacion.module.ts`, y exporta el servicio.

- [ ] **Step 5: Correr**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/comunicacion --silent && pnpm exec tsc --noEmit
```

Esperado: 26 en verde y `tsc` limpio.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): configuracion de SMTP y plantillas por gimnasio

La conexion se verifica ANTES de guardar: una configuracion que no
conecta deja al gimnasio creyendo que sus emails salen, y el primer aviso
llega cuando un alumno no recibio el suyo.

GET /config/smtp no devuelve la contrasena ni enmascarada: una mascara
sigue confirmando la longitud. Solo dice si hay una guardada. El detalle
del historial lleva host y usuario, nunca la clave.
```

### Apéndice de la Task 5: `motivoSeguro`, que este plan no preveía

Esto no estaba escrito aquí. Salió durante la ejecución y queda anotado porque es el tipo de cosa
que, si no está en el papel, el próximo que lea la función la borra por "defensiva de más".

**El agujero original.** `guardarSmtp` devuelve un 400 con el motivo del fallo de conexión, como pide
la §6.2 de la spec. Pero nodemailer arma el `EAUTH` como `Invalid login: <respuesta literal del
servidor>`, y un servidor verboso reimprime la línea que acaba de recibir: con `AUTH LOGIN`, eso es
**el base64 de la contraseña sola**. Interpolar el mensaje mandaba la credencial de vuelta al
cliente, contra la §6.1 ("la contraseña no vuelve nunca"). Y no hace falta un atacante: basta un host
mal tecleado que dé con un servidor charlatán. Se probó con servidores SMTP falsos, no de palabra.

De ahí salió `motivoSeguro(error, clave, usuario)`, en `config-email.service.ts`.

**Lo que rompió después un revisor independiente**, con un script que importaba la función y le
tiraba casos hostiles:

| Agujero | Cómo se rompía | Arreglo |
|---|---|---|
| Fragmentación | Un `\n` o un guion en medio parte la clave en dos trozos de <16: no la agarra ni la coincidencia literal ni la red de `PARECE_BASE64`. **Alcanzable de verdad**: nodemailer une las líneas de continuación de una respuesta SMTP multilínea con un `\n` literal (`smtp-connection/index.js:747`) y eso va directo a `err.message`. | Pasada por aplanado: quedarse solo con `[A-Za-z0-9]` guardando los índices originales, buscar la aguja aplanada, y redactar el tramo entero **con los separadores de adentro**. |
| `code` sin sanear | El paso 1 devolvía cualquier `code` string tal cual. Hoy nodemailer solo pone ~20 literales fijos, pero la función confiaba en el **tipo** del campo, no en su **forma**. | Solo se devuelve si matchea `/^[A-Z][A-Z0-9_]{1,30}$/`. |
| Unicode NFC/NFD | Una clave con `ñ` devuelta descompuesta es visualmente idéntica y distinta en bytes: no coincidía con ninguna aguja, y esos caracteres tampoco entran en la clase del regex. | `.normalize('NFC')` en los dos lados antes de aplanar. |
| base64 URL-safe | `-` y `_` no están en `[A-Za-z0-9+/=]`. | Cae solo: el aplanado tira `+`, `/`, `=`, `-` y `_`, así que el base64 estándar y el base64url del mismo secreto aplanan al mismo string. |
| `motivoSeguro(null)` | `TypeError` → el 400 esperado se volvía un 500. | Guarda de objeto. |

**Lo que deliberadamente NO se cambió**, y por qué:

- **El umbral 16 de `PARECE_BASE64` se queda.** Separa bien las palabras normales de una respuesta
  SMTP (`ECONNREFUSED` son 12, `authentication` 14, ninguna se toca) de los tokens base64 reales. Y
  no era la causa de ningún agujero: la fragmentación y la normalización rompían el match *antes* de
  llegar a contar caracteres. Subirlo o bajarlo no cerraba ninguno de los dos.
- **`-` y `_` no entran en la clase de `PARECE_BASE64`.** Sobre-redactaría palabras normales con
  guion bajo (`authentication_failed` son 21). Queda como hueco latente solo si algún día se soporta
  XOAUTH2 u otro SASL con tokens base64url.

**El test que impide que el arreglo se pase de celoso** es tan importante como los otros: estos tres
motivos tienen que seguir llegando **enteros**, sin una sola redacción, o el admin se queda sin saber
qué le pasó: `ECONNREFUSED`, `Invalid greeting. response=553 ...` y `535 5.7.8 Error: authentication
failed`. Ese test lleva además una clave corta con separador (`'ai-l'`, que aplana a `ail` y cae
dentro de `failed`): con el umbral en 8 se salta, con el umbral en 0 mutila el mensaje. Así la
mutación que baja el umbral tiene algo que romper.

**Lo que sigue abierto, escrito para que nadie lo redescubra a ciegas:**

1. **Clave corta y troceada.** Es el precio explícito del umbral de 8: una clave cuyo aplanado no
   llegue a 8 caracteres y venga partida (`abc-12` devuelta como `abc\n-12`) no la agarra el literal
   (no es contigua), ni el fragmentado (bajo umbral), ni la red (bajo 16). Bajar el umbral **no** es
   la solución: está demostrado con una mutación que entonces sobre-redacta. Lo que lo cerraría es un
   `@MinLength` en el `clave` de `GuardarSmtpDto`, que hoy solo tiene `@IsNotEmpty` y `@MaxLength`.
   **Decisión de producto, no técnica** — pendiente de preguntarle a Cesar, porque rechaza la
   contraseña de un servidor legítimo que use una corta.
2. **Recodificaciones que no son base64.** Si el otro extremo devolviera la clave en hex, en
   quoted-printable, en URL-encoding (`%61%62…`) o con la caja cambiada, el aplanado no coincide con
   ninguna aguja. El hex largo y contiguo lo salva la red de base64 (16 caracteres hex = 8 bytes); el
   hex **troceado** o el `%`-encoding, no. Añadirlas como agujas extra es barato y entra en el mismo
   `reduce`; no se hizo porque hoy ningún camino real las produce.
3. **La puerta del log — esta estaba abierta y se cerró.** `motivoSeguro` solo protegía el cuerpo del
   400. El `MensajeroService` de la Task 7, tal como lo escribía este plan, logueaba
   `(error as Error).message` de un fallo de envío: **el mismísimo texto**, por otra puerta y a un
   sitio que encima se queda escrito. Corregido en la Task 7, con su test y su mutación. Y el
   principio, para la próxima: un log no es menos grave que una respuesta HTTP — la respuesta la ve
   una persona y se va, el log se guarda, se rota, se manda a un agregador y acaba en más manos.

**Segunda corrección de la Task 5, encontrada al revisar la 7: `guardarPlantilla` no comprobaba que
la plantilla compile.** Un admin guarda un `{{#if x}}` sin cerrar y, desde ese instante, todo job de
ese tipo revienta — en bucle, porque hay reintentos. Y revienta en el worker, tres días después, no
delante de quien lo escribió. Se valida al guardar: se compila asunto y cuerpo y, si Handlebars
lanza, 400 con su mensaje y **no se escribe nada** (mismo patrón que el "verifica la conexión ANTES
de guardar"). El error de Handlebars se puede devolver crudo: es texto de la plantilla que el propio
admin acaba de escribir, ahí no hay credencial.

⚠️ **Y la trampa, que casi nos come: `Handlebars.compile` NO lanza.** Es perezoso — devuelve la
función y parsea la primera vez que se la invoca. Una validación escrita como
`try { Handlebars.compile(texto) } catch` **pasa siempre sin comprobar nada**: el agujero seguiría
abierto, con un test en verde encima certificando lo contrario. Hay que usar `Handlebars.precompile`,
que parsea en el acto. Comprobado ejecutándolo, y fijado con un test (`NO se puede escribir con
Handlebars.compile, que es perezoso`) que se cae el día que Handlebars cambie ese comportamiento y el
comentario deje de ser cierto. La mutación que lo defiende es cambiar `precompile` por `compile`: si
esa mutación no rompe nada, la validación es decorativa.

Un corolario que cambia dónde estaba el fallo: `resolverMensaje` **puede lanzar**, y lanza al
renderizar, no al compilar. Por eso la red de `avisar` tiene que envolver `resolverMensaje` y no solo
la lectura de la plantilla.

La red del otro lado va igual, en la Task 7: `resolverMensaje` y `plantillaDe` dentro del `try` de
`avisar`, porque la clase promete "NUNCA lanza" y esa primera línea estaba fuera de todo `try`. Las
dos defensas hacen cosas distintas: la validación avisa a un humano en el momento; la red protege de
las filas guardadas antes de que la validación existiera.

Verificado de paso: `AllExceptionsFilter` **no** es una cuarta puerta. `guardarSmtp` convierte el
error de nodemailer en un `BadRequestException` ya saneado, y el filtro solo loguea el mensaje crudo
de los errores que **no** son `HttpException`. El error original nunca llega hasta él.

---

## Task 6: Las suscripciones push

**Files:**
- Crear: `src/push/push.service.ts` · `.spec.ts` · `.controller.ts` · `.module.ts` ·
  `dto/suscribir.dto.ts`
- Modificar: `src/app.module.ts`

- [ ] **Step 1: El DTO y el servicio**

Crear `apps/api/src/push/dto/suscribir.dto.ts`:

```ts
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SuscribirDto {
  /** La URL del servicio de push del navegador. Larga y opaca. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  endpoint!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  p256dh!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  auth!: string;
}
```

Crear `apps/api/src/push/push.service.ts`:

```ts
import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import {
  ENVIOS_PUSH,
  type DestinoPush,
  type EnviosPush,
  type MensajePush,
} from '../comunicacion/envios.interface';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { SuscribirDto } from './dto/suscribir.dto';

@Injectable()
export class PushService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENVIOS_PUSH) private readonly envios: EnviosPush,
  ) {}

  async suscribir(actor: JwtPayload, dto: SuscribirDto): Promise<void> {
    // Sin VAPID no hay push. 503 y no 400: no es que el cliente mande algo mal,
    // es que este despliegue no tiene la capacidad.
    if (!this.envios.habilitado) {
      throw new ServiceUnavailableException(
        'Este gimnasio no tiene las notificaciones push configuradas.',
      );
    }

    const perfil = await this.perfilDelActor(actor);

    // CORREGIDO DURANTE LA EJECUCION. La version original de este plan buscaba
    // `findFirst({ perfilId, endpoint })` y salia si existia. Estaba mal: el
    // unique es (tenantId, perfilId, endpoint), asi que Ana y Beto compartiendo
    // el navegador del gimnasio acaban con DOS filas sobre el mismo endpoint, y
    // la de Ana no se limpia nunca sola —el endpoint sigue vivo, web-push
    // responde 200, y el 404/410 que dispara la limpieza de `notificar` no
    // llega jamas—. Resultado: Beto recibe los avisos de Ana en su pantalla.
    //
    // Un navegador es de quien se suscribio ultimo: se borra CUALQUIER fila con
    // ese endpoint EN ESTE GIMNASIO (el tenantId lo inyecta la extension; la
    // ausencia del perfilId es justo el arreglo) y se crea la nueva, las dos
    // dentro de una transaccion. Borrar-y-crear ya es idempotente para el mismo
    // alumno, asi que el `findFirst` previo no vuelve.
    //
    // QUE HACE LA TRANSACCION Y QUE NO. Da atomicidad ante fallo: no queda la
    // fila de Ana borrada sin la de Beto creada, que dejaria al navegador sin
    // push sin que nadie se entere. NO cierra la carrera de dos suscripciones
    // simultaneas: con READ COMMITTED el deleteMany de la segunda no ve la fila
    // no commiteada de la primera, y como el @@unique es
    // (tenantId, perfilId, endpoint) y los perfilId difieren, tampoco colisiona.
    // Esa carrera es de todas formas casi inalcanzable, y por una razon que
    // conviene tener escrita: el endpoint IDENTIFICA A UN NAVEGADOR, y un
    // navegador tiene una sesion. Dos perfiles del sistema operativo o una
    // ventana de incognito reciben endpoints distintos y ni siquiera colisionan.
    // Si ese supuesto dejara de valer, lo que la cerraria es un
    // @@unique([tenantId, endpoint]) — con el matiz de que eso convierte al
    // perdedor en un P2002, asi que habria que capturarlo y reintentar.
    //
    // ENTRE GIMNASIOS la regla NO vale: el mismo navegador suscrito en el
    // gimnasio A y en el B conserva las dos filas. Es una consecuencia asumida
    // del aislamiento, no un descuido — taparlo pediria un `runUnscoped()`, que
    // es justo lo que la extension existe para impedir. Y cuando la misma
    // persona es socia de los dos, recibir los avisos de ambos es lo correcto.
    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      await cliente.suscripcionPush.deleteMany({ where: { endpoint: dto.endpoint } });

      await cliente.suscripcionPush.create({
        data: {
          tenantId: actor.tenantId,
          perfilId: perfil.id,
          endpoint: dto.endpoint,
          p256dh: dto.p256dh,
          auth: dto.auth,
        },
      });
    });
  }

  async desuscribir(actor: JwtPayload, endpoint: string | undefined): Promise<void> {
    const perfil = await this.perfilDelActor(actor);

    // Sin endpoint se borran todas las de este alumno: es lo que quiere quien
    // pulsa "desactivar" sin saber que su navegador tiene una suscripcion por
    // dispositivo.
    await this.prisma.db.suscripcionPush.deleteMany({
      where: { perfilId: perfil.id, ...(endpoint ? { endpoint } : {}) },
    });
  }

  /**
   * Manda a todos los dispositivos de un alumno y limpia los que ya no existen.
   *
   * Nunca lanza: lo llaman los processors, y un push fallido no puede tumbar el
   * email que iba en el mismo job.
   */
  async notificar(
    cliente: ClientePrismaTx,
    perfilId: string,
    mensaje: MensajePush,
  ): Promise<number> {
    if (!this.envios.habilitado) return 0;

    const destinos = await cliente.suscripcionPush.findMany({ where: { perfilId } });
    let enviados = 0;

    // Sin `as unknown as (DestinoPush & { id: string })[]`, que es lo que decia
    // este plan y estaba MAL: el doble cast apaga el chequeo de tipos justo
    // donde duele. El findMany ya devuelve filas con id, endpoint, p256dh y
    // auth, asignables a DestinoPush; comprobado que `tsc --noEmit` sale limpio
    // sin el cast. Con el cast, renombrar p256dh en el schema compilaria igual
    // y fallaria en ejecucion mandandole `undefined` a web-push.
    for (const destino of destinos) {
      const resultado = await this.envios.enviar(destino, mensaje);

      if (resultado === 'ENVIADO') enviados += 1;
      if (resultado === 'CADUCADA') {
        // 404 o 410: la suscripcion ya no existe en el navegador. Sin esto, la
        // tabla se llena de endpoints muertos a los que se reintenta cada dia.
        await cliente.suscripcionPush.deleteMany({ where: { id: destino.id } });
      }
    }

    return enviados;
  }

  private async perfilDelActor(actor: JwtPayload): Promise<{ id: string }> {
    const perfil = await this.prisma.db.perfil.findFirst({
      where: { usuarioId: actor.sub },
      select: { id: true },
    });
    if (!perfil) throw new NotFoundException('Este usuario no tiene perfil');

    return perfil;
  }
}
```

- [ ] **Step 2: Los tests**

Crear `apps/api/src/push/push.service.spec.ts` con estos casos, siguiendo el estilo de los dobles de
las fases anteriores (un `prismaFalso` que filtre de verdad por `perfilId`):

1. `sin VAPID, suscribir responde 503` — `envios.habilitado = false`.
2. `suscribirse dos veces con el mismo endpoint no duplica` — queda una sola fila.
3. **`el endpoint de otro alumno se le quita: un navegador es de quien se suscribio ultimo`** —
   Ana tiene fila sobre el endpoint, se suscribe Beto, queda **una** fila y es la de Beto.
4. **`pero no toca los endpoints DISTINTOS de otros alumnos`** — acota el borrado por arriba.
5. `desuscribir sin endpoint borra todas las del alumno` — el `where` no lleva `endpoint`.
6. `notificar manda a los dos dispositivos` — dos filas, dos envíos.
7. **`una suscripcion CADUCADA se borra`** — el adaptador devuelve `CADUCADA` y se comprueba el
   `deleteMany` con ese id.
8. `sin VAPID, notificar no manda nada y no lanza`.
9. `el borrado y la creacion van en la misma transaccion` — ojo con el comentario de este test: mide
   **atomicidad**, no exclusión mutua. Ver el bloque de `suscribir`.
10. **`notificar no lanza aunque la base falle`** — el doble hace que `findMany` rechace. El JSDoc
    promete "nunca lanza" y hoy eso se cumplía de rebote, porque `PushPorWebPush.enviar` captura
    todo; un fallo del `findMany` o del `deleteMany` de limpieza sí propagaba. La Task 7 se apoya en
    esa promesa (`MensajeroService` también dice "NUNCA lanza"), y una promesa que solo se cumple por
    accidente a través de otra clase no es una promesa.
11. **`desuscribir con el endpoint de otro alumno no borra nada`** — Beto pasa el endpoint de Ana en
    el query string.
12. **`un endpoint presente pero vacío es 400`** — `...(endpoint ? { endpoint } : {})` trata la
    cadena vacía como ausente, así que `DELETE /push/suscripcion?endpoint=` acababa borrando
    **todas** las del alumno. Son datos propios, no es un agujero, pero es una sorpresa fea.

⚠️ **El doble de Prisma tiene que generar ids monótonos**, no `filas.length + 1`: ahora un `create`
sigue a un `deleteMany`, y con la longitud como id el doble reutiliza un id vivo y miente justo en
los tests nuevos.

- [ ] **Step 3: El controlador y el módulo**

Crear `apps/api/src/push/push.controller.ts`:

```ts
import { Body, Controller, Delete, HttpCode, Post, Query } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SuscribirDto } from './dto/suscribir.dto';
import { PushService } from './push.service';

@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Roles('ALUMNO')
  @HttpCode(204)
  @Post('suscripcion')
  suscribir(@CurrentUser() actor: JwtPayload, @Body() dto: SuscribirDto): Promise<void> {
    return this.push.suscribir(actor, dto);
  }

  @Roles('ALUMNO')
  @HttpCode(204)
  @Delete('suscripcion')
  desuscribir(
    @CurrentUser() actor: JwtPayload,
    @Query('endpoint') endpoint?: string,
  ): Promise<void> {
    return this.push.desuscribir(actor, endpoint);
  }
}
```

Crear `push.module.ts` con el controlador y el servicio, exportando el servicio, y añádelo a
`app.module.ts`.

⚠️ **Un comentario que tiene que quedar en el controlador: no se añade nunca un `GET` que liste
suscripciones.** El diseño "un navegador es de quien se suscribió último" tiene una contrapartida
asumida: quien conozca el endpoint de otro alumno puede quedarse su navegador con un `POST` y dejarlo
sin push en silencio. No es fuga —web-push cifra con las claves del atacante y el navegador de la
víctima no descifra nada—, es denegación de servicio, y hoy es inalcanzable **solo porque ninguna
ruta expone endpoints ajenos**. Eso es lo que lo sostiene, y sin escribirlo el día que alguien añada
el listado abre el camino sin enterarse.

- [ ] **Step 4: Correr**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/push --silent && pnpm exec tsc --noEmit
```

Esperado: 9 en verde y `tsc` limpio.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): suscripciones push del navegador

Sin claves VAPID, suscribirse responde 503: no es que el cliente mande
algo mal, es que este despliegue no tiene la capacidad. El email sigue
saliendo igual.

Una suscripcion que devuelve 404 o 410 ya no existe en el navegador y se
borra sola: sin eso la tabla se llena de endpoints muertos a los que se
reintenta cada dia.
```

---
## Task 7: El mensajero, y el hook que deja de estar inerte

**Files:**
- Crear: `src/comunicacion/mensajero.service.ts` · `.spec.ts`
- Crear: `src/jobs/notificaciones/colas.ts`
- Modificar: `src/notificaciones/notificaciones.service.ts` · `.spec.ts` ·
  `notificaciones.module.ts`
- Modificar: `src/reservas/reservas.service.ts`, `src/jobs/jobs.module.ts`

- [ ] **Step 1: Las colas y sus payloads**

Crear `apps/api/src/jobs/notificaciones/colas.ts`:

```ts
export const NOTIFICACION_RESERVA_QUEUE = 'notificacion-reserva-queue';
export const NOTIFICACION_LISTA_ESPERA_QUEUE = 'notificacion-lista-espera-queue';
export const RECORDATORIO_PAGO_QUEUE = 'recordatorio-pago-queue';
export const VENCIMIENTO_PACK_QUEUE = 'vencimiento-pack-queue';

/**
 * `tenantId` es un DATO DE SEGURIDAD en todos los payloads: el worker no tiene
 * request ni JWT, asi que es lo unico que le dice sobre que gimnasio puede
 * operar. Lo pone quien encola, desde el contexto ya abierto, NUNCA el cuerpo
 * de una peticion. Mismo criterio que DatosGeneracionMes desde la Fase 2.
 *
 * REGLA QUE NO SE ROMPE: un payload lleva IDENTIFICADORES Y NADA MAS.
 *
 * Nunca, bajo ninguna circunstancia, un `DatosSmtp` ni nada que salga de
 * `datosDeEnvio()`. Un job de BullMQ se serializa a Redis en JSON y se queda
 * ahi hasta que caduque: meter la credencial descifrada en el payload la
 * persiste en claro, la expone en cualquier panel de Bull y la deja fuera de
 * las cuatro puertas que la Task 5 cerro con tests.
 *
 * El SMTP se resuelve DENTRO del processor, que ya abre su contexto de tenant
 * y puede pedirlo. Cuesta una consulta y evita una fuga.
 *
 * Y LA OTRA CONDICION, que se decide aqui y la cumplen las Tasks 8, 9 y 10:
 * los jobs se encolan con `attempts: 3`, asi que UN PROCESSOR PUEDE
 * EJECUTARSE DOS VECES. Quien escriba uno tiene que hacerlo idempotente. El
 * caso concreto: manda el email, falla despues —al marcar la entrada como
 * notificada, por ejemplo—, y el reintento manda el segundo email. Es el mismo
 * aviso fantasma que el encolado post-commit evita, entrando por la otra
 * puerta: alli el peligro era encolar algo que no ocurrio, aqui es hacer dos
 * veces algo que ocurrio una.
 */
export interface DatosNotificacionReserva {
  tenantId: string;
  perfilId: string;
  turnoId: string;
  accion: 'CONFIRMACION' | 'CANCELACION';
}

export interface DatosNotificacionListaEspera {
  tenantId: string;
  perfilId: string;
  turnoId: string;
  entradaId: string;
}

/** Los diarios no llevan tenant: recorren todos. Ver la Task 10. */
export interface DatosDiarios {
  /** Inyectable para los tests; en produccion es el reloj del worker. */
  ahoraISO?: string;
}
```

- [ ] **Step 2: El mensajero**

Crear `apps/api/src/comunicacion/mensajero.service.ts`:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TipoPlantilla } from '@boxadmin/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { ConfigEmailService } from './config-email.service';
import { ENVIOS_DE_EMAIL, type EnviosDeEmail } from './envios.interface';
import { resolverMensaje, type DatosDePlantilla } from './plantillas';

export interface Destinatario {
  perfilId: string;
  email: string;
  nombre: string;
}

/**
 * Junta plantilla, SMTP y envio. Lo usan los cuatro processors, que asi no
 * repiten cinco veces la misma secuencia.
 *
 * NUNCA lanza. Un processor que reviente por un SMTP mal configurado se
 * reintenta en bucle y llena la cola de trabajo muerto; peor, en el caso de la
 * lista de espera dejaria sin marcar una asignacion que si ocurrio.
 */
@Injectable()
export class MensajeroService {
  private readonly logger = new Logger(MensajeroService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigEmailService,
    private readonly push: PushService,
    @Inject(ENVIOS_DE_EMAIL) private readonly envios: EnviosDeEmail,
  ) {}

  async avisar(
    destinatario: Destinatario,
    tipo: TipoPlantilla,
    datos: DatosDePlantilla,
    urlPush: string,
  ): Promise<void> {
    const { asunto, html } = resolverMensaje(await this.config.plantillaDe(tipo), tipo, datos);

    await this.porEmail(destinatario, asunto, html);
    await this.porPush(destinatario, asunto, urlPush);
  }

  private async porEmail(destinatario: Destinatario, asunto: string, html: string): Promise<void> {
    // Declarado FUERA del try aunque se asigne dentro: el catch lo necesita
    // para sanear el mensaje del error, y dentro no estaria en alcance. Sigue
    // todo bajo el try, que el contrato de la clase es no lanzar nunca.
    let envio: Awaited<ReturnType<ConfigEmailService['datosDeEnvio']>> = null;

    try {
      envio = await this.config.datosDeEnvio();

      if (envio === null) {
        // Un gimnasio sin SMTP configurado no es un error: es un gimnasio que
        // todavia no quiere mandar emails.
        this.logger.log(`Sin SMTP configurado; no se envia "${asunto}"`);
        return;
      }

      await this.envios.enviar(envio.smtp, {
        para: destinatario.email,
        copia: envio.copia,
        asunto,
        html,
      });
    } catch (error) {
      // Se traga el error a proposito y se deja rastro. Ver el comentario de la
      // clase. NUNCA se loguea el objeto de configuracion: lleva la clave.
      //
      // ⚠️ Y TAMPOCO el mensaje crudo del error, que es la parte que este plan
      // tenia MAL. `(error as Error).message` de un fallo de nodemailer es
      // exactamente el texto del que la Task 5 saco la contrasena: el EAUTH se
      // arma como `Invalid login: <respuesta literal del servidor>`, y un
      // servidor verboso reimprime ahi el base64 de la clave. Se demostro con
      // servidores SMTP falsos, no de palabra. El 400 de `guardarSmtp` ya esta
      // protegido por `motivoSeguro`; este log era la MISMA fuga por otra
      // puerta, y encima a un sitio que se queda escrito.
      //
      // Un log no es menos grave que una respuesta HTTP: la respuesta la ve una
      // persona y se va, el log se guarda, se rota, se envia a un agregador y
      // acaba en mas manos que la propia respuesta.
      //
      // Si el fallo fue del propio `datosDeEnvio`, `envio` sigue en null y no
      // hay credencial que pasarle: `motivoSeguro` con agujas vacias degrada a
      // la red de base64 y sigue haciendo su trabajo. Por eso los `?? ''`.
      this.logger.warn(
        `Fallo el email a ${destinatario.email}: ` +
          `${motivoSeguro(error, envio?.smtp.clave ?? '', envio?.smtp.usuario ?? '')}`,
      );
    }
  }

  private async porPush(destinatario: Destinatario, titulo: string, url: string): Promise<void> {
    try {
      await this.push.notificar(this.prisma.db, destinatario.perfilId, {
        titulo,
        cuerpo: `Hola ${destinatario.nombre}`,
        url,
      });
    } catch (error) {
      this.logger.warn(`Fallo el push a ${destinatario.perfilId}: ${(error as Error).message}`);
    }
  }
}
```

Necesita `import { ConfigEmailService, motivoSeguro } from './config-email.service';` — `motivoSeguro`
ya está exportada desde la Task 5.

**Test obligatorio, y que se verifica con una mutación:** `un fallo del SMTP no escribe la clave en el
log`. El doble de `envios.enviar` rechaza con un error que imita al de nodemailer —
`new Error('Invalid login: 535 5.7.8 ' + Buffer.from('laClaveDelGimnasio').toString('base64'))` —, se
espía `logger.warn`, y se comprueba que el texto logueado **no contiene** ni la clave ni su base64.
Mutación que tiene que romperlo: volver a `(error as Error).message`. Si esa mutación no rompe nada,
el test está mirando al sitio equivocado.

Añádelo a `providers` y `exports` de `comunicacion.module.ts`. ⚠️ Necesita `PushService`, así que
`ComunicacionModule` tiene que importar `PushModule` — y `PushModule` **no** puede importar
`ComunicacionModule` o hay ciclo. `PushService` solo necesita el token `ENVIOS_PUSH`, que es global.

- [ ] **Step 3: El hook deja de loguear y encola**

Reescribe `apps/api/src/notificaciones/notificaciones.service.ts`:

```ts
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { OrigenReserva } from '@boxadmin/shared';
import {
  NOTIFICACION_LISTA_ESPERA_QUEUE,
  NOTIFICACION_RESERVA_QUEUE,
  type DatosNotificacionListaEspera,
  type DatosNotificacionReserva,
} from '../jobs/notificaciones/colas';

export interface CupoAsignado {
  tenantId: string;
  perfilId: string;
  turnoId: string;
  reservaId: string;
  entradaId: string;
}

export interface ReservaCambiada {
  tenantId: string;
  perfilId: string;
  turnoId: string;
  origen: OrigenReserva;
  accion: 'CONFIRMACION' | 'CANCELACION';
}

/**
 * El enganche que la Fase 3A dejo preparado. Desde la 5B **encola**, no envia.
 *
 * INVARIANTE, el mismo de la 3A y ahora con motivo: estos metodos NUNCA deben
 * lanzar. Se llaman dentro de la transaccion que crea o cancela la reserva, asi
 * que una excepcion aqui revertiria una operacion perfectamente valida. Encolar
 * es una escritura a Redis y puede fallar; por eso va envuelto en try/catch.
 *
 * Y por eso se encola en vez de enviar: un SMTP lento o caido dentro de una
 * transaccion de Postgres es un bloqueo esperando a una red ajena.
 */
@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger(NotificacionesService.name);

  constructor(
    @InjectQueue(NOTIFICACION_RESERVA_QUEUE) private readonly colaReserva: Queue,
    @InjectQueue(NOTIFICACION_LISTA_ESPERA_QUEUE) private readonly colaListaEspera: Queue,
  ) {}

  async cupoAsignado(evento: CupoAsignado): Promise<void> {
    const datos: DatosNotificacionListaEspera = {
      tenantId: evento.tenantId,
      perfilId: evento.perfilId,
      turnoId: evento.turnoId,
      entradaId: evento.entradaId,
    };

    await this.encolar(this.colaListaEspera, datos, `cupo asignado a ${evento.perfilId}`);
  }

  async reservaCambiada(evento: ReservaCambiada): Promise<void> {
    // Las de RUTINA no avisan. Publicar un mes con treinta alumnos son ciento
    // veinte correos en el mismo minuto, y el alumno ya sabe que va todos los
    // martes: lo que no sabe es lo que cambia.
    //
    // Hoy las de RUTINA ni siquiera pasan por aqui —las crea el aplicador del
    // plan directamente contra Prisma—, pero `origen` llega del DTO en el alta
    // manual y nada impide mandarlo. La comprobacion es barata.
    if (evento.origen === 'RUTINA') return;

    const datos: DatosNotificacionReserva = {
      tenantId: evento.tenantId,
      perfilId: evento.perfilId,
      turnoId: evento.turnoId,
      accion: evento.accion,
    };

    await this.encolar(this.colaReserva, datos, `${evento.accion} de ${evento.perfilId}`);
  }

  private async encolar(cola: Queue, datos: object, descripcion: string): Promise<void> {
    try {
      await cola.add('aviso', datos, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        // Que la cola no crezca sin limite con jobs ya hechos.
        removeOnComplete: 100,
        removeOnFail: 500,
      });
    } catch (error) {
      this.logger.warn(`No se pudo encolar el aviso (${descripcion}): ${(error as Error).message}`);
    }
  }
}
```

En `notificaciones.module.ts`, registra las dos colas con `BullModule.registerQueue`.

- [ ] **Step 4: Reescribir el spec del hook**

`notificaciones.service.spec.ts` protege hoy que `cupoAsignado` no lanza. Amplíalo:

```ts
describe('NotificacionesService', () => {
  function crearServicio(colaFalla = false) {
    const add = colaFalla
      ? jest.fn().mockRejectedValue(new Error('Redis caido'))
      : jest.fn().mockResolvedValue({ id: 'job-1' });
    const colaReserva = { add } as never;
    const colaListaEspera = { add } as never;

    return { servicio: new NotificacionesService(colaReserva, colaListaEspera), add };
  }

  it('encola el aviso de cupo asignado', async () => {
    const { servicio, add } = crearServicio();

    await servicio.cupoAsignado({
      tenantId: 'gym-1',
      perfilId: 'perfil-1',
      turnoId: 'turno-1',
      reservaId: 'reserva-1',
      entradaId: 'entrada-1',
    });

    expect(add).toHaveBeenCalledTimes(1);
  });

  it('NO lanza aunque Redis este caido', async () => {
    // El invariante de la Fase 3A, ahora con motivo: esto corre dentro de la
    // transaccion que asigna el cupo. Una excepcion aqui revertiria una reserva
    // perfectamente valida.
    const { servicio } = crearServicio(true);

    await expect(
      servicio.cupoAsignado({
        tenantId: 'gym-1',
        perfilId: 'p',
        turnoId: 't',
        reservaId: 'r',
        entradaId: 'e',
      }),
    ).resolves.toBeUndefined();
  });

  it('una reserva de RUTINA no encola nada', async () => {
    const { servicio, add } = crearServicio();

    await servicio.reservaCambiada({
      tenantId: 'gym-1',
      perfilId: 'p',
      turnoId: 't',
      origen: 'RUTINA',
      accion: 'CONFIRMACION',
    });

    expect(add).not.toHaveBeenCalled();
  });

  it('una reserva del alumno si encola', async () => {
    const { servicio, add } = crearServicio();

    await servicio.reservaCambiada({
      tenantId: 'gym-1',
      perfilId: 'p',
      turnoId: 't',
      origen: 'ALUMNO',
      accion: 'CONFIRMACION',
    });

    expect(add).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 5: Engancharlo en reservas**

En `lista-espera.service.ts`, la llamada a `cupoAsignado` ya existe: añádele `entradaId: entrada.id`.

⚠️ **Eso va a romper un test, y tiene que romperlo.** `lista-espera.service.spec.ts:242` hace
`expect(notificaciones.cupoAsignado).toHaveBeenCalledWith({...})` con el objeto **exacto**, así que
el campo nuevo lo tira. Es la tercera vez en el proyecto que un assert que fija una forma entera se
cae al añadir un campo (pasó en la Fase 1 con un `include` y dos veces en la Fase 2). Añadí
`entradaId` al objeto esperado y seguí; no lo ablandes a `expect.objectContaining` para que deje de
molestar, que ese assert es justo el que garantiza que no se cuela nada de más en el payload.

Verificado antes de empezar, para que no lo descubras a mitad: `PushModule` **no** importa
`ComunicacionModule` (el global ya le da `ENVIOS_PUSH`), así que meter `imports: [PushModule]` en el
`forRoot()` no crea ciclo. Y `mi-calendario.service.ts:201` delega en `reservas.crear`, así que
enganchar `reservas.service.ts` cubre también las reservas que hace el alumno desde la PWA; el único
`reserva.create` que queda fuera es el de `publicacion.service.ts`, que es `RUTINA` y no avisa a
propósito.

⚠️ **CORREGIDO DURANTE LA EJECUCIÓN: el aviso se encola DESPUÉS del commit, no dentro de la
transacción.** Esto que sigue lo decía mal este plan, y lo encontró el implementador.

`crear` y `cancelar` corren bajo `conReintentoDeCupo` con `isolationLevel: 'Serializable'`. **Redis no
participa del rollback de Postgres**: si la transacción aborta con 40001 después de haber encolado,
el job ya está en Redis y el reintento encola otro. El alumno recibe dos confirmaciones, o una de una
reserva que al final no existió porque el reintento acabó en 409.

Y lo que lo vuelve serio no es la probabilidad, es **cuándo** pasa: un aborto por serialización
ocurre justo cuando dos personas compiten por el último lugar de un turno, que es exactamente el
momento en que el aviso importa. La ventana no es un rincón raro, es el caso de uso.

El comentario de la Fase 3A —que el hook va dentro de la transacción "cuando ya se sabe que la
reserva se creó"— era cierto **mientras el hook solo escribía en el log**: un log duplicado no le
hace daño a nadie. Desde que encola, dentro de la transacción no sabés que la reserva se creó, sabés
que está a punto de crearse. La certeza llega con el commit.

Así que: la transacción **devuelve** los avisos junto con su resultado, y se encolan fuera, cuando
`conReintentoDeCupo` ya volvió. `asignarPrimero` deja de llamar a `cupoAsignado` y devuelve los datos
del aviso (ya devolvía `{ reservaId, perfilId } | null`; se le suman `turnoId` y `entradaId`), y
`cancelar` recoge ese aviso junto con el de CANCELACION.

Lo que **no** se mueve: la asignación del cupo en sí se queda dentro de la transacción, por el motivo
que ya dice su comentario — tiene que revertirse con la cancelación que la originó, o una cancelación
que falle después deja una reserva de la cola que nadie pidió. Sale fuera **solo el aviso**.

**El intercambio que se acepta, escrito:** si el proceso muere entre el commit y el `add`, el aviso se
pierde. Es preferible a mandarlo de más. Perder un aviso molesta; mandar uno fantasma le dice a
alguien que tiene una clase que no tiene, o le confirma dos veces una que pidió una vez — y eso no se
desanda, porque un aviso mal mandado no da error: llega, y se lee.

Y el `try/catch` de `encolar` sigue haciendo falta, pero ahora por otro motivo: ya no protege una
transacción (no hay ninguna abierta), protege de que un Redis caído convierta en 500 un POST que
guardó la reserva perfectamente.

**El test que lo defiende:** la transacción aborta con 40001 en el primer intento y el reintento la
completa → `add` se llamó **una sola vez**. Con el encolado dentro, ese test cuenta dos.

En `reservas.service.ts`, inyecta `NotificacionesService`. El aviso que la transacción devuelve tiene
esta forma (y se encola ya fuera de ella):

```ts
      await this.notificaciones.reservaCambiada({
        tenantId: actor.tenantId,
        perfilId: reserva.perfilId,
        turnoId: reserva.turnoId,
        origen: reserva.origen,
        accion: 'CONFIRMACION', // o 'CANCELACION' en cancelar
      });
```

⚠️ `ReservasModule` ya importa `ListaEsperaModule`, que importa `NotificacionesModule`. Comprueba que
no aparece un ciclo; si aparece, `NotificacionesModule` puede ser `@Global` como
`ComunicacionModule`.

- [ ] **Step 6: Correr**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/notificaciones src/reservas src/lista-espera --silent
```

Esperado: verde. Los tests de lista de espera y reservas ya tenían dobles del hook; les basta con
aceptar el método nuevo.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): el hook de notificaciones deja de estar inerte

Desde la Fase 3A solo escribia en el log. Ahora encola, y sigue sin
lanzar nunca: corre dentro de la transaccion que crea o cancela la
reserva, y encolar es una escritura a Redis que puede fallar.

Se encola en vez de enviar porque un SMTP lento dentro de una transaccion
de Postgres es un bloqueo esperando a una red ajena. Las reservas de
RUTINA no avisan: publicar un mes serian cientos de correos de golpe.
```

---

## Task 8: El processor de reserva

**Files:**
- Crear: `src/jobs/notificaciones/notificacion-reserva.processor.ts` · `.spec.ts`
- Modificar: `src/jobs/jobs.module.ts`

⚠️ **El `perfilId` del payload hay que contrastarlo, no creerlo.** `PushService.notificar` confia en
el perfil que le pasan, y la extension de aislamiento NO lo va a atrapar: filtra por gimnasio, y esto
seria un cruce **dentro** del mismo gimnasio. El processor tiene que comprobar que el perfil del
payload es de verdad el duenio de la reserva, del turno o del pack que origino el aviso; si no
coincide, se omite el envio y se deja rastro. Un aviso que llega a la persona equivocada no da error:
llega, y se lee.

⚠️ **Y no basta con contrastar el perfil: hay que comprobar que la reserva EXISTE y sigue viva.** El
encolado se movió a después del commit justo para que no haya jobs fantasma (ver la Task 7), pero eso
cierra la puerta de arriba, no la de abajo: entre que el job se encola y el worker lo toma pueden
pasar minutos, y en ese rato la reserva puede haberse cancelado. El processor lee el estado **en el
momento de enviar**, no confía en que el payload siga siendo cierto. Si la reserva ya no está activa,
no manda nada. Un payload es una foto del pasado; la base es el presente.

⚠️ **PENDIENTE AL CERRAR LA FASE: mover la marca de idempotencia de `job.updateData` a columnas de
`Reserva`, en LOS DOS processors.** Hoy la marca vive en Redis, en la clave del propio job. Funciona
para lo que tiene que cubrir —los reintentos del **mismo** job, que es lo que produce `attempts: 3`— y
está documentado en los dos processors.

**Corrección: este bloque decía que la Task 9 usaba `ListaEspera.notificado`, una columna. Es falso, y
haberlo creído casi cuesta caro.** `asignarPrimero` **borra** la fila de `ListaEspera` en la misma
transacción en la que crea la reserva (`lista-espera.service.ts`, y hay un test commiteado que lo
fija), y el aviso se encola **después** del commit. Cuando el worker toma el job, la fila ya no existe:
un `updateMany` sobre `notificado` devolvería `count: 0` **siempre**, y un CAS sobre eso —que es lo que
este plan llegó a pedir— habría suprimido el **100%** de los avisos de lista de espera, sin lanzar,
sin log, y probablemente en verde contra un doble escrito a medida. El borrado no es un descuido: la
plantilla `LISTA_ESPERA` dice textualmente *"Ya no estás en la lista de espera"*.

Así que los dos hermanos usan la marca en Redis, que era lo que de verdad importaba: **el mismo
mecanismo en los dos**. Y el pendiente es uno solo, para ambos.

La columna además cierra el agujero que la marca en Redis no cubre: **dos jobs distintos para el mismo
aviso**. Hoy no puede pasar (`crear` da 409 en duplicada, `cancelar` da 409 en ya cancelada), pero eso
lo sostiene un 409 que vive lejos, en otro servicio, y que nadie va a recordar que sostiene esto.

⚠️ **Y la columna hay que escribirla como CAS, no como un `update` a secas.** Esto lo sacó la revisión
de la Task 8 y es la parte que se pierde si no está escrita aquí: `job.updateData` es un
read-modify-write **sin atomicidad**, así que un job *stalled* con dos ejecuciones solapadas —el lock
vence por una pausa del event loop, un GC o un Redis lento, y BullMQ lo redistribuye mientras el
primer worker sigue vivo— hace que los dos lean la marca ausente y los dos manden. Si la columna se
escribe con un `update` normal, **cambiamos la marca de sitio y nos llevamos el mismo agujero
puesto**. Va como `updateMany({ where: { …, notificado: false } })` mirando el `count`: si volvió 0,
otro ya la marcó y este no manda.

Hacen falta **tres** columnas, no una: una reserva puede generar un aviso de CONFIRMACIÓN, después uno
de CANCELACIÓN, y una nacida de la lista de espera genera además el aviso de cupo asignado. Las tres
cuelgan de `Reserva`, que es el hecho durable que queda en los tres casos — y en el de la lista de
espera es además **el único** que queda, porque la entrada de la cola se borra.

Lo que NO se hace, para que no se vuelva a proponer: **dejar viva la fila de `ListaEspera`** y marcarla
ahí. No es solo caro, está mal. Durante la ventana el alumno aparecería a la vez con reserva y en la
lista de espera, contradiciendo el email que se le acaba de mandar; y el `@@unique([tenantId, turnoId,
perfilId])` convertiría un fallo de Redis en una fila huérfana que le bloquea ese turno para siempre. Se hace cuando Docker vuelva a estar en pie, junto con la Task 9, para que las dos
aterricen con el mismo mecanismo. **Prisma numera las migraciones en UTC** — si se escribe a mano, el
nombre va con la hora UTC o queda ordenada antes de las ya aplicadas.

Lo que se descartó y por qué: escribir la marca en `historial_acciones` rompe un e2e de
`test/nucleo.e2e-spec.ts` (checklist 9) que afirma que **todas** las filas tienen
`usuarioId === gym.adminId`, y una fila escrita por el worker va sin autor. Más allá del test, meter
acciones de máquina en una auditoría de personas está mal igual.

⚠️ **El processor tiene que ser IDEMPOTENTE: su job puede ejecutarse dos veces.** Los jobs llevan
`attempts: 3`. Si manda el email y falla después —al marcar la entrada como notificada, al escribir
el historial—, el reintento manda el segundo email. El orden importa: **primero se marca, después se
manda**, o se comprueba la marca antes de mandar. Vale para las Tasks 8, 9 y 10. Lo señaló la
revisión de la Task 7 y está escrito también en `colas.ts`.

⚠️ **Las fechas que entren en `datos` tienen que ir LEGIBLES, no en ISO.** `aFechaISO` devuelve
`2026-09-07`, y el email diria "Te reservamos Pilates el 2026-09-07": suena a sistema, no a mensaje.
`resolverMensaje` no formatea a proposito —es pura y no sabe de idiomas—, asi que le toca a quien
arma los datos.

Antes de escribir el processor, anadi a `packages/shared/src/fechas.ts`:

```ts
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * Una fecha como la escribiria una persona: "lunes 7 de septiembre".
 *
 * Se arma a mano y no con `toLocaleDateString`: el resultado de esa dependeria
 * de los datos de idioma del sistema donde corra el worker, que en un contenedor
 * minimo pueden no estar y devolver el nombre en ingles. Esto es lo que va a
 * leer un alumno, asi que no puede depender de como este montada la imagen.
 */
export function fechaLegible(fecha: Date): string {
  return `${DIAS[fecha.getUTCDay()]} ${fecha.getUTCDate()} de ${MESES[fecha.getUTCMonth()]}`;
}
```

con sus tests (los siete dias, un cambio de mes, y que no depende del huso del proceso). Los tres
processors la usan para el campo `fecha`.

- [ ] **Step 1: El processor**

Crear `apps/api/src/jobs/notificaciones/notificacion-reserva.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { fechaLegible } from '@boxadmin/shared';
import { MensajeroService } from '../../comunicacion/mensajero.service';
import { runWithTenant } from '../../common/tenant/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICACION_RESERVA_QUEUE, type DatosNotificacionReserva } from './colas';

@Processor(NOTIFICACION_RESERVA_QUEUE)
export class NotificacionReservaProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificacionReservaProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mensajero: MensajeroService,
  ) {
    super();
  }

  /**
   * Un job no tiene request, asi que no hay middleware que abra el contexto de
   * tenant: sin `runWithTenant`, la primera query lanzaria
   * MissingTenantContextError. Es el diseno fail-closed funcionando. Mismo
   * patron que el processor de generacion de mes desde la Fase 2.
   */
  async process(job: Job<DatosNotificacionReserva>): Promise<void> {
    const { tenantId, perfilId, turnoId, accion } = job.data;

    await runWithTenant(tenantId, async () => {
      const perfil = await this.prisma.db.perfil.findFirst({
        where: { id: perfilId },
        include: { usuario: { select: { nombreCompleto: true, email: true, activo: true } } },
      });
      const turno = await this.prisma.db.turno.findFirst({ where: { id: turnoId } });
      const tenant = await this.prisma.db.tenant.findFirst({ where: { id: tenantId } });

      if (!perfil || !turno) {
        // El turno pudo borrarse entre encolar y procesar. No es un fallo: no
        // hay nada que avisar.
        this.logger.log(`Sin datos para el aviso ${accion} (job ${job.id}); se omite`);
        return;
      }

      await this.mensajero.avisar(
        {
          perfilId,
          email: perfil.usuario.email,
          nombre: perfil.usuario.nombreCompleto,
        },
        accion,
        {
          alumno: perfil.usuario.nombreCompleto,
          gimnasio: tenant?.nombre ?? '',
          clase: turno.nombre,
          // Legible, no ISO: esto lo lee un alumno.
          fecha: fechaLegible(turno.fecha),
          hora: turno.horaInicio,
        },
        '/calendario',
      );
    });
  }
}
```

- [ ] **Step 2: Los tests**

Crear su spec con estos casos:

1. `manda con la plantilla del tipo que trae el job` — se comprueba que `mensajero.avisar` recibe
   `'CONFIRMACION'`.
2. `interpola el nombre del alumno, la clase y la fecha`.
3. **`si el turno ya no existe, no manda nada y no lanza`** — el caso de la carrera entre encolar y
   procesar.
4. `abre el contexto de tenant antes de consultar` — el doble de Prisma lanza si se le llama fuera
   de `runWithTenant`; si no es fácil, basta comprobar que las tres consultas se hicieron.

- [ ] **Step 3: Registrarlo**

En `jobs.module.ts`, añade `BullModule.registerQueue({ name: NOTIFICACION_RESERVA_QUEUE })` y el
processor a `providers`.

- [ ] **Step 4: Correr**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/jobs --silent && pnpm exec tsc --noEmit
```

Esperado: verde y limpio.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): processor de confirmacion y cancelacion de reserva

Abre el contexto de tenant con el tenantId del payload, como el de
generacion de mes: un job no tiene request, y sin contexto la extension
de Prisma falla en vez de devolver datos sin filtrar.

Si el turno ya no existe entre encolar y procesar, se omite el aviso en
vez de reventar: no hay nada que avisar.
```

---

## Task 9: El processor de la lista de espera

**Files:**
- Crear: `src/jobs/notificaciones/notificacion-lista-espera.processor.ts` · `.spec.ts`
- Modificar: `src/jobs/jobs.module.ts`

Igual que el anterior, con dos diferencias:

- Usa el tipo `LISTA_ESPERA`.
- **Marca `ListaEspera.notificado = true`** después de avisar. Ese campo existe desde la Fase 3A con
  el comentario *"Lo escribira el modulo de notificaciones de la Fase 5. Hoy siempre false"*: esta es
  la tarea que lo cumple.

- [ ] **Step 1: El processor**

Mismo esqueleto que la Task 8, y al final del `runWithTenant`:

```ts
      await this.mensajero.avisar(destinatario, 'LISTA_ESPERA', datos, '/calendario');

      // El campo existe desde la Fase 3A esperando a esta linea. Se marca
      // DESPUES de avisar: si se marcara antes y el aviso fallara, la entrada
      // quedaria como notificada sin que nadie recibiera nada.
      await this.prisma.db.listaEspera.updateMany({
        where: { id: entradaId },
        data: { notificado: true },
      });
```

⚠️ `MensajeroService.avisar` **nunca lanza**, así que "después de avisar" no garantiza que el email
saliera: garantiza que se intentó. Es lo correcto — reintentar el job entero por un SMTP caído
mandaría el aviso tres veces a quien sí lo recibió.

- [ ] **Step 2: Los tests**

1. `avisa con el tipo LISTA_ESPERA`.
2. **`marca notificado DESPUES de avisar`** — se comprueba el orden de las llamadas.
3. `si la entrada ya no existe, no lanza`.

- [ ] **Step 3: Registrarlo y correr**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/jobs --silent
```

**Mensaje de commit sugerido para Cesar:**

```
feat(api): processor del cupo liberado, y ListaEspera.notificado se escribe

El campo existe desde la Fase 3A con un comentario que decia "lo
escribira el modulo de notificaciones de la Fase 5". Esta es esa linea.

Se marca DESPUES de avisar: al reves, un aviso fallido dejaria la entrada
como notificada sin que nadie recibiera nada.
```

---
## Task 10: Los dos jobs diarios y el registro de crones

**Files:**
- Crear: `src/jobs/notificaciones/recordatorio-pago.processor.ts` · `.spec.ts`
- Crear: `src/jobs/notificaciones/vencimiento-pack.processor.ts` · `.spec.ts`
- Crear: `src/jobs/notificaciones/registro-de-crones.ts` · `.spec.ts`
- Modificar: `src/jobs/jobs.module.ts`

⚠️ **Un job diario no tiene tenant.** Los otros dos processors lo reciben en el payload porque los
encola alguien que ya está dentro de un gimnasio; estos los dispara un cron y tienen que recorrer
**todos**. El patrón es: listar los tenants activos con `runUnscoped`, y después un `runWithTenant`
por cada uno.

- [ ] **Step 1: El de recordatorio de pago**

Crear `apps/api/src/jobs/notificaciones/recordatorio-pago.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { MensajeroService } from '../../comunicacion/mensajero.service';
import { runUnscoped, runWithTenant } from '../../common/tenant/tenant-context';
import { PagosService } from '../../pagos/pagos.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RECORDATORIO_PAGO_QUEUE, type DatosDiarios } from './colas';

@Processor(RECORDATORIO_PAGO_QUEUE)
export class RecordatorioPagoProcessor extends WorkerHost {
  private readonly logger = new Logger(RecordatorioPagoProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pagos: PagosService,
    private readonly mensajero: MensajeroService,
  ) {
    super();
  }

  async process(job: Job<DatosDiarios>): Promise<{ avisados: number }> {
    const ahora = job.data.ahoraISO ? new Date(job.data.ahoraISO) : new Date();

    // Listar los gimnasios es deliberadamente global: el cron no viene de
    // ninguno. `runUnscoped` lo deja visible en el codigo en vez de esconderlo.
    const tenants = await runUnscoped(() =>
      this.prisma.db.tenant.findMany({ where: { activo: true }, select: { id: true, nombre: true } }),
    );

    let avisados = 0;
    for (const tenant of tenants) {
      avisados += await this.deUnGimnasio(tenant, ahora);
    }

    this.logger.log(`Recordatorio de pago: ${avisados} avisos (job ${job.id})`);
    return { avisados };
  }

  private async deUnGimnasio(
    tenant: { id: string; nombre: string },
    ahora: Date,
  ): Promise<number> {
    return await runWithTenant(tenant.id, async () => {
      // A quien se le avisa: alumnos ACTIVOS y CON PACK. Un alumno dado de baja
      // hace seis meses no debe recibir un recordatorio mensual para siempre, y
      // uno sin pack no debe nada.
      const perfiles = await this.prisma.db.perfil.findMany({
        where: { packId: { not: null }, usuario: { rol: 'ALUMNO', activo: true } },
        include: { usuario: { select: { nombreCompleto: true, email: true } } },
      });
      if (perfiles.length === 0) return 0;

      const alDia = await this.pagos.perfilesAlDia(
        this.prisma.db,
        perfiles.map((p) => p.id),
        ahora,
      );

      let avisados = 0;
      for (const perfil of perfiles) {
        if (alDia.has(perfil.id)) continue;

        await this.mensajero.avisar(
          { perfilId: perfil.id, email: perfil.usuario.email, nombre: perfil.usuario.nombreCompleto },
          'RECORDATORIO_PAGO',
          { alumno: perfil.usuario.nombreCompleto, gimnasio: tenant.nombre, fecha: '', clase: '', hora: '' },
          '/mi-pack',
        );
        avisados += 1;
      }

      return avisados;
    });
  }
}
```

- [ ] **Step 2: Sus tests**

Los tres casos que importan, con un doble de `PagosService`:

1. **`avisa solo a quien NO esta al dia`** — tres perfiles, uno en el `Set` de al día: se avisa a dos.
2. **`no avisa a un alumno sin pack`** — el `where` lleva `packId: { not: null }`.
3. **`no avisa a un alumno dado de baja`** — el `where` lleva `usuario: { activo: true }`.
4. `recorre todos los gimnasios` — dos tenants, y se comprueba que hubo dos `runWithTenant`.

- [ ] **Step 3: El de vencimiento de pack**

Mismo esqueleto. La diferencia es a quién elige:

```ts
      // La ventana: desde hoy hasta hoy + diasAvisoVencimiento. Se avisa una
      // vez al entrar en la ventana, no todos los dias que quedan — pero esta
      // fase no guarda "ya avisado", asi que el job es idempotente por dia y
      // repetiria el aviso cada dia de la ventana. Queda anotado como deuda.
      const hoy = comienzoDeHoyUtc(ahora);
      const limite = new Date(hoy.getTime() + tenant.diasAvisoVencimiento * 24 * 60 * 60 * 1000);

      const perfiles = await this.prisma.db.perfil.findMany({
        where: {
          vigenciaHasta: { gte: hoy, lte: limite },
          usuario: { rol: 'ALUMNO', activo: true },
        },
        include: { usuario: { select: { nombreCompleto: true, email: true } } },
      });
```

⚠️ **Anota la deuda en el tracker**: sin un campo de "ya avisado", un pack que vence en siete días
recibe siete recordatorios. La alternativa —guardar la fecha del último aviso en `Perfil`— es una
columna más que esta fase no necesita para cumplir el checklist, pero un gimnasio real la querrá.
**Ya está hablado con Cesar: lo quiere, pero en una fase posterior.** No lo implementes en esta
tarea; queda como deuda anotada en la spec.

Sus tests: dentro de la ventana avisa; fuera (vence mañana con ventana de 0, o vence dentro de 30
días) no; un perfil sin `vigenciaHasta` no; y la ventana la manda el tenant, no una constante.

- [ ] **Step 4: El registro de crones**

Crear `apps/api/src/jobs/notificaciones/registro-de-crones.ts`:

```ts
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { RECORDATORIO_PAGO_QUEUE, VENCIMIENTO_PACK_QUEUE } from './colas';

/** Todos los dias a las 9:00. */
const PATRON_DIARIO = '0 9 * * *';

/**
 * Registra los jobs repetitivos al arrancar, y SOLO si JOBS_RECURRENTES=1.
 *
 * La bandera no es opcional ni cosmetica:
 *
 * - Sin ella, cada `jest` que levanta la aplicacion —y son muchos— registraria
 *   un cron diario en el Redis compartido.
 * - Con dos instancias de API, las dos lo registrarian. El `jobId` fijo hace
 *   que BullMQ deduplique, pero apagarlo donde no hace falta es mas barato que
 *   confiar en eso.
 *
 * En produccion se enciende en UNA instancia, o en todas: con el jobId fijo da
 * igual, pero encenderlo en una sola deja mas claro quien manda.
 */
@Injectable()
export class RegistroDeCrones implements OnModuleInit {
  private readonly logger = new Logger(RegistroDeCrones.name);

  constructor(
    private readonly config: ConfigService,
    @InjectQueue(RECORDATORIO_PAGO_QUEUE) private readonly recordatorio: Queue,
    @InjectQueue(VENCIMIENTO_PACK_QUEUE) private readonly vencimiento: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get<string>('JOBS_RECURRENTES') !== '1') {
      this.logger.log('JOBS_RECURRENTES no esta en 1: no se registran los jobs diarios.');
      return;
    }

    await this.registrar(this.recordatorio, 'recordatorio-pago-diario');
    await this.registrar(this.vencimiento, 'vencimiento-pack-diario');
    this.logger.log(`Jobs diarios registrados con el patron ${PATRON_DIARIO}`);
  }

  private async registrar(cola: Queue, jobId: string): Promise<void> {
    // El jobId fijo es lo que impide que dos instancias registren dos crones.
    await cola.add('diario', {}, { repeat: { pattern: PATRON_DIARIO }, jobId });
  }
}
```

Su spec: con la bandera apagada **no** se llama a `add` en ninguna de las dos colas; con la bandera en
`'1'` se llama dos veces, y con el mismo `jobId` cada vez.

- [ ] **Step 5: Registrar todo y correr**

En `jobs.module.ts`: las dos colas nuevas, los dos processors y `RegistroDeCrones` en `providers`.

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec jest src/jobs --silent && pnpm exec tsc --noEmit
```

- [ ] **Step 6: Mutación — la bandera del cron**

Quita el `if (this.config.get(...) !== '1') return;` de `onModuleInit`.

Esperado: falla el test de que con la bandera apagada no se registra nada. Si pasa, **cada corrida de
jest dejaría un cron vivo en Redis**, y eso no se nota hasta que la máquina lleva días encendida.

**Deshaz la mutación.**

**Mensaje de commit sugerido para Cesar:**

```
feat(api): los dos jobs diarios, y el registro de crones tras una bandera

Un job diario no tiene tenant: los dispara un cron y recorren todos los
gimnasios, listandolos con runUnscoped y abriendo un contexto por cada
uno.

El recordatorio va solo a quien no esta al dia Y tiene pack Y sigue
activo: un alumno dado de baja hace seis meses no debe recibir un
recordatorio mensual para siempre.

Los recurrentes solo se registran con JOBS_RECURRENTES=1. Sin esa
bandera, cada jest que levanta la aplicacion dejaria un cron diario vivo
en el Redis compartido.
```

---

## Task 11: El push en la PWA

**Files:**
- Crear: `apps/web/src/lib/push.ts` · `.spec.ts`
- Crear: `apps/web/src/componentes/boton-de-push.tsx` · `.spec.tsx`
- Crear: `apps/web/src/app/api/bx/push/route.ts`
- Modificar: `apps/web/src/app/sw.ts`, `apps/web/src/app/[slug]/(alumno)/perfil/page.tsx`
- Modificar: `apps/web/.env.local` y el README

⚠️ **El título de la notificación llega SIN escapar, y eso es correcto.** El `titulo` del push es el
asunto de la plantilla, y `resolverMensaje` no escapa el asunto **a propósito** (escaparlo convertía
`O'Brien & Ana` en `O&#x27;Brien &amp;amp; Ana` en la bandeja de entrada; ver la Task 4). Pero ese
mismo texto lo escribe el admin del gimnasio y lleva datos interpolados, así que en la PWA hay que
tratarlo como **texto y nunca como HTML**: `self.registration.showNotification` lo pone como texto y
no hay problema, pero cualquier sitio donde se pinte ese título en el DOM —un centro de
notificaciones, un toast, un historial— tiene que usar `textContent` o el equivalente de React, jamás
`dangerouslySetInnerHTML`. Lo señaló el implementador de la Task 7 y queda anotado aquí porque es
donde se decide.

- [ ] **Step 1: El handler del service worker**

En `apps/web/src/app/sw.ts`, **antes** de `serwist.addEventListeners()`:

```ts
/**
 * El push. Serwist no lo gestiona: registra sus propios listeners para la
 * cache, y este es nuestro.
 *
 * El cuerpo llega como JSON con lo que puso `web-push`. Si no se puede parsear
 * se muestra igualmente algo: una notificacion sin texto es mejor que una
 * excepcion en el service worker, que ademas no se ve en ningun sitio.
 */
self.addEventListener('push', (evento: PushEvent) => {
  const datos = (() => {
    try {
      return evento.data?.json() as { titulo?: string; cuerpo?: string; url?: string };
    } catch {
      return {};
    }
  })();

  evento.waitUntil(
    self.registration.showNotification(datos.titulo ?? 'BoxAdmin', {
      body: datos.cuerpo ?? '',
      icon: '/icono-192.png',
      data: { url: datos.url ?? '/' },
    }),
  );
});

/** Al tocarla, abrir la aplicacion donde corresponda. */
self.addEventListener('notificationclick', (evento: NotificationEvent) => {
  evento.notification.close();
  const destino = (evento.notification.data as { url?: string } | undefined)?.url ?? '/';

  evento.waitUntil(self.clients.openWindow(destino));
});
```

⚠️ Si `tsc` se queja de `PushEvent` o `NotificationEvent`, es lo mismo que pasó en la Fase 3B con
`ServiceWorkerGlobalScope`: los tipos viven en la `lib` de `webworker`, y la primera línea del
archivo ya trae `/// <reference lib="webworker" />`. Comprueba que sigue ahí antes de buscar otra
cosa.

- [ ] **Step 2: El helper de suscripción**

Crear `apps/web/src/lib/push.ts`:

```ts
/**
 * La clave VAPID publica viaja en base64url y `pushManager.subscribe` la quiere
 * como Uint8Array. Esta conversion es el paso que mas se equivoca al copiarla
 * de un tutorial: base64url no es base64, y `atob` no entiende `-` ni `_`.
 */
export function claveAplicacionDesdeBase64(base64url: string): Uint8Array {
  const relleno = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + relleno).replace(/-/g, '+').replace(/_/g, '/');
  const crudo = atob(base64);

  return Uint8Array.from([...crudo].map((c) => c.charCodeAt(0)));
}

export interface SuscripcionSerializada {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Pasa la suscripcion del navegador a lo que espera la API. */
export function serializar(suscripcion: PushSubscription): SuscripcionSerializada {
  const json = suscripcion.toJSON() as { endpoint?: string; keys?: Record<string, string> };

  return {
    endpoint: json.endpoint ?? suscripcion.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
  };
}
```

Su spec, con Vitest: que la conversión acepta `-` y `_`, que rellena bien el padding, y que
`serializar` saca las dos claves.

- [ ] **Step 3: El botón**

Crear `apps/web/src/componentes/boton-de-push.tsx`, un componente cliente que:

1. Si `!('Notification' in window)` o no hay `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, no se pinta. Un botón
   que no puede funcionar es peor que ningún botón.
2. Pide permiso con `Notification.requestPermission()`.
3. Si lo dan, `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`.
4. Manda la suscripción a `/api/bx/push/suscripcion`.
5. Si la API responde **503**, muestra "el gimnasio no tiene las notificaciones activadas" — no un
   error genérico.

Su spec con Testing Library: que no se pinta sin clave, que un permiso denegado muestra el mensaje
correspondiente, y que el 503 se traduce a texto entendible.

- [ ] **Step 4: Las rutas del BFF**

El proxy genérico `/api/bx/[...ruta]` **ya cubre** `/push/suscripcion`: no hace falta ninguna ruta
nueva. Compruébalo antes de escribir una — el firewall anti-SSRF de la 3B acepta el segmento `push`
sin más.

- [ ] **Step 5: El perfil**

En `apps/web/src/app/[slug]/(alumno)/perfil/page.tsx`, añade `<BotonDePush />` encima de
`<BotonDeSalir />`.

- [ ] **Step 6: La variable**

En `apps/web/.env.local` y en la sección del README:

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
```

⚠️ Esta **sí** lleva el prefijo público, al contrario que `API_URL`: el navegador la necesita para
suscribirse y es pública por diseño. Explicalo en el README junto al aviso de `API_URL`, que dice lo
contrario, para que nadie lo lea como una incoherencia.

- [ ] **Step 7: Correr**

```bash
cd /d/Dev/box-admin/apps/web && pnpm typecheck && pnpm test && pnpm build
```

Esperado: verde, y el build genera el service worker con el handler nuevo.

**Mensaje de commit sugerido para Cesar:**

```
feat(web): notificaciones push en la PWA

El handler push y el de notificationclick van en el service worker junto
a la unica regla de cache que ya tenia. El boton no se pinta si el
navegador no soporta notificaciones o si no hay clave VAPID: un boton que
no puede funcionar es peor que ninguno.

NEXT_PUBLIC_VAPID_PUBLIC_KEY si lleva el prefijo publico, al contrario
que API_URL: el navegador la necesita y es publica por diseno.
```

---

## Task 12: Los e2e

**Files:**
- Crear: `apps/api/test/comunicacion.e2e-spec.ts`

⚠️ **Comprueba que no hay otra API viva antes de correrlos.** Media fase son jobs, y una segunda
instancia se los lleva.

- [ ] **Step 1: Escribirlos**

Los casos, todos contra el adaptador de memoria (`app.get(ENVIOS_DE_EMAIL)`):

1. **`configurar SMTP no devuelve la contrasena`** — el `PUT` responde 200 y el cuerpo no contiene la
   clave; el `GET` tampoco, y trae `tieneClave: true`.
2. **`la contrasena no esta en claro en la base`** — se lee `configuraciones_smtp` con el cliente
   crudo y se comprueba que `claveCifrada` empieza por `v1:` y no contiene la clave.
3. `guardar una plantilla propia la marca como no-por-defecto` y `las cinco vienen siempre`.
4. `un tipo de plantilla inventado es 400`.
5. **`reservar a mano manda un email`** — con el alumno reservando por `/turnos/:id/mi-reserva`, se
   espera a que la cola lo procese y se mira `envios.enviados`.
6. **`publicar un mes NO manda ningun email`** — el punto 7 del checklist. Se publica un mes con
   rutina y se comprueba que la bandeja sigue vacía.
7. `sin VAPID, suscribirse a push es 503`.
8. `configurar SMTP lo hace ADMIN_SALON, no ADMIN_OPERATIVO`.

⚠️ **Los jobs son asíncronos.** Para el caso 5 hace falta sondear, como hace `esperarPublicacion`
desde la Fase 2. Añade a `helpers.ts`:

```ts
/**
 * Espera a que la bandeja del adaptador de memoria tenga al menos `cuantos`.
 *
 * Los avisos se encolan, asi que entre la peticion y el email hay un worker de
 * por medio. Sondear es la unica forma honesta: un `setTimeout` fijo seria
 * lento cuando va bien e intermitente cuando va mal.
 */
export async function esperarEmails(
  envios: { enviados: unknown[] },
  cuantos: number,
  intentos = 60,
): Promise<void> {
  for (let i = 0; i < intentos; i++) {
    if (envios.enviados.length >= cuantos) return;
    await new Promise((r) => setTimeout(r, 100));
  }

  throw new Error(
    `No llegaron ${cuantos} emails tras ${intentos} intentos. ` +
      'Si la bandeja esta vacia, lo mas probable es que el processor no este registrado ' +
      'o que Redis no responda.',
  );
}
```

Y para el caso 6, que comprueba una **ausencia**, no vale sondear: hay que esperar un tiempo fijo
razonable después de que la publicación termine y comprobar que la bandeja sigue vacía. Déjalo
escrito en el test, porque es la clase de cosa que alguien "arregla" convirtiéndola en un sondeo que
no prueba nada.

- [ ] **Step 2: Correr los de la fase y luego todos**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec dotenv -e ../../.env.test -- jest --config ./test/jest-e2e.json test/comunicacion.e2e-spec.ts --runInBand
cd /d/Dev/box-admin/apps/api && pnpm test:e2e
```

Esperado: los de la fase en verde, y los 163 anteriores intactos.

**Mensaje de commit sugerido para Cesar:**

```
test(api): e2e de la comunicacion

La contrasena SMTP no vuelve en la respuesta ni esta en claro en la base.
Reservar a mano manda un email; publicar un mes no manda ninguno, que es
el punto que distingue esta fase de lo que pedia el PDF.
```

---

## Task 13: Verificación final, README y tracker

- [ ] **Step 1: Verificación completa**

```bash
cd /d/Dev/box-admin/packages/shared && pnpm exec jest
cd ../../apps/api && pnpm exec tsc --noEmit && pnpm test && pnpm test:e2e
cd ../web && pnpm typecheck && pnpm test && pnpm test:e2e
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/api/src/comunicacion/**/*.ts" "apps/api/src/push/**/*.ts" "apps/api/src/jobs/notificaciones/**/*.ts" "apps/api/test/comunicacion.e2e-spec.ts" "packages/shared/src/comunicacion.contracts.ts" "apps/web/src/lib/push.ts"
```

⚠️ Playwright necesita la API levantada **con el throttler aflojado** y comparte Redis con los e2e
del backend: no se pueden correr los dos a la vez.

- [ ] **Step 2: El estado de git**

```bash
cd /d/Dev/box-admin && git diff --cached --stat
git status --short | grep -E "node_modules|\.next/|sw\.js" || echo "sin artefactos"
```

- [ ] **Step 3: Recorrer el checklist a mano**

Los ocho puntos del §9 de la spec, con la API levantada. Comprueba en particular las tres cosas que
ningún test automático puede ver:

- Que **la contraseña no aparece en el log de la API** ni al guardar ni al enviar. Búscala con `grep`
  en la salida después de configurar el SMTP y forzar un envío.
- Que con `EMAIL_TIPO=smtp` y un host inventado, `PUT /config/smtp` responde **400 con el motivo** y
  no guarda nada.
- Que con `JOBS_RECURRENTES=1` los dos crones aparecen en Redis, y con `0` no.

- [ ] **Step 4: README**

Añade "Comunicación — Fase 5B" antes de `## Tests` con: los dos puertos y sus variables; que la
contraseña se cifra con versión y nunca vuelve; que las VAPID son opcionales; que los crones están
tras una bandera y por qué; que las reservas de RUTINA no avisan; y la sección de la PWA con
`NEXT_PUBLIC_VAPID_PUBLIC_KEY`.

- [ ] **Step 5: Tracker**

Bloque de la Fase 5B en `PROGRESO.md` con el formato de los anteriores: las 14 tareas, las seis
decisiones, la tabla del checklist a mano, **los errores de este plan que encontraste** y las trampas
nuevas.

Anota además:

- **El aviso de vencimiento se repite cada día de la ventana.** Sin un campo de "ya avisado", un pack
  que vence en siete días manda siete correos. **Ya está hablado con Cesar: lo quiere arreglado, pero
  en una fase posterior**, porque la solución es una columna de estado en `Perfil` y conviene pensarla
  junto al resto de "última vez que avisamos de X". Anotalo como deuda, no lo implementes.
- **`upsert` y la extensión de aislamiento**: si hizo falta sustituirlo, quedó documentado.
- La rotación de la clave de cifrado sigue sin implementarse; existe el formato.
- `VacacionAlumno.devuelveClase` se reetiqueta a la Fase 6.

- [ ] **Step 6: Comprobar el README**

```bash
cd /d/Dev/box-admin && python -c "
import re
d=open('README.md','rb').read()
print('fences:', len(re.findall(rb'(?m)^\`\`\`', d)), 'CRLF:', d.count(b'\r\n'))
"
```

Esperado: par y 0.

**Mensaje de commit sugerido para Cesar:**

```
docs: la comunicacion en el README y el estado en el tracker
```

---

## Verificación del plan contra la spec

| Sección de la spec | Tarea |
|---|---|
| D1 — Puertos con adaptador | T3 |
| D2 — `APP_ENCRYPTION_KEY` obligatoria y con versión | T0 (entorno), T1 (formato) |
| D3 — Las de `RUTINA` no confirman | T7 (el filtro), T12 (el e2e) |
| D4 — VAPID opcionales | T3 (adaptador), T6 (503) |
| D5 — Plantillas por defecto en el código | T4 |
| D6 — `diasAvisoVencimiento` | T0 (modelo), T10 (uso) |
| §4 — Modelo de datos | T0 |
| §5.1 — Nada dentro de una transacción | T7 |
| §5.2 — Lo puro | T1, T4 |
| §5.3 — Los cuatro processors | T8, T9, T10 |
| §6 — Los seis endpoints | T5, T6 |
| §6.1 — La contraseña no vuelve | T5, T12 |
| §6.2 — Verificar antes de guardar | T5 |
| §6.3 — Escapado de Handlebars | T4 |
| §7 — El push en la PWA | T11 |
| §8 — Pruebas y mutación | T1, T4, T10, T12 |
| §9 — Checklist | T12, T13 |

### Las tres mutaciones obligatorias

| Qué se muta | Tarea | Test que debe romperse |
|---|---|---|
| El IV fijo en vez de aleatorio | T1 | `dos cifrados del mismo texto son distintos` |
| `{ noEscape: true }` en Handlebars | T4 | `el HTML del dato sale ESCAPADO` |
| Quitar la comprobación de `JOBS_RECURRENTES` | T10 | `con la bandera apagada no se registra nada` |

Y una cuarta que sale gratis: quitar el `if (evento.origen === 'RUTINA') return;` de la Task 7 tiene
que romper el e2e de publicar un mes.
