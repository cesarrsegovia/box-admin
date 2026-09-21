# Fase 3B — La PWA del alumno — Plan de implementación

> **Para agentes ejecutores:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos
> usan sintaxis de checkbox (`- [ ]`) para seguimiento.

**Goal:** Que un alumno, desde el navegador y sin tocar `curl`, se auto-registre con una clave de
invitación, vea su calendario, reserve y cancele clases, se anote en lista de espera y suba un
comprobante — y que pueda instalar la aplicación en su teléfono y seguir viendo su calendario sin
conexión.

**Architecture:** Next.js 15 (App Router) en `apps/web`, consumiendo `@boxadmin/shared` — los mismos
contratos y las mismas funciones puras que usa la API. Los tokens viven en **cookies `httpOnly`** que
el JavaScript de la página nunca ve: un puñado de Route Handlers de Next hacen de intermediario, con
un **proxy genérico** `/api/bx/[...ruta]` que reenvía a la API de Nest. El service worker lo genera
**Serwist**, no `next-pwa` (que lleva muerta desde 2022).

**Tech Stack:** Next 15.5.x, React 19, TypeScript strict, Tailwind CSS 4, TanStack Query v5,
react-hook-form + zod, `@serwist/next`, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-18-fase3b-pwa-alumno.md`

---

## Reglas de esta casa (leer antes de la Task 1)

No son preferencias: son restricciones del proyecto que ya causaron problemas reales.

1. **NUNCA hagas commit.** Ni `git add`, ni `git commit`, ni `git push`, ni `git stash`, ni
   `git checkout`, ni `git reset`. Los commits los hace Cesar y solo Cesar. Cada tarea termina con un
   **mensaje de commit sugerido**. `git status` y `git diff` sí puedes usarlos.
2. **NUNCA ejecutes `pnpm lint`** en `apps/api` ni en `packages/shared`: ese script lleva `--fix` y
   reformatearía código ya commiteado. Para comprobar formato usa
   `pnpm exec prettier --check "<ruta>"`.
3. **NUNCA uses `taskkill` ni `Stop-Process` por NOMBRE de proceso.** Hay una sesión de Claude Code
   viva en esta máquina. Mata siempre por PID concreto.
4. **`prisma migrate reset` y `docker compose down -v` requieren permiso explícito de Cesar.**
5. **No edites archivos del repo con scripts de Python en modo texto.** Convierten el archivo entero
   de LF a CRLF; `core.autocrlf=true` lo oculta en `git diff` pero Prettier lo ve. Usa las
   herramientas de edición.
6. **13 archivos de las Fases 0–2 no pasan `prettier --check`** y ya venían así de sus commits. No
   los toques: comprueba el formato solo de lo que escribas tú.

---

## Trampas conocidas del entorno

| Trampa | Qué pasa | Qué hacer |
|---|---|---|
| `docker compose up` a secas | Levanta también el contenedor `api`, que comparte Redis con los tests y les roba los jobs | `docker compose up -d postgres postgres-test redis` |
| Puerto 3000 libre ≠ API muerta | `nest start --watch` deja un hijo `dist/main`; **su worker de BullMQ sigue robando jobs sin escuchar en ningún puerto**. Síntoma: "Sala inexistente" | Listar procesos node del repo y matarlos **por PID** (comando en el README) |
| Docker Desktop | Se cerró solo seis veces entre las Fases 2 y 3A | Ante 500 o `P1001` masivos, `docker info` antes de buscar el bug |
| `next-pwa` | Última publicación en agosto de 2022, anterior al App Router | Usar `@serwist/next` |
| Service worker en desarrollo | Cachea versiones viejas y vuelve loco el ciclo de trabajo | Queda desactivado si `NODE_ENV === 'development'`; Playwright corre contra el **build de producción** |
| **Instalar paquetes en `apps/web` borra el cliente de Prisma** | pnpm reescribe `node_modules` y se lleva `.prisma/client`. La API deja de compilar con **decenas de `Parameter 'tx' implicitly has an 'any' type`**, que no mencionan Prisma por ningún lado | `cd apps/api && pnpm exec dotenv -e ../../.env -- prisma generate` |

---

## Estructura de archivos

### Backend (`apps/api`) — dos añadidos

| Archivo | Responsabilidad |
|---|---|
| `src/mi-calendario/mi-pack.service.ts` | **Crear.** Calcula el consumo del pack reutilizando `topeDelPack` y `ventanaDeConteo` |
| `src/mi-calendario/mi-calendario.controller.ts` | **Modificar.** Añadir `GET /mi-pack` |
| `src/mi-calendario/mi-calendario.module.ts` | **Modificar.** Registrar el servicio nuevo |
| `src/main.ts` | **Modificar.** CORS acotado a las rutas del almacén local |
| `src/config/validar-entorno.ts` | **Modificar.** `WEB_ORIGIN` para el CORS |

### Paquete compartido (`packages/shared`) — un añadido

| Archivo | Responsabilidad |
|---|---|
| `src/selfservice.contracts.ts` | **Modificar.** Añadir `MiPackPublico` |

### Frontend (`apps/web`) — nuevo

| Archivo | Responsabilidad |
|---|---|
| `src/lib/api-url.ts` | Compone y **valida** rutas hacia la API. El cortafuegos anti-SSRF |
| `src/lib/cookies.ts` | Nombres y opciones de las tres cookies, en un solo sitio |
| `src/lib/sesion.ts` | Lee la sesión del servidor: tokens y slug desde las cookies |
| `src/app/api/bx/[...ruta]/route.ts` | Proxy genérico hacia la API, con refresh ante 401 |
| `src/app/api/auth/login/route.ts` | Login: llama a la API y siembra las cookies |
| `src/app/api/auth/auto-registro/route.ts` | Alta con clave de invitación |
| `src/app/api/auth/logout/route.ts` | Revoca en la API y borra las cookies |
| `src/lib/cliente.ts` | `pedir()`: el fetch del navegador contra `/api/bx`, tipado |
| `src/lib/query.tsx` | Provider de TanStack Query |
| `src/hooks/*.ts` | Un hook por recurso: calendario, disponibles, pack, comprobantes |
| `src/componentes/*.tsx` | Botón, tarjeta, aviso, campo. Cortos y sin dependencias |
| `src/app/[slug]/(publico)/login/page.tsx` | Entrar |
| `src/app/[slug]/(publico)/registro/page.tsx` | Auto-registro |
| `src/app/[slug]/(alumno)/layout.tsx` | Exige sesión y slug coincidente |
| `src/app/[slug]/(alumno)/calendario/page.tsx` | La pantalla principal |
| `src/app/[slug]/(alumno)/mi-pack/page.tsx` | Consumo y vigencia |
| `src/app/[slug]/(alumno)/comprobantes/page.tsx` | Subida en tres pasos |
| `src/app/[slug]/(alumno)/perfil/page.tsx` | Datos y cerrar sesión |
| `src/app/sw.ts` | El service worker de Serwist |
| `public/manifest.json` + iconos | Lo que hace la aplicación instalable |
| `e2e/*.spec.ts` | Playwright: instalabilidad, offline, ciclo completo |

Un archivo por responsabilidad. `lib/` no contiene nada de React; `hooks/` no contiene nada de
presentación; `componentes/` no sabe de la API. Esa separación es lo que permite testear la lógica
con Vitest sin montar medio Next.

---

## Task 0: Spike — ¿Serwist genera un service worker de verdad?

**Nada de esta tarea se queda en el repo.** Despeja la única incógnita que puede tumbar la fase
entera, y la despeja **antes** de escribir seis pantallas encima.

En la Fase 3A el spike equivalente ahorró rehacer dos tareas. Aquí la pregunta es más grave: si
Serwist no funcionara con Next 15, habría que replantear la decisión D1 del spec, y el momento de
descubrirlo es ahora y no en la Task 14.

**Files:**
- Crear (temporal): `/tmp/spike-pwa/` — se borra al final de la tarea

- [ ] **Step 1: Montar un Next 15 desechable fuera del repo**

**Fuera del repo a propósito**, para que un `create-next-app` a medias no ensucie `git status`.

```bash
mkdir -p /tmp/spike-pwa && cd /tmp/spike-pwa
pnpm dlx create-next-app@15 web --typescript --tailwind --app --src-dir \
  --import-alias "@/*" --no-eslint --use-pnpm --turbopack=false
cd web && node -e "console.log('next:', require('next/package.json').version)"
```

Esperado: una versión `15.x`. **Anótala**: es la que se fija en la Task 3.

- [ ] **Step 2: Instalar Serwist**

```bash
cd /tmp/spike-pwa/web
pnpm add @serwist/next && pnpm add -D serwist
node -e "console.log(require('@serwist/next/package.json').version)"
```

Esperado: `9.x`.

- [ ] **Step 3: Configurar el plugin**

Crear `/tmp/spike-pwa/web/next.config.mjs`:

```js
import withSerwistInit from '@serwist/next';

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  // En desarrollo el service worker cachea versiones viejas y vuelve loco el
  // ciclo de trabajo. El PDF de la fase ya lo pedia desactivado.
  disable: process.env.NODE_ENV === 'development',
});

export default withSerwist({});
```

Crear `/tmp/spike-pwa/web/src/app/sw.ts`.

⚠️ **La primera línea no es decorativa y está verificada.** Sin
`/// <reference lib="webworker" />`, el bundle del service worker se genera bien pero el chequeo de
tipos del build **falla** con `Cannot find name 'ServiceWorkerGlobalScope'`: el `lib` del tsconfig
que genera `create-next-app` no incluye `WebWorker`. Se resuelve aquí, en el propio archivo, en vez
de añadir `WebWorker` al `lib` global — eso haría que `self` pareciera un worker en toda la
aplicación.

```ts
/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
```

- [ ] **Step 4: Construir y comprobar que el service worker existe**

```bash
cd /tmp/spike-pwa/web && pnpm build 2>&1 | tail -20
ls -la public/sw.js && wc -c public/sw.js
grep -c "precacheEntries\|__SW_MANIFEST\|workbox" public/sw.js
```

Esperado: `public/sw.js` existe, pesa **decenas de kilobytes** (no cientos de bytes: eso sería un
archivo vacío o un stub) y contiene referencias al precache.

**Si el build falla**, el mensaje es la respuesta a la pregunta de esta tarea. Anótalo literalmente y
**para**: hay que volver a la decisión D1 del spec con Cesar antes de seguir.

- [ ] **Step 5: Comprobar que un navegador lo registra de verdad**

Que el archivo exista no prueba que el navegador lo acepte.

```bash
cd /tmp/spike-pwa/web && (pnpm start &) && sleep 8
curl -s -o /dev/null -w "sw.js: %{http_code} tipo=%{content_type}\n" http://localhost:3000/sw.js
```

Esperado: `200` y un `content_type` de JavaScript. Un `text/html` significaría que Next está
devolviendo la página 404 en vez del archivo.

Mata el servidor **por PID**:

```bash
netstat -ano | grep -E "LISTENING.*:3000\b" | awk '{print $NF}' | sort -u
# y para cada PID: powershell -NoProfile -Command "Stop-Process -Id <PID> -Force"
```

- [ ] **Step 6: Comprobar que `@boxadmin/shared` se puede importar desde el navegador**

Es la otra suposición de la que cuelga todo el plan: que las funciones puras de la Fase 3A corren en
el bundle.

```bash
cd /d/Dev/box-admin/packages/shared && pnpm build
node -e "
const s = require('./dist/index.js');
console.log('calcularDisponibilidad:', typeof s.calcularDisponibilidad);
console.log('puedeCancelar:', typeof s.puedeCancelar);
console.log('resolverConfiguracion:', typeof s.resolverConfiguracion);
"
grep -rn \"require('node:\\|from 'node:\\|require('fs'\" packages/shared/src/ || echo 'SIN IMPORTS DE NODE'
```

Esperado: las tres funciones, y **`SIN IMPORTS DE NODE`**. Si apareciera alguno, ese módulo no puede
ir al bundle del navegador tal cual.

- [ ] **Step 7: Borrar el spike**

```bash
rm -rf /tmp/spike-pwa
cd /d/Dev/box-admin && git status --short
```

Esperado: `git status` **sin cambios nuevos** — el spike vivía fuera del repo.

**No hay mensaje de commit:** esta tarea no deja nada que commitear. Lo que deja son tres hechos
anotados: la versión exacta de Next 15, la de Serwist, y la confirmación de que el service worker se
genera y se sirve.

---

## Task 1: `GET /mi-pack` en la API

El endpoint que la pantalla `mi-pack` necesita y que la Fase 3A no dejó. Va primero porque el
frontend lo consume, y porque es la única parte de esta fase donde ya sabemos trabajar.

**Files:**
- Modificar: `packages/shared/src/selfservice.contracts.ts`
- Crear: `apps/api/src/mi-calendario/mi-pack.service.ts`
- Modificar: `apps/api/src/mi-calendario/mi-calendario.controller.ts`
- Modificar: `apps/api/src/mi-calendario/mi-calendario.module.ts`
- Test: `apps/api/src/mi-calendario/mi-pack.service.spec.ts`

- [ ] **Step 1: Añadir el contrato**

Al final de `packages/shared/src/selfservice.contracts.ts`:

```ts
/**
 * El estado del pack de un alumno, tal como lo ve el.
 *
 * `consumidas` NO se puede calcular en el cliente: cuenta tambien las reservas
 * canceladas como DEFINITIVA y se mide sobre la ventana del pack, no sobre el
 * rango que el alumno tenga abierto en pantalla.
 */
export interface MiPackPublico {
  pack: PackPublico | null;
  /** Tope de clases del periodo. null = sin pack, o pack sin tope. */
  tope: number | null;
  consumidas: number;
  /** null cuando no hay tope. Nunca negativo. */
  restantes: number | null;
  /** La ventana sobre la que se cuenta, en YYYY-MM-DD. null = sin limite por ese lado. */
  ventanaDesde: string | null;
  ventanaHasta: string | null;
  clasesExtra: number;
  cancelacionesUsadas: number;
  cancelacionesPermitidas: number | null;
  pagoAlDia: boolean;
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
}
```

Y al principio del archivo, junto al import que ya existe:

```ts
import type { OrigenReserva, PackPublico } from './nucleo.contracts';
```

- [ ] **Step 2: Escribir los tests que fallan**

Crear `apps/api/src/mi-calendario/mi-pack.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { MiPackService } from './mi-pack.service';
import type { PrismaService } from '../prisma/prisma.service';

const ALUMNO: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ALUMNO' };
const AHORA = new Date('2099-10-15T10:00:00.000Z');

const PACK_MENSUAL = {
  id: 'pack-1',
  tenantId: 'gym-1',
  nombre: '8 clases',
  salaId: null,
  tipo: 'MENSUAL' as const,
  precio: null,
  clasesPorMes: 8,
  clasesTotales: null,
  cancelacionesPermitidas: 2,
  activo: true,
};

const PERFIL = {
  id: 'perfil-1',
  clasesExtra: 0,
  cancelacionesUsadas: 1,
  pagoAlDia: true,
  vigenciaDesde: null as Date | null,
  vigenciaHasta: null as Date | null,
  pack: PACK_MENSUAL,
};

function crearServicio() {
  const db = {
    perfil: { findFirst: jest.fn().mockResolvedValue(PERFIL) },
    reserva: { count: jest.fn().mockResolvedValue(3) },
  };

  return { servicio: new MiPackService({ db } as unknown as PrismaService), db };
}

