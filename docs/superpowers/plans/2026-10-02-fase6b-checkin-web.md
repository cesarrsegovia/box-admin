# Fase 6B — Check-in y web pública: plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` (recomendado) o
> `superpowers:executing-plans` para ejecutar este plan tarea por tarea. Los pasos usan checkbox
> (`- [ ]`) para seguimiento.

**Spec:** `docs/superpowers/specs/2026-10-02-fase6b-checkin-web.md`

**Objetivo:** que el alumno marque presente escaneando un QR, y que el gimnasio tenga una landing
pública editable e indexable.

**Arquitectura:** dos módulos nuevos (`checkin` y `web-salon`) con la separación de siempre —funciones
puras para lo que se puede probar con una tabla de casos, datos aparte, service que orquesta—, más una
pieza compartida que las dos necesitan: **la zona horaria del despliegue**.

**Stack:** NestJS 10, Prisma 7 + PostgreSQL, Next 15 (SSR), `qrcode` (nuevo), Jest + Supertest.

---

## Reglas que gobiernan todo este plan

**Las fechas siguen en UTC; sólo los relojes de pared llevan zona.** Un turno del 5 de octubre es del 5
de octubre en todas partes. La zona se usa en **dos sitios y nada más**: la ventana del check-in y el
patrón del cron. Si aparece un tercero, parar y preguntar.

**`Reserva.asistio` es la única verdad sobre la asistencia.** `Asistencia` es la evidencia de cómo se
marcó. Las dos se escriben en la misma transacción o ninguna.

**El endpoint público se audita por lo que NO manda.** Ni un email, ni un id de perfil, ni el nombre de
una profesora. Y una bandera apagada significa que el dato **no sale del servidor**, no que salga con
un `false` al lado.

**Un slug inexistente y una web apagada dan el mismo 404.** Siempre.

**Todo el texto que escribe el admin se renderiza como texto, nunca como HTML.**

**Los cinco modelos nuevos van en `MODELOS_CON_TENANT`** y con FK compuestas. Sin eso la extensión de
aislamiento los rechaza al primer query, que es lo correcto.

---

## Estructura de archivos

```
packages/shared/src/
  fechas.ts                       TOCAR  instanteEnZona + ventanaDeCheckIn (PURAS)
  fechas.spec.ts                  TOCAR
  checkin.contracts.ts            CREAR
  web-salon.contracts.ts          CREAR
  recurrencia.contracts.ts        TOCAR  fuera devuelveClase
  index.ts                        TOCAR

apps/api/
  prisma/schema.prisma            TOCAR  5 modelos nuevos, y borrar devuelveClase
  prisma/migrations/...           CREAR  una sola migracion
  src/config/validar-entorno.ts   TOCAR  ZONA_HORARIA
  src/common/tenant/tenant-scoped.extension.ts  TOCAR  los 5 modelos

  src/checkin/
    firma-qr.ts + .spec.ts        CREAR  PURA: firmar y verificar
    checkin.service.ts + .spec.ts CREAR
    checkin.controller.ts         CREAR
    config-checkin.service.ts     CREAR
    checkin.module.ts             CREAR
    dto/marcar-presente.dto.ts    CREAR
    dto/guardar-config-qr.dto.ts  CREAR

  src/web-salon/
    web-salon.service.ts + .spec  CREAR  configuracion, ADMIN_SALON
    web-salon.controller.ts       CREAR
    publico.service.ts + .spec    CREAR  el armado de la respuesta publica
    publico.controller.ts         CREAR  GET /public/salon/:slug
    web-salon.module.ts           CREAR
    dto/                          CREAR

  src/vacaciones/                 TOCAR  fuera devuelveClase
  src/app.module.ts               TOCAR

  test/checkin.e2e-spec.ts        CREAR
  test/web-salon.e2e-spec.ts      CREAR

apps/web/src/app/[slug]/
  page.tsx                        CREAR  la landing, SSR
  (alumno)/checkin/page.tsx       CREAR  a donde lleva el QR
```

**Por qué `firma-qr.ts` y la ventana son puras y van aparte:** la firma es lo único que separa un QR
legítimo de uno fabricado, y la ventana es el cálculo que esta fase existe para hacer bien. Las dos se
prueban con una tabla de casos; dentro de un service habría que levantar una aplicación para probar un
borde de quince minutos.

---

## Task 0: La zona horaria

**Files:**
- Modificar: `packages/shared/src/fechas.ts` · `.spec.ts`, `apps/api/src/config/validar-entorno.ts` ·
  `.spec.ts`, `.env.example`, `.env.test.example`, `.env`, `.env.test`

Es la pieza que las dos mitades de la fase necesitan, y la que arregla una deuda abierta desde la 5B.

- [x] **Step 1: Los tests de la función pura**

En `packages/shared/src/fechas.spec.ts`:

```ts
describe('instanteEnZona', () => {
  it('las 18:00 en Buenos Aires son las 21:00 UTC', () => {
    const r = instanteEnZona(new Date('2026-10-05T00:00:00.000Z'), '18:00', 'America/Argentina/Buenos_Aires');

    expect(r.toISOString()).toBe('2026-10-05T21:00:00.000Z');
  });

  it('en UTC la hora es la misma', () => {
    const r = instanteEnZona(new Date('2026-10-05T00:00:00.000Z'), '18:00', 'UTC');

    expect(r.toISOString()).toBe('2026-10-05T18:00:00.000Z');
  });

  /**
   * EL CASO QUE JUSTIFICA NO HACERLO A MANO. Madrid pasa de UTC+2 a UTC+1 el
   * ultimo domingo de octubre. Una resta fija de horas da bien en una fecha y
   * mal en la otra; `Intl` conoce la regla.
   */
  it('respeta el cambio de horario de verano', () => {
    const zona = 'Europe/Madrid';
    const antes = instanteEnZona(new Date('2026-10-20T00:00:00.000Z'), '12:00', zona);
    const despues = instanteEnZona(new Date('2026-11-10T00:00:00.000Z'), '12:00', zona);

    expect(antes.toISOString()).toBe('2026-10-20T10:00:00.000Z');
    expect(despues.toISOString()).toBe('2026-11-10T11:00:00.000Z');
  });

  it('una zona que no existe lanza', () => {
    expect(() => instanteEnZona(new Date('2026-10-05T00:00:00.000Z'), '18:00', 'Marte/Olympus')).toThrow();
  });

  it('una hora invalida lanza, igual que instanteDelTurno', () => {
    expect(() => instanteEnZona(new Date('2026-10-05T00:00:00.000Z'), '25:00', 'UTC')).toThrow();
  });
});
```

- [x] **Step 2: Correr y ver que falla**

```bash
cd /d/Dev/box-admin/packages/shared && pnpm exec jest fechas
```

- [x] **Step 3: La implementación**

En `packages/shared/src/fechas.ts`:

```ts
/**
 * El instante UTC que corresponde a un reloj de pared de una zona.
 *
 * `instanteDelTurno` construye el instante EN UTC, lo que equivale a decir que
 * el gimnasio vive en UTC. Para comparar contra fechas eso da igual —un turno
 * del 5 de octubre es del 5 de octubre en todas partes— y por eso seis fases
 * funcionaron sin esto. Pero el check-in compara una hora del dia contra el
 * reloj, con una ventana de quince minutos: la de una clase de las 18:00 seria
 * [17:45, 18:15] UTC, o sea [14:45, 15:15] en Argentina, y el alumno que llega
 * a su clase quedaria tres horas afuera.
 *
 * NO se resta un desfase fijo: se le pregunta a `Intl`, que conoce los cambios
 * de horario de verano. Una resta de "menos tres horas" acierta en julio y
 * falla en noviembre, y el fallo es invisible hasta que alguien no puede marcar
 * presente un lunes.
 *
 * DONDE SE USA: la ventana del check-in y el patron del cron. En ningun otro
 * sitio. Las fechas del sistema siguen en UTC.
 */
export function instanteEnZona(fecha: Date, hora: string, zona: string): Date {
  if (!esHoraValida(hora)) {
    throw new FechaInvalidaError(`Hora invalida: ${hora}. Se espera HH:MM en 24 h.`);
  }

  const [horas, minutos] = hora.split(':').map(Number);

  // Se parte de la interpretacion ingenua —ese reloj de pared como si fuera
  // UTC— y se corrige con el desfase que la zona tenia EN ESE INSTANTE. Dos
  // pasadas, porque el desfase puede cambiar justo en el salto de horario.
  const ingenuo = Date.UTC(
    fecha.getUTCFullYear(),
    fecha.getUTCMonth(),
    fecha.getUTCDate(),
    horas,
    minutos,
  );

  const primerIntento = ingenuo - desfaseDeZona(new Date(ingenuo), zona);

  return new Date(ingenuo - desfaseDeZona(new Date(primerIntento), zona));
}

/** Milisegundos que `zona` esta por delante de UTC en ese instante. */
function desfaseDeZona(instante: Date, zona: string): number {
  // `en-CA` da `YYYY-MM-DD, HH:MM:SS`, que `Date.parse` entiende tras cambiar
  // la coma por una T. Es la forma estandar de sacarle a Intl un desfase sin
  // depender de una tabla propia de husos.
  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const comoSiFueraUtc = Date.parse(`${formato.format(instante).replace(', ', 'T')}Z`);

  return comoSiFueraUtc - instante.getTime();
}
```

⚠️ **Las dos pasadas no sobran.** Con una sola, un turno a la hora exacta del salto de horario se
calcula con el desfase equivocado. Es un caso por año y por zona, y es el tipo de error que aparece un
domingo de madrugada y nadie reproduce.

⚠️ **`Intl.DateTimeFormat` lanza `RangeError` con una zona inexistente**, que es lo que hace pasar el
test de `'Marte/Olympus'` sin escribir una validación aparte.

- [x] **Step 4: Validar la variable al arrancar**

En `validar-entorno.ts`, sumá `ZONA_HORARIA` a las requeridas y validá que existe:

```ts
  // Una zona mal escrita tiene que matar el proceso aqui, no fallar en el
  // primer check-in de un lunes a la manana. `Intl` lanza RangeError si no la
  // conoce, asi que la prueba es intentar usarla.
  const zona = config.ZONA_HORARIA;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zona as string });
  } catch {
    throw new Error(
      `ZONA_HORARIA no es una zona IANA valida: ${JSON.stringify(zona)}. ` +
        'Se espera algo como America/Argentina/Buenos_Aires o UTC.',
    );
  }
```

Con su test, y `ZONA_HORARIA=America/Argentina/Buenos_Aires` en los cuatro `.env`.

- [x] **Step 5: Correr**

```bash
cd /d/Dev/box-admin/packages/shared && pnpm exec jest && pnpm build
cd ../../apps/api && pnpm exec jest src/config --silent && pnpm exec tsc --noEmit
```

⚠️ **`pnpm build` en shared no es opcional**: `apps/api` resuelve los tipos desde `dist/`, no desde
`src/`. Sin rebuild, lo nuevo no existe para la API y el error no apunta a esto.

- [x] **Step 6: Mutaciones**

| Mutación | Tiene que caer |
|---|---|
| Una sola pasada de corrección del desfase | ninguna de las de arriba — **escribí el caso del salto de horario exacto si no cae ninguna** |
| Sumar el desfase en vez de restarlo | `las 18:00 en Buenos Aires son las 21:00 UTC` |
| Quitar la validación de `ZONA_HORARIA` | el test del entorno |

**Mensaje de commit sugerido para Cesar:**

```
feat: la zona horaria del despliegue

El sistema nunca tuvo husos: instanteDelTurno construye en UTC, que
equivale a decir que el gimnasio vive en UTC. Para comparar fechas da
igual, y por eso seis fases funcionaron asi.

El check-in no: su ventana es de quince minutos, y la de una clase de
las 18:00 seria [14:45, 15:15] hora de Argentina. El alumno que llega a
su clase queda tres horas afuera.

Las fechas siguen en UTC. La zona se usa en dos sitios: la ventana del
check-in y el patron del cron, que arrastraba la misma deuda desde la
Fase 5B.
```

---

## Task 1: El schema y la migración

**Files:**
- Modificar: `apps/api/prisma/schema.prisma`, `apps/api/src/common/tenant/tenant-scoped.extension.ts`
- Crear: una migración

- [ ] **Step 1: Los cinco modelos**

Seguí el patrón del resto del schema: FK compuesta `(tenantId, …)` contra el `@@unique([tenantId, id])`
del modelo destino, y comentario que explique el *porqué* de lo que no es obvio.

```prisma
model ConfigCheckInQR {
  tenantId String @id
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  /// Ventana alrededor del INICIO del turno. Un gimnasio sin fila usa estos
  /// mismos quince minutos: la ausencia de configuracion no puede ser un
  /// check-in roto.
  minutosAntes   Int @default(15)
  minutosDespues Int @default(15)

  updatedAt DateTime @updatedAt

  @@map("config_checkin_qr")
}

enum OrigenAsistencia {
  QR
  MANUAL
}

model Asistencia {
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  /// FK COMPUESTA, no simple: la base impide que una asistencia apunte a una
  /// reserva de otro gimnasio. El PDF proponia `reservaId @unique` global; eso
  /// deja la garantia en el codigo, y el codigo se olvida.
  reservaId String
  reserva   Reserva @relation(fields: [tenantId, reservaId], references: [tenantId, id], onDelete: Cascade)

  /// `Reserva.asistio` es la UNICA verdad sobre si vino. Esta fila es la
  /// evidencia de COMO se marco, y solo existe si paso por el check-in: la
  /// profesora que pasa lista escribe `asistio` sin dejar fila, y esta bien.
  origen      OrigenAsistencia
  ip          String?
  dispositivo String?
  marcadaEn   DateTime @default(now())

  /// Lo que hace que el segundo check-in sea un 409 EN LA BASE y no solo en el
  /// codigo. Entre la comprobacion y la escritura hay una ventana; esto la cierra.
  @@unique([tenantId, reservaId])
  @@index([tenantId])
  @@map("asistencias")
}

model WebSalonConfig {
  tenantId String @id
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  /// Sin fila, la web esta apagada y el endpoint publico da 404.
  activa Boolean @default(false)

  /// NO hay `slug` aqui: el publico es `Tenant.slug`, el mismo que usan todas
  /// las rutas de la PWA. Dos slugs para el mismo gimnasio es pedir que algun
  /// dia no coincidan.
  colorPrimario   String  @default("#000000")
  colorSecundario String  @default("#ffffff")
  tituloPrincipal String?
  tagline         String?
  sobreElSalon    String?

  /// URL EXTERNA, validada como https. No puede salir del almacen: ese firma
  /// con vencimiento, correcto para un comprobante privado y veneno para una
  /// landing indexada, donde el enlace muere y queda un 403 que nadie ve.
  imagenPrincipalUrl String?

  whatsapp  String?
  instagram String?
  linkExtra String?

  mostrarPrecios      Boolean @default(true)
  mostrarTestimonios  Boolean @default(false)
  mostrarFAQ          Boolean @default(false)
  /// Publica la agenda del gimnasio y cuan vacia esta. Apagado por defecto a
  /// proposito: es una decision de negocio, no un detalle de presentacion.
  mostrarTurnosLibres Boolean @default(false)

  planDestacadoId String?
  planDestacado   Pack?   @relation(fields: [tenantId, planDestacadoId], references: [tenantId, id])

  updatedAt DateTime @updatedAt

  @@map("web_salon_config")
}

model Testimonio {
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  nombre String
  texto  String
  orden  Int    @default(0)

  @@unique([tenantId, id])
  @@index([tenantId, orden])
  @@map("testimonios")
}

model PreguntaFrecuente {
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  pregunta  String
  respuesta String
  orden     Int    @default(0)

  @@unique([tenantId, id])
  @@index([tenantId, orden])
  @@map("preguntas_frecuentes")
}
```