describe('MiPackService.deActor', () => {
  it('devuelve el consumo del periodo con sus restantes', async () => {
    const { servicio } = crearServicio();

    const mp = await servicio.deActor(ALUMNO, AHORA);

    expect(mp).toMatchObject({
      tope: 8,
      consumidas: 3,
      restantes: 5,
      cancelacionesUsadas: 1,
      cancelacionesPermitidas: 2,
      pagoAlDia: true,
    });
    expect(mp.pack).toMatchObject({ id: 'pack-1', nombre: '8 clases' });
  });

  it('un pack MENSUAL cuenta sobre el mes calendario de HOY', async () => {
    const { servicio, db } = crearServicio();

    await servicio.deActor(ALUMNO, AHORA);

    // No hay turno del que sacar la fecha, asi que la ventana es la del mes en
    // curso: es lo que significa "mi pack" cuando lo mira el alumno.
    expect(db.reserva.count.mock.calls[0][0].where.turno.fecha).toEqual({
      gte: new Date('2099-10-01T00:00:00.000Z'),
      lte: new Date('2099-10-31T00:00:00.000Z'),
    });
  });

  it('expone la ventana en YYYY-MM-DD', async () => {
    const { servicio } = crearServicio();

    const mp = await servicio.deActor(ALUMNO, AHORA);

    expect(mp.ventanaDesde).toBe('2099-10-01');
    expect(mp.ventanaHasta).toBe('2099-10-31');
  });

  it('cuenta las activas MAS las canceladas como DEFINITIVA', async () => {
    const { servicio, db } = crearServicio();

    await servicio.deActor(ALUMNO, AHORA);

    // Es la misma regla que advertenciasDePack desde la Fase 1: una cancelacion
    // DEFINITIVA sigue gastando la clase, una RECUPERABLE no.
    expect(db.reserva.count.mock.calls[0][0].where.OR).toEqual([
      { canceladaEn: null },
      { cancelacionTipo: 'DEFINITIVA' },
    ]);
  });

  it('las clases extra suben el tope', async () => {
    const { servicio, db } = crearServicio();
    db.perfil.findFirst.mockResolvedValue({ ...PERFIL, clasesExtra: 2 });

    const mp = await servicio.deActor(ALUMNO, AHORA);

    expect(mp.tope).toBe(10);
    expect(mp.restantes).toBe(7);
  });

  it('sin pack no hay tope ni restantes, pero si consumo', async () => {
    const { servicio, db } = crearServicio();
    db.perfil.findFirst.mockResolvedValue({ ...PERFIL, pack: null });

    const mp = await servicio.deActor(ALUMNO, AHORA);

    expect(mp.pack).toBeNull();
    expect(mp.tope).toBeNull();
    expect(mp.restantes).toBeNull();
    expect(mp.consumidas).toBe(3);
  });

  it('restantes nunca es negativo', async () => {
    const { servicio, db } = crearServicio();
    db.reserva.count.mockResolvedValue(12);

    const mp = await servicio.deActor(ALUMNO, AHORA);

    // Pasarse del pack esta permitido desde la Fase 1 (avisa, no bloquea), asi
    // que 12 de 8 es un estado real. "-4 restantes" no se lo dice a nadie.
    expect(mp.restantes).toBe(0);
    expect(mp.consumidas).toBe(12);
  });

  it('un pack TOTAL cuenta sobre la vigencia del perfil', async () => {
    const { servicio, db } = crearServicio();
    db.perfil.findFirst.mockResolvedValue({
      ...PERFIL,
      vigenciaDesde: new Date('2099-01-01T00:00:00.000Z'),
      vigenciaHasta: new Date('2099-12-31T00:00:00.000Z'),
      pack: { ...PACK_MENSUAL, tipo: 'TOTAL', clasesPorMes: null, clasesTotales: 40 },
    });

    const mp = await servicio.deActor(ALUMNO, AHORA);

    expect(mp.tope).toBe(40);
    expect(mp.ventanaDesde).toBe('2099-01-01');
    expect(mp.ventanaHasta).toBe('2099-12-31');
  });

  it('404 si el actor no tiene perfil', async () => {
    const { servicio, db } = crearServicio();
    db.perfil.findFirst.mockResolvedValue(null);

    await expect(servicio.deActor(ALUMNO, AHORA)).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 3: Ejecutar los tests y verlos fallar**

```bash
cd apps/api && pnpm exec jest src/mi-calendario/mi-pack
```

Esperado: FAIL — no existe el módulo.

- [ ] **Step 4: Implementar el servicio**

Crear `apps/api/src/mi-calendario/mi-pack.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { aFechaISO, type JwtPayload, type MiPackPublico } from '@boxadmin/shared';
import { PrismaService } from '../prisma/prisma.service';
import { topeDelPack, ventanaDeConteo } from '../reservas/ventana-pack';

/** Lo que hace falta del perfil, con su pack. */
const PERFIL_CON_PACK = { pack: true } as const;

@Injectable()
export class MiPackService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * El estado del pack del alumno.
   *
   * Reutiliza `topeDelPack` y `ventanaDeConteo` de la Fase 1 en vez de repetir
   * el calculo: si las reglas del pack cambian, cambian en un solo sitio.
   *
   * `ventanaDeConteo` pide la fecha de un turno porque en una reserva el periodo
   * que importa es el del turno que se reserva. Aqui no hay turno: el alumno
   * pregunta por su pack AHORA, asi que se le pasa el momento actual y para un
   * pack MENSUAL sale el mes en curso.
   */
  async deActor(actor: JwtPayload, ahora: Date = new Date()): Promise<MiPackPublico> {
    const perfil = await this.prisma.db.perfil.findFirst({
      where: { usuarioId: actor.sub },
      include: PERFIL_CON_PACK,
    });
    if (!perfil) {
      throw new NotFoundException('Este usuario no tiene perfil de alumno');
    }

    const tope = topeDelPack(perfil.pack, perfil);
    const ventana = ventanaDeConteo(perfil.pack, perfil, ahora);

    // Misma regla que advertenciasDePack desde la Fase 1: consumen clase las
    // reservas activas y las canceladas como DEFINITIVA. Las RECUPERABLE no —
    // ahi es exactamente donde "la clase vuelve al perfil".
    const consumidas = await this.prisma.db.reserva.count({
      where: {
        perfilId: perfil.id,
        OR: [{ canceladaEn: null }, { cancelacionTipo: 'DEFINITIVA' }],
        turno: { fecha: ventana },
      },
    });

    return {
      pack:
        perfil.pack === null
          ? null
          : {
              id: perfil.pack.id,
              tenantId: perfil.pack.tenantId,
              nombre: perfil.pack.nombre,
              salaId: perfil.pack.salaId,
              tipo: perfil.pack.tipo,
              precio: perfil.pack.precio === null ? null : perfil.pack.precio.toString(),
              clasesPorMes: perfil.pack.clasesPorMes,
              clasesTotales: perfil.pack.clasesTotales,
              cancelacionesPermitidas: perfil.pack.cancelacionesPermitidas,
              activo: perfil.pack.activo,
            },
      tope,
      consumidas,
      // Pasarse del pack esta permitido desde la Fase 1 (avisa, no bloquea), asi
      // que "consumidas > tope" es un estado real. Un numero negativo de
      // restantes no le dice nada util a nadie.
      restantes: tope === null ? null : Math.max(0, tope - consumidas),
      ventanaDesde: ventana.gte === undefined ? null : aFechaISO(ventana.gte),
      ventanaHasta: ventana.lte === undefined ? null : aFechaISO(ventana.lte),
      clasesExtra: perfil.clasesExtra,
      cancelacionesUsadas: perfil.cancelacionesUsadas,
      cancelacionesPermitidas: perfil.pack?.cancelacionesPermitidas ?? null,
      pagoAlDia: perfil.pagoAlDia,
      vigenciaDesde: perfil.vigenciaDesde === null ? null : aFechaISO(perfil.vigenciaDesde),
      vigenciaHasta: perfil.vigenciaHasta === null ? null : aFechaISO(perfil.vigenciaHasta),
    };
  }
}
```

**Comprueba el tipo real de `PackPublico`** en `packages/shared/src/nucleo.contracts.ts` antes de dar
por buenos los nombres de campo del objeto `pack`, y ajusta si alguno no coincide. En particular
`precio` es un `Decimal` de Prisma: mira cómo lo serializa `packs.service.ts` y haz lo mismo.

- [ ] **Step 5: Ejecutar los tests y verlos pasar**

```bash
cd packages/shared && pnpm build
cd ../../apps/api && pnpm exec jest src/mi-calendario/mi-pack
```

Esperado: PASS, 9 tests.

- [ ] **Step 6: Exponer la ruta**

En `apps/api/src/mi-calendario/mi-calendario.controller.ts`, añadir el import de `MiPackService` y
de `MiPackPublico`, inyectarlo en el constructor y añadir:

```ts
  @Roles('ALUMNO')
  @Get('mi-pack')
  miPack(@CurrentUser() actor: JwtPayload): Promise<MiPackPublico> {
    return this.miPackServicio.deActor(actor);
  }
```

En `apps/api/src/mi-calendario/mi-calendario.module.ts`, añadir `MiPackService` a `providers` y a
`exports`.

- [ ] **Step 7: Añadir el e2e**

⚠️ **Estos tests usan un pack `TOTAL` sin vigencia, y el motivo no es caprichoso.** `mi-pack` cuenta
sobre el **mes en curso**, pero los turnos de los e2e viven en **2099** —los fixtures se fueron al
futuro porque la API se niega a generar meses pasados—, así que con un pack `MENSUAL` la reserva cae
fuera de la ventana y `consumidas` sale 0. Un pack `TOTAL` sin vigencia tiene ventana sin límites y
cuenta caiga la clase donde caiga. La semántica del `MENSUAL` se prueba en los unitarios, que sí
pueden fijar el reloj.

⚠️ El endpoint de cancelación del admin toma el tipo **por query y en minúsculas**
(`?tipo=definitiva`), no por cuerpo.

Al final de `apps/api/test/selfservice.e2e-spec.ts`, **dentro** del `describe` raíz (es decir, antes
del último `});` del archivo):

```ts
  // -------------------------------------------------------------------------
  // 7. Mi pack
  // -------------------------------------------------------------------------
  describe('mi-pack', () => {
    it('refleja el consumo real: una reserva cuenta, una cancelacion RECUPERABLE no', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId);
      const pack = await request(servidor)
        .post('/packs')
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .send({ nombre: '8 clases', tipo: 'MENSUAL', clasesPorMes: 8 })
        .expect(201);
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId], { packId: pack.body.id });
      await publicarMes(app, gym.adminToken, salaId, ANIO, MES);

      const vacio = await request(servidor)
        .get('/mi-pack')
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(200);
      expect(vacio.body).toMatchObject({ tope: 8, consumidas: 0, restantes: 8 });

      const reserva = await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(201);

      const conUna = await request(servidor)
        .get('/mi-pack')
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(200);
      expect(conUna.body).toMatchObject({ consumidas: 1, restantes: 7 });

      // El alumno cancela dentro de ventana: RECUPERABLE, la clase vuelve.
      await request(servidor)
        .delete(`/mis-reservas/${reserva.body.id}`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(200);

      const trasCancelar = await request(servidor)
        .get('/mi-pack')
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(200);
      expect(trasCancelar.body).toMatchObject({ consumidas: 0, restantes: 8 });
    });

    it('sin pack, devuelve tope y restantes en null', async () => {
      const salaId = await crearSala();
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);

      const { body } = await request(servidor)
        .get('/mi-pack')
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(200);

      expect(body).toMatchObject({ pack: null, tope: null, restantes: null });
    });

    it('un admin sin perfil recibe 404', async () => {
      await request(servidor)
        .get('/mi-pack')
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .expect(404);
    });
  });
```

- [ ] **Step 8: Verificar todo el backend**

**Antes de los e2e**, comprueba que no hay otra API viva (ver las trampas del entorno):

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*box-admin*' } | Select-Object ProcessId"
docker compose up -d postgres postgres-test redis
```

```bash
cd apps/api && pnpm exec tsc --noEmit && pnpm test && pnpm test:e2e
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/api/src/mi-calendario/**/*.ts" "packages/shared/src/selfservice.contracts.ts"
```

Esperado: 600 unitarios, 130 e2e, formato limpio.

**Mensaje de commit sugerido para Cesar:**

```
feat(api): GET /mi-pack

El consumo del pack no se puede calcular en el cliente: cuenta las canceladas
como DEFINITIVA y se mide sobre la ventana del pack. Reutiliza topeDelPack y
ventanaDeConteo de la Fase 1, pasandoles el momento actual como fecha.
```

---

## Task 2: CORS para el almacén local

Sin esto, la subida del comprobante desde el navegador queda bloqueada. Es una tarea corta pero no es
opcional: el `PUT` del archivo es el único punto donde el navegador **no** habla con Next.

**Files:**
- Modificar: `apps/api/src/main.ts`
- Modificar: `apps/api/src/config/validar-entorno.ts`
- Modificar: `.env`, `.env.example`, `.env.test`, `.env.test.example`
- Test: `apps/api/src/config/validar-entorno.spec.ts`

- [ ] **Step 1: Escribir el test de la variable nueva**

Añadir a `apps/api/src/config/validar-entorno.spec.ts`, dentro del `describe` del almacén:

```ts
  it('WEB_ORIGIN es opcional: sin el, no se habilita CORS', () => {
    const entorno = { ...ENTORNO_COMPLETO } as Record<string, unknown>;
    delete entorno.WEB_ORIGIN;

    // Un despliegue solo-API no tiene frontend al que abrirle la puerta.
    expect(() => validarEntorno(entorno)).not.toThrow();
  });

  it('WEB_ORIGIN, si esta, tiene que ser un origen valido', () => {
    expect(() => validarEntorno({ ...ENTORNO_COMPLETO, WEB_ORIGIN: 'no-es-una-url' })).toThrow(
      /WEB_ORIGIN/,
    );
  });

  it('acepta un origen con puerto', () => {
    expect(() =>
      validarEntorno({ ...ENTORNO_COMPLETO, WEB_ORIGIN: 'http://localhost:3001' }),
    ).not.toThrow();
  });
```

- [ ] **Step 2: Ejecutar y ver fallar**

```bash
cd apps/api && pnpm exec jest src/config -t WEB_ORIGIN
```

Esperado: FAIL en "tiene que ser un origen valido" — hoy no valida nada.

- [ ] **Step 3: Validar `WEB_ORIGIN`**

En `apps/api/src/config/validar-entorno.ts`, antes del `return config` final:

```ts
  // Opcional a proposito: un despliegue solo-API no tiene frontend al que
  // abrirle la puerta, y exigirla obligaria a inventar un valor.
  const webOrigin = config.WEB_ORIGIN;
  if (webOrigin !== undefined && webOrigin !== '') {
    if (typeof webOrigin !== 'string') {
      throw new Error('WEB_ORIGIN debe ser una cadena con el origen del frontend.');
    }
    try {
      // Un origen es esquema + host + puerto. `new URL` lo valida de verdad;
      // una expresion regular casera aqui seria peor que inutil.
      new URL(webOrigin);
    } catch {
      throw new Error(
        `WEB_ORIGIN no es un origen valido: ${webOrigin}. ` +
          'Se espera algo como http://localhost:3001 o https://app.boxadmin.io.',
      );
    }
  }
```

- [ ] **Step 4: Habilitar CORS solo donde hace falta**

En `apps/api/src/main.ts`, después del `trust proxy` y antes de `helmet`:

```ts
  // CORS acotado a las rutas del almacen local, y solo si hay un frontend
  // configurado.
  //
  // Con el BFF de la Fase 3B el navegador habla siempre con Next, mismo origen,
  // salvo en UN sitio: el PUT del comprobante va directo del navegador al
  // almacen, que es exactamente para lo que existen las URLs firmadas. En
  // desarrollo ese almacen es esta misma API en otro puerto, asi que sin CORS
  // el navegador bloquea la subida.
  //
  // `origin` es un valor concreto y no `true`: reflejar cualquier origen
  // convertiria estas rutas en algo que cualquier pagina podria invocar.
  // `credentials` queda en false porque las rutas del almacen se autentican con
  // su firma HMAC, no con cookies.
  const webOrigin = config.get<string>('WEB_ORIGIN');
  if (webOrigin) {
    app.enableCors({
      origin: webOrigin,
      methods: ['GET', 'PUT', 'OPTIONS'],
      credentials: false,
    });
  }
```

`config` ya existe en `bootstrap()`; si estuviera declarado después, súbelo antes de este bloque.

- [ ] **Step 5: Añadir la variable a los `.env`**

En `.env` y `.env.example`:

```
# Origen del frontend (Fase 3B). Sin el, no se habilita CORS.
WEB_ORIGIN=http://localhost:3001
```

En `.env.test` y `.env.test.example`, lo mismo. Los e2e del backend no lo usan, pero la variable
tiene que existir para que el entorno de test se parezca al real.

- [ ] **Step 6: Verificar**

```bash
cd apps/api && pnpm exec jest src/config && pnpm exec tsc --noEmit
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/api/src/main.ts"
```

Esperado: tests en verde y formato correcto. `main.ts` ya estaba limpio antes de esta fase.

- [ ] **Step 7: Comprobar CORS a mano contra la API viva**

Un test unitario no prueba que el navegador acepte la respuesta. Levanta la API y pregunta:

```bash
cd apps/api && (pnpm start:dev &) && sleep 40
curl -s -i -X OPTIONS "http://localhost:3000/archivos-locales/prueba.pdf" \
  -H "Origin: http://localhost:3001" \
  -H "Access-Control-Request-Method: PUT" | grep -i "access-control-allow"
```

Esperado: al menos `Access-Control-Allow-Origin: http://localhost:3001` y un
`Access-Control-Allow-Methods` que incluya `PUT`.

Y comprueba que **no** se abre a cualquiera:

```bash
curl -s -i -X OPTIONS "http://localhost:3000/archivos-locales/prueba.pdf" \
  -H "Origin: https://sitio-malicioso.invalid" \
  -H "Access-Control-Request-Method: PUT" | grep -i "access-control-allow-origin"
```

Esperado: **sin** cabecera `Access-Control-Allow-Origin`, o con un valor distinto del origen pedido.

Mata la API **por PID** (ver las trampas del entorno: el puerto libre no basta).

**Mensaje de commit sugerido para Cesar:**

```
feat(api): CORS acotado a las rutas del almacen local

El PUT del comprobante es el unico punto donde el navegador no habla con el
BFF de Next. Origen concreto desde WEB_ORIGIN, nunca reflejando el que llegue,
y sin credenciales: esas rutas se autentican con su firma HMAC.
```

---
## Task 3: Montar `apps/web`

El esqueleto. Nada de pantallas todavía: solo que el paquete exista, compile, vea `@boxadmin/shared`
y sepa correr sus tests.

**Files:**
- Crear: `apps/web/` (scaffold de Next)
- Modificar: `apps/web/package.json`, `apps/web/next.config.mjs`, `apps/web/tsconfig.json`
- Crear: `apps/web/vitest.config.ts`, `apps/web/vitest.setup.ts`
- Crear: `apps/web/.env.local`, `apps/web/.env.example`
- Modificar: `package.json` (raíz), `.gitignore`
- Test: `apps/web/src/lib/shared.spec.ts`

- [ ] **Step 1: Generar el proyecto**

Usa la versión exacta de Next que anotaste en la Task 0.

```bash
cd /d/Dev/box-admin/apps
pnpm dlx create-next-app@15 web --typescript --tailwind --app --src-dir \
  --import-alias "@/*" --no-eslint --use-pnpm --no-turbopack < /dev/null
```

**`--no-turbopack` es obligatorio y está verificado:** sin esa bandera, `create-next-app@15` abre un
prompt interactivo ("Would you like to use Turbopack?") y el comando **se queda colgado para
siempre** en un entorno no interactivo. El `< /dev/null` es el cinturón de seguridad por si
apareciera alguna pregunta más.

Se evita Turbopack porque Serwist engancha en el pipeline de Webpack, y mezclarlo añadiría una
variable más a la tarea más delicada de la fase.

**Por qué sin ESLint:** el monorepo ya tiene su configuración en `apps/api` y el único script de lint
del repo lleva `--fix`, que está prohibido. Añadir una segunda configuración distinta aquí solo
crearía confusión. El formato lo comprueba Prettier, como en el resto del repo.

- [ ] **Step 2: Fijar nombre, puerto y scripts**

Reemplazar la sección de scripts y el nombre en `apps/web/package.json`:

```json
{
  "name": "@boxadmin/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "predev": "pnpm --filter @boxadmin/shared build",
    "dev": "next dev --port 3001",
    "prebuild": "pnpm --filter @boxadmin/shared build",
    "build": "next build",
    "start": "next start --port 3001",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  }
}
```

**El puerto 3001 no es casual:** la API vive en el 3000 y las dos tienen que correr a la vez. Y los
`pre*` construyen `@boxadmin/shared` antes, igual que hace `apps/api`: sin eso, el primer arranque en
una máquina limpia falla porque `dist/` no existe.

- [ ] **Step 3: Instalar las dependencias de la fase**

```bash
cd /d/Dev/box-admin/apps/web
pnpm add @tanstack/react-query react-hook-form @hookform/resolvers zod
pnpm add @boxadmin/shared@workspace:^
pnpm add @serwist/next
pnpm add -D serwist \
  @testing-library/react @testing-library/user-event @testing-library/jest-dom \
  @playwright/test
pnpm add -D vitest@3 "@vitejs/plugin-react@5" jsdom@26
```

⚠️ **Las tres versiones fijadas de la última línea están verificadas y no son negociables con Node
20.** El monorepo está clavado en `engines: ">=20 <21"`, y las últimas de estos tres paquetes ya
pidieron Node 22:

| Paquete | Por qué fijado |
|---|---|
| `vitest@3` (3.2.7) | La 5 declara `engines: node ^22.12` o superior. **No es un aviso de tipos: no arranca** |
| `@vitejs/plugin-react@5` (5.2.0) | La 6 exige `vite@^8` y Vitest 3 trae la 7. La 5 acepta de la 4 a la 8, así que sobrevive a que Vitest cambie de Vite por debajo |
| `jsdom@26` (26.1.0) | La 30 arrastra `undici@8` y **revienta al cargar** en Node 20, con una traza que apunta a `cachestorage.js` y no menciona la versión de Node por ningún lado |

El patrón se repite: si un paquete de test falla con una traza incomprensible dentro de
`node_modules`, mira sus `engines` antes de depurar nada.

**No se instala `axios`,** aunque el PDF lo liste. El `fetch` nativo cubre todo lo que hace falta y
ya está en el runtime de Next; una dependencia menos que mantener. Se deja anotado como desviación.

- [ ] **Step 4: Configurar Next**

Reemplazar `apps/web/next.config.ts` (o `.mjs`) por `apps/web/next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // `@boxadmin/shared` se publica como TypeScript compilado dentro del
  // monorepo; sin esto Next no lo procesa y el import falla en el build.
  transpilePackages: ['@boxadmin/shared'],
};

export default config;
```

Serwist se añade en la Task 14: meterlo ahora dejaría un service worker rondando durante trece
tareas de desarrollo.

- [ ] **Step 5: Endurecer TypeScript**

En `apps/web/tsconfig.json`, dentro de `compilerOptions`, asegurar:

```json
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true
```

`strict` viene del scaffold; los otros dos no. `noUncheckedIndexedAccess` es el que más vale aquí:
la mitad del código de esta fase indexa arrays de turnos y reservas, y sin él TypeScript miente sobre
que siempre hay elemento.

- [ ] **Step 6: Configurar Vitest**

Crear `apps/web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Los tests de Playwright viven en e2e/ y los corre otro runner. Sin esta
    // exclusion, Vitest intenta ejecutarlos y falla con errores desconcertantes.
    exclude: ['node_modules/**', 'e2e/**', '.next/**'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
});
```

Crear `apps/web/vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * La limpieza del DOM entre tests NO es automatica con Vitest.
 *
 * Testing Library la engancha sola cuando el runner expone `afterEach` como
 * global (el modo `globals: true`). Aqui los tests importan `describe`, `it` y
 * `expect` explicitamente, asi que hay que registrarla a mano.
 *
 * Sin esto, cada `render` acumula nodos y los tests empiezan a fallar con
 * "Found multiple elements with the role ..." — un sintoma que apunta al test
 * equivocado, porque el que falla es el segundo y el culpable es el primero.
 */
afterEach(() => {
  cleanup();
});
```

- [ ] **Step 7: Escribir el test que prueba que el paquete compartido llega**

Es el test más importante de esta tarea: verifica la suposición de la que cuelga todo el plan.

Crear `apps/web/src/lib/shared.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { calcularDisponibilidad, puedeCancelar, resolverConfiguracion } from '@boxadmin/shared';

const SIN_VENTANA = { minMinutosCancelar: 0, minMinutosAnotarse: 0, listaEsperaHabilitada: false };

describe('@boxadmin/shared en el navegador', () => {
  it('calcularDisponibilidad corre en el bundle del cliente', () => {
    const d = calcularDisponibilidad({
      turno: {
        id: 'turno-1',
        salaId: 'sala-1',
        fecha: new Date('2099-10-02T00:00:00.000Z'),
        horaInicio: '10:00',
        cupo: 5,
      },
      sala: { activa: true, visibleAlumnos: true, soloCuposLiberados: false },
      config: SIN_VENTANA,
      ocupados: 1,
      huboCancelaciones: false,
      mesPublicado: true,
      tieneAccesoASala: true,
      yaReservado: false,
      enListaEspera: false,
      posicionEnLista: null,
      ahora: new Date('2099-10-01T10:00:00.000Z'),
    });

    // Es la MISMA funcion que decide en el servidor. Que corra aqui es lo que
    // permite a una pantalla apagar un boton sin preguntar.
    expect(d.estado).toBe('LIBRE');
    expect(d.puedeReservar).toBe(true);
  });

  it('puedeCancelar corre en el bundle del cliente', () => {
    const fecha = new Date('2099-10-02T00:00:00.000Z');

    expect(puedeCancelar(fecha, '10:00', SIN_VENTANA, new Date('2099-10-01T10:00:00.000Z'))).toBe(
      true,
    );
  });

  it('resolverConfiguracion corre en el bundle del cliente', () => {
    const config = resolverConfiguracion(
      { minMinutosCancelar: 120, minMinutosAnotarse: null, listaEsperaHabilitada: null },
      { minMinutosCancelar: 999, minMinutosAnotarse: 30, listaEsperaHabilitada: true },
    );

    expect(config).toEqual({
      minMinutosCancelar: 120,
      minMinutosAnotarse: 30,
      listaEsperaHabilitada: true,
    });
  });
});
```

- [ ] **Step 8: Ejecutar los tests**

```bash
cd /d/Dev/box-admin/packages/shared && pnpm build
cd ../../apps/web && pnpm test
```

Esperado: PASS, 3 tests.

**Si fallara con "Cannot find module '@boxadmin/shared'"**, comprueba que `pnpm add
@boxadmin/shared@workspace:^` dejó la dependencia en `apps/web/package.json` apuntando a
`workspace:^` y que `packages/shared/dist/` existe.

- [ ] **Step 9: Variables de entorno**

Crear `apps/web/.env.example`:

```
# La API de Nest. El BFF de Next es el UNICO que la llama; el navegador nunca.
API_URL=http://localhost:3000

# Origen publico de esta aplicacion, para las cookies y los enlaces absolutos.
NEXT_PUBLIC_APP_URL=http://localhost:3001
```

Copiar a `apps/web/.env.local` con los mismos valores.

**`API_URL` no lleva el prefijo `NEXT_PUBLIC_`, y es deliberado:** una variable con ese prefijo se
incrusta en el bundle del navegador. La dirección de la API no tiene por qué ser pública, y sobre
todo: si estuviera disponible en el cliente, sería una invitación a saltarse el BFF y volver a
mandar el token desde el navegador.

En `.gitignore` de la raíz, comprobar que `.env.local` está cubierto y, si no, añadir:

```
.env.local
apps/web/.next/
apps/web/public/sw.js
apps/web/public/sw.js.map
apps/web/test-results/
apps/web/playwright-report/
```

El service worker generado **no se commitea**: es un artefacto del build.

- [ ] **Step 10: Atajos desde la raíz**

En el `package.json` de la raíz, añadir a `scripts`:

```json
    "web:dev": "pnpm --filter @boxadmin/web dev",
    "web:build": "pnpm --filter @boxadmin/web build",
    "web:test": "pnpm --filter @boxadmin/web test",
    "web:test:e2e": "pnpm --filter @boxadmin/web test:e2e"
```

- [ ] **Step 11: Verificar el conjunto**

```bash
cd /d/Dev/box-admin/apps/web && pnpm typecheck && pnpm test && pnpm build 2>&1 | tail -15
cd /d/Dev/box-admin && git check-ignore -v apps/web/.next apps/web/.env.local
```

Esperado: typecheck limpio, 3 tests, build correcto, y los dos ignorados.

```bash
cd /d/Dev/box-admin && git status --short | head -20
```

Esperado: `apps/web/` sin seguir, y **sin** `.next/` ni `node_modules/` dentro.

**Mensaje de commit sugerido para Cesar:**

```
chore(web): esqueleto de la PWA del alumno

Next 15 con App Router, Tailwind y TypeScript strict en el puerto 3001.
Consume @boxadmin/shared via transpilePackages, con un test que verifica que
las funciones puras de la Fase 3A corren en el bundle del navegador. Vitest
configurado y excluyendo e2e/, que es de Playwright. Sin axios: fetch basta.
```

---

## Task 4: El proxy del BFF

La pieza central, y la única con superficie de ataque propia. Va antes que cualquier pantalla porque
todo lo demás la usa.

**Files:**
- Crear: `apps/web/src/lib/api-url.ts`
- Crear: `apps/web/src/lib/cookies.ts`
- Crear: `apps/web/src/app/api/bx/[...ruta]/route.ts`
- Test: `apps/web/src/lib/api-url.spec.ts`

### Por qué un proxy genérico

Escribir un Route Handler por endpoint daría veinte archivos casi idénticos. Uno solo que reenvíe
cualquier ruta es más corto y más fácil de auditar — **a cambio de que haya que auditarlo de verdad**,
porque un proxy que acepta cualquier destino es un SSRF: un atacante lo usaría para que el servidor
pida URLs que él no alcanza.

Por eso la validación de ruta vive en su propio archivo, con sus propios tests, separada del handler.

- [ ] **Step 1: Escribir los tests del cortafuegos**

Crear `apps/web/src/lib/api-url.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RutaInvalidaError, urlDeApi } from './api-url';

beforeEach(() => {
  vi.stubEnv('API_URL', 'http://api-interna:3000');
});

describe('urlDeApi — rutas validas', () => {
  it('compone la ruta sobre la base configurada', () => {
    expect(urlDeApi(['mi-calendario'], '')).toBe('http://api-interna:3000/mi-calendario');
  });

  it('une varios segmentos', () => {
    expect(urlDeApi(['turnos', 'abc123', 'mi-reserva'], '')).toBe(
      'http://api-interna:3000/turnos/abc123/mi-reserva',
    );
  });

  it('conserva la query', () => {
    expect(urlDeApi(['mi-calendario'], '?desde=2099-10-01&hasta=2099-10-31')).toBe(
      'http://api-interna:3000/mi-calendario?desde=2099-10-01&hasta=2099-10-31',
    );
  });

  it('acepta los caracteres de un cuid', () => {
    expect(urlDeApi(['comprobantes', 'cmu74sou60009uotb2q7xwqod'], '')).toContain(
      'cmu74sou60009uotb2q7xwqod',
    );
  });
});

describe('urlDeApi — cortafuegos anti-SSRF', () => {
  // Cada uno de estos es un intento de hacer que el SERVIDOR pida algo que el
  // atacante no alcanza desde su navegador. El proxy corre dentro de la red
  // donde vive la API, asi que un destino libre seria una puerta a todo lo que
  // haya ahi dentro.
  it.each([
    ['ruta absoluta', ['http://malicioso.invalid/robar']],
    ['esquema en un segmento', ['https:', '', 'malicioso.invalid']],
    ['subida de directorio', ['..', '..', 'etc', 'passwd']],
    ['subida codificada', ['%2e%2e', 'admin']],
    ['barra dentro de un segmento', ['turnos/../../admin']],
    ['barra invertida', ['turnos\\..\\admin']],
    ['byte nulo', ['turnos\u0000']],
    ['segmento vacio', ['']],
    ['sin segmentos', []],
  ])('rechaza %s', (_nombre, segmentos) => {
    expect(() => urlDeApi(segmentos, '')).toThrow(RutaInvalidaError);
  });

  it('el resultado SIEMPRE cuelga de la base, pase lo que pase', () => {
    // Red de seguridad final: aunque un caso se escapara de las reglas de
    // arriba, la URL compuesta no puede salir del origen de la API.
    for (const segmentos of [['a'], ['a', 'b'], ['mi-calendario']]) {
      expect(urlDeApi(segmentos, '').startsWith('http://api-interna:3000/')).toBe(true);
    }
  });

  it('lanza si API_URL no esta configurada', () => {
    vi.stubEnv('API_URL', '');

    // Fallar ruidosamente es mejor que componer una URL contra undefined y
    // pedirle algo a un host que no existe.
    expect(() => urlDeApi(['mi-calendario'], '')).toThrow(/API_URL/);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

```bash
cd apps/web && pnpm test src/lib/api-url.spec.ts
```

Esperado: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar el cortafuegos**

Crear `apps/web/src/lib/api-url.ts`:

```ts
/**
 * Compone la URL de la API a partir de los segmentos que llegan al proxy.
 *
 * Este archivo es un CORTAFUEGOS, no una utilidad de concatenar cadenas. El
 * proxy corre en el servidor, dentro de la red donde vive la API; si aceptara
 * cualquier destino, cualquiera podria usarlo para que el servidor pida cosas
 * que el no alcanza desde su navegador (SSRF).
 *
 * Por eso vive aparte del handler y con sus propios tests: es la pieza que hay
 * que poder auditar de un vistazo.
 */

export class RutaInvalidaError extends Error {
  constructor(motivo: string) {
    super(`Ruta rechazada por el proxy: ${motivo}`);
    this.name = 'RutaInvalidaError';
  }
}

/**
 * Un segmento aceptable: letras, numeros, guion, guion bajo y punto.
 *
 * Deliberadamente estrecho. Todos los identificadores de la API son cuids y
 * todas sus rutas son palabras con guiones, asi que no hace falta nada mas — y
 * lo que no hace falta, no se admite.
 */
const SEGMENTO_VALIDO = /^[A-Za-z0-9._-]+$/;

export function urlDeApi(segmentos: string[], query: string): string {
  const base = process.env.API_URL;
  if (!base) {
    throw new RutaInvalidaError('API_URL no esta configurada');
  }

  if (segmentos.length === 0) {
    throw new RutaInvalidaError('sin segmentos');
  }

  for (const segmento of segmentos) {
    // Next ya decodifica los segmentos, pero un `%2e%2e` doblemente codificado
    // llegaria aqui como `%2e%2e` literal y pasaria un test ingenuo de "..".
    // Se comprueba tambien la forma decodificada.
    let decodificado: string;
    try {
      decodificado = decodeURIComponent(segmento);
    } catch {
      throw new RutaInvalidaError(`segmento mal codificado: ${segmento}`);
    }

    for (const forma of [segmento, decodificado]) {
      if (!SEGMENTO_VALIDO.test(forma)) {
        throw new RutaInvalidaError(`segmento con caracteres no admitidos: ${segmento}`);
      }
      if (forma === '.' || forma === '..') {
        throw new RutaInvalidaError(`subida de directorio: ${segmento}`);
      }
    }
  }

  const url = `${base.replace(/\/+$/, '')}/${segmentos.join('/')}${query}`;

  // Red de seguridad final. Si alguna de las reglas de arriba se quedara corta,
  // esto sigue garantizando que el destino cuelga del origen de la API.
  const destino = new URL(url);
  const origen = new URL(base);
  if (destino.origin !== origen.origin) {
    throw new RutaInvalidaError(`el destino sale del origen de la API: ${destino.origin}`);
  }

  return url;
}
```

- [ ] **Step 4: Ejecutar los tests y verlos pasar**

```bash
cd apps/web && pnpm test src/lib/api-url.spec.ts
```

Esperado: PASS, 15 tests.

- [ ] **Step 5: Prueba de mutación — comprobar que el cortafuegos muerde**

Comenta el bucle `for (const segmento of segmentos)` entero y vuelve a correr.

```bash
cd apps/web && pnpm test src/lib/api-url.spec.ts
```

Esperado: **FAIL** en varios casos del bloque anti-SSRF. Si pasaran en verde, los tests no valen
nada. **Revierte** y confirma que vuelven a pasar.

- [ ] **Step 6: Definir las cookies en un solo sitio**

Crear `apps/web/src/lib/cookies.ts`:

```ts
/**
 * Lo unico que este modulo necesita de las cookies de una respuesta.
 *
 * Se declara estructuralmente en vez de importar el tipo de Next: el tipo real
 * vive en `next/dist/compiled/...`, que es una ruta interna que cambia entre
 * versiones sin avisar. Un `set` es todo lo que se usa aqui.
 */
interface CookiesDeRespuesta {
  set(nombre: string, valor: string, opciones: Record<string, unknown>): unknown;
}

export const COOKIE_ACCESS = 'bx_access';
export const COOKIE_REFRESH = 'bx_refresh';
/**
 * El gimnasio al que pertenece la sesion.
 *
 * Las cookies son del dominio, pero los tokens son de UN gimnasio. Sin esto,
 * alguien logueado en /gym-a/ que abriera /gym-b/calendario veria datos de A
 * bajo la URL de B, porque el JWT lleva su propio tenantId y la API responderia
 * tan tranquila.
 *
 * Es httpOnly como las otras dos: la lee el layout en el servidor, el cliente no
 * la necesita, y una cookie menos legible desde JavaScript es una menos que
 * manipular.
 */
export const COOKIE_SLUG = 'bx_slug';

/**
 * `sameSite: 'lax'` y no `'strict'`: con strict, volver a la aplicacion desde
 * un enlace externo no manda las cookies y el alumno aparece deslogueado sin
 * entender por que. `lax` ya bloquea el envio en peticiones cross-site que no
 * sean navegacion de primer nivel, que es lo que importa aqui.
 */
export function opcionesDeCookie(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

/** 15 minutos, como el access token de la API. */
export const VIDA_ACCESS = 15 * 60;
/** 30 dias, como el refresh de la API. */
export const VIDA_REFRESH = 30 * 24 * 60 * 60;

export function borrarCookiesDeSesion(cookies: CookiesDeRespuesta): void {
  for (const nombre of [COOKIE_ACCESS, COOKIE_REFRESH, COOKIE_SLUG]) {
    cookies.set(nombre, '', { ...opcionesDeCookie(0), maxAge: 0 });
  }
}
```

- [ ] **Step 7: Escribir el proxy**

Crear `apps/web/src/app/api/bx/[...ruta]/route.ts`:

```ts
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { RutaInvalidaError, urlDeApi } from '@/lib/api-url';
import {
  COOKIE_ACCESS,
  COOKIE_REFRESH,
  VIDA_ACCESS,
  borrarCookiesDeSesion,
  opcionesDeCookie,
} from '@/lib/cookies';

/**
 * Proxy generico hacia la API.
 *
 * Existe para que el token nunca llegue al navegador: el JavaScript de la
 * pagina llama a `/api/bx/lo-que-sea` sin credenciales, y es este handler —en
 * el servidor— quien añade el Authorization desde la cookie httpOnly.
 *
 * Es generico a proposito: un handler por endpoint serian veinte archivos casi
 * identicos. El precio es que la validacion del destino tiene que ser seria, y
 * por eso vive en `lib/api-url.ts` con sus propios tests.
 */

/** Cabeceras que NO se reenvian a la API. */
const CABECERAS_A_OMITIR = new Set([
  // La pone el proxy desde la cookie; la que venga del cliente se ignora.
  'authorization',
  // Las cookies del navegador no son asunto de la API.
  'cookie',
  // Las recalcula fetch; reenviarlas produce respuestas truncadas o corruptas.
  'host',
  'connection',
  'content-length',
  'accept-encoding',
]);

function cabecerasParaLaApi(req: NextRequest, accessToken: string): Headers {
  const salida = new Headers();

  req.headers.forEach((valor, nombre) => {
    if (!CABECERAS_A_OMITIR.has(nombre.toLowerCase())) salida.set(nombre, valor);
  });
  salida.set('authorization', `Bearer ${accessToken}`);

  return salida;
}

async function reenviar(
  req: NextRequest,
  url: string,
  accessToken: string,
  cuerpo: string | undefined,
): Promise<Response> {
  return fetch(url, {
    method: req.method,
    headers: cabecerasParaLaApi(req, accessToken),
    body: cuerpo,
    // El proxy sigue la cadena el mismo: dejar que fetch redirija podria
    // llevarlo fuera del origen de la API sin pasar por el cortafuegos.
    redirect: 'manual',
    cache: 'no-store',
  });
}

/**
 * Pide un par de tokens nuevo. Devuelve el access token, o null si el refresh
 * ya no sirve.
 */
async function refrescar(refreshToken: string): Promise<{ access: string; refresh: string } | null> {
  const respuesta = await fetch(urlDeApi(['auth', 'refresh'], ''), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });

  if (!respuesta.ok) return null;

  const datos = (await respuesta.json()) as { accessToken: string; refreshToken: string };
  return { access: datos.accessToken, refresh: datos.refreshToken };
}

async function manejar(req: NextRequest, ctx: { params: Promise<{ ruta: string[] }> }) {
  const { ruta } = await ctx.params;

  let url: string;
  try {
    url = urlDeApi(ruta, new URL(req.url).search);
  } catch (error) {
    if (error instanceof RutaInvalidaError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    throw error;
  }

  const almacen = await cookies();
  const access = almacen.get(COOKIE_ACCESS)?.value;
  const refresh = almacen.get(COOKIE_REFRESH)?.value;

  if (!access) {
    return NextResponse.json({ message: 'Sin sesion' }, { status: 401 });
  }

  // El cuerpo se lee UNA vez: un Request no se puede consumir dos veces, y el
  // reintento tras el refresh necesita volver a mandarlo.
  const cuerpo =
    req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();

  let respuesta = await reenviar(req, url, access, cuerpo);

  // Un 401 puede ser simplemente que el access token caduco. Se intenta el
  // refresh UNA vez: si tambien falla, la sesion se acabo de verdad.
  if (respuesta.status === 401 && refresh) {
    const nuevos = await refrescar(refresh);

    if (!nuevos) {
      const fin = NextResponse.json({ message: 'Sesion expirada' }, { status: 401 });
      borrarCookiesDeSesion(fin.cookies);
      return fin;
    }

    respuesta = await reenviar(req, url, nuevos.access, cuerpo);

    const conTokens = new NextResponse(respuesta.body, {
      status: respuesta.status,
      headers: respuesta.headers,
    });
    conTokens.cookies.set(COOKIE_ACCESS, nuevos.access, opcionesDeCookie(VIDA_ACCESS));
    conTokens.cookies.set(COOKIE_REFRESH, nuevos.refresh, opcionesDeCookie(VIDA_REFRESH));
    return conTokens;
  }

  return new NextResponse(respuesta.body, {
    status: respuesta.status,
    headers: respuesta.headers,
  });
}

export const GET = manejar;
export const POST = manejar;
export const PATCH = manejar;
export const PUT = manejar;
export const DELETE = manejar;

/** Nada de este proxy se puede cachear: cada respuesta depende de la sesion. */
export const dynamic = 'force-dynamic';
```

- [ ] **Step 8: Verificar**

```bash
cd apps/web && pnpm typecheck && pnpm test && pnpm build 2>&1 | tail -10
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/web/src/**/*.ts"
```

Esperado: todo limpio. El build debe listar la ruta `/api/bx/[...ruta]` como dinámica.

**Mensaje de commit sugerido para Cesar:**

```
feat(web): proxy del BFF hacia la API

Un solo handler generico en vez de veinte casi identicos, con el token puesto
en el servidor desde la cookie httpOnly. La validacion del destino vive aparte
en lib/api-url.ts y con sus propios tests, porque un proxy sin cortafuegos es
un SSRF: comprueba forma cruda y decodificada de cada segmento y, como red
final, que la URL compuesta no salga del origen de la API. Refresh una sola vez
ante un 401.
```

---

## Task 5: Las rutas de sesión

Login, auto-registro y logout. Son los tres únicos sitios donde los tokens existen como texto, y de
ahí pasan directamente a cookies.

**Files:**
- Crear: `apps/web/src/app/api/auth/login/route.ts`
- Crear: `apps/web/src/app/api/auth/auto-registro/route.ts`
- Crear: `apps/web/src/app/api/auth/logout/route.ts`
- Crear: `apps/web/src/lib/sesion.ts`
- Test: `apps/web/src/lib/sesion.spec.ts`

- [ ] **Step 1: Escribir el test de la lectura de sesión**

Crear `apps/web/src/lib/sesion.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sesionValidaPara } from './sesion';

describe('sesionValidaPara', () => {
  it('acepta cuando hay token y el slug coincide', () => {
    expect(sesionValidaPara({ access: 'tok', slug: 'mi-gym' }, 'mi-gym')).toBe(true);
  });

  it('rechaza sin token', () => {
    expect(sesionValidaPara({ access: undefined, slug: 'mi-gym' }, 'mi-gym')).toBe(false);
  });

  it('rechaza si el slug de la URL es de OTRO gimnasio', () => {
    // El caso que justifica que exista la cookie del slug: el JWT lleva su
    // propio tenantId, asi que la API responderia con datos de mi-gym bajo la
    // URL de otro-gym sin quejarse de nada.
    expect(sesionValidaPara({ access: 'tok', slug: 'mi-gym' }, 'otro-gym')).toBe(false);
  });

  it('rechaza si no hay slug guardado', () => {
    expect(sesionValidaPara({ access: 'tok', slug: undefined }, 'mi-gym')).toBe(false);
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

```bash
cd apps/web && pnpm test src/lib/sesion.spec.ts
```

Esperado: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar la lectura de sesión**

Crear `apps/web/src/lib/sesion.ts`:

```ts
import { cookies } from 'next/headers';
import { COOKIE_ACCESS, COOKIE_REFRESH, COOKIE_SLUG } from './cookies';

export interface Sesion {
  access: string | undefined;
  refresh?: string | undefined;
  slug: string | undefined;
}

/** Lee la sesion de las cookies. Solo tiene sentido en el servidor. */
export async function leerSesion(): Promise<Sesion> {
  const almacen = await cookies();

  return {
    access: almacen.get(COOKIE_ACCESS)?.value,
    refresh: almacen.get(COOKIE_REFRESH)?.value,
    slug: almacen.get(COOKIE_SLUG)?.value,
  };
}

/**
 * Funcion pura, separada de la lectura de cookies para poder probarla.
 *
 * La comprobacion del slug NO es paranoia: las cookies son del dominio pero los
 * tokens son de un gimnasio, asi que sin esto alguien logueado en /gym-a/ que
 * abriera /gym-b/calendario veria los datos de A bajo la URL de B.
 */
export function sesionValidaPara(sesion: Sesion, slugDeLaUrl: string): boolean {
  if (!sesion.access) return false;
  if (!sesion.slug) return false;

  return sesion.slug === slugDeLaUrl;
}
```

- [ ] **Step 4: Ejecutar y ver pasar**

```bash
cd apps/web && pnpm test src/lib/sesion.spec.ts
```

Esperado: PASS, 4 tests.

- [ ] **Step 5: Escribir la ruta de login**

Crear `apps/web/src/app/api/auth/login/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { urlDeApi } from '@/lib/api-url';
import {
  COOKIE_ACCESS,
  COOKIE_REFRESH,
  COOKIE_SLUG,
  VIDA_ACCESS,
  VIDA_REFRESH,
  opcionesDeCookie,
} from '@/lib/cookies';

/**
 * Login.
 *
 * Es uno de los tres unicos sitios de toda la aplicacion donde los tokens
 * existen como texto, y de aqui pasan directamente a cookies httpOnly. La
 * respuesta que ve el navegador lleva el usuario y NO lleva los tokens: si los
 * llevara, el JavaScript de la pagina podria leerlos y todo el diseño de la D3
 * del spec no serviria de nada.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const cuerpo = (await req.json()) as { tenantSlug?: string };

  const respuesta = await fetch(urlDeApi(['auth', 'login'], ''), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
    cache: 'no-store',
  });

  const datos = (await respuesta.json()) as {
    accessToken?: string;
    refreshToken?: string;
    usuario?: unknown;
    message?: string;
  };

  if (!respuesta.ok || !datos.accessToken || !datos.refreshToken) {
    return NextResponse.json(
      { message: datos.message ?? 'No se pudo iniciar sesion' },
      { status: respuesta.status === 200 ? 502 : respuesta.status },
    );
  }

  const salida = NextResponse.json({ usuario: datos.usuario });
  salida.cookies.set(COOKIE_ACCESS, datos.accessToken, opcionesDeCookie(VIDA_ACCESS));
  salida.cookies.set(COOKIE_REFRESH, datos.refreshToken, opcionesDeCookie(VIDA_REFRESH));
  salida.cookies.set(COOKIE_SLUG, cuerpo.tenantSlug ?? '', opcionesDeCookie(VIDA_REFRESH));

  return salida;
}

export const dynamic = 'force-dynamic';
```

- [ ] **Step 6: Escribir la ruta de auto-registro**

Crear `apps/web/src/app/api/auth/auto-registro/route.ts` con **el mismo cuerpo que el login**,
cambiando únicamente:

- la llamada a `urlDeApi(['auth', 'auto-registro'], '')`,
- el mensaje de error por `'No se pudo completar el registro'`,
- y el `status` de la respuesta correcta por `201`:

```ts
  const salida = NextResponse.json({ usuario: datos.usuario }, { status: 201 });
```

Se repite en vez de factorizarse a propósito: son dos endpoints con contratos distintos que hoy
coinciden, y un helper compartido invitaría a que un cambio en uno se colara en el otro.

- [ ] **Step 7: Escribir la ruta de logout**

Crear `apps/web/src/app/api/auth/logout/route.ts`:

```ts
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { urlDeApi } from '@/lib/api-url';
import { COOKIE_ACCESS, COOKIE_REFRESH, borrarCookiesDeSesion } from '@/lib/cookies';

/**
 * Cierra la sesion.
 *
 * Avisa a la API para que revoque el refresh token —si no, seguiria sirviendo
 * aunque el navegador ya no lo tenga— y borra las cookies pase lo que pase.
 * Un logout que falla a medias y deja al usuario "dentro" es peor que uno que
 * no revoca: al menos aqui el navegador queda limpio.
 */
export async function POST(): Promise<NextResponse> {
  const almacen = await cookies();
  const access = almacen.get(COOKIE_ACCESS)?.value;
  const refresh = almacen.get(COOKIE_REFRESH)?.value;

  if (access && refresh) {
    try {
      await fetch(urlDeApi(['auth', 'logout'], ''), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` },
        body: JSON.stringify({ refreshToken: refresh }),
        cache: 'no-store',
      });
    } catch {
      // La API puede estar caida y el alumno sigue teniendo derecho a salir.
    }
  }

  const salida = NextResponse.json({ ok: true });
  borrarCookiesDeSesion(salida.cookies);
  return salida;
}

export const dynamic = 'force-dynamic';
```

- [ ] **Step 8: Verificar**

```bash
cd apps/web && pnpm typecheck && pnpm test && pnpm build 2>&1 | tail -12
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/web/src/**/*.ts"
```

Esperado: todo limpio, y el build lista las cuatro rutas de `/api`.

- [ ] **Step 9: Probar el ciclo real contra la API**

Un test unitario no prueba que las cookies lleguen bien. Levanta las dos y compruébalo:

```bash
docker compose up -d postgres postgres-test redis
cd apps/api && (pnpm start:dev &) && sleep 40
cd ../web && (pnpm dev &) && sleep 20
```

Crea un gimnasio y un admin con la API (mismo flujo que el README), y luego:

```bash
curl -s -i -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"tenantSlug":"TU_SLUG","email":"admin@TU_SLUG.io","password":"Password123!"}' \
  | grep -i "set-cookie\|HTTP/"
```

Esperado: tres `Set-Cookie` (`bx_access`, `bx_refresh`, `bx_slug`), **los tres con `HttpOnly`**.

Y comprueba que el cuerpo **no** filtra los tokens:

```bash
curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"tenantSlug":"TU_SLUG","email":"admin@TU_SLUG.io","password":"Password123!"}' \
  | grep -c "accessToken" || echo "SIN TOKENS EN EL CUERPO (correcto)"