Y en `model Pack`, la relación inversa `webSalonConfigs WebSalonConfig[]`; en `Reserva`, `asistencia
Asistencia?`; y en `Tenant`, las cinco inversas.

- [ ] **Step 2: Borrar `devuelveClase`**

Del modelo `VacacionAlumno`. **Decidido con Cesar: las clases perdidas no se devuelven.** Lleva cuatro
fases de mudanza y ya acumula más que `Sala.exclusiva`, que es el error que se cita cada vez.

- [ ] **Step 3: Clasificar los cinco modelos**

En `tenant-scoped.extension.ts`, añadí a `MODELOS_CON_TENANT`: `'ConfigCheckInQR'`, `'Asistencia'`,
`'WebSalonConfig'`, `'Testimonio'`, `'PreguntaFrecuente'`.

⚠️ **Sin esto la extensión los rechaza al primer query.** Es el comportamiento correcto —falla
cerrada— pero el error no dice "te olvidaste de clasificar", así que conviene hacerlo ahora.

- [ ] **Step 4: La migración**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec prisma migrate dev --name fase6b_checkin_y_web && pnpm exec prisma generate
```

⚠️ **`migrate dev` NO regenera el cliente** en Prisma 7 con `prisma.config.ts`: hace falta el
`generate` aparte o la suite no compila, y el error no apunta a la migración.

⚠️ Borrar una columna **es destructivo** y `migrate dev` puede pedir confirmación en una terminal no
interactiva. Si aborta, **pará y preguntá** — no fuerces nada.

⚠️ **Prisma numera las migraciones en UTC.** Si hay que escribirla a mano, el nombre va con hora UTC o
queda ordenada antes de las ya aplicadas.

- [ ] **Step 5: Correr**

```bash
cd /d/Dev/box-admin/apps/api && pnpm exec tsc --noEmit && pnpm exec jest --silent
```

Esperado: `tsc` se queja de `devuelveClase` en el DTO, el service y el contrato. **Eso es la Task 2.**

---

## Task 2: Los contratos, y la salida de `devuelveClase`

**Files:**
- Crear: `packages/shared/src/checkin.contracts.ts`, `web-salon.contracts.ts`
- Modificar: `packages/shared/src/recurrencia.contracts.ts`, `index.ts`,
  `apps/api/src/vacaciones/vacaciones.service.ts` · `.spec.ts`, `dto/crear-vacacion.dto.ts`

- [ ] **Step 1: Sacar `devuelveClase` de los cuatro sitios**

El campo del contrato, el del DTO, el del `create` y el del mapper.

⚠️ **Es un cambio de contrato visible**: el campo desaparece de las respuestas y mandarlo pasa a dar
400 por `forbidNonWhitelisted`. **Los tests que lo afirman se actualizan, no se ablandan** — si alguno
usa `toEqual` sobre el objeto entero, se le quita el campo del objeto esperado y punto.

- [ ] **Step 2: Los contratos nuevos**

`checkin.contracts.ts`:

```ts
export interface ConfigCheckIn {
  minutosAntes: number;
  minutosDespues: number;
}

export interface PresenteMarcado {
  reservaId: string;
  turnoId: string;
  /** `YYYY-MM-DD`. */
  fecha: string;
  horaInicio: string;
  clase: string;
  marcadaEn: string;
}
```

`web-salon.contracts.ts`:

```ts
export interface TestimonioPublico {
  nombre: string;
  texto: string;
}

export interface PreguntaPublica {
  pregunta: string;
  respuesta: string;
}

export interface PackPublico {
  nombre: string;
  /** String con dos decimales, o `null` si el pack no tiene precio cargado. */
  precio: string | null;
  destacado: boolean;
}

export interface TurnoLibrePublico {
  /** `YYYY-MM-DD`. */
  fecha: string;
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
 * Los cuatro campos opcionales de abajo van `undefined` —y por tanto NO viajan
 * en el JSON— cuando su bandera esta apagada. No viajan con un `false` al lado:
 * si el servidor los manda y el cliente los esconde, los precios ya estan en el
 * HTML, en la cache del navegador y en el primer "ver codigo fuente".
 */
export interface SalonPublico {
  nombre: string;
  colorPrimario: string;
  colorSecundario: string;
  tituloPrincipal: string | null;
  tagline: string | null;
  sobreElSalon: string | null;
  imagenPrincipalUrl: string | null;
  whatsapp: string | null;
  instagram: string | null;
  linkExtra: string | null;