```

Esperado: `SIN TOKENS EN EL CUERPO (correcto)`.

Mata las dos **por PID**.

**Mensaje de commit sugerido para Cesar:**

```
feat(web): rutas de sesion del BFF

Login, auto-registro y logout. Son los tres unicos sitios donde los tokens
existen como texto, y de ahi pasan a cookies httpOnly; la respuesta al
navegador nunca los lleva. La cookie del slug es lo que impide ver los datos
de un gimnasio bajo la URL de otro.
```

---
## Task 6: El cliente de datos

Una función `pedir()` y los hooks de TanStack Query. A partir de aquí, ninguna pantalla vuelve a
escribir un `fetch`.

**Files:**
- Crear: `apps/web/src/lib/cliente.ts`
- Crear: `apps/web/src/lib/query.tsx`
- Crear: `apps/web/src/hooks/use-calendario.ts`
- Modificar: `apps/web/src/app/layout.tsx`
- Test: `apps/web/src/lib/cliente.spec.ts`

- [ ] **Step 1: Escribir los tests del cliente**

Crear `apps/web/src/lib/cliente.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorDeApi, pedir } from './cliente';

afterEach(() => {
  vi.unstubAllGlobals();
});

function respuestaFalsa(cuerpo: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('pedir', () => {
  it('llama al proxy, no a la API directamente', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuestaFalsa([{ id: 'x' }]));
    vi.stubGlobal('fetch', fetchFalso);

    await pedir('/mi-calendario?desde=2099-10-01&hasta=2099-10-31');

    // Si esto apuntara a la API, el navegador tendria que mandar el token, y
    // todo el diseño de cookies httpOnly no serviria de nada.
    expect(fetchFalso.mock.calls[0][0]).toBe(
      '/api/bx/mi-calendario?desde=2099-10-01&hasta=2099-10-31',
    );
  });

  it('nunca manda cabecera de autorizacion', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuestaFalsa([]));
    vi.stubGlobal('fetch', fetchFalso);

    await pedir('/mi-calendario');

    const cabeceras = new Headers(fetchFalso.mock.calls[0][1]?.headers);
    expect(cabeceras.get('authorization')).toBeNull();
  });

  it('devuelve el JSON parseado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuestaFalsa([{ id: 'turno-1' }])));

    const datos = await pedir<{ id: string }[]>('/mi-calendario');

    expect(datos).toEqual([{ id: 'turno-1' }]);
  });

  it('manda el cuerpo como JSON en un POST', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuestaFalsa({ id: 'r1' }, { status: 201 }));
    vi.stubGlobal('fetch', fetchFalso);

    await pedir('/comprobantes', { metodo: 'POST', cuerpo: { tipoMime: 'application/pdf' } });

    const opciones = fetchFalso.mock.calls[0][1];
    expect(opciones.method).toBe('POST');
    expect(JSON.parse(opciones.body)).toEqual({ tipoMime: 'application/pdf' });
  });

  it('un error de la API llega como ErrorDeApi con su mensaje y su estado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respuestaFalsa(
          { message: 'Este turno esta completo (1/1).', statusCode: 409 },
          { status: 409 },
        ),
      ),
    );

    // El mensaje de la API es el que ve el alumno: se escribio para el, y
    // sustituirlo por uno generico seria tirar informacion util.
    await expect(pedir('/turnos/t1/mi-reserva', { metodo: 'POST' })).rejects.toMatchObject({
      name: 'ErrorDeApi',
      estado: 409,
      message: 'Este turno esta completo (1/1).',
    });
  });

  it('un 204 no intenta parsear cuerpo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(pedir('/lista-espera/le-1', { metodo: 'DELETE' })).resolves.toBeNull();
  });

  it('sin red, el error dice que no hay conexion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    // Es lo que ve el alumno offline al intentar reservar (decision D6 del
    // spec): un mensaje claro, no un fallo silencioso.
    await expect(pedir('/turnos/t1/mi-reserva', { metodo: 'POST' })).rejects.toMatchObject({
      name: 'ErrorDeApi',
      estado: 0,
    });
    await expect(pedir('/turnos/t1/mi-reserva', { metodo: 'POST' })).rejects.toThrow(/conexion/i);
  });

  it('un 401 se distingue, para poder mandar al login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respuestaFalsa({ message: 'Sin sesion' }, { status: 401 })),
    );

    await expect(pedir('/mi-calendario')).rejects.toMatchObject({ estado: 401 });
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