  packs?: PackPublico[];
  testimonios?: TestimonioPublico[];
  preguntas?: PreguntaPublica[];
  turnosLibres?: TurnoLibrePublico[];
}
```

Y los dos reexports en `index.ts`.

- [ ] **Step 3: Correr**

```bash
cd /d/Dev/box-admin/packages/shared && pnpm exec jest && pnpm exec tsc -p tsconfig.json --noEmit && pnpm build
cd ../../apps/api && pnpm exec tsc --noEmit && pnpm exec jest --silent && pnpm test:e2e
```

- [ ] **Step 4: Mutación**

Devolver `devuelveClase` al DTO → tiene que caer el test de que mandarlo da 400.

---

## Task 3: La firma del QR

**Files:**
- Crear: `apps/api/src/checkin/firma-qr.ts` · `.spec.ts`

- [ ] **Step 1: Los tests**

```ts
describe('firmarTenant / verificarFirma', () => {
  const CLAVE = 'a'.repeat(64);

  it('lo que se firma se verifica', () => {
    const firma = firmarTenant('gym-1', CLAVE);

    expect(verificarFirma('gym-1', firma, CLAVE)).toBe(true);
  });

  it('la firma de un gimnasio NO sirve para otro', () => {
    const firma = firmarTenant('gym-1', CLAVE);

    expect(verificarFirma('gym-2', firma, CLAVE)).toBe(false);
  });

  it('una firma inventada no pasa', () => {
    expect(verificarFirma('gym-1', 'cualquiercosa', CLAVE)).toBe(false);
  });

  it('con otra clave de aplicacion no pasa', () => {
    const firma = firmarTenant('gym-1', CLAVE);

    expect(verificarFirma('gym-1', firma, 'b'.repeat(64))).toBe(false);
  });

  it('la firma es estable: el mismo gimnasio da siempre la misma', () => {
    // El QR se imprime y se pega en la pared. Si la firma cambiara entre
    // reinicios, el cartel impreso dejaria de servir.
    expect(firmarTenant('gym-1', CLAVE)).toBe(firmarTenant('gym-1', CLAVE));
  });

  it('una firma vacia o de otro largo no pasa', () => {
    expect(verificarFirma('gym-1', '', CLAVE)).toBe(false);
    expect(verificarFirma('gym-1', 'abc', CLAVE)).toBe(false);
  });
});
```

- [ ] **Step 2: La implementación**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Separador de dominio: la misma APP_ENCRYPTION_KEY cifra las credenciales
 * SMTP desde la Fase 5B. Sin este prefijo, las dos usarian la clave para cosas
 * distintas sin decirlo, que es como se construye un problema que nadie ve.
 */
const PROPOSITO = 'checkin-qr:v1:';

/** HMAC del tenant, en base64url y sin relleno: va en una URL. */
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
 */
export function verificarFirma(tenantId: string, firma: string, claveDeApp: string): boolean {
  const esperada = Buffer.from(firmarTenant(tenantId, claveDeApp));
  const recibida = Buffer.from(firma);

  // `timingSafeEqual` LANZA si los largos difieren, asi que hay que mirarlo
  // antes. Comparar el largo no filtra nada util: es publico y fijo.
  if (esperada.length !== recibida.length) return false;

  return timingSafeEqual(esperada, recibida);
}
```

- [ ] **Step 3: Mutaciones**

| Mutación | Tiene que caer |
|---|---|
| Quitar el `PROPOSITO` | ninguna de las de arriba — **escribí el caso si no cae ninguna**: la firma sin separador tiene que ser distinta de la que lo lleva |
| `===` en vez de `timingSafeEqual` | ninguna — **es un cambio invisible para los tests.** Anotalo en el informe: lo sostiene el comentario, no una prueba |
| Quitar la comprobación de largos | el caso de `'abc'`, que pasaría a lanzar en vez de devolver `false` |
| Firmar sin el `tenantId` | `la firma de un gimnasio NO sirve para otro` |

---

## Task 4: El check-in

**Files:**
- Crear: `apps/api/src/checkin/` entero (service, controller, config-service, module, dto) + specs
- Modificar: `apps/api/src/app.module.ts`

- [ ] **Step 1: La elección de la reserva, pura y aparte**

Lo que decide **cuál** reserva se marca es la parte con bordes, así que va en una función pura que
recibe las candidatas ya cargadas y el instante actual:

```ts
export interface CandidataDeCheckIn {
  reservaId: string;
  turnoId: string;
  fecha: Date;
  horaInicio: string;
  clase: string;
  yaMarcada: boolean;
}

export type ResultadoDeEleccion =
  | { tipo: 'elegida'; candidata: CandidataDeCheckIn }
  | { tipo: 'ya-marcada'; candidata: CandidataDeCheckIn }
  | { tipo: 'fuera-de-ventana'; masCercana: CandidataDeCheckIn }
  | { tipo: 'sin-reserva' };

/**
 * Cual de las reservas del alumno es la que esta marcando.
 *
 * PURA: recibe el instante y la zona, no los lee. Es lo que permite probar el
 * borde de los quince minutos con una tabla de casos en vez de con un reloj.
 *
 * Los tres rechazos son DISTINGUIBLES a proposito: son datos del propio alumno,
 * asi que decirle cual de los tres no filtra nada y le ahorra una llamada a
 * recepcion. "No se pudo marcar" lo manda a preguntar; "llegaste 40 minutos
 * tarde" no.
 */
export function elegirReserva(
  candidatas: CandidataDeCheckIn[],
  ahora: Date,
  config: { minutosAntes: number; minutosDespues: number },
  zona: string,
): ResultadoDeEleccion
```

El algoritmo, para que no se invente:

1. Para cada candidata, calcular `inicio = instanteEnZona(fecha, horaInicio, zona)` y la ventana
   `[inicio - minutosAntes, inicio + minutosDespues]`, **inclusiva en los dos extremos**.
2. Quedarse con las que contengan `ahora`.
3. Si no queda ninguna: si había candidatas, `fuera-de-ventana` con la de `inicio` más cercano a
   `ahora` (en valor absoluto); si no había ninguna, `sin-reserva`.
4. Si queda más de una, la de `inicio` más cercano a `ahora`.
5. Si la elegida tiene `yaMarcada`, `ya-marcada`; si no, `elegida`.

⚠️ **`yaMarcada` se mira DESPUÉS de elegir, no antes.** Al revés, un alumno con dos clases seguidas que
ya marcó la primera recibiría "sin reserva" en vez de que se le marque la segunda.

⚠️ **`clase` sale de `Turno.nombre`.** La columna se llama `nombre`; "clase" es como se le dice de cara
al alumno, igual que en las plantillas de la Fase 5B (`{{clase}}`). No busques `turno.clase`.

- [ ] **Step 2: Los tests de la elección**

```ts
  it('la clase de las 18:00 en Buenos Aires se marca a las 18:00 de ahi', () => {
    // El caso que esta fase existe para arreglar. 18:00 en Argentina son las
    // 21:00 UTC; con la ventana calculada en UTC, esto quedaria tres horas
    // fuera y el check-in no serviria para nada.
  });

  it('entra justo al abrirse la ventana', () => {
    // inicio menos minutosAntes, exacto.
  });

  it('entra justo al cerrarse', () => {
    // inicio mas minutosDespues, exacto.
  });

  it('un minuto antes de abrirse, no', () => {
    // inicio - minutosAntes - 1 minuto: fuera-de-ventana, con esa misma
    // candidata como la mas cercana.
  });

  it('un minuto despues de cerrarse, no, y dice cual era la mas cercana', () => {
    // inicio + minutosDespues + 1 minuto. El motivo tiene que traer la
    // candidata para que la pantalla pueda decir "tu clase era a las 18:00".
  });

  it('con dos turnos en ventana elige el mas cercano al instante actual', () => {
    // Dos clases pegadas, 18:00 y 19:00, ventana de 45 minutos para que las
    // dos esten abiertas a las 18:40. Elige la de las 19:00, que esta a 20
    // minutos, y no la de las 18:00, que esta a 40.
  });

  it('una reserva ya marcada se distingue de una fuera de ventana', () => {
    // Una sola candidata, dentro de ventana, con yaMarcada en true.
    // tipo === 'ya-marcada', nunca 'sin-reserva' ni 'fuera-de-ventana'.
  });

  it('sin ninguna reserva en el dia, "sin-reserva"', () => {
    // Lista vacia. Es el unico caso que NO lleva candidata en el resultado.
  });

  it('con la ventana en cero solo entra el instante exacto del inicio', () => {
    // minutosAntes y minutosDespues en 0. Es configuracion valida y el borde
    // degenerado tiene que comportarse, no reventar.
  });
```

- [ ] **Step 3: El service**

`POST /checkin`, rol `ALUMNO`, en este orden:

1. **Verifica la firma** contra `actor.tenantId`. Si no coincide: **404, no 403** — un 403 confirmaría
   que ese gimnasio existe. Dejá el porqué escrito.
2. Carga la configuración (o los quince minutos por defecto si no hay fila) y las reservas vivas del
   alumno **del día**, con su `Asistencia` si la tienen.
3. Llama a `elegirReserva`.
4. Según el resultado: `409` con el motivo, o seguir.
5. En **una transacción**: `asistio = true` y `create` de `Asistencia` con origen `QR`, IP y
   dispositivo.

⚠️ **La IP y el `User-Agent` son datos del request, no del dominio.** Llegan como argumentos desde el
controlador; el service no conoce `Request`. Es lo que permite probarlo sin montar HTTP.

⚠️ **El `@@unique` es la red del paso 4.** Entre comprobar y escribir hay una ventana: dos escaneos
simultáneos pasan los dos la comprobación y uno choca contra el índice. Capturá el `P2002` y
devolvé el mismo 409 que el camino normal — el usuario no tiene por qué ver la diferencia.

- [ ] **Step 4: `GET` y `PUT /config/checkin-qr` y la imagen**

`ADMIN_SALON`. `GET /config/checkin-qr/imagen` devuelve un PNG con `qrcode`, codificando
`<WEB_ORIGIN>/<slug>/checkin?f=<firma>`.

```bash
cd /d/Dev/box-admin/apps/api && pnpm add qrcode && pnpm add -D @types/qrcode
```

- [ ] **Step 5: Mutaciones**

| Mutación | Tiene que caer |
|---|---|
| Calcular la ventana en UTC (`instanteDelTurno` en vez de `instanteEnZona`) | `la clase de las 18:00 en Buenos Aires…` — **la más importante del plan** |
| `>` en vez de `>=` en el borde de apertura | `entra justo al abrirse la ventana` |
| Elegir la primera candidata en vez de la más cercana | `con dos turnos en ventana elige el mas cercano` |
| No verificar la firma | el caso del QR de otro gimnasio |
| Devolver 403 en vez de 404 con firma ajena | el caso que fija el 404 |
| Permitir el segundo check-in | el caso de `ya-marcada` |
| Escribir `asistio` fuera de la transacción | el caso de que un fallo al crear la `Asistencia` deja `asistio` sin tocar |

---

## Task 5: La configuración de la web

**Files:**
- Crear: `apps/api/src/web-salon/web-salon.service.ts` · `.spec.ts`, `web-salon.controller.ts`,
  `web-salon.module.ts`, los DTO
- Modificar: `apps/api/src/app.module.ts`

- [ ] **Step 1: Los endpoints**

`PUT /config/web-salon`, `POST` y `DELETE /config/web-salon/testimonios/:id`, ídem `faq`. Todos
`ADMIN_SALON`.

⚠️ **`upsert` está bloqueado por la extensión de aislamiento** (`UnsafeUniqueOperationError`). Para la
fila única por gimnasio va `findFirst` + `create`/`update` dentro de una transacción, como ya hace
`config-email.service.ts` de la Fase 5B. Y el `data` del `update` **no lleva `tenantId`**, o salta
`ReasignacionDeTenantError`.

⚠️ **`imagenPrincipalUrl` se valida como `https`.** Un `javascript:` o un `http:` en una página
pública son un problema; `@IsUrl({ protocols: ['https'], require_protocol: true })`.

- [ ] **Step 2: Los tests**

```ts
  it('una URL de imagen que no es https es 400', async () => {
    // `http://...` y `javascript:alert(1)`. Los dos 400, no uno guardado y
    // otro rechazado.
  });

  it('guardar dos veces actualiza, no duplica', async () => {
    // Dos PUT seguidos con titulos distintos: una sola fila, el segundo titulo.
    // Es el camino findFirst + create/update, porque upsert esta bloqueado.
  });

  it('un testimonio de otro gimnasio no se puede borrar', async () => {
    // El deleteMany lleva el tenantId inyectado; el de otro gimnasio no
    // aparece y el borrado no afecta a nadie. Se comprueba que la fila ajena
    // SIGUE existiendo, no solo que la respuesta fue 404.
  });

  it('ADMIN_OPERATIVO no puede tocar la configuracion de la web', async () => {
    // 403 en el PUT y en el alta de testimonio. Y un caso que comprueba que
    // ADMIN_SALON si puede: sin el, el 403 podria ser porque el rol no sirve.
  });