```bash
cd apps/web && pnpm test src/lib/cliente.spec.ts
```

Esperado: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar el cliente**

Crear `apps/web/src/lib/cliente.ts`:

```ts
/**
 * El unico fetch del navegador en toda la aplicacion.
 *
 * Siempre contra `/api/bx`, nunca contra la API directamente: el token vive en
 * una cookie httpOnly que este codigo no puede leer, y es el proxy del servidor
 * quien lo añade. Si alguna pantalla llamara a la API por su cuenta, tendria
 * que llevar el token consigo y todo el diseño se vendria abajo.
 */

export class ErrorDeApi extends Error {
  /** El codigo HTTP. `0` cuando la peticion no llego a salir (sin red). */
  readonly estado: number;

  constructor(mensaje: string, estado: number) {
    super(mensaje);
    this.name = 'ErrorDeApi';
    this.estado = estado;
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
    // alumno sin conexion intentando reservar (decision D6 del spec).
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

    throw new ErrorDeApi(mensaje, respuesta.status);
  }

  return datos as T;
}
```

- [ ] **Step 4: Ejecutar y ver pasar**

```bash
cd apps/web && pnpm test src/lib/cliente.spec.ts
```

Esperado: PASS, 8 tests.

- [ ] **Step 5: Montar TanStack Query**

Crear `apps/web/src/lib/query.tsx`:

```tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ErrorDeApi } from './cliente';

/**
 * El cliente se crea DENTRO de un useState y no como constante de modulo.
 *
 * Con una constante, todos los usuarios de un mismo proceso de servidor
 * compartirian cache — es decir, un alumno podria ver datos de otro. Es el
 * error clasico de montar React Query en Next, y el sitio donde se paga es
 * imposible de reproducir en desarrollo con un solo usuario.
 */
export function ProveedorDeDatos({ children }: { children: ReactNode }) {
  const [cliente] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Un calendario de hace medio minuto sigue siendo util, y evita
            // recargar entero cada vez que el alumno cambia de pestaña.
            staleTime: 30_000,
            retry: (intentos, error) => {
              // Reintentar un 401 o un 403 no los va a arreglar, y reintentar
              // sin red solo retrasa el mensaje que el alumno necesita ver.
              if (error instanceof ErrorDeApi) {
                if (error.esSinConexion) return false;
                if (error.estado >= 400 && error.estado < 500) return false;
              }
              return intentos < 2;
            },
          },
          mutations: { retry: false },
        },
      }),
  );

  return <QueryClientProvider client={cliente}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 6: Colgar el proveedor del layout raíz**

En `apps/web/src/app/layout.tsx`, envolver `{children}` con `<ProveedorDeDatos>` y dejar el `<html
lang="es">`:

```tsx
import type { Metadata } from 'next';
import { ProveedorDeDatos } from '@/lib/query';
import './globals.css';

export const metadata: Metadata = {
  title: 'BoxAdmin',
  description: 'Tus clases, en tu bolsillo.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <ProveedorDeDatos>{children}</ProveedorDeDatos>
      </body>
    </html>
  );
}
```

- [ ] **Step 7: Escribir los hooks de lectura**

Crear `apps/web/src/hooks/use-calendario.ts`:

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import type { MiClase, MiPackPublico, TurnoDisponible } from '@boxadmin/shared';
import { pedir } from '@/lib/cliente';

/**
 * Las claves de cache, en un solo sitio.
 *
 * Tenerlas centralizadas es lo que permite invalidar con precision desde las
 * mutaciones: una clave escrita a mano en dos archivos se desincroniza y
 * aparece como "la pantalla no se actualiza al reservar".
 */
export const claves = {
  misClases: (desde: string, hasta: string) => ['mis-clases', desde, hasta] as const,
  turnosDisponibles: (desde: string, hasta: string) =>
    ['turnos-disponibles', desde, hasta] as const,
  miPack: () => ['mi-pack'] as const,
  comprobantes: () => ['comprobantes'] as const,
};

export function useMisClases(desde: string, hasta: string) {
  return useQuery({
    queryKey: claves.misClases(desde, hasta),
    queryFn: () => pedir<MiClase[]>(`/mi-calendario?desde=${desde}&hasta=${hasta}`),
  });
}

export function useTurnosDisponibles(desde: string, hasta: string) {
  return useQuery({
    queryKey: claves.turnosDisponibles(desde, hasta),
    queryFn: () => pedir<TurnoDisponible[]>(`/turnos-disponibles?desde=${desde}&hasta=${hasta}`),
  });
}

export function useMiPack() {
  return useQuery({
    queryKey: claves.miPack(),
    queryFn: () => pedir<MiPackPublico>('/mi-pack'),
  });
}
```

- [ ] **Step 8: Verificar**

```bash
cd apps/web && pnpm typecheck && pnpm test && pnpm build 2>&1 | tail -10
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/web/src/**/*.{ts,tsx}"
```

Esperado: todo limpio.

**Mensaje de commit sugerido para Cesar:**

```
feat(web): cliente de datos y hooks de lectura

`pedir()` es el unico fetch del navegador y siempre va contra /api/bx: el token
esta en una cookie que este codigo no puede leer. Los mensajes de error de la
API se conservan tal cual, porque estan escritos para el alumno. El QueryClient
se crea dentro de useState, no como constante de modulo: con una constante, dos
alumnos del mismo proceso compartirian cache.
```

---

## Task 7: El área de alumno

El layout que exige sesión y slug coincidente, y la navegación.

**Files:**
- Crear: `apps/web/src/app/[slug]/(alumno)/layout.tsx`
- Crear: `apps/web/src/componentes/navegacion.tsx`
- Crear: `apps/web/src/componentes/ui.tsx`
- Test: `apps/web/src/componentes/ui.spec.tsx`

- [ ] **Step 1: Escribir los componentes básicos y su test**

Crear `apps/web/src/componentes/ui.spec.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Aviso, Boton } from './ui';

describe('Boton', () => {
  it('se desactiva y explica por que', () => {
    render(
      <Boton disabled title="Ya paso el plazo para anotarse">
        Reservar
      </Boton>,
    );

    const boton = screen.getByRole('button', { name: 'Reservar' });
    expect(boton).toBeDisabled();
    // Un boton apagado sin explicacion es el defecto que esta fase viene a
    // evitar: el `motivo` de la API existe justamente para poder decirlo.
    expect(boton).toHaveAttribute('title', 'Ya paso el plazo para anotarse');
  });

  it('muestra un estado de cargando accesible', () => {
    render(<Boton cargando>Reservar</Boton>);

    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('Aviso', () => {
  it('un error se anuncia a los lectores de pantalla', () => {
    render(<Aviso tono="error">No hay conexion</Aviso>);

    expect(screen.getByRole('alert')).toHaveTextContent('No hay conexion');
  });

  it('un aviso informativo no interrumpe', () => {
    render(<Aviso tono="info">Datos de hace 3 minutos</Aviso>);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Datos de hace 3 minutos')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

```bash
cd apps/web && pnpm test src/componentes/ui.spec.tsx
```

Esperado: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar los componentes**

Crear `apps/web/src/componentes/ui.tsx`:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type TonoDeBoton = 'primario' | 'secundario' | 'peligro';

const CLASES_DE_BOTON: Record<TonoDeBoton, string> = {
  primario: 'bg-slate-900 text-white hover:bg-slate-800',
  secundario: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
  peligro: 'bg-red-50 text-red-700 hover:bg-red-100',
};

interface PropsDeBoton extends ButtonHTMLAttributes<HTMLButtonElement> {
  tono?: TonoDeBoton;
  cargando?: boolean;
}

export function Boton({
  tono = 'primario',
  cargando = false,
  disabled,
  children,
  className = '',
  ...resto
}: PropsDeBoton) {
  return (
    <button
      // `aria-busy` y no solo un spinner: un lector de pantalla tiene que poder
      // saber que la accion esta en curso.
      aria-busy={cargando}
      disabled={disabled === true || cargando}
      className={
        `rounded-lg px-4 py-2 text-sm font-medium transition ` +
        `disabled:cursor-not-allowed disabled:opacity-50 ` +
        `${CLASES_DE_BOTON[tono]} ${className}`
      }
      {...resto}
    >
      {children}
    </button>
  );
}

type TonoDeAviso = 'info' | 'error' | 'exito';

const CLASES_DE_AVISO: Record<TonoDeAviso, string> = {
  info: 'bg-slate-50 text-slate-700 border-slate-200',
  error: 'bg-red-50 text-red-800 border-red-200',
  exito: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};

export function Aviso({ tono = 'info', children }: { tono?: TonoDeAviso; children: ReactNode }) {
  return (
    <div
      // Solo los errores usan `role="alert"`: ese rol interrumpe al lector de
      // pantalla, y hacerlo por un "datos de hace 3 minutos" seria ruido.
      role={tono === 'error' ? 'alert' : undefined}
      className={`rounded-lg border px-3 py-2 text-sm ${CLASES_DE_AVISO[tono]}`}
    >
      {children}
    </div>
  );
}

export function Tarjeta({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">{children}</div>;
}
```

- [ ] **Step 4: Ejecutar y ver pasar**

```bash
cd apps/web && pnpm test src/componentes/ui.spec.tsx
```

Esperado: PASS, 4 tests.

- [ ] **Step 5: Escribir el layout protegido**

Crear `apps/web/src/app/[slug]/(alumno)/layout.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { leerSesion, sesionValidaPara } from '@/lib/sesion';
import { Navegacion } from '@/componentes/navegacion';

/**
 * Puerta del area de alumno.
 *
 * Corre en el servidor y lee las cookies httpOnly, asi que la comprobacion no
 * se puede saltar desde el navegador. La segunda parte —que el slug de la URL
 * coincida con el de la sesion— es la que impide ver los datos de un gimnasio
 * bajo la URL de otro: el JWT lleva su propio tenantId y la API responderia
 * tan tranquila con los datos del gimnasio del token.
 */
export default async function LayoutDeAlumno({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sesion = await leerSesion();

  if (!sesionValidaPara(sesion, slug)) {
    redirect(`/${slug}/login`);
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col bg-slate-50">
      <main className="flex-1 p-4 pb-24">{children}</main>
      <Navegacion slug={slug} />
    </div>
  );
}
```

- [ ] **Step 6: Escribir la navegación**

Crear `apps/web/src/componentes/navegacion.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECCIONES = [
  { ruta: 'calendario', texto: 'Calendario' },
  { ruta: 'mi-pack', texto: 'Mi pack' },
  { ruta: 'comprobantes', texto: 'Pagos' },
  { ruta: 'perfil', texto: 'Perfil' },
] as const;

/**
 * Barra inferior fija, no lateral: esta aplicacion se usa desde el telefono,
 * de pie y con una mano.
 */
export function Navegacion({ slug }: { slug: string }) {
  const rutaActual = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 mx-auto flex w-full max-w-2xl border-t border-slate-200 bg-white">
      {SECCIONES.map((seccion) => {
        const href = `/${slug}/${seccion.ruta}`;
        const activa = rutaActual === href;

        return (
          <Link
            key={seccion.ruta}
            href={href}
            aria-current={activa ? 'page' : undefined}
            className={
              `flex-1 py-3 text-center text-xs font-medium ` +
              (activa ? 'text-slate-900' : 'text-slate-400')
            }
          >
            {seccion.texto}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 7: Verificar**

```bash
cd apps/web && pnpm typecheck && pnpm test && pnpm build 2>&1 | tail -10
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/web/src/**/*.{ts,tsx}"
```

Esperado: todo limpio.

**Mensaje de commit sugerido para Cesar:**

```
feat(web): area de alumno con su puerta

El layout corre en el servidor y lee las cookies httpOnly, asi que la
comprobacion no se puede saltar desde el navegador. Ademas exige que el slug de
la URL coincida con el de la sesion: sin eso, el JWT respondria con los datos de
su gimnasio bajo la URL de otro. Navegacion inferior, que es como se usa un
telefono.
```

---

## Task 8: Login y registro

Las dos pantallas públicas.

**Files:**
- Crear: `apps/web/src/app/[slug]/(publico)/login/page.tsx`
- Crear: `apps/web/src/app/[slug]/(publico)/registro/page.tsx`
- Crear: `apps/web/src/componentes/formulario.tsx`
- Test: `apps/web/src/app/[slug]/(publico)/registro/registro.spec.tsx`

- [ ] **Step 1: Escribir el test del formulario de registro**

Crear `apps/web/src/app/[slug]/(publico)/registro/registro.spec.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormularioDeRegistro } from './formulario-de-registro';

afterEach(() => {
  vi.unstubAllGlobals();
});

function rellenar() {
  return {
    nombre: screen.getByLabelText(/nombre/i),
    email: screen.getByLabelText(/email/i),
    codigo: screen.getByLabelText(/clave/i),
    password: screen.getByLabelText(/contrase/i),
    enviar: screen.getByRole('button', { name: /crear mi cuenta/i }),
  };
}

describe('FormularioDeRegistro', () => {
  it('exige una clave de 32 caracteres antes de molestar al servidor', async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    const usuario = userEvent.setup();
    render(<FormularioDeRegistro slug="mi-gym" />);

    const campos = rellenar();
    await usuario.type(campos.nombre, 'Ana Perez');
    await usuario.type(campos.email, 'ana@ejemplo.com');
    await usuario.type(campos.codigo, 'corta');
    await usuario.type(campos.password, 'Password123!');
    await usuario.click(campos.enviar);

    expect(await screen.findByText(/32 caracteres/i)).toBeInTheDocument();
    // Validar en el cliente no sustituye a la API: le ahorra al alumno un viaje
    // y un 401 que no explica nada.
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('manda el slug de la URL, que el alumno no escribe', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ usuario: { id: 'u1' } }), { status: 201 }));
    vi.stubGlobal('fetch', fetchFalso);
    const usuario = userEvent.setup();
    render(<FormularioDeRegistro slug="mi-gym" />);

    const campos = rellenar();
    await usuario.type(campos.nombre, 'Ana Perez');
    await usuario.type(campos.email, 'ana@ejemplo.com');
    await usuario.type(campos.codigo, 'a'.repeat(32));
    await usuario.type(campos.password, 'Password123!');
    await usuario.click(campos.enviar);

    await waitFor(() => expect(fetchFalso).toHaveBeenCalled());
    const cuerpo = JSON.parse(fetchFalso.mock.calls[0][1].body);
    expect(cuerpo.tenantSlug).toBe('mi-gym');
    expect(cuerpo).not.toHaveProperty('rol');
  });

  it('muestra el error de la API tal cual', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Clave de invitacion invalida' }), { status: 401 }),
      ),
    );
    const usuario = userEvent.setup();
    render(<FormularioDeRegistro slug="mi-gym" />);

    const campos = rellenar();
    await usuario.type(campos.nombre, 'Ana Perez');
    await usuario.type(campos.email, 'ana@ejemplo.com');
    await usuario.type(campos.codigo, 'a'.repeat(32));
    await usuario.type(campos.password, 'Password123!');
    await usuario.click(campos.enviar);

    expect(await screen.findByRole('alert')).toHaveTextContent('Clave de invitacion invalida');
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

```bash
cd apps/web && pnpm test src/app
```

Esperado: FAIL — no existe el módulo.

- [ ] **Step 3: Escribir los campos de formulario**

Crear `apps/web/src/componentes/formulario.tsx`:

```tsx
import type { InputHTMLAttributes } from 'react';

interface PropsDeCampo extends InputHTMLAttributes<HTMLInputElement> {
  etiqueta: string;
  error?: string | undefined;
}

export function Campo({ etiqueta, error, id, ...resto }: PropsDeCampo) {
  const idCampo = id ?? etiqueta.toLowerCase().replace(/\s+/g, '-');
  const idError = `${idCampo}-error`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={idCampo} className="text-sm font-medium text-slate-700">
        {etiqueta}
      </label>
      <input
        id={idCampo}
        // `aria-describedby` y `aria-invalid` son lo que hace que un lector de
        // pantalla lea el error junto al campo, en vez de dejarlo suelto.
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : idError}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        {...resto}
      />
      {error !== undefined && (
        <p id={idError} className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Escribir el formulario de registro**

Crear `apps/web/src/app/[slug]/(publico)/registro/formulario-de-registro.tsx`:

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Aviso, Boton } from '@/componentes/ui';
import { Campo } from '@/componentes/formulario';

/**
 * El esquema refleja el DTO de la API, no lo sustituye.
 *
 * Validar aqui le ahorra al alumno un viaje y un 401 que no explica nada — la
 * API devuelve el mismo mensaje para las cuatro formas de clave invalida, a
 * proposito, asi que "tu codigo tiene 5 caracteres" solo se lo puede decir el
 * cliente.
 */
const esquema = z.object({
  nombreCompleto: z.string().min(1, 'Hace falta tu nombre').max(120),
  email: z.string().email('Ese email no parece valido'),
  codigo: z.string().length(32, 'La clave tiene 32 caracteres'),
  password: z.string().min(8, 'Al menos 8 caracteres').max(128),
});

type Datos = z.infer<typeof esquema>;

export function FormularioDeRegistro({ slug }: { slug: string }) {
  const router = useRouter();
  const [errorDeApi, setErrorDeApi] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Datos>({ resolver: zodResolver(esquema) });

  async function enviar(datos: Datos) {
    setErrorDeApi(null);

    const respuesta = await fetch('/api/auth/auto-registro', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // El slug sale de la URL: el alumno no tiene por que saber que existe.
      body: JSON.stringify({ ...datos, tenantSlug: slug }),
    });

    if (!respuesta.ok) {
      const cuerpo = (await respuesta.json()) as { message?: string };
      setErrorDeApi(cuerpo.message ?? 'No se pudo completar el registro');
      return;
    }

    router.push(`/${slug}/calendario`);
  }

  return (
    <form onSubmit={handleSubmit(enviar)} className="flex flex-col gap-4" noValidate>
      {errorDeApi !== null && <Aviso tono="error">{errorDeApi}</Aviso>}

      <Campo etiqueta="Nombre completo" error={errors.nombreCompleto?.message} {...register('nombreCompleto')} />
      <Campo etiqueta="Email" type="email" error={errors.email?.message} {...register('email')} />
      <Campo
        etiqueta="Clave de invitacion"
        error={errors.codigo?.message}
        placeholder="La que te dio tu gimnasio"
        {...register('codigo')}
      />
      <Campo
        etiqueta="Contrasena"
        type="password"
        error={errors.password?.message}
        {...register('password')}
      />

      <Boton type="submit" cargando={isSubmitting}>
        Crear mi cuenta
      </Boton>
    </form>
  );
}
```

- [ ] **Step 5: Escribir la página que lo envuelve**

Crear `apps/web/src/app/[slug]/(publico)/registro/page.tsx`:

```tsx
import Link from 'next/link';
import { FormularioDeRegistro } from './formulario-de-registro';

export default async function PaginaDeRegistro({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">Crear tu cuenta</h1>
      <FormularioDeRegistro slug={slug} />
      <p className="text-sm text-slate-500">
        ¿Ya tenes cuenta?{' '}
        <Link href={`/${slug}/login`} className="font-medium text-slate-900 underline">
          Entrar
        </Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 6: Escribir el login**

Crear `apps/web/src/app/[slug]/(publico)/login/formulario-de-login.tsx` con la misma forma que el
registro, con el esquema `{ email, password }`, llamando a `/api/auth/login`, y con el botón
`Entrar`. Y `apps/web/src/app/[slug]/(publico)/login/page.tsx` igual que la de registro, con el
enlace apuntando a `/${slug}/registro` y el texto "¿No tenes cuenta?".

- [ ] **Step 7: Ejecutar los tests y verlos pasar**

```bash
cd apps/web && pnpm test
```

Esperado: PASS, incluidos los 3 del registro.

- [ ] **Step 8: Verificar**

```bash
cd apps/web && pnpm typecheck && pnpm build 2>&1 | tail -10
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/web/src/**/*.{ts,tsx}"
```

**Mensaje de commit sugerido para Cesar:**

```
feat(web): pantallas de login y registro

Validacion con zod en el cliente que no sustituye a la de la API: le ahorra al
alumno un viaje y un mensaje que no explica nada, porque la API devuelve el
mismo 401 para las cuatro formas de clave invalida. El slug sale de la URL, no
lo escribe nadie. Los errores de la API se muestran tal cual.
```

---
## Task 9: El calendario (lectura)

La pantalla principal. Esta tarea solo muestra; reservar y cancelar llegan en la Task 10.

**Files:**
- Crear: `apps/web/src/lib/semana.ts`
- Crear: `apps/web/src/lib/textos-disponibilidad.ts`
- Crear: `apps/web/src/app/[slug]/(alumno)/calendario/page.tsx`
- Crear: `apps/web/src/app/[slug]/(alumno)/calendario/vista-de-semana.tsx`
- Test: `apps/web/src/lib/semana.spec.ts`
- Test: `apps/web/src/lib/textos-disponibilidad.spec.ts`

### La regla de esta pantalla

**El calendario no decide nada.** La API ya calculó `estado`, `puedeReservar` y `motivo`; aquí solo
se traducen a texto y a estados de botón. Si aparece un `if` que compara cupos o fechas en esta
pantalla, está duplicando una regla que ya vive en `calcularDisponibilidad`, y las dos copias se van
a separar.

- [ ] **Step 1: Escribir los tests de la semana**

Crear `apps/web/src/lib/semana.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { diasDeLaSemana, semanaDe, sumarSemanas } from './semana';

describe('semanaDe', () => {
  it('una semana va de lunes a domingo', () => {
    // El 2099-10-14 es miercoles.
    expect(semanaDe('2099-10-14')).toEqual({ desde: '2099-10-12', hasta: '2099-10-18' });
  });

  it('un lunes se queda en su sitio', () => {
    expect(semanaDe('2099-10-12')).toEqual({ desde: '2099-10-12', hasta: '2099-10-18' });
  });

  it('un domingo pertenece a la semana que TERMINA, no a la que empieza', () => {
    // Es la convencion europea, y la que espera cualquiera que mire un
    // calendario aqui. Con la semana empezando en domingo, el domingo saltaria
    // solo a la vista siguiente.
    expect(semanaDe('2099-10-18')).toEqual({ desde: '2099-10-12', hasta: '2099-10-18' });
  });

  it('cruza el cambio de mes sin romperse', () => {
    // El 2099-11-01 es domingo.
    expect(semanaDe('2099-11-01')).toEqual({ desde: '2099-10-26', hasta: '2099-11-01' });
  });

  it('cruza el cambio de año', () => {
    // El 2100-01-01 es viernes.
    expect(semanaDe('2100-01-01')).toEqual({ desde: '2099-12-28', hasta: '2100-01-03' });
  });
});

describe('sumarSemanas', () => {
  it('avanza siete dias', () => {
    expect(sumarSemanas('2099-10-14', 1)).toBe('2099-10-21');
  });

  it('retrocede siete dias', () => {
    expect(sumarSemanas('2099-10-14', -1)).toBe('2099-10-07');
  });
});

describe('diasDeLaSemana', () => {
  it('devuelve los siete dias en orden', () => {
    const dias = diasDeLaSemana('2099-10-12');

    expect(dias).toHaveLength(7);
    expect(dias[0]).toBe('2099-10-12');
    expect(dias[6]).toBe('2099-10-18');
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

```bash
cd apps/web && pnpm test src/lib/semana.spec.ts
```

Esperado: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar la aritmética de semanas**

Crear `apps/web/src/lib/semana.ts`:

```ts
import { aFechaISO, desdeFechaISO } from '@boxadmin/shared';

/**
 * Aritmetica de semanas, en UTC.
 *
 * Todo el sistema trata las fechas como UTC desde la Fase 1 —los turnos son
 * columnas `@db.Date` y las horas son cadenas "HH:MM"—, asi que mezclar aqui la
 * zona local del navegador haria que un alumno en otro huso viera la semana
 * corrida un dia.
 */

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export interface Semana {
  desde: string;
  hasta: string;
}

/** La semana (lunes a domingo) a la que pertenece una fecha. */
export function semanaDe(fecha: string): Semana {
  const dia = desdeFechaISO(fecha);
  // getUTCDay: 0 = domingo. Se convierte a "dias desde el lunes", donde el
  // domingo es 6 y no 0: sin esto, el domingo saltaria solo a la semana
  // siguiente.
  const desdeElLunes = (dia.getUTCDay() + 6) % 7;

  const lunes = new Date(dia.getTime() - desdeElLunes * MS_POR_DIA);
  const domingo = new Date(lunes.getTime() + 6 * MS_POR_DIA);

  return { desde: aFechaISO(lunes), hasta: aFechaISO(domingo) };
}

export function sumarSemanas(fecha: string, semanas: number): string {
  return aFechaISO(new Date(desdeFechaISO(fecha).getTime() + semanas * 7 * MS_POR_DIA));
}

/** Los siete dias de la semana que empieza en `lunes`, en orden. */
export function diasDeLaSemana(lunes: string): string[] {
  const inicio = desdeFechaISO(lunes);

  return Array.from({ length: 7 }, (_, i) => aFechaISO(new Date(inicio.getTime() + i * MS_POR_DIA)));
}
```

- [ ] **Step 4: Ejecutar y ver pasar**

```bash
cd apps/web && pnpm test src/lib/semana.spec.ts
```

Esperado: PASS, 8 tests.

- [ ] **Step 5: Escribir los tests de la traducción a texto**

Crear `apps/web/src/lib/textos-disponibilidad.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Disponibilidad } from '@boxadmin/shared';
import { accionDeTurno, textoDeDisponibilidad } from './textos-disponibilidad';

function disponibilidad(cambios: Partial<Disponibilidad> = {}): Disponibilidad {
  return {
    turnoId: 'turno-1',
    estado: 'LIBRE',
    cupo: 5,
    ocupados: 1,
    puedeReservar: true,
    motivo: null,
    enListaEspera: false,
    posicionEnLista: null,
    ...cambios,
  };
}

describe('accionDeTurno', () => {
  it('con cupo y permiso, ofrece reservar', () => {
    expect(accionDeTurno(disponibilidad())).toBe('reservar');
  });

  it('un turno en LISTA_ESPERA ofrece la cola, no un boton muerto', () => {
    // Punto del checklist del PDF: un turno lleno tiene que OFRECER la cola.
    expect(
      accionDeTurno(disponibilidad({ estado: 'LISTA_ESPERA', ocupados: 5, puedeReservar: false })),
    ).toBe('anotarme');
  });

  it('si ya esta en la cola, ofrece salirse', () => {
    expect(
      accionDeTurno(
        disponibilidad({
          estado: 'LISTA_ESPERA',
          puedeReservar: false,
          enListaEspera: true,
          posicionEnLista: 2,
        }),
      ),
    ).toBe('salirme');
  });

  it('si ya reservo, ofrece cancelar', () => {
    expect(
      accionDeTurno(disponibilidad({ puedeReservar: false, motivo: 'YA_RESERVADO' })),
    ).toBe('cancelar');
  });

  it('un turno LLENO no ofrece nada', () => {
    expect(
      accionDeTurno(disponibilidad({ estado: 'LLENO', ocupados: 5, puedeReservar: false })),
    ).toBe('ninguna');
  });

  it('fuera de ventana no ofrece nada', () => {
    expect(
      accionDeTurno(disponibilidad({ puedeReservar: false, motivo: 'VENTANA_CERRADA' })),
    ).toBe('ninguna');
  });
});

describe('textoDeDisponibilidad', () => {
  it.each([
    ['VENTANA_CERRADA', /plazo/i],
    ['SOLO_CUPOS_LIBERADOS', /liber/i],
    ['YA_RESERVADO', /ya .*reserva/i],
  ] as const)('el motivo %s se explica en castellano', (motivo, patron) => {
    expect(textoDeDisponibilidad(disponibilidad({ puedeReservar: false, motivo }))).toMatch(patron);
  });

  it('un turno lleno dice cuantos son', () => {
    expect(
      textoDeDisponibilidad(
        disponibilidad({ estado: 'LLENO', cupo: 5, ocupados: 5, puedeReservar: false }),
      ),
    ).toMatch(/5\s*\/\s*5/);
  });

  it('en lista de espera dice la posicion', () => {
    expect(
      textoDeDisponibilidad(
        disponibilidad({
          estado: 'LISTA_ESPERA',
          puedeReservar: false,
          enListaEspera: true,
          posicionEnLista: 3,
        }),
      ),
    ).toMatch(/3/);
  });

  it('un turno libre dice cuantos lugares quedan', () => {
    expect(textoDeDisponibilidad(disponibilidad({ cupo: 5, ocupados: 2 }))).toMatch(/3/);
  });

  // Red de seguridad: si la API añadiera un motivo nuevo, no puede salir un
  // hueco en blanco en la pantalla.
  it('nunca devuelve una cadena vacia', () => {
    for (const estado of ['LIBRE', 'SOLO_ADMIN', 'LISTA_ESPERA', 'LLENO'] as const) {
      expect(textoDeDisponibilidad(disponibilidad({ estado })).length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 6: Ejecutar y ver fallar**

```bash
cd apps/web && pnpm test src/lib/textos-disponibilidad.spec.ts
```

Esperado: FAIL — no existe el módulo.

- [ ] **Step 7: Implementar la traducción**

Crear `apps/web/src/lib/textos-disponibilidad.ts`:

```ts
import type { Disponibilidad } from '@boxadmin/shared';

/**
 * Traduce el estado consolidado de la API a lo que ve el alumno.
 *
 * Aqui NO se decide nada: `calcularDisponibilidad` ya resolvio el estado, el
 * permiso y el motivo en el servidor (y con la misma funcion que corre aqui, si
 * hiciera falta). Este archivo solo pone palabras.
 *
 * Si alguna vez aparece un `if` comparando cupos o fechas en esta pantalla, esta
 * duplicando una regla que ya vive en @boxadmin/shared, y las dos copias se van
 * a separar.
 */

export type AccionDeTurno = 'reservar' | 'cancelar' | 'anotarme' | 'salirme' | 'ninguna';

export function accionDeTurno(d: Disponibilidad): AccionDeTurno {
  if (d.motivo === 'YA_RESERVADO') return 'cancelar';
  if (d.enListaEspera) return 'salirme';
  if (d.puedeReservar) return 'reservar';
  // Solo se ofrece la cola cuando el turno esta en LISTA_ESPERA Y no hay otro
  // impedimento: sin acceso a la sala o fuera de ventana, anotarse fallaria.
  if (d.estado === 'LISTA_ESPERA' && d.motivo === null) return 'anotarme';

  return 'ninguna';
}

export function textoDeDisponibilidad(d: Disponibilidad): string {
  if (d.enListaEspera) {
    return `Estas en la lista de espera, en el puesto ${d.posicionEnLista ?? '?'}`;
  }

  switch (d.motivo) {
    case 'YA_RESERVADO':
      return 'Ya tenes tu lugar reservado';
    case 'VENTANA_CERRADA':
      return 'Ya paso el plazo para anotarse';
    case 'SOLO_CUPOS_LIBERADOS':
      return 'Solo se pueden tomar lugares liberados, y todavia no se libero ninguno';
    case 'SIN_ACCESO_A_SALA':
    case 'SALA_NO_VISIBLE':
      return 'No tenes acceso a esta sala';
    case 'MES_NO_PUBLICADO':
      return 'Este mes todavia no esta abierto';
    case null:
      break;
  }

  switch (d.estado) {
    case 'LIBRE':
      return `Quedan ${Math.max(0, d.cupo - d.ocupados)} lugares`;
    case 'LISTA_ESPERA':
      return `Completo (${d.ocupados}/${d.cupo}). Podes anotarte en la lista de espera`;
    case 'LLENO':
      return `Completo (${d.ocupados}/${d.cupo})`;
    case 'SOLO_ADMIN':
      return 'Solo el salon puede asignar este lugar';
  }
}
```

- [ ] **Step 8: Ejecutar y ver pasar**

```bash
cd apps/web && pnpm test src/lib/textos-disponibilidad.spec.ts
```

Esperado: PASS, 11 tests.

- [ ] **Step 9: Escribir la vista de semana**

Crear `apps/web/src/app/[slug]/(alumno)/calendario/vista-de-semana.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { MiClase, TurnoDisponible } from '@boxadmin/shared';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { useMisClases, useTurnosDisponibles } from '@/hooks/use-calendario';
import { diasDeLaSemana, semanaDe, sumarSemanas } from '@/lib/semana';
import { accionDeTurno, textoDeDisponibilidad } from '@/lib/textos-disponibilidad';

const NOMBRES_DE_DIA = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo'];

function hoyEnIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function VistaDeSemana() {
  const [ancla, setAncla] = useState(hoyEnIso);
  const { desde, hasta } = semanaDe(ancla);

  const disponibles = useTurnosDisponibles(desde, hasta);
  const misClases = useMisClases(desde, hasta);

  const reservadoPorTurno = new Map<string, MiClase>(
    (misClases.data ?? []).map((clase) => [clase.turnoId, clase]),
  );

  const porDia = new Map<string, TurnoDisponible[]>();
  for (const turno of disponibles.data ?? []) {
    porDia.set(turno.fecha, [...(porDia.get(turno.fecha) ?? []), turno]);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <Boton tono="secundario" onClick={() => setAncla(sumarSemanas(ancla, -1))}>
          ← Anterior
        </Boton>
        <p className="text-sm font-medium text-slate-700">
          {desde} a {hasta}
        </p>
        <Boton tono="secundario" onClick={() => setAncla(sumarSemanas(ancla, 1))}>
          Siguiente →
        </Boton>
      </header>

      {disponibles.isError && (
        <Aviso tono="error">
          {disponibles.error instanceof Error
            ? disponibles.error.message
            : 'No se pudo cargar el calendario'}
        </Aviso>
      )}

      {disponibles.isPending && <p className="text-sm text-slate-500">Cargando tu semana…</p>}

      {diasDeLaSemana(desde).map((fecha, indice) => {
        const turnos = porDia.get(fecha) ?? [];

        return (
          <section key={fecha} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-slate-900">
              {NOMBRES_DE_DIA[indice]} {fecha.slice(8)}
            </h2>

            {turnos.length === 0 ? (
              <p className="text-sm text-slate-400">Sin clases</p>
            ) : (
              turnos.map((turno) => (
                <FilaDeTurno
                  key={turno.turnoId}
                  turno={turno}
                  reserva={reservadoPorTurno.get(turno.turnoId)}
                />
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}

function FilaDeTurno({ turno, reserva }: { turno: TurnoDisponible; reserva: MiClase | undefined }) {
  const accion = accionDeTurno(turno.disponibilidad);
  const explicacion = textoDeDisponibilidad(turno.disponibilidad);

  return (
    <Tarjeta>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-slate-900">
            {turno.horaInicio}–{turno.horaFin} · {turno.nombre}
          </p>
          <p className="text-xs text-slate-500">{explicacion}</p>
        </div>

        {/* Los botones llegan en la Task 10; aqui solo se ve el estado. */}
        {accion === 'ninguna' && <span className="text-xs text-slate-400">Sin acciones</span>}
        {accion !== 'ninguna' && (
          <span className="text-xs font-medium text-slate-600" data-accion={accion}>
            {accion}
          </span>
        )}
      </div>

      {reserva !== undefined && !reserva.puedeCancelar && (
        <p className="mt-2 text-xs text-amber-700">Ya no se puede cancelar esta clase</p>
      )}
    </Tarjeta>
  );
}
```

- [ ] **Step 10: Escribir la página**

Crear `apps/web/src/app/[slug]/(alumno)/calendario/page.tsx`:

```tsx
import { VistaDeSemana } from './vista-de-semana';

export default function PaginaDeCalendario() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-slate-900">Tu semana</h1>
      <VistaDeSemana />
    </div>
  );
}
```

- [ ] **Step 11: Verificar**

```bash
cd apps/web && pnpm typecheck && pnpm test && pnpm build 2>&1 | tail -10
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/web/src/**/*.{ts,tsx}"
```

Esperado: todo limpio.

**Mensaje de commit sugerido para Cesar:**

```
feat(web): calendario semanal del alumno

La pantalla no decide nada: la API ya resolvio estado, permiso y motivo, y aqui
solo se traducen a texto. Un turno lleno con lista de espera OFRECE la cola en
vez de quedarse apagado sin explicacion. Aritmetica de semanas en UTC, como
todo el sistema desde la Fase 1, con el domingo cerrando la semana.
```

---

## Task 10: Reservar, cancelar y hacer cola

Las mutaciones, con actualización optimista. El PDF pide esto por su nombre.

**Files:**
- Crear: `apps/web/src/hooks/use-acciones-de-turno.ts`
- Modificar: `apps/web/src/app/[slug]/(alumno)/calendario/vista-de-semana.tsx`
- Test: `apps/web/src/hooks/use-acciones-de-turno.spec.tsx`

### Por qué el rollback no es opcional

Actualizar la interfaz antes de que responda el servidor es lo que hace que la aplicación se sienta
instantánea. Pero reservar **puede fallar**: por cupo, por ventana, por pack. Una interfaz que se
quedara mostrando una reserva que no existe sería peor que una lenta — el alumno se presentaría a una
clase en la que no está anotado.

- [ ] **Step 1: Escribir los tests**

Crear `apps/web/src/hooks/use-acciones-de-turno.spec.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { TurnoDisponible } from '@boxadmin/shared';
import { claves } from './use-calendario';
import { useAccionesDeTurno } from './use-acciones-de-turno';

const DESDE = '2099-10-12';
const HASTA = '2099-10-18';

const TURNO: TurnoDisponible = {
  turnoId: 'turno-1',
  salaId: 'sala-1',
  nombre: 'Pilates',
  fecha: '2099-10-13',
  horaInicio: '18:00',
  horaFin: '19:00',
  disponibilidad: {
    turnoId: 'turno-1',
    estado: 'LIBRE',
    cupo: 5,
    ocupados: 1,
    puedeReservar: true,
    motivo: null,
    enListaEspera: false,
    posicionEnLista: null,
  },
};

function montar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  cliente.setQueryData(claves.turnosDisponibles(DESDE, HASTA), [TURNO]);

  const envoltorio = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cliente}>{children}</QueryClientProvider>
  );

  const hook = renderHook(() => useAccionesDeTurno(DESDE, HASTA), { wrapper: envoltorio });

  return { cliente, hook };
}

function turnoEnCache(cliente: QueryClient): TurnoDisponible {
  const lista = cliente.getQueryData<TurnoDisponible[]>(claves.turnosDisponibles(DESDE, HASTA));
  return lista![0]!;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useAccionesDeTurno — reservar', () => {
  it('marca el turno como reservado ANTES de que responda el servidor', async () => {
    let resolver: (r: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise<Response>((r) => (resolver = r))),
    );
    const { cliente, hook } = montar();

    hook.result.current.reservar.mutate('turno-1');

    // Es todo el objetivo del optimismo: la interfaz responde ya.
    await waitFor(() => {
      expect(turnoEnCache(cliente).disponibilidad.motivo).toBe('YA_RESERVADO');
    });
    expect(turnoEnCache(cliente).disponibilidad.ocupados).toBe(2);

    resolver(new Response(JSON.stringify({ id: 'r1' }), { status: 201 }));
  });

  it('REVIERTE si la API rechaza la reserva', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ message: 'Este turno esta completo (5/5).' }), {
            status: 409,
          }),
        ),
    );
    const { cliente, hook } = montar();

    hook.result.current.reservar.mutate('turno-1');

    await waitFor(() => expect(hook.result.current.reservar.isError).toBe(true));

    // Dejar la reserva pintada seria mandar al alumno a una clase en la que no
    // esta anotado. Peor que una interfaz lenta.
    expect(turnoEnCache(cliente).disponibilidad.motivo).toBeNull();
    expect(turnoEnCache(cliente).disponibilidad.ocupados).toBe(1);
  });

  it('conserva el mensaje de la API para poder mostrarlo', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ message: 'Ya paso el plazo para anotarse.' }), {
            status: 409,
          }),
        ),
    );
    const { hook } = montar();

    hook.result.current.reservar.mutate('turno-1');

    await waitFor(() => expect(hook.result.current.reservar.isError).toBe(true));
    expect(hook.result.current.reservar.error?.message).toBe('Ya paso el plazo para anotarse.');
  });

  it('llama al endpoint correcto', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'r1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchFalso);
    const { hook } = montar();

    hook.result.current.reservar.mutate('turno-1');

    await waitFor(() => expect(hook.result.current.reservar.isSuccess).toBe(true));
    expect(fetchFalso.mock.calls[0][0]).toBe('/api/bx/turnos/turno-1/mi-reserva');
    expect(fetchFalso.mock.calls[0][1].method).toBe('POST');
  });
});

describe('useAccionesDeTurno — lista de espera', () => {
  it('marca la cola de forma optimista y revierte si falla', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ message: 'Este turno tiene cupo' }), { status: 409 }),
        ),
    );
    const { cliente, hook } = montar();

    hook.result.current.anotarme.mutate('turno-1');

    await waitFor(() => expect(hook.result.current.anotarme.isError).toBe(true));
    expect(turnoEnCache(cliente).disponibilidad.enListaEspera).toBe(false);
  });
});

describe('useAccionesDeTurno — sin conexion', () => {
  it('el error dice que falta conexion y la interfaz vuelve atras', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { cliente, hook } = montar();

    hook.result.current.reservar.mutate('turno-1');

    await waitFor(() => expect(hook.result.current.reservar.isError).toBe(true));
    // Decision D6 del spec: offline se lee, no se escribe, y se dice.
    expect(hook.result.current.reservar.error?.message).toMatch(/conexion/i);
    expect(turnoEnCache(cliente).disponibilidad.motivo).toBeNull();
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

```bash
cd apps/web && pnpm test src/hooks/use-acciones-de-turno.spec.tsx
```

Esperado: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar las mutaciones**

Crear `apps/web/src/hooks/use-acciones-de-turno.ts`:

```ts
'use client';

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Disponibilidad, TurnoDisponible } from '@boxadmin/shared';
import { ErrorDeApi, pedir } from '@/lib/cliente';
import { claves } from './use-calendario';

/**
 * Aplica un cambio a la disponibilidad de UN turno dentro de la cache, sin
 * mutar nada: React Query compara por referencia para decidir si repintar.
 */
function parchearTurno(
  cliente: QueryClient,
  desde: string,
  hasta: string,
  turnoId: string,
  cambio: (d: Disponibilidad) => Disponibilidad,
): void {
  cliente.setQueryData<TurnoDisponible[]>(claves.turnosDisponibles(desde, hasta), (lista) =>
    (lista ?? []).map((turno) =>
      turno.turnoId === turnoId
        ? { ...turno, disponibilidad: cambio(turno.disponibilidad) }
        : turno,
    ),
  );
}

interface ContextoDeReversion {
  anterior: TurnoDisponible[] | undefined;
}

/**
 * Reservar, cancelar y lista de espera, con actualizacion optimista.
 *
 * El PDF pide el optimismo por su nombre: es donde TurnoFit se siente pesado.
 * Pero la parte que de verdad importa es el ROLLBACK. Reservar puede fallar por
 * cupo, por ventana o por pack, y una interfaz que se quedara mostrando una
 * reserva inexistente mandaria al alumno a una clase en la que no esta anotado
 * — peor que una interfaz lenta.
 *
 * Por eso cada mutacion guarda la lista anterior entera en `onMutate` y la
 * restaura en `onError`, y por eso todas invalidan en `onSettled`: el estado
 * real lo tiene el servidor.
 */
export function useAccionesDeTurno(desde: string, hasta: string) {
  const cliente = useQueryClient();
  const clave = claves.turnosDisponibles(desde, hasta);

  function preparar(): ContextoDeReversion {
    return { anterior: cliente.getQueryData<TurnoDisponible[]>(clave) };
  }

  function revertir(contexto: ContextoDeReversion | undefined): void {
    if (contexto?.anterior !== undefined) cliente.setQueryData(clave, contexto.anterior);
  }

  async function refrescar(): Promise<void> {
    await Promise.all([
      cliente.invalidateQueries({ queryKey: clave }),
      cliente.invalidateQueries({ queryKey: claves.misClases(desde, hasta) }),
      // Una reserva cambia el consumo del pack, y esa pantalla es otra.
      cliente.invalidateQueries({ queryKey: claves.miPack() }),
    ]);
  }

  const reservar = useMutation<unknown, ErrorDeApi, string, ContextoDeReversion>({
    mutationFn: (turnoId) => pedir(`/turnos/${turnoId}/mi-reserva`, { metodo: 'POST' }),
    onMutate: async (turnoId) => {
      await cliente.cancelQueries({ queryKey: clave });
      const contexto = preparar();

      parchearTurno(cliente, desde, hasta, turnoId, (d) => ({
        ...d,
        ocupados: d.ocupados + 1,
        puedeReservar: false,
        motivo: 'YA_RESERVADO',
      }));

      return contexto;
    },
    onError: (_error, _turnoId, contexto) => revertir(contexto),
    onSettled: refrescar,
  });

  const cancelar = useMutation<unknown, ErrorDeApi, { turnoId: string; reservaId: string }, ContextoDeReversion>({
    mutationFn: ({ reservaId }) => pedir(`/mis-reservas/${reservaId}`, { metodo: 'DELETE' }),
    onMutate: async ({ turnoId }) => {
      await cliente.cancelQueries({ queryKey: clave });
      const contexto = preparar();

      parchearTurno(cliente, desde, hasta, turnoId, (d) => ({
        ...d,
        ocupados: Math.max(0, d.ocupados - 1),
        puedeReservar: true,
        motivo: null,
      }));

      return contexto;
    },
    onError: (_error, _variables, contexto) => revertir(contexto),
    onSettled: refrescar,
  });

  const anotarme = useMutation<unknown, ErrorDeApi, string, ContextoDeReversion>({
    mutationFn: (turnoId) => pedir(`/turnos/${turnoId}/lista-espera`, { metodo: 'POST' }),
    onMutate: async (turnoId) => {
      await cliente.cancelQueries({ queryKey: clave });
      const contexto = preparar();

      parchearTurno(cliente, desde, hasta, turnoId, (d) => ({
        ...d,
        enListaEspera: true,
        // La posicion real la decide el servidor; mostrar una inventada seria
        // mentir sobre algo que el alumno va a comparar con la realidad.
        posicionEnLista: null,
      }));

      return contexto;
    },
    onError: (_error, _turnoId, contexto) => revertir(contexto),
    onSettled: refrescar,
  });

  const salirme = useMutation<unknown, ErrorDeApi, { turnoId: string; entradaId: string }, ContextoDeReversion>({
    mutationFn: ({ entradaId }) => pedir(`/lista-espera/${entradaId}`, { metodo: 'DELETE' }),
    onMutate: async ({ turnoId }) => {
      await cliente.cancelQueries({ queryKey: clave });
      const contexto = preparar();

      parchearTurno(cliente, desde, hasta, turnoId, (d) => ({
        ...d,
        enListaEspera: false,
        posicionEnLista: null,
      }));

      return contexto;
    },
    onError: (_error, _variables, contexto) => revertir(contexto),
    onSettled: refrescar,
  });

  return { reservar, cancelar, anotarme, salirme };
}
```

- [ ] **Step 4: Ejecutar y ver pasar**

```bash
cd apps/web && pnpm test src/hooks/use-acciones-de-turno.spec.tsx
```

Esperado: PASS, 6 tests.

- [ ] **Step 5: Prueba de mutación — comprobar que el rollback está probado**

Comenta el cuerpo de `revertir` (déjala vacía) y vuelve a correr.

```bash
cd apps/web && pnpm test src/hooks/use-acciones-de-turno.spec.tsx
```

Esperado: **FAIL** en "REVIERTE si la API rechaza la reserva", en el de lista de espera y en el de
sin conexión. Si pasaran en verde, el rollback no está probado. **Revierte** el cambio.

- [ ] **Step 6: Conectar los botones**

En `vista-de-semana.tsx`, dentro de `VistaDeSemana` y justo después de calcular `desde`/`hasta`:

```tsx
  const acciones = useAccionesDeTurno(desde, hasta);
```

Cambiar la firma de `FilaDeTurno` para que reciba las acciones, y la llamada que la usa:

```tsx
function FilaDeTurno({
  turno,
  reserva,
  acciones,
}: {
  turno: TurnoDisponible;
  reserva: MiClase | undefined;
  acciones: ReturnType<typeof useAccionesDeTurno>;
}) {
```

```tsx
                <FilaDeTurno
                  key={turno.turnoId}
                  turno={turno}
                  reserva={reservadoPorTurno.get(turno.turnoId)}
                  acciones={acciones}
                />
```

Y reemplazar el bloque que hoy solo muestra el nombre de la acción por botones reales:

```tsx
        {accion === 'reservar' && (
          <Boton
            cargando={acciones.reservar.isPending}
            onClick={() => acciones.reservar.mutate(turno.turnoId)}
          >
            Reservar
          </Boton>
        )}
        {accion === 'cancelar' && reserva !== undefined && (
          <Boton
            tono="peligro"
            disabled={!reserva.puedeCancelar}
            title={reserva.puedeCancelar ? undefined : 'Ya paso el plazo para cancelar'}
            cargando={acciones.cancelar.isPending}
            onClick={() =>
              acciones.cancelar.mutate({ turnoId: turno.turnoId, reservaId: reserva.reservaId })
            }
          >
            Cancelar
          </Boton>
        )}
        {accion === 'anotarme' && (
          <Boton
            tono="secundario"
            cargando={acciones.anotarme.isPending}
            onClick={() => acciones.anotarme.mutate(turno.turnoId)}
          >
            Lista de espera
          </Boton>
        )}
        {accion === 'ninguna' && <span className="text-xs text-slate-400">Sin acciones</span>}
```

Y mostrar el error de la última mutación que fallara, encima de la lista:

```tsx
      {[acciones.reservar, acciones.cancelar, acciones.anotarme, acciones.salirme]
        .filter((m) => m.isError)
        .slice(0, 1)
        .map((m, i) => (
          <Aviso key={i} tono="error">
            {m.error?.message ?? 'No se pudo completar la accion'}
          </Aviso>
        ))}
```

**La acción `salirme` necesita el id de la entrada en la cola**, que `TurnoDisponible` no trae — la
API expone `enListaEspera` y `posicionEnLista`, pero no el id. Por eso esta pantalla **no ofrece
salirse de la cola**: se hace desde la pantalla del turno cuando exista, o se añade el id al contrato
en una fase futura. Déjalo anotado como desviación en el tracker; `salirme` queda escrito y probado
para cuando el dato esté.

- [ ] **Step 7: Verificar**

```bash
cd apps/web && pnpm typecheck && pnpm test && pnpm build 2>&1 | tail -10
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/web/src/**/*.{ts,tsx}"
```

**Mensaje de commit sugerido para Cesar:**

```
feat(web): reservar, cancelar y lista de espera con optimismo

La interfaz responde antes que el servidor, que es lo que pedia el PDF. Lo que
de verdad importa es el rollback: reservar puede fallar por cupo, ventana o
pack, y dejar pintada una reserva inexistente mandaria al alumno a una clase en
la que no esta anotado. Verificado por mutacion: sin revertir(), tres tests
caen.
```

---
## Task 11: La pantalla del pack

Corta, y con una regla de negocio que hay que respetar al mostrarla.

**Files:**
- Crear: `apps/web/src/app/[slug]/(alumno)/mi-pack/page.tsx`
- Crear: `apps/web/src/app/[slug]/(alumno)/mi-pack/resumen-del-pack.tsx`
- Test: `apps/web/src/app/[slug]/(alumno)/mi-pack/resumen-del-pack.spec.tsx`

- [ ] **Step 1: Escribir los tests**

Crear `apps/web/src/app/[slug]/(alumno)/mi-pack/resumen-del-pack.spec.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MiPackPublico } from '@boxadmin/shared';
import { ResumenDelPack } from './resumen-del-pack';

function pack(cambios: Partial<MiPackPublico> = {}): MiPackPublico {
  return {
    pack: {
      id: 'pack-1',
      tenantId: 'gym-1',
      nombre: '8 clases',
      salaId: null,
      tipo: 'MENSUAL',
      precio: null,
      clasesPorMes: 8,
      clasesTotales: null,
      cancelacionesPermitidas: 2,
      activo: true,
    },
    tope: 8,
    consumidas: 3,
    restantes: 5,
    ventanaDesde: '2099-10-01',
    ventanaHasta: '2099-10-31',
    clasesExtra: 0,
    cancelacionesUsadas: 1,
    cancelacionesPermitidas: 2,
    pagoAlDia: true,
    vigenciaDesde: null,
    vigenciaHasta: null,
    ...cambios,
  };
}

describe('ResumenDelPack', () => {
  it('muestra el consumo y lo que queda', () => {
    render(<ResumenDelPack datos={pack()} />);

    expect(screen.getByText(/8 clases/)).toBeInTheDocument();
    expect(screen.getByText(/3 de 8/)).toBeInTheDocument();
    expect(screen.getByText(/quedan 5/i)).toBeInTheDocument();
  });

  it('pasarse del pack se avisa, no se presenta como un error', () => {
    render(<ResumenDelPack datos={pack({ consumidas: 10, restantes: 0 })} />);

    // Decision D3 de la Fase 1, que el backend mantiene: el pack avisa, no
    // bloquea. Un alumno con 10 de 8 tiene un estado real y legitimo, y la
    // pantalla no puede tratarlo como una falla.
    expect(screen.getByText(/10 de 8/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sin pack lo dice, en vez de mostrar ceros', () => {
    render(<ResumenDelPack datos={pack({ pack: null, tope: null, restantes: null })} />);

    // "0 de 0" sugeriria que se gastaron todas las clases. No es lo mismo no
    // tener pack que haberlo agotado.
    expect(screen.getByText(/todavia no tenes un pack/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 de 0/)).toBeNull();
  });

  it('un pago pendiente se ve', () => {
    render(<ResumenDelPack datos={pack({ pagoAlDia: false })} />);

    expect(screen.getByText(/pendiente/i)).toBeInTheDocument();
  });

  it('muestra el periodo sobre el que se cuenta', () => {
    render(<ResumenDelPack datos={pack()} />);

    // Sin el periodo, "3 de 8" no se puede interpretar: el alumno no sabe si
    // son de este mes o de todo el año.
    expect(screen.getByText(/2099-10-01/)).toBeInTheDocument();
    expect(screen.getByText(/2099-10-31/)).toBeInTheDocument();
  });

  it('las cancelaciones se muestran cuando el pack las limita', () => {
    render(<ResumenDelPack datos={pack()} />);

    expect(screen.getByText(/1 de 2/)).toBeInTheDocument();
  });

  it('sin limite de cancelaciones, no se inventa uno', () => {
    render(<ResumenDelPack datos={pack({ cancelacionesPermitidas: null })} />);

    expect(screen.queryByText(/de null/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

```bash
cd apps/web && pnpm test src/app/\\[slug\\]
```

Esperado: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar el resumen**

Crear `apps/web/src/app/[slug]/(alumno)/mi-pack/resumen-del-pack.tsx`:

```tsx
import type { MiPackPublico } from '@boxadmin/shared';
import { Aviso, Tarjeta } from '@/componentes/ui';

export function ResumenDelPack({ datos }: { datos: MiPackPublico }) {
  if (datos.pack === null) {
    return (
      <Tarjeta>
        <p className="text-sm text-slate-700">
          Todavia no tenes un pack asignado. Hablalo con tu gimnasio.
        </p>
      </Tarjeta>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Tarjeta>
        <h2 className="text-lg font-semibold text-slate-900">{datos.pack.nombre}</h2>

        <p className="mt-2 text-sm text-slate-700">
          Llevas{' '}
          <strong>
            {datos.consumidas} de {datos.tope ?? '∞'}
          </strong>{' '}
          clases
          {datos.restantes !== null && <> · quedan {datos.restantes}</>}
        </p>

        {/* Sin el periodo, "3 de 8" no se puede interpretar: podrian ser de
            este mes o de todo el año. */}
        {datos.ventanaDesde !== null && datos.ventanaHasta !== null && (
          <p className="mt-1 text-xs text-slate-500">
            Periodo: {datos.ventanaDesde} a {datos.ventanaHasta}
          </p>
        )}

        {datos.clasesExtra > 0 && (
          <p className="mt-1 text-xs text-slate-500">
            Incluye {datos.clasesExtra} clases extra que te dio el salon
          </p>
        )}
      </Tarjeta>

      <Tarjeta>
        <p className="text-sm text-slate-700">
          Cancelaciones usadas:{' '}
          <strong>
            {datos.cancelacionesUsadas}
            {datos.cancelacionesPermitidas !== null && <> de {datos.cancelacionesPermitidas}</>}
          </strong>
        </p>
      </Tarjeta>

      {/* `Aviso` con tono info y no error: un pago pendiente es un recordatorio,
          no un fallo del que haya que alarmar con role="alert". */}
      <Aviso tono={datos.pagoAlDia ? 'exito' : 'info'}>
        {datos.pagoAlDia ? 'Tu pago esta al dia' : 'Tenes un pago pendiente'}
      </Aviso>
    </div>
  );
}
```

- [ ] **Step 4: Escribir la página**

Crear `apps/web/src/app/[slug]/(alumno)/mi-pack/page.tsx`:

```tsx
'use client';

import { Aviso } from '@/componentes/ui';
import { useMiPack } from '@/hooks/use-calendario';
import { ResumenDelPack } from './resumen-del-pack';

export default function PaginaDeMiPack() {
  const { data, isPending, isError, error } = useMiPack();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-slate-900">Tu pack</h1>

      {isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {isError && (
        <Aviso tono="error">
          {error instanceof Error ? error.message : 'No se pudo cargar tu pack'}
        </Aviso>
      )}
      {data !== undefined && <ResumenDelPack datos={data} />}
    </div>
  );
}
```

- [ ] **Step 5: Verificar**

```bash
cd apps/web && pnpm typecheck && pnpm test && pnpm build 2>&1 | tail -8
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/web/src/**/*.{ts,tsx}"
```

Esperado: PASS, 7 tests nuevos.

**Mensaje de commit sugerido para Cesar:**

```
feat(web): pantalla del pack

Muestra el periodo junto al consumo, porque "3 de 8" sin periodo no se puede
interpretar. Pasarse del pack se muestra como el estado legitimo que es
(decision D3 de la Fase 1: avisa, no bloquea), y no tener pack se dice con
palabras en vez de con un "0 de 0" que sugeriria haberlas gastado.
```

---

## Task 12: Comprobantes

El flujo de tres pasos, desde el navegador. La parte interesante es que **el segundo paso no pasa por
el BFF**.

**Files:**
- Crear: `apps/web/src/hooks/use-comprobantes.ts`
- Crear: `apps/web/src/app/[slug]/(alumno)/comprobantes/page.tsx`
- Crear: `apps/web/src/app/[slug]/(alumno)/comprobantes/subir-comprobante.tsx`
- Test: `apps/web/src/hooks/use-comprobantes.spec.tsx`

### Los tres pasos, y por qué

1. `POST /comprobantes` → devuelve la fila y una **URL firmada**.
2. `PUT` del archivo **a esa URL**, directo del navegador al almacén. **No pasa por Next ni por la
   API**: es exactamente para lo que existen las URLs presignadas, y es el único punto de toda la
   aplicación donde el navegador habla con otro origen. Por eso la Task 2 habilitó CORS.
3. `PATCH /comprobantes/:id/confirmar` → marca `subidoEn`.

El tercero existe porque **ni S3 ni el adaptador local pueden avisar a la API** de que el `PUT`
terminó.

- [ ] **Step 1: Escribir los tests del flujo**

Crear `apps/web/src/hooks/use-comprobantes.spec.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useSubirComprobante } from './use-comprobantes';

function montar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cliente}>{children}</QueryClientProvider>
  );

  return renderHook(() => useSubirComprobante(), { wrapper: envoltorio });
}