```

---

## Task 6: El endpoint público

**Files:**
- Crear: `apps/api/src/web-salon/publico.service.ts` · `.spec.ts`, `publico.controller.ts`

Es el único endpoint sin sesión que lee datos de un gimnasio. Es el que más cuidado pide del plan.

- [ ] **Step 1: Los tests, que son el diseño**

```ts
  it('un slug que no existe da 404', async () => {
    // Se guarda el cuerpo entero para compararlo con el del caso siguiente.
  });

  it('una web APAGADA da exactamente el mismo 404', async () => {
    // Mismo codigo y mismo cuerpo que el anterior. Distinguirlos convierte el
    // endpoint en un directorio de gimnasios: cualquiera prueba nombres.
    // Se comparan las dos respuestas enteras.
  });

  it('con mostrarPrecios apagado, el cuerpo NO CONTIENE el precio', async () => {
    // No es que venga con una bandera en false: es que la clave `packs` no
    // existe en el JSON. Se afirma sobre el cuerpo serializado.
    expect(JSON.stringify(cuerpo)).not.toContain('8500');
  });

  it('solo salen los packs activos', async () => {
    // Dos packs, uno activo: 8500 y 9900 inactivo. El cuerpo serializado
    // contiene 8500 y NO contiene 9900.
  });

  it('el cuerpo no lleva ni un email, ni un id de perfil', async () => {
    // La comprobacion de ausencia: un endpoint publico se audita por lo que NO
    // manda. Se siembra un alumno con email conocido y se busca en el cuerpo.
  });

  it('las consultas de contenido corren CON contexto de gimnasio', async () => {
    // El runUnscoped envuelve solo la resolucion del slug. Se comprueba con un
    // doble que registra en que contexto llego cada consulta: la del tenant en
    // 'unscoped', y las de packs y testimonios en 'tenant'.
  });

  it('los testimonios salen en el orden que puso el admin', async () => {
    // Tres con orden 2, 0, 1 creados en ese mismo orden: salen 0, 1, 2. Sin el
    // orderBy saldrian por createdAt y el test pasaria con dos de los tres.
  });