function archivo(nombre = 'transferencia.pdf', tipo = 'application/pdf'): File {
  return new File([new Uint8Array([1, 2, 3])], nombre, { type: tipo });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSubirComprobante', () => {
  it('hace los tres pasos en orden', async () => {
    const llamadas: string[] = [];
    const fetchFalso = vi.fn().mockImplementation((url: string) => {
      llamadas.push(url);
      if (url === '/api/bx/comprobantes') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              comprobante: { id: 'comp-1' },
              urlDeSubida: 'http://localhost:3000/archivos-locales/abc.pdf?exp=1&firma=ff',
            }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(new Response(JSON.stringify({ id: 'comp-1' }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchFalso);

    const hook = montar();
    hook.result.current.mutate(archivo());

    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

    expect(llamadas).toEqual([
      '/api/bx/comprobantes',
      // El PUT va DIRECTO al almacen: ni por Next ni por la API. Es para lo que
      // existe la URL firmada.
      'http://localhost:3000/archivos-locales/abc.pdf?exp=1&firma=ff',
      '/api/bx/comprobantes/comp-1/confirmar',
    ]);
  });

  it('el PUT manda el archivo crudo, no un JSON ni un FormData', async () => {
    const fetchFalso = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        url === '/api/bx/comprobantes'
          ? new Response(
              JSON.stringify({
                comprobante: { id: 'comp-1' },
                urlDeSubida: 'http://almacen/x.pdf?firma=ff',
              }),
              { status: 201, headers: { 'content-type': 'application/json' } },
            )
          : new Response(JSON.stringify({ ok: true }), { status: 200 }),
      ),
    );
    vi.stubGlobal('fetch', fetchFalso);

    const hook = montar();
    hook.result.current.mutate(archivo());

    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

    const opcionesDelPut = fetchFalso.mock.calls[1][1];
    expect(opcionesDelPut.method).toBe('PUT');
    // La URL firmada se emitio para un Content-Type concreto; envolver el
    // archivo cambiaria los bytes y el almacen guardaria basura.
    expect(opcionesDelPut.body).toBeInstanceOf(File);
    expect(opcionesDelPut.headers['content-type']).toBe('application/pdf');
  });

  it('manda el nombre y el tipo reales del archivo', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ comprobante: { id: 'c1' }, urlDeSubida: 'http://almacen/x' }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchFalso);

    const hook = montar();
    hook.result.current.mutate(archivo('mi pago.png', 'image/png'));

    await waitFor(() => expect(fetchFalso).toHaveBeenCalled());
    expect(JSON.parse(fetchFalso.mock.calls[0][1].body)).toEqual({
      nombreOriginal: 'mi pago.png',
      tipoMime: 'image/png',
    });
  });

  it('si el PUT falla, NO confirma', async () => {
    const llamadas: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        llamadas.push(url);
        if (url === '/api/bx/comprobantes') {
          return Promise.resolve(
            new Response(
              JSON.stringify({ comprobante: { id: 'c1' }, urlDeSubida: 'http://almacen/x' }),
              { status: 201, headers: { 'content-type': 'application/json' } },
            ),
          );
        }
        return Promise.resolve(new Response('', { status: 403 }));
      }),
    );

    const hook = montar();
    hook.result.current.mutate(archivo());

    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    // Confirmar sin archivo dejaria al admin un comprobante que no se puede
    // abrir. La fila sin confirmar simplemente no le aparece.
    expect(llamadas).not.toContain('/api/bx/comprobantes/c1/confirmar');
  });

  it('rechaza un tipo no admitido antes de molestar al servidor', async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);

    const hook = montar();
    hook.result.current.mutate(archivo('virus.exe', 'application/x-msdownload'));

    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(hook.result.current.error?.message).toMatch(/PDF|imagen/i);
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

```bash
cd apps/web && pnpm test src/hooks/use-comprobantes.spec.tsx
```

Esperado: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar el flujo**

Crear `apps/web/src/hooks/use-comprobantes.ts`:

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ComprobanteCreado, ComprobantePublico } from '@boxadmin/shared';
import { ErrorDeApi, pedir } from '@/lib/cliente';
import { claves } from './use-calendario';

/**
 * Los mismos tipos que admite la API (lista blanca en ComprobantesService).
 * Validar aqui no sustituye a la validacion del servidor: le ahorra al alumno
 * subir diez megas para recibir un 409.
 */
const TIPOS_ADMITIDOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export function useComprobantes() {
  return useQuery({
    queryKey: claves.comprobantes(),
    queryFn: () => pedir<ComprobantePublico[]>('/comprobantes'),
  });
}

/**
 * La subida, en tres pasos.
 *
 * 1. `POST /comprobantes` crea la fila y devuelve una URL firmada.
 * 2. `PUT` del archivo A ESA URL, **directo del navegador al almacen**. No pasa
 *    por Next ni por la API: es exactamente para lo que existen las URLs
 *    presignadas, y es el unico punto de la aplicacion donde el navegador habla
 *    con otro origen (de ahi el CORS de la Task 2).
 * 3. `PATCH .../confirmar` marca que el archivo llego.
 *
 * El tercer paso existe porque ni S3 ni el adaptador local pueden avisar a la
 * API de que el PUT termino.
 */
export function useSubirComprobante() {
  const cliente = useQueryClient();

  return useMutation<ComprobantePublico, ErrorDeApi, File>({
    mutationFn: async (archivo) => {
      if (!TIPOS_ADMITIDOS.includes(archivo.type)) {
        throw new ErrorDeApi('Solo se aceptan PDF o imagenes (JPEG, PNG o WebP).', 0);
      }

      const creado = await pedir<ComprobanteCreado>('/comprobantes', {
        metodo: 'POST',
        cuerpo: { nombreOriginal: archivo.name, tipoMime: archivo.type },
      });

      let subida: Response;
      try {
        subida = await fetch(creado.urlDeSubida, {
          method: 'PUT',
          // El archivo crudo, sin envolver. La URL se firmo para este
          // Content-Type; un FormData cambiaria los bytes y el almacen
          // guardaria basura que despues no se puede abrir.
          headers: { 'content-type': archivo.type },
          body: archivo,
        });
      } catch {
        throw new ErrorDeApi('Sin conexion: no se pudo subir el archivo.', 0);
      }

      if (!subida.ok) {
        // Sin confirmar: la fila queda con `subidoEn` en null y no le aparece
        // al admin. Confirmarla le dejaria un comprobante que no se puede abrir.
        throw new ErrorDeApi(
          `No se pudo subir el archivo (${subida.status}). Volve a intentarlo.`,
          subida.status,
        );
      }

      return pedir<ComprobantePublico>(`/comprobantes/${creado.comprobante.id}/confirmar`, {
        metodo: 'PATCH',
      });
    },
    onSuccess: () => cliente.invalidateQueries({ queryKey: claves.comprobantes() }),
  });
}
```

- [ ] **Step 4: Ejecutar y ver pasar**

```bash
cd apps/web && pnpm test src/hooks/use-comprobantes.spec.tsx
```

Esperado: PASS, 5 tests.

- [ ] **Step 5: Escribir la pantalla**

Crear `apps/web/src/app/[slug]/(alumno)/comprobantes/subir-comprobante.tsx`:

```tsx
'use client';

import { useRef } from 'react';
import { Aviso, Boton } from '@/componentes/ui';
import { useSubirComprobante } from '@/hooks/use-comprobantes';

export function SubirComprobante() {
  const entrada = useRef<HTMLInputElement>(null);
  const subir = useSubirComprobante();

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={entrada}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        aria-label="Comprobante de pago"
        className="text-sm"
        onChange={(evento) => {
          const archivo = evento.target.files?.[0];
          if (archivo !== undefined) subir.mutate(archivo);
        }}
      />

      <Boton
        cargando={subir.isPending}
        tono="secundario"
        onClick={() => entrada.current?.click()}
      >
        Subir comprobante
      </Boton>

      {subir.isError && <Aviso tono="error">{subir.error.message}</Aviso>}
      {subir.isSuccess && <Aviso tono="exito">Comprobante subido. Queda pendiente de revision.</Aviso>}
    </div>
  );
}
```

Crear `apps/web/src/app/[slug]/(alumno)/comprobantes/page.tsx`:

```tsx
'use client';

import type { EstadoComprobante } from '@boxadmin/shared';
import { Aviso, Tarjeta } from '@/componentes/ui';
import { useComprobantes } from '@/hooks/use-comprobantes';
import { SubirComprobante } from './subir-comprobante';

const TEXTO_DE_ESTADO: Record<EstadoComprobante, string> = {
  PENDIENTE: 'Pendiente de revision',
  APROBADO: 'Aprobado',
  RECHAZADO: 'Rechazado',
};

export default function PaginaDeComprobantes() {
  const { data, isPending, isError, error } = useComprobantes();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-slate-900">Tus pagos</h1>

      <SubirComprobante />

      {isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {isError && (
        <Aviso tono="error">
          {error instanceof Error ? error.message : 'No se pudieron cargar tus comprobantes'}
        </Aviso>
      )}

      {data?.length === 0 && <p className="text-sm text-slate-500">Todavia no subiste ninguno.</p>}

      {(data ?? []).map((comprobante) => (
        <Tarjeta key={comprobante.id}>
          <p className="font-medium text-slate-900">{comprobante.nombreOriginal}</p>
          <p className="text-xs text-slate-500">
            {TEXTO_DE_ESTADO[comprobante.estado]}
            {comprobante.subidoEn === null && ' · sin terminar de subir'}
          </p>
          {comprobante.nota !== null && (
            <p className="mt-1 text-xs text-slate-700">Nota del salon: {comprobante.nota}</p>
          )}
        </Tarjeta>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Verificar**

```bash
cd apps/web && pnpm typecheck && pnpm test && pnpm build 2>&1 | tail -8
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/web/src/**/*.{ts,tsx}"
```

**Mensaje de commit sugerido para Cesar:**

```
feat(web): subida de comprobantes en tres pasos

El PUT va directo del navegador al almacen, que es para lo que existe la URL
firmada y el unico punto donde se habla con otro origen. El archivo va crudo:
envolverlo en FormData cambiaria los bytes y el almacen guardaria algo que no
se puede abrir. Si el PUT falla NO se confirma, asi la fila sin archivo no le
aparece al admin.
```

---

## Task 13: Perfil y cierre de sesión

**Files:**
- Crear: `apps/web/src/app/[slug]/(alumno)/perfil/page.tsx`
- Crear: `apps/web/src/app/[slug]/(alumno)/perfil/boton-de-salir.tsx`
- Test: `apps/web/src/app/[slug]/(alumno)/perfil/boton-de-salir.spec.tsx`

- [ ] **Step 1: Escribir el test**

Crear `apps/web/src/app/[slug]/(alumno)/perfil/boton-de-salir.spec.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BotonDeSalir } from './boton-de-salir';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

describe('BotonDeSalir', () => {
  it('llama al logout del BFF y vuelve al login del gimnasio', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetchFalso);
    const usuario = userEvent.setup();

    render(<BotonDeSalir slug="mi-gym" />);
    await usuario.click(screen.getByRole('button', { name: /cerrar sesion/i }));

    await waitFor(() => expect(fetchFalso).toHaveBeenCalledWith('/api/auth/logout', expect.anything()));
    expect(push).toHaveBeenCalledWith('/mi-gym/login');
  });

  it('si la API falla, IGUAL saca al alumno', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const usuario = userEvent.setup();

    render(<BotonDeSalir slug="mi-gym" />);
    await usuario.click(screen.getByRole('button', { name: /cerrar sesion/i }));

    // Un logout que deja al usuario "dentro" porque la red fallo es peor que
    // uno que no revoca: el navegador tiene que quedar limpio igual.
    await waitFor(() => expect(push).toHaveBeenCalledWith('/mi-gym/login'));
  });
});
```

- [ ] **Step 2: Ejecutar y ver fallar**

```bash
cd apps/web && pnpm test perfil
```

Esperado: FAIL — no existe el módulo.

- [ ] **Step 3: Implementar**

Crear `apps/web/src/app/[slug]/(alumno)/perfil/boton-de-salir.tsx`:

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Boton } from '@/componentes/ui';

export function BotonDeSalir({ slug }: { slug: string }) {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function salir() {
    setSaliendo(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // La API puede estar caida y el alumno sigue teniendo derecho a salir.
      // Un logout que lo deja "dentro" porque fallo la red es peor que uno que
      // no revoca: el navegador queda limpio igual.
    }
    router.push(`/${slug}/login`);
  }

  return (
    <Boton tono="peligro" cargando={saliendo} onClick={() => void salir()}>
      Cerrar sesion
    </Boton>
  );
}
```

Crear `apps/web/src/app/[slug]/(alumno)/perfil/page.tsx`:

```tsx
import { BotonDeSalir } from './boton-de-salir';

export default async function PaginaDePerfil({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-slate-900">Tu perfil</h1>
      <p className="text-sm text-slate-600">Gimnasio: {slug}</p>
      <BotonDeSalir slug={slug} />
    </div>
  );
}
```

- [ ] **Step 4: Verificar**

```bash
cd apps/web && pnpm typecheck && pnpm test && pnpm build 2>&1 | tail -8
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/web/src/**/*.{ts,tsx}"
```

**Mensaje de commit sugerido para Cesar:**

```
feat(web): perfil y cierre de sesion

El logout saca al alumno aunque la API no conteste: dejarlo "dentro" porque
fallo la red seria peor que no revocar el token.
```

---
## Task 14: Convertirla en PWA

Manifest, iconos, service worker y el aviso de datos viejos. Va al final a propósito: un service
worker cacheando durante trece tareas de desarrollo habría sido una fuente inagotable de confusión.

**Files:**
- Crear: `apps/web/public/manifest.json`
- Crear: `apps/web/scripts/generar-iconos.mjs`
- Crear: `apps/web/public/icono.svg`, `public/icono-192.png`, `public/icono-512.png`
- Crear: `apps/web/src/app/sw.ts`
- Modificar: `apps/web/next.config.mjs`
- Modificar: `apps/web/src/app/layout.tsx`
- Crear: `apps/web/src/componentes/aviso-offline.tsx`
- Test: `apps/web/src/componentes/aviso-offline.spec.tsx`

- [ ] **Step 1: Escribir el manifest**

Crear `apps/web/public/manifest.json`:

```json
{
  "name": "BoxAdmin",
  "short_name": "BoxAdmin",
  "description": "Tus clases, en tu bolsillo.",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f8fafc",
  "theme_color": "#0f172a",
  "icons": [
    { "src": "/icono-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icono-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icono-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`display: standalone` es lo que hace que, una vez instalada, se abra sin barra de direcciones. El
icono `maskable` es el que Android recorta a su forma; sin él, el icono sale dentro de un cuadrado
blanco.

- [ ] **Step 2: Generar los iconos**

**Esto no es cosmética.** Un manifest que apunta a iconos inexistentes **no hace la aplicación
instalable**, y Chrome no lo dice en voz alta: simplemente no ofrece instalar.

Crear `apps/web/public/icono.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0f172a"/>
  <rect x="112" y="216" width="288" height="80" rx="24" fill="#f8fafc"/>
  <rect x="72" y="176" width="64" height="160" rx="24" fill="#f8fafc"/>
  <rect x="376" y="176" width="64" height="160" rx="24" fill="#f8fafc"/>
</svg>
```

Crear `apps/web/scripts/generar-iconos.mjs`:

```js
/**
 * Rasteriza el SVG del icono a los PNG que exige el manifest.
 *
 * Los PNG SI se commitean, a diferencia del service worker: son fuente, no
 * artefacto de build, y sin ellos la aplicacion deja de ser instalable sin que
 * nada lo avise.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const raiz = resolve(import.meta.dirname, '..');
const svg = await readFile(resolve(raiz, 'public/icono.svg'));

for (const tamano of [192, 512]) {
  const png = await sharp(svg).resize(tamano, tamano).png().toBuffer();
  await writeFile(resolve(raiz, `public/icono-${tamano}.png`), png);
  console.log(`icono-${tamano}.png:`, png.length, 'bytes');
}
```

```bash
cd apps/web && pnpm add -D sharp && node scripts/generar-iconos.mjs
ls -la public/icono-*.png
```

Esperado: dos PNG de varios kilobytes cada uno. **Si alguno pesara menos de 500 bytes**, la
rasterización falló y el archivo está vacío.

Añadir a `apps/web/package.json`:

```json
    "iconos": "node scripts/generar-iconos.mjs"
```

- [ ] **Step 3: Escribir el service worker**

Crear `apps/web/src/app/sw.ts`.

⚠️ **La primera línea es obligatoria**, verificada en la Task 0: sin ella el bundle se genera pero el
chequeo de tipos del build falla con `Cannot find name 'ServiceWorkerGlobalScope'`, porque el
tsconfig de `create-next-app` no incluye `WebWorker` en su `lib`. Se arregla aquí y no en el `lib`
global para que `self` no parezca un worker en toda la aplicación.

```ts
/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { NetworkFirst, Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      /**
       * La UNICA regla de datos: el calendario del alumno.
       *
       * Es lo que pide el PDF ("funciona razonablemente offline para la vista
       * de mi calendario ya cacheada") y no hay razon para cachear mas.
       *
       * `NetworkFirst` con timeout corto: con red, datos frescos; sin red, lo
       * ultimo que se vio. Al reves —cache primero— el alumno veria su
       * calendario viejo aun teniendo conexion.
       */
      matcher: ({ url, request }) =>
        request.method === 'GET' && url.pathname.startsWith('/api/bx/mi-calendario'),
      handler: new NetworkFirst({
        cacheName: 'mi-calendario',
        networkTimeoutSeconds: 3,
      }),
    },
    // La carcasa: HTML, CSS, JS, fuentes e imagenes.
    ...defaultCache,
  ],
});

/**
 * Todo lo que NO sea leer el calendario se queda sin cachear, y eso es
 * deliberado (decision D6 del spec): sin red, reservar tiene que FALLAR con un
 * mensaje claro. Encolarlo para mas tarde haria que el alumno creyera tener
 * plaza en una clase cuyo cupo pudo agotarse mientras tanto.
 */

serwist.addEventListeners();
```

- [ ] **Step 4: Enchufar Serwist a Next**

Reemplazar `apps/web/next.config.mjs`:

```js
import withSerwistInit from '@serwist/next';

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  // En desarrollo el service worker sirve versiones viejas y vuelve loco el
  // ciclo de trabajo. Por eso Playwright corre contra el build de produccion:
  // probarlo contra `next dev` no probaria nada.
  disable: process.env.NODE_ENV === 'development',
});

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  transpilePackages: ['@boxadmin/shared'],
};

export default withSerwist(config);
```

- [ ] **Step 5: Enlazar el manifest desde el layout**

En `apps/web/src/app/layout.tsx`, ampliar `metadata` y añadir `viewport`:

```tsx
export const metadata: Metadata = {
  title: 'BoxAdmin',
  description: 'Tus clases, en tu bolsillo.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'BoxAdmin' },
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
  // `viewportFit: cover` para que la barra inferior no quede debajo del area
  // de gestos en los telefonos con muesca.
  viewportFit: 'cover',
};
```

Importando `type Viewport` de `next`.

- [ ] **Step 6: Escribir el test del aviso de datos viejos**

Crear `apps/web/src/componentes/aviso-offline.spec.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AvisoOffline, textoDeAntiguedad } from './aviso-offline';

afterEach(() => {
  vi.unstubAllGlobals();
});

function conConexion(online: boolean) {
  vi.stubGlobal('navigator', { ...globalThis.navigator, onLine: online });
}

describe('textoDeAntiguedad', () => {
  it('menos de un minuto se dice "hace instantes"', () => {
    expect(textoDeAntiguedad(30_000)).toMatch(/instantes/i);
  });

  it('los minutos se cuentan', () => {
    expect(textoDeAntiguedad(5 * 60_000)).toMatch(/5 minutos/);
  });

  it('a partir de una hora se cuentan horas', () => {
    expect(textoDeAntiguedad(3 * 60 * 60_000)).toMatch(/3 horas/);
  });

  it('un dia entero se dice en dias', () => {
    expect(textoDeAntiguedad(26 * 60 * 60_000)).toMatch(/1 dia/);
  });
});

describe('AvisoOffline', () => {
  it('con conexion no molesta', () => {
    conConexion(true);
    const { container } = render(<AvisoOffline actualizadoEn={Date.now() - 60_000} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('sin conexion dice de cuando son los datos', () => {
    conConexion(false);
    render(<AvisoOffline actualizadoEn={Date.now() - 5 * 60_000} />);

    // Un calendario viejo SIN fecha es peor que no tenerlo: el alumno no sabe
    // si puede fiarse.
    expect(screen.getByText(/5 minutos/)).toBeInTheDocument();
    expect(screen.getByText(/sin conexion/i)).toBeInTheDocument();
  });

  it('sin datos cacheados, lo dice en vez de inventar una fecha', () => {
    conConexion(false);
    render(<AvisoOffline actualizadoEn={0} />);

    expect(screen.getByText(/sin conexion/i)).toBeInTheDocument();
    expect(screen.queryByText(/hace/i)).toBeNull();
  });
});
```

- [ ] **Step 7: Implementar el aviso**

Crear `apps/web/src/componentes/aviso-offline.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Aviso } from './ui';

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

export function textoDeAntiguedad(milisegundos: number): string {
  if (milisegundos < MINUTO) return 'hace instantes';
  if (milisegundos < HORA) return `hace ${Math.floor(milisegundos / MINUTO)} minutos`;
  if (milisegundos < DIA) return `hace ${Math.floor(milisegundos / HORA)} horas`;

  const dias = Math.floor(milisegundos / DIA);
  return `hace ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

/**
 * Avisa de que lo que se ve es una copia cacheada, y de cuando se cargo.
 *
 * Un calendario viejo SIN fecha es peor que no tenerlo: el alumno no sabe si
 * puede fiarse de lo que ve para decidir si presentarse a una clase.
 *
 * `actualizadoEn` sale de `dataUpdatedAt` de React Query; `0` significa que
 * nunca se cargo nada.
 */
export function AvisoOffline({ actualizadoEn }: { actualizadoEn: number }) {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // El estado inicial se lee DENTRO del efecto: en el render del servidor no
    // existe `navigator`, y leerlo directo romperia la hidratacion.
    setOnline(navigator.onLine);

    const conectar = () => setOnline(true);
    const desconectar = () => setOnline(false);
    window.addEventListener('online', conectar);
    window.addEventListener('offline', desconectar);

    return () => {
      window.removeEventListener('online', conectar);
      window.removeEventListener('offline', desconectar);
    };
  }, []);

  if (online) return null;

  return (
    <Aviso tono="info">
      Sin conexion
      {actualizadoEn > 0 && <> · datos cargados {textoDeAntiguedad(Date.now() - actualizadoEn)}</>}
      . No vas a poder reservar ni cancelar hasta que vuelvas a tener red.
    </Aviso>
  );
}
```

- [ ] **Step 8: Mostrarlo en el calendario**

En `vista-de-semana.tsx`, justo debajo de la cabecera:

```tsx
      <AvisoOffline actualizadoEn={misClases.dataUpdatedAt} />
```

- [ ] **Step 9: Verificar el build y el service worker**

```bash
cd apps/web && pnpm test && pnpm typecheck && pnpm build 2>&1 | tail -15
ls -la public/sw.js && wc -c public/sw.js
```

Esperado: `public/sw.js` existe y pesa **decenas de kilobytes**. Si pesara cientos de bytes, algo
falló en silencio.

```bash
cd apps/web && (pnpm start &) && sleep 10
curl -s -o /dev/null -w "sw.js: %{http_code} %{content_type}\n" http://localhost:3001/sw.js
curl -s -o /dev/null -w "manifest: %{http_code} %{content_type}\n" http://localhost:3001/manifest.json
curl -s -o /dev/null -w "icono-192: %{http_code} %{content_type}\n" http://localhost:3001/icono-192.png
curl -s -o /dev/null -w "icono-512: %{http_code} %{content_type}\n" http://localhost:3001/icono-512.png
```

Esperado: los cuatro en `200`, con tipos `javascript`, `json` e `image/png`. **Un `text/html` en
cualquiera significa que Next está devolviendo un 404 disfrazado.**

Mata el servidor **por PID**.

- [ ] **Step 10: Comprobar que el service worker no se commitea**

```bash
cd /d/Dev/box-admin && git check-ignore -v apps/web/public/sw.js
git status --short apps/web/public/
```

Esperado: `sw.js` ignorado, y los PNG y el SVG **sí** sin seguir (son fuente y se commitean).

**Mensaje de commit sugerido para Cesar:**

```
feat(web): PWA instalable con Serwist

Manifest con iconos rasterizados desde un SVG: un manifest que apunta a iconos
inexistentes no hace la app instalable y Chrome no lo dice, simplemente no
ofrece instalar. Una sola regla de cache de datos, NetworkFirst sobre
mi-calendario: con red, datos frescos; sin red, lo ultimo que se vio, con un
aviso de cuando se cargo. Todo lo demas sin cachear, para que reservar offline
falle con un mensaje en vez de fingir que funciono.
```

---

## Task 15: Playwright

Los tres escenarios que jsdom no puede probar.

**Files:**
- Crear: `apps/web/playwright.config.ts`
- Crear: `apps/web/e2e/instalabilidad.spec.ts`
- Crear: `apps/web/e2e/offline.spec.ts`
- Crear: `apps/web/e2e/ciclo-del-alumno.spec.ts`
- Crear: `apps/web/e2e/preparar.ts`

### Lo que hace falta levantado

Playwright necesita **tres cosas a la vez**: Postgres y Redis, la API de Nest y el **build de
producción** del frontend. Lo tercero no es un detalle: el service worker no existe en desarrollo, así
que probarlo contra `next dev` no probaría nada.

⚠️ **Esa API comparte Redis con los e2e de la Fase 3A.** No se pueden correr los dos a la vez.

⚠️ **La API hay que arrancarla con el throttler aflojado**, o los tests fallan con **429** a mitad de
suite. Cada test crea su gimnasio con un login y un auto-registro, así que cinco tests son diez
llamadas de auth por minuto contra un límite de cinco. Es la misma trampa que `.env.test` resuelve
para los e2e del backend, aquí con la API de desarrollo:

```bash
cd apps/api && THROTTLE_AUTH_LIMIT=100000 THROTTLE_GENERAL_LIMIT=100000 pnpm start:dev
```

Funciona porque `common/throttling.ts` lee `process.env` directamente y `@nestjs/config` nunca pisa
una variable que ya existe.

⚠️ **Los fixtures NO pueden usar fechas de 2099**, a diferencia de los del backend. El calendario
abre en la semana de **hoy**, así que un turno en 2099 sencillamente no se ve y el test falla por un
motivo que no tiene nada que ver con lo que intenta probar. El fixture crea el turno **mañana**, y un
helper (`e2e/navegar.ts`) avanza de semana hasta encontrarlo — lo que además cubre el caso de que hoy
sea domingo, y de paso ejercita la navegación entre semanas.

⚠️ **Al volver de otra pantalla, el calendario se remonta y vuelve a abrir en la semana de hoy.** Si
un test navega a `mi-pack` y regresa, tiene que volver a buscar la semana del turno.

- [ ] **Step 1: Instalar los navegadores**

```bash
cd apps/web && pnpm exec playwright install chromium
```

Solo Chromium: es donde se puede comprobar la instalabilidad de una PWA, y bajar tres navegadores
para tres tests sería gastar por gastar.

- [ ] **Step 2: Configurar Playwright**

Crear `apps/web/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

const PUERTO_WEB = 3002;
const URL_WEB = `http://localhost:${PUERTO_WEB}`;

export default defineConfig({
  testDir: './e2e',
  // En serie: los tests comparten la misma base de datos y se pisarian.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: URL_WEB,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /**
   * El BUILD DE PRODUCCION, no `next dev`.
   *
   * El service worker esta desactivado en desarrollo (ver next.config.mjs), asi
   * que probar la PWA contra `next dev` no probaria nada de lo que esta fase
   * tiene que demostrar.
   *
   * Puerto 3002 y no 3001 para no chocar con un `pnpm web:dev` que este abierto.
   */
  webServer: {
    command: `pnpm build && pnpm exec next start --port ${PUERTO_WEB}`,
    url: URL_WEB,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      NODE_ENV: 'production',
      API_URL: process.env.API_URL ?? 'http://localhost:3000',
    },
  },
});
```

- [ ] **Step 3: Escribir el preparador de datos**

Crear `apps/web/e2e/preparar.ts`:

```ts
/**
 * Prepara un gimnasio con una sala, un turno publicado y una clave de
 * invitacion, llamando a la API — nunca escribiendo en la base directamente.
 *
 * Usar la API y no SQL no es purismo: si el alta cambiara de reglas, un seed
 * por SQL seguiria pasando mientras la aplicacion real se rompe.
 */
const API = process.env.API_URL ?? 'http://localhost:3000';
const BOOTSTRAP = process.env.BOOTSTRAP_KEY ?? 'changeme_bootstrap_key';

async function llamar<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const respuesta = await fetch(`${API}${ruta}`, {
    ...opciones,
    headers: { 'content-type': 'application/json', ...(opciones.headers ?? {}) },
  });

  if (!respuesta.ok) {
    throw new Error(`${ruta} devolvio ${respuesta.status}: ${await respuesta.text()}`);
  }

  return (await respuesta.json()) as T;
}

export interface GimnasioDePrueba {
  slug: string;
  adminToken: string;
  salaId: string;
  turnoId: string;
  codigo: string;
  anio: number;
  mes: number;
  fecha: string;
}

export async function prepararGimnasio(): Promise<GimnasioDePrueba> {
  const slug = `e2e${Date.now()}`;
  const anio = 2099;
  const mes = 10;
  const fecha = `${anio}-10-13`;

  await llamar(`/auth/tenants`, {
    method: 'POST',
    headers: { 'x-bootstrap-key': BOOTSTRAP },
    body: JSON.stringify({ nombre: slug, slug }),
  });

  await llamar(`/auth/register`, {
    method: 'POST',
    headers: { 'x-bootstrap-key': BOOTSTRAP },
    body: JSON.stringify({
      tenantSlug: slug,
      nombreCompleto: 'Admin',
      email: `admin@${slug}.io`,
      password: 'Password123!',
    }),
  });

  const login = await llamar<{ accessToken: string }>(`/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ tenantSlug: slug, email: `admin@${slug}.io`, password: 'Password123!' }),
  });
  const auth = { authorization: `Bearer ${login.accessToken}` };

  const sala = await llamar<{ id: string }>(`/salas`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ nombre: 'Sala A', cupoBase: 5 }),
  });

  const turno = await llamar<{ id: string }>(`/turnos`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      salaId: sala.id,
      nombre: 'Pilates',
      fecha,
      horaInicio: '18:00',
      horaFin: '19:00',
      cupo: 5,
    }),
  });

  const clave = await llamar<{ codigo: string }>(`/invitaciones`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ nombre: 'e2e', salaIds: [sala.id] }),
  });

  // Sin publicar el mes, el alumno no ve NINGUN turno: es el gate de la
  // decision D1 de la Fase 3A.
  await fetch(`${API}/calendario/${sala.id}/${anio}/${mes}/publicar`, {
    method: 'POST',
    headers: auth,
  });

  for (let i = 0; i < 60; i++) {
    const estado = await llamar<{ publicacion: { estado: string } | null }>(
      `/calendario/${sala.id}/${anio}/${mes}`,
      { headers: auth },
    );
    if (estado.publicacion?.estado === 'terminado') break;
    if (estado.publicacion?.estado === 'fallido') {
      throw new Error('La publicacion del mes fallo. ¿Hay otra API robando jobs de Redis?');
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  return {
    slug,
    adminToken: login.accessToken,
    salaId: sala.id,
    turnoId: turno.id,
    codigo: clave.codigo,
    anio,
    mes,
    fecha,
  };
}
```

- [ ] **Step 4: Escribir el test de instalabilidad**

Crear `apps/web/e2e/instalabilidad.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test.describe('la aplicacion es instalable', () => {
  test('el manifest se sirve y sus iconos EXISTEN', async ({ page, request }) => {
    await page.goto('/');

    const enlace = page.locator('link[rel="manifest"]');
    await expect(enlace).toHaveCount(1);

    const manifest = await request.get('/manifest.json');
    expect(manifest.status()).toBe(200);

    const datos = (await manifest.json()) as {
      name: string;
      display: string;
      icons: { src: string; sizes: string }[];
    };
    expect(datos.display).toBe('standalone');
    expect(datos.icons.length).toBeGreaterThanOrEqual(2);

    // Lo que de verdad importa: que los archivos existan. Un manifest que
    // apunta a iconos inexistentes no hace la app instalable, y Chrome no lo
    // dice — simplemente no ofrece instalar.
    for (const icono of datos.icons) {
      const respuesta = await request.get(icono.src);
      expect(respuesta.status(), `${icono.src} no se sirve`).toBe(200);
      expect(respuesta.headers()['content-type']).toContain('image/png');
      const cuerpo = await respuesta.body();
      expect(cuerpo.length, `${icono.src} esta vacio`).toBeGreaterThan(500);
    }
  });

  test('el service worker se registra de verdad', async ({ page }) => {
    await page.goto('/');

    // jsdom no puede hacer esto, y por eso esta prueba existe.
    const registrado = await page.evaluate(async () => {
      const registro = await navigator.serviceWorker.getRegistration();
      if (registro !== undefined) return true;
      await navigator.serviceWorker.ready;
      return true;
    });

    expect(registrado).toBe(true);
  });
});
```

- [ ] **Step 5: Escribir el test de offline**

Crear `apps/web/e2e/offline.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { prepararGimnasio } from './preparar';

test('el calendario ya cargado sobrevive a quedarse sin red', async ({ page, context }) => {
  const gym = await prepararGimnasio();

  await page.goto(`/${gym.slug}/registro`);
  await page.getByLabel(/nombre/i).fill('Ana Offline');
  await page.getByLabel(/email/i).fill(`ana-${Date.now()}@test.io`);
  await page.getByLabel(/clave/i).fill(gym.codigo);
  await page.getByLabel(/contrase/i).fill('Password123!');
  await page.getByRole('button', { name: /crear mi cuenta/i }).click();

  await expect(page).toHaveURL(new RegExp(`/${gym.slug}/calendario`));
  await expect(page.getByText('Pilates')).toBeVisible();

  // El service worker necesita estar activo para servir de la cache.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.getByText('Pilates')).toBeVisible();

  await context.setOffline(true);
  await page.reload();

  // Punto del checklist del PDF: "funciona razonablemente offline para la vista
  // de mi calendario ya cacheada".
  await expect(page.getByText(/sin conexion/i)).toBeVisible();

  await context.setOffline(false);
});
```

- [ ] **Step 6: Escribir el ciclo completo**

Crear `apps/web/e2e/ciclo-del-alumno.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { prepararGimnasio } from './preparar';

test('un alumno se registra, reserva y cancela sin tocar la API a mano', async ({ page }) => {
  const gym = await prepararGimnasio();
  const email = `ciclo-${Date.now()}@test.io`;

  await page.goto(`/${gym.slug}/registro`);
  await page.getByLabel(/nombre/i).fill('Ana Ciclo');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/clave/i).fill(gym.codigo);
  await page.getByLabel(/contrase/i).fill('Password123!');
  await page.getByRole('button', { name: /crear mi cuenta/i }).click();

  await expect(page).toHaveURL(new RegExp(`/${gym.slug}/calendario`));

  // Reservar
  await page.getByRole('button', { name: /^reservar$/i }).first().click();
  await expect(page.getByText(/ya tenes tu lugar reservado/i)).toBeVisible();

  // El pack refleja el consumo
  await page.getByRole('link', { name: /mi pack/i }).click();
  await expect(page.getByText(/llevas/i)).toBeVisible();

  // Cancelar
  await page.getByRole('link', { name: /calendario/i }).click();
  await page.getByRole('button', { name: /cancelar/i }).first().click();
  await expect(page.getByRole('button', { name: /^reservar$/i }).first()).toBeVisible();

  // Cerrar sesion devuelve al login
  await page.getByRole('link', { name: /perfil/i }).click();
  await page.getByRole('button', { name: /cerrar sesion/i }).click();
  await expect(page).toHaveURL(new RegExp(`/${gym.slug}/login`));
});

test('el slug de otro gimnasio no deja entrar con la sesion propia', async ({ page }) => {
  const gym = await prepararGimnasio();
  const otro = await prepararGimnasio();
  const email = `slug-${Date.now()}@test.io`;

  await page.goto(`/${gym.slug}/registro`);
  await page.getByLabel(/nombre/i).fill('Ana Slug');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/clave/i).fill(gym.codigo);
  await page.getByLabel(/contrase/i).fill('Password123!');
  await page.getByRole('button', { name: /crear mi cuenta/i }).click();
  await expect(page).toHaveURL(new RegExp(`/${gym.slug}/calendario`));

  // Con la cookie del gimnasio A, abrir el calendario de B.
  await page.goto(`/${otro.slug}/calendario`);

  // Sin la comprobacion del slug, la API respondria con los datos de A bajo la
  // URL de B, porque el JWT lleva su propio tenantId.
  await expect(page).toHaveURL(new RegExp(`/${otro.slug}/login`));
});
```

- [ ] **Step 7: Correr Playwright**

**Primero comprueba que no hay otra API viva**, y levanta la de verdad:

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*box-admin*' } | Select-Object ProcessId, CommandLine"
cd /d/Dev/box-admin && docker compose up -d postgres postgres-test redis
cd apps/api && (pnpm start:dev &) && sleep 40
```

```bash
cd /d/Dev/box-admin/apps/web && pnpm test:e2e
```

Esperado: 5 tests en verde. Playwright construye el frontend (puede tardar un par de minutos la
primera vez) y lo sirve en el 3002.

Mata la API **por PID** al terminar.

- [ ] **Step 8: Correrlo dos veces más**

```bash
cd apps/web && for i in 1 2; do pnpm test:e2e || break; done
```

Esperado: dos corridas más idénticas. El test de offline depende del service worker y del tiempo de
registro: si fuera intermitente, hay que arreglarlo, no reintentarlo.

**Mensaje de commit sugerido para Cesar:**

```
test(web): Playwright para lo que jsdom no puede probar

Instalabilidad (manifest e iconos que EXISTEN de verdad, no solo mencionados),
offline con la red cortada, ciclo completo del alumno y la comprobacion de que
la sesion de un gimnasio no sirve en la URL de otro. Contra el build de
produccion: el service worker no existe en desarrollo, asi que probarlo contra
next dev no probaria nada.
```

---

## Task 16: Verificación final, README y tracker

**Files:**
- Modificar: `README.md`
- Modificar: `docs/superpowers/plans/PROGRESO.md`

- [ ] **Step 1: Verificación completa**

```bash
cd /d/Dev/box-admin/packages/shared && pnpm exec jest
cd ../../apps/api && pnpm exec tsc --noEmit && pnpm test && pnpm test:e2e
cd ../web && pnpm typecheck && pnpm test && pnpm build
cd /d/Dev/box-admin && pnpm exec prettier --check "apps/web/src/**/*.{ts,tsx}" "apps/web/e2e/**/*.ts"
```

Esperado: todo en verde y el formato limpio en lo que escribió esta fase.

- [ ] **Step 2: Comprobar el estado de git**

```bash
cd /d/Dev/box-admin && git diff --cached --stat
git check-ignore -v .env .env.test apps/web/.env.local apps/web/.next apps/web/public/sw.js
git status --short | grep -E "node_modules|\.next/|sw\.js" || echo "sin artefactos de build sin seguir"
```

Esperado: índice vacío, todo lo sensible ignorado, y ningún artefacto suelto.

- [ ] **Step 3: Recorrer el checklist a mano**

Levanta base de datos, API y `pnpm web:dev`, abre `http://localhost:3001/<slug>/registro` en un
navegador real y recorre los ocho puntos del §8 del spec **con las manos**. Los e2e prueban que el
código hace lo que dice; esto prueba que hace lo que hacía falta, y en las tres fases anteriores es
donde aparecieron las sorpresas.

Comprueba en particular, con las herramientas de desarrollo abiertas:

- En **Application → Manifest**, que Chrome no muestra ningún error y ofrece instalar.
- En **Application → Service Workers**, que hay uno activo.
- Que `document.cookie` **no** contiene `bx_access` — son `httpOnly`, así que el JavaScript de la
  página no debe poder verlas. Si aparecieran, la decisión D3 del spec no se está cumpliendo.

Anota el resultado de cada punto: es lo que va en el tracker.

- [ ] **Step 4: Documentar en el README**

Añadir una sección "La PWA del alumno — Fase 3B" con:

- Cómo levantar las dos aplicaciones a la vez y en qué puertos (3000 la API, 3001 la web).
- Las seis pantallas y sus rutas.
- **Por qué hay un BFF** y qué implica: el navegador nunca ve el token.
- Las variables de entorno de `apps/web` y por qué `API_URL` **no** lleva `NEXT_PUBLIC_`.
- El flujo de tres pasos del comprobante y por qué el `PUT` no pasa por Next.
- Qué funciona offline y qué no, y por qué las escrituras no se encolan.
- Que **Playwright necesita el build de producción** y comparte Redis con los e2e de la 3A.

- [ ] **Step 5: Actualizar el tracker**

En `docs/superpowers/plans/PROGRESO.md`, añadir el bloque de la Fase 3B con las 17 tareas marcadas,
las siete decisiones cerradas, la tabla del checklist verificada a mano, **los errores de este plan
que encontraste al ejecutarlo** —los hubo en las tres fases anteriores— y las trampas de entorno
nuevas.

Anota también la desviación conocida: **la pantalla no ofrece salirse de la lista de espera** porque
`TurnoDisponible` no trae el id de la entrada en la cola; el hook `salirme` está escrito y probado
para cuando el contrato lo incluya.

- [ ] **Step 6: Comprobar el README**

```bash
cd /d/Dev/box-admin && python -c "
import re
d=open('README.md','rb').read()
print('fences:', len(re.findall(rb'(?m)^\`\`\`', d)))
print('CRLF:', d.count(b'\r\n'))
"
```

Esperado: número **par** de bloques de código y **0** CRLF.

**Mensaje de commit sugerido para Cesar:**

```
docs: la PWA del alumno en el README y el estado en el tracker
```

---

## Verificación del plan contra el spec

| Sección del spec | Tarea |
|---|---|
| D1 — Serwist en lugar de `next-pwa` | T0 (spike), T14 |
| D2 — Next 15 | T0, T3 |
| D3 — Cookies `httpOnly` con Next de intermediario | T4, T5, T7 |
| D4 — El gimnasio en la ruta | T3, T7, T8 |
| D5 — `GET /mi-pack` | T1, T11 |
| D6 — Offline: leer sí, escribir no | T6 (cliente), T14 (service worker) |
| D7 — Tailwind y componentes propios | T7 |
| §3.1 — El paquete compartido | T3 (con test que lo verifica) |
| §3.2 — El BFF | T4, T5 |
| §3.3 — Un gimnasio por cookie | T5, T7, T15 (e2e) |
| §3.4 — CORS | T2 |
| §4 — Las seis pantallas | T8, T9, T11, T12, T13 |
| §4.1 — El calendario habla el idioma de la API | T9 |
| §4.2 — Actualizaciones optimistas | T10 |
| §5 — `GET /mi-pack` | T1 |
| §6 — Service worker | T14 |
| §7 — Pruebas | Vitest en cada tarea; Playwright en T15 |
| §8 — Checklist de aceptación | T16 |