```

- [ ] **Step 2: La implementación**

```ts
    // `runUnscoped` envuelve UNA sola consulta: la que resuelve el slug. Todo
    // lo demas va dentro de `runWithTenant`. Es el patron que auth.service.ts
    // usa para el login, y la regla es que esta ventana sea de una linea y se
    // vea. Ensancharla es desactivar el aislamiento para todo el endpoint
    // publico, que es el peor sitio donde se puede desactivar.
    const tenant = await runUnscoped(() =>
      this.prisma.base.tenant.findUnique({ where: { slug }, select: { id: true, nombre: true, activo: true } }),
    );
```

Y después: 404 si no hay tenant, si no está activo, o si su `WebSalonConfig` no existe o tiene
`activa: false`. **Los cuatro casos, el mismo 404.**

- [ ] **Step 3: Mutaciones**

| Mutación | Tiene que caer |
|---|---|
| 403 con la web apagada | `una web APAGADA da exactamente el mismo 404` |
| Mandar `packs` con una bandera en vez de omitirlos | `el cuerpo NO CONTIENE el precio` |
| Incluir packs inactivos | el caso correspondiente |
| Ensanchar el `runUnscoped` a todo el método | `las consultas de contenido corren CON contexto` |
| Devolver el email del contacto en el cuerpo | `el cuerpo no lleva ni un email` |

---

## Task 7: La landing

**Files:**
- Crear: `apps/web/src/app/[slug]/page.tsx` · `.spec.tsx`

El índice de `[slug]` está libre; la landing va ahí. Es **SSR** porque es la única superficie del
sistema donde el SEO importa.

- [ ] **Step 1: La página**

Secciones, en orden, cada una sólo si su dato vino: portada (imagen, título, tagline), sobre el salón,
planes con el destacado marcado, turnos libres, testimonios, preguntas frecuentes, y el pie con las
redes.

⚠️ **Todo el texto del admin se renderiza como texto.** Nada de `dangerouslySetInnerHTML`, en ningún
sitio y por ninguna razón. Es la primera vez en el proyecto que contenido escrito por un usuario se
muestra en una página pública, y el daño sería XSS almacenado en el sitio del gimnasio.

⚠️ **Los colores van por variables CSS**, no interpolados en un `style` con el string crudo del admin.

- [ ] **Step 2: Los tests**

Que una sección cuyo dato no vino **no se renderiza** (no "se renderiza vacía"), que un título con
`<script>` sale como texto visible y no como etiqueta, y que un slug que da 404 en la API muestra el
not-found de Next.

---

## Task 8: La pantalla de check-in

**Files:**
- Crear: `apps/web/src/app/[slug]/(alumno)/checkin/page.tsx` · `.spec.tsx`

A donde lleva el QR. Lee la firma del query, llama a `POST /checkin`, y muestra el resultado.

Los cuatro estados, con su mensaje: marcado, ya estaba marcado, fuera de ventana (diciendo cuál era la
clase y a qué hora), y sin reserva. Y el caso de no estar logueado: el QR lo escanea cualquiera, así
que la página tiene que llevar al login y volver.

---

## Task 9: Los e2e

**Files:**
- Crear: `apps/api/test/checkin.e2e-spec.ts`, `apps/api/test/web-salon.e2e-spec.ts`

⚠️ **Comprobá que no hay procesos node huérfanos antes de correr.** Un jest superviviente de una
corrida cortada mantiene la app viva y vuelve los e2e intermitentes; pasó en la 5B y parecía un bug
del código.

Los casos que el checklist exige:

- El check-in acepta a la hora de la clase **en la zona del gimnasio**.
- Rechaza fuera de ventana, sin reserva, y el segundo intento.
- `asistio` y la fila de `Asistencia` se escriben juntas: se comprueban **las dos** en la base.
- El QR de un gimnasio no sirve en otro.
- La web pública se ve **sin token**, respeta las banderas omitiendo, y sólo expone packs activos.
- Un slug inexistente y una web apagada son indistinguibles.

---

## Task 10: Verificación final, README y tracker

- [ ] **Step 1: Todo verde**

```bash
cd /d/Dev/box-admin/packages/shared && pnpm exec jest && pnpm exec tsc -p tsconfig.json --noEmit
cd ../../apps/api && pnpm exec tsc --noEmit && pnpm exec jest --silent
cd ../web && pnpm exec tsc --noEmit && pnpm test && pnpm build
cd /d/Dev/box-admin && pnpm api:test:e2e
```

⚠️ **No corras `pnpm lint`**: lleva `--fix` y reformatea código commiteado de otras fases.

- [ ] **Step 2: El checklist a mano**

Lo que ningún test automático ve:

- Escanear el QR con un teléfono de verdad y que abra la pantalla correcta.
- Que la landing se vea sin sesión en una ventana de incógnito, y que el "ver código fuente" **no
  contenga** los precios con la bandera apagada.
- Que la hora del cron de los jobs diarios, ahora con `tz`, dispare cuando corresponde.

- [ ] **Step 3: README y tracker**

Sección "Check-in y web pública — Fase 6B" antes de `## Tests`, y el bloque de la 6B en `PROGRESO.md`
con el formato de los anteriores: tareas, decisiones, **los errores de este plan que encontraste**,
trampas nuevas y deuda.

Anotá además:

- **Una zona por gimnasio** sigue pendiente: esta fase resuelve el despliegue entero con una sola.
- **El QR rotativo**, para cuando la asistencia tenga que probar presencia y no sólo registrarla.
- **El panel de admin**, que sigue sin existir.
- Que **`devuelveClase` se borró** y por qué, para que no vuelva.
