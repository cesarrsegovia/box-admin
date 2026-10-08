# Fase 7 — El panel del admin: armazón y Personas

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans` para implementarlo tarea por tarea. Los pasos llevan
> casillas (`- [ ]`) para ir marcándolos.

**Objetivo:** la primera pantalla de admin del proyecto — el armazón del panel y el área de Personas,
que es lo que hoy obliga a un `curl` para dar de alta a alguien.

**Arquitectura:** un grupo de rutas `(admin)` dentro de `[slug]` en `apps/web`, con la puerta resuelta
en el servidor contra `GET /auth/me` y la navegación dibujada desde el rol. Los datos van por TanStack
Query contra el proxy `/api/bx` que ya existe. **No se toca ni un endpoint de la API.**

**Herramientas:** Next 15.5 App Router, React 19, Tailwind 4, TanStack Query v5, react-hook-form + zod,
Vitest 3, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-06-fase7-panel-personas.md`

---

## Reglas que gobiernan todo este plan

⚠️ **No hacés commits.** Nunca `git add`, `git commit`, `git push`, `git stash`, `git checkout` ni
`git reset`. `git status`, `git diff` y `git show` sí. Los commits los hace Cesar. Donde otros planes
pondrían un paso de commit, aquí hay uno de verificación.

⚠️ **Nunca `pnpm lint`.** Lleva `--fix` y reformatea código commiteado de otras fases. Para formato,
`pnpm exec prettier --check`, y `--write` **sólo** sobre archivos que vos mismo creaste o tocaste.

⚠️ **Nunca `taskkill` ni `Stop-Process` por NOMBRE de proceso.** Hay una sesión viva de Claude Code en
la máquina. Por PID concreto y sólo los que hayas lanzado vos.

⚠️ **No se toca `apps/api`.** Esta fase no agrega ni modifica un endpoint. Si una pantalla parece
necesitar uno, **pará y reportalo**: es señal de que está inventando una capacidad en vez de usar la que
hay.

⚠️ **No se toca `packages/shared`** salvo que una tarea lo diga. Si lo tocaras, hay que reconstruirlo
(`pnpm --filter @boxadmin/shared build`) porque los demás paquetes resuelven los tipos desde `dist/`.

**Comandos:**

```bash
pnpm --filter @boxadmin/web test                      # Vitest, toda la suite
pnpm --filter @boxadmin/web exec vitest run <archivo> [<archivo>...]  # subcadena, NO regex
pnpm --filter @boxadmin/web exec tsc --noEmit         # tipos
pnpm --filter @boxadmin/web build                     # el build de Next
pnpm --filter @boxadmin/web test:e2e                  # Playwright (necesita el build)
```

**Punto de partida:** 351 tests en 23 archivos, verdes. `tsc` limpio. No rompas ninguno.

### La mutación abierta

Cada tarea termina con una. En la Fase 6B se pidió seis veces y encontró algo real **las seis**, y las
seis fueron de la misma familia: **agregar algo que no debería estar, sin quitar nada de lo que sí** —
un campo de más en un contrato, un dato de más dentro de un string legítimo, una frase de más en la
pantalla equivocada, un contador de más en una portada, el `tenantId` dentro del PNG de un QR.

Ningún test de presencia ve eso. Por eso **las comparaciones son de totales**: el conjunto entero de
enlaces, de columnas, de claves.

### Sobre la densidad de este plan

Las Tasks 1 a 7 traen el código completo, porque son las piezas nuevas o delicadas: la puerta, la regla
del service worker, la navegación por rol, los filtros en la URL.

Las Tasks 8 a 12 traen **el código de los tests y la tabla de mutaciones, pero no el de la
implementación**. Es deliberado: son pantallas de ABM que repiten patrones ya fijados —react-hook-form
con zod como en `formulario-de-login.tsx`, los hooks de la Task 6, la tabla y el diálogo de las Tasks 7
y 9— y bajo TDD el test es la especificación. **Si al implementarlas aparece una decisión que los tests
no determinan, paralo y preguntá en vez de inventar un patrón nuevo**: dos formas de hacer un formulario
en el mismo panel es exactamente lo que esta fase quiere evitar.

---

## Estructura de archivos

```
apps/web/src/
  lib/
    destino-por-rol.ts            CREAR   a dónde va cada rol tras el login
    destino-por-rol.spec.ts       CREAR
    sesion.ts                     TOCAR   añade sesionConRol()
  app/
    sw.ts                         TOCAR   regla: el panel no se cachea
    sw.spec.ts                    TOCAR
    [slug]/
      (publico)/login/
        formulario-de-login.tsx   TOCAR   destino por rol
        formulario-de-login.spec.tsx TOCAR
      (alumno)/layout.tsx         TOCAR   exige rol
      (admin)/
        layout.tsx                CREAR   la puerta
        layout.spec.tsx           CREAR
        sin-permiso.tsx           CREAR   la pantalla del 403
        armazon.tsx               CREAR   barra lateral + cajón
        armazon.spec.tsx          CREAR
        navegacion-admin.ts       CREAR   la lista declarativa de enlaces
        page.tsx                  CREAR   inicio
        usuarios/
          page.tsx                CREAR   listado
          page.spec.tsx           CREAR
          filtros.tsx             CREAR   filtros que escriben la URL
          nuevo/
            page.tsx              CREAR   alta
            page.spec.tsx         CREAR
            clave-temporal.tsx    CREAR   la pantalla de la contraseña
            clave-temporal.spec.tsx CREAR
          [id]/
            page.tsx              CREAR   la ficha
            page.spec.tsx         CREAR
            bloque-datos.tsx      CREAR
            bloque-salas.tsx      CREAR
            bloque-estado-pago.tsx CREAR
            bloque-acciones.tsx   CREAR   baja + reset
            bloque-dias-fijos.tsx CREAR   las rutinas
        invitaciones/
          page.tsx                CREAR
          page.spec.tsx           CREAR
  hooks/
    use-usuarios.ts               CREAR
    use-usuarios.spec.tsx         CREAR
    use-invitaciones.ts           CREAR
    use-rutinas.ts                CREAR
  componentes/
    tabla.tsx                     CREAR   tabla → tarjetas en teléfono
    confirmar.tsx                 CREAR   diálogo que nombra a quién afecta
    confirmar.spec.tsx            CREAR
```

---

## Task 1: El destino por rol

**Files:**

- Crear: `apps/web/src/lib/destino-por-rol.ts` · `.spec.ts`
- Modificar: `apps/web/src/app/[slug]/(publico)/login/formulario-de-login.tsx`
- Modificar: `apps/web/src/app/[slug]/(publico)/login/formulario-de-login.spec.tsx`

El login ya recibe el rol: `/api/auth/login` responde `{ usuario }` y `UsuarioPublico` lleva `rol`. No
hace falta ninguna petición extra.

- [ ] **Step 1: El test que falla**

Crear `apps/web/src/lib/destino-por-rol.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { destinoPorRol } from './destino-por-rol';

describe('destinoPorRol', () => {
  it('un ADMIN_OPERATIVO va al panel', () => {
    expect(destinoPorRol('ADMIN_OPERATIVO', 'mi-gym')).toBe('/mi-gym/admin');
  });

  it('un ADMIN_SALON tambien, porque los roles son jerarquicos', () => {
    expect(destinoPorRol('ADMIN_SALON', 'mi-gym')).toBe('/mi-gym/admin');
  });

  it('un SUPERADMIN tambien', () => {
    expect(destinoPorRol('SUPERADMIN', 'mi-gym')).toBe('/mi-gym/admin');
  });

  it('un ALUMNO va al calendario', () => {
    expect(destinoPorRol('ALUMNO', 'mi-gym')).toBe('/mi-gym/calendario');
  });

  // No hay pantalla de profesor en el front: sus endpoints existen desde la
  // Fase 4 pero nadie los dibuja. Cae en el calendario, como hoy.
  it('un PROFESOR va al calendario, porque no tiene pantalla propia todavia', () => {
    expect(destinoPorRol('PROFESOR', 'mi-gym')).toBe('/mi-gym/calendario');
  });

  it('un FANTASMA va al calendario y NO al panel', () => {
    expect(destinoPorRol('FANTASMA', 'mi-gym')).toBe('/mi-gym/calendario');
  });
});
```

- [ ] **Step 2: Verificar que falla**

Ejecutar: `pnpm --filter @boxadmin/web exec vitest run destino-por-rol`
Esperado: FAIL, `Failed to resolve import "./destino-por-rol"`.

- [ ] **Step 3: La implementación**

Crear `apps/web/src/lib/destino-por-rol.ts`:

```ts
import { type RolUsuario, rolAlcanza } from '@boxadmin/shared';

/**
 * A donde cae cada rol despues de entrar.
 *
 * `rolAlcanza` es la MISMA funcion que usa el guard de la API: la jerarquia de
 * roles no se reimplementa en el front, porque dos ideas de quien puede que es
 * lo que se separa con el tiempo.
 *
 * El profesor cae en el calendario a proposito: sus endpoints existen desde la
 * Fase 4, pero no hay ninguna pantalla de profesor todavia. Es deuda anotada,
 * no un olvido.
 */
export function destinoPorRol(rol: RolUsuario, slug: string): string {
  if (rolAlcanza(rol, 'ADMIN_OPERATIVO')) return `/${slug}/admin`;

  return `/${slug}/calendario`;
}
```

- [ ] **Step 4: Verificar que pasa**

Ejecutar: `pnpm --filter @boxadmin/web exec vitest run destino-por-rol`
Esperado: PASS, 6 tests.

- [ ] **Step 5: `rutaDeRetornoSegura` acepta un destino por defecto**

Va **antes** de tocar el login, que es quien lo va a usar con tres argumentos.

En `apps/web/src/lib/ruta-de-retorno.ts`, cambiar la firma **sin tocar ninguna de sus comprobaciones**:

```ts
export function rutaDeRetornoSegura(
  volverA: string | undefined,
  slug: string,
  porDefecto = `/${slug}/calendario`,
): string {
```

y borrar la línea `const porDefecto = \`/${slug}/calendario\`;` del cuerpo.

⚠️ **No se toca nada más de ese archivo.** Es una pieza de seguridad con 16 tests; el parámetro nuevo
tiene valor por defecto justamente para que los 16 sigan valiendo sin cambios.

- [ ] **Step 6: El login usa el destino**

En `formulario-de-login.tsx`, la respuesta del BFF ya trae el usuario. Reemplazar el bloque final de
`enviar`:

```ts
const { usuario } = (await respuesta.json()) as { usuario: UsuarioPublico };

// El destino sale SIEMPRE de `rutaDeRetornoSegura`, nunca del parametro
// crudo. Lo unico que cambia es el valor por defecto, que ahora depende
// del rol: antes todo el mundo caia en el calendario.
router.push(rutaDeRetornoSegura(volverA, slug, destinoPorRol(usuario.rol, slug)));
```

Añadir los imports `import type { UsuarioPublico } from '@boxadmin/shared';` y
`import { destinoPorRol } from '@/lib/destino-por-rol';`.

- [ ] **Step 7: Los tests del login**

Añadir a `formulario-de-login.spec.tsx` (el doble de `/api/auth/login` ahora debe devolver
`{ usuario: { rol } }`):

```tsx
it('un admin cae en el PANEL, no en el calendario', async () => {
  servidorResponde({ usuario: { rol: 'ADMIN_OPERATIVO' } });

  await entrar();

  expect(empujar).toHaveBeenCalledWith('/mi-gym/admin');
});

it('un alumno sigue cayendo en el calendario', async () => {
  servidorResponde({ usuario: { rol: 'ALUMNO' } });

  await entrar();

  expect(empujar).toHaveBeenCalledWith('/mi-gym/calendario');
});

// El volverA manda sobre el destino por rol: si venia del check-in, vuelve
// al check-in aunque sea admin.
it('el volverA valido gana al destino por rol', async () => {
  servidorResponde({ usuario: { rol: 'ADMIN_OPERATIVO' } });

  await entrar({ volverA: '/mi-gym/checkin?f=abc' });

  expect(empujar).toHaveBeenCalledWith('/mi-gym/checkin?f=abc');
});

// Y uno invalido cae al destino POR ROL, no al calendario a secas.
it('un volverA de otro gimnasio cae al destino del rol', async () => {
  servidorResponde({ usuario: { rol: 'ADMIN_OPERATIVO' } });

  await entrar({ volverA: '/otro-gimnasio/admin' });

  expect(empujar).toHaveBeenCalledWith('/mi-gym/admin');
});
```

Adaptá `servidorResponde` y `entrar` a los helpers que ya tenga ese archivo; si no los tiene, escribilos
siguiendo el estilo de sus cuatro tests actuales.

- [ ] **Step 8: Verificar**

```bash
pnpm --filter @boxadmin/web exec vitest run ruta-de-retorno destino-por-rol formulario-de-login
pnpm --filter @boxadmin/web exec tsc --noEmit
```

Esperado: todo PASS, los 16 de `ruta-de-retorno` incluidos. `tsc` limpio.

- [ ] **Step 9: Mutaciones**

Aplicá, corré, anotá si cayó, **revertí**:

| Mutación                                                           | Debe caer                      |
| ------------------------------------------------------------------ | ------------------------------ |
| `rolAlcanza(rol, 'ADMIN_OPERATIVO')` → `'PROFESOR'`                | «un PROFESOR va al calendario» |
| `rolAlcanza(rol, 'ADMIN_OPERATIVO')` → `rol === 'ADMIN_OPERATIVO'` | «un ADMIN_SALON tambien»       |
| Pasar `volverA` crudo a `router.push`                              | «un volverA de otro gimnasio…» |
| Quitar el tercer argumento de `rutaDeRetornoSegura` en el login    | «un admin cae en el PANEL»     |

**Y la abierta:** una que te parezca que tu código no sobreviviría y que ningún test tuyo cubre. Si
sobrevive, reportala en vez de taparla.

---

## Task 2: El service worker no cachea el panel

**Files:**

- Modificar: `apps/web/src/app/sw.ts`
- Modificar: `apps/web/src/app/sw.spec.ts`

⚠️ **El manifest NO se mueve.** `apps/web/e2e/instalabilidad.spec.ts` hace `page.goto('/')` y exige que
exista el `link[rel="manifest"]`: vive en el layout raíz precisamente para cubrir la raíz. El manifest
nunca fue el problema — es una etiqueta `<link>`.

El problema es `defaultCache`, que guarda la carcasa **incluido el HTML**. Un listado de gente con
nombres, emails y teléfonos quedaría en la `CacheStorage` del navegador de la computadora compartida del
mostrador, legible por quien se siente después.

- [ ] **Step 1: El test que falla**

Añadir a `apps/web/src/app/sw.spec.ts`, siguiendo el estilo de sus 10 tests actuales:

```ts
describe('el panel del admin no se cachea', () => {
  it('una navegacion al panel NO casa con ninguna regla de cacheo', () => {
    const url = new URL('https://x.test/mi-gym/admin/usuarios');
    const request = new Request(url, { method: 'GET' });

    expect(esCacheable({ url, request })).toBe(false);
  });

  it('una peticion de datos del panel tampoco', () => {
    const url = new URL('https://x.test/api/bx/usuarios');
    const request = new Request(url, { method: 'GET' });

    expect(esCacheable({ url, request })).toBe(false);
  });

  // La regla no puede ser tan ancha que se lleve por delante la unica que
  // existe: el calendario del alumno es lo que hace que la PWA funcione sin red.
  it('el calendario del alumno SIGUE cacheandose', () => {
    const url = new URL('https://x.test/api/bx/mi-calendario?desde=2026-10-01&hasta=2026-10-07');
    const request = new Request(url, { method: 'GET' });

    expect(esCacheable({ url, request })).toBe(true);
  });

  it('el calendario del alumno como PANTALLA sigue cacheandose', () => {
    const url = new URL('https://x.test/mi-gym/calendario');
    const request = new Request(url, { method: 'GET' });

    expect(esCacheable({ url, request })).toBe(true);
  });

  // Un gimnasio que se llame "administracion" no es el panel.
  it('un slug que EMPIEZA por admin no es el panel', () => {
    const url = new URL('https://x.test/administracion/calendario');
    const request = new Request(url, { method: 'GET' });

    expect(esCacheable({ url, request })).toBe(true);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Ejecutar: `pnpm --filter @boxadmin/web exec vitest run sw.spec`
Esperado: FAIL, `esCacheable is not exported`.

- [ ] **Step 3: La implementación**

En `apps/web/src/app/sw.ts`, antes del `new Serwist({...})`:

```ts
/**
 * Lo que NUNCA se cachea: el panel del admin.
 *
 * `defaultCache` guarda la carcasa, y la carcasa incluye el HTML. Un listado de
 * gente con nombres, emails y telefonos quedaria en la CacheStorage del
 * navegador del mostrador, que es una computadora compartida, legible por quien
 * se siente despues. El alumno no tiene este problema porque sus pantallas solo
 * hablan de el mismo.
 *
 * La comparacion lleva las dos barras (`/<slug>/admin/` y el exacto
 * `/<slug>/admin`): sin ellas, un gimnasio llamado "administracion" dejaria de
 * funcionar sin red.
 */
export function esDelPanel(pathname: string): boolean {
  const partes = pathname.split('/');
  // ['', '<slug>', 'admin', ...]
  return partes.length >= 3 && partes[2] === 'admin';
}

/** La regla que decide si algo entra en cache. Exportada para poder probarla. */
export function esCacheable({ url, request }: { url: URL; request: Request }): boolean {
  if (request.method !== 'GET') return false;

  return !esDelPanel(url.pathname);
}
```

Y envolver las reglas existentes. `runtimeCaching` pasa a ser:

```ts
  runtimeCaching: [
    {
      // Primero la exclusion: la primera regla que casa es la que manda, asi
      // que esta tiene que ir ANTES de defaultCache.
      matcher: ({ url, request }: { url: URL; request: Request }) =>
        !esCacheable({ url, request }) && request.method === 'GET',
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ url, request }: { url: URL; request: Request }) =>
        request.method === 'GET' && url.pathname.startsWith('/api/bx/mi-calendario'),
      handler: new NetworkFirst({ cacheName: 'mi-calendario', networkTimeoutSeconds: 3 }),
    },
    ...defaultCache,
  ],
```

Añadir `NetworkOnly` al import de `serwist`.

⚠️ **El `esCacheable` del test y el `matcher` tienen que ser la misma función.** Si el test prueba una
copia de la regla en vez de la regla, no prueba nada — es el caso de la Fase 6B donde el doble sólo
sabía lo que su autor creía.

- [ ] **Step 4: Verificar que pasa**

Ejecutar: `pnpm --filter @boxadmin/web exec vitest run sw.spec`
Esperado: PASS, los 10 de antes más los 5 nuevos.

- [ ] **Step 5: El metadata del panel**

El layout raíz dice «Tus clases, en tu bolsillo», que es del alumno. Se corrige **en la Task 3**, con el
`metadata` propio del layout del panel. Anotalo y seguí.

- [ ] **Step 6: Verificar que la PWA sigue entera**

```bash
pnpm --filter @boxadmin/web test
pnpm --filter @boxadmin/web build
pnpm --filter @boxadmin/web test:e2e
```

Esperado: Vitest verde; el build OK; **Playwright verde, incluidos los dos de
`instalabilidad.spec.ts`**. Si alguno de esos dos cae, parás y lo reportás: significa que la regla
nueva tocó la PWA, que es exactamente lo que no debe pasar.

- [ ] **Step 7: Mutaciones**

| Mutación                                                  | Debe caer                         |
| --------------------------------------------------------- | --------------------------------- |
| `partes[2] === 'admin'` → `pathname.includes('admin')`    | «un slug que EMPIEZA por admin»   |
| `partes[2] === 'admin'` → `pathname.startsWith('/admin')` | «una navegacion al panel NO casa» |
| Poner la regla de exclusión **después** de `defaultCache` | «una navegacion al panel NO casa» |
| Devolver `true` en `esCacheable` para todo                | las dos primeras                  |

**Y la abierta.**

---

## Task 3: La puerta del panel

**Files:**

- Crear: `apps/web/src/app/[slug]/(admin)/layout.tsx` · `layout.spec.tsx`
- Crear: `apps/web/src/app/[slug]/(admin)/sin-permiso.tsx`
- Modificar: `apps/web/src/lib/sesion.ts`

Es la pieza cuyo fallo expone todo lo demás.

- [ ] **Step 1: El helper de sesión con rol**

Añadir a `apps/web/src/lib/sesion.ts`:

```ts
import type { MeRespuesta } from '@boxadmin/shared';
import { urlDeApi } from './api-url';

/**
 * El rol se le pregunta a la API, NO se deduce del token aqui.
 *
 * El JWT lleva el rol, pero decodificarlo sin verificar la firma para decidir
 * que se dibuja es apoyarse en un dato que el cliente podria haber tocado.
 * `GET /auth/me` es el unico que verifica.
 *
 * Va contra la API directamente y no por `/api/bx`: eso es el proxy del
 * NAVEGADOR, y esto corre en el servidor, que ya tiene el token en la mano.
 */
export async function leerRol(access: string): Promise<MeRespuesta | null> {
  const respuesta = await fetch(urlDeApi(['auth', 'me'], ''), {
    headers: { authorization: `Bearer ${access}` },
    cache: 'no-store',
  });

  if (!respuesta.ok) return null;

  return (await respuesta.json()) as MeRespuesta;
}
```

- [ ] **Step 2: Los tests que fallan**

Crear `apps/web/src/app/[slug]/(admin)/layout.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirigir = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    redirigir(destino);
    throw new Error('NEXT_REDIRECT');
  },
}));

const leerSesion = vi.fn();
const leerRol = vi.fn();
vi.mock('@/lib/sesion', async () => ({
  ...(await vi.importActual<typeof import('@/lib/sesion')>('@/lib/sesion')),
  leerSesion: () => leerSesion(),
  leerRol: (access: string) => leerRol(access),
}));

import LayoutDeAdmin from './layout';

async function montar() {
  const jsx = await LayoutDeAdmin({
    children: <p>el panel</p>,
    params: Promise.resolve({ slug: 'mi-gym' }),
  });
  render(jsx);
}

beforeEach(() => {
  redirigir.mockClear();
  leerSesion.mockReset();
  leerRol.mockReset();
});

describe('la puerta del panel', () => {
  it('SIN SESION manda al login conservando a donde iba', async () => {
    leerSesion.mockResolvedValue({ access: undefined, slug: undefined });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirigir).toHaveBeenCalledWith('/mi-gym/login?volverA=%2Fmi-gym%2Fadmin');
  });

  it('con sesion de OTRO GIMNASIO manda al login', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'otro-gimnasio' });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirigir).toHaveBeenCalledWith('/mi-gym/login?volverA=%2Fmi-gym%2Fadmin');
  });

  // EL CASO QUE IMPORTA. Mandar aqui al login es un BUCLE INFINITO: el destino
  // pasa la lista blanca por ser del mismo gimnasio, al entrar vuelve al panel,
  // y el panel lo rebota otra vez. Volver a autenticarse no cambia el rol.
  it('con ROL INSUFICIENTE muestra una pantalla, NO redirige', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'ALUMNO' });

    await montar();

    expect(redirigir).not.toHaveBeenCalled();
    expect(screen.getByText(/no tenes permiso/i)).toBeInTheDocument();
  });

  it('la pantalla de sin permiso dice QUE ROL hace falta', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'ALUMNO' });

    await montar();

    expect(screen.getByText(/administrador operativo/i)).toBeInTheDocument();
  });

  it('un PROFESOR tampoco entra', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'PROFESOR' });

    await montar();

    expect(screen.queryByText('el panel')).not.toBeInTheDocument();
  });

  it('un ADMIN_OPERATIVO entra', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'ADMIN_OPERATIVO', nombreCompleto: 'Ana', tenant: {} });

    await montar();

    expect(screen.getByText('el panel')).toBeInTheDocument();
  });

  it('un ADMIN_SALON entra, porque los roles son jerarquicos', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'ADMIN_SALON', nombreCompleto: 'Ana', tenant: {} });

    await montar();

    expect(screen.getByText('el panel')).toBeInTheDocument();
  });

  // Un token caducado da 401 en /auth/me: leerRol devuelve null. Eso es "sin
  // sesion", no "sin permiso": aqui SI hay que mandar al login, y volver a
  // entrar lo arregla.
  it('si /auth/me falla, manda al login y NO muestra sin permiso', async () => {
    leerSesion.mockResolvedValue({ access: 'caducado', slug: 'mi-gym' });
    leerRol.mockResolvedValue(null);

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirigir).toHaveBeenCalledWith('/mi-gym/login?volverA=%2Fmi-gym%2Fadmin');
  });
});
```

- [ ] **Step 3: Verificar que falla**

Ejecutar: `pnpm --filter @boxadmin/web exec vitest run "(admin)/layout"`
Esperado: FAIL, no existe `./layout`.

- [ ] **Step 4: La pantalla del 403**

Crear `apps/web/src/app/[slug]/(admin)/sin-permiso.tsx`:

```tsx
import Link from 'next/link';
import type { RolUsuario } from '@boxadmin/shared';

const NOMBRE_DEL_ROL: Record<RolUsuario, string> = {
  SUPERADMIN: 'superadministrador',
  ADMIN_SALON: 'administrador del salon',
  ADMIN_OPERATIVO: 'administrador operativo',
  PROFESOR: 'profesor',
  ALUMNO: 'alumno',
  FANTASMA: 'sin acceso',
};

/**
 * El 403 del panel.
 *
 * NO es un redirect al login, y eso es lo unico importante de este archivo:
 * mandar aqui al login seria un bucle sin salida, porque volver a autenticarse
 * no cambia el rol. Se dice que rol hace falta, que es lo que convierte un
 * reclamo en una conversacion con el dueño.
 */
export function SinPermiso({ rol, slug }: { rol: RolUsuario; slug: string }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">No tenes permiso para entrar aca</h1>
      <p className="text-slate-600">
        El panel pide ser <strong>administrador operativo</strong> como minimo, y tu cuenta es de{' '}
        <strong>{NOMBRE_DEL_ROL[rol]}</strong>. Si creés que es un error, hablalo con quien
        administra el gimnasio.
      </p>
      <Link href={`/${slug}/calendario`} className="font-medium text-slate-900 underline">
        Ir a tu calendario
      </Link>
    </main>
  );
}
```

- [ ] **Step 5: La puerta**

Crear `apps/web/src/app/[slug]/(admin)/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { rolAlcanza } from '@boxadmin/shared';
import { leerRol, leerSesion, sesionValidaPara } from '@/lib/sesion';
import { Armazon } from './armazon';
import { SinPermiso } from './sin-permiso';

// El layout raiz dice "Tus clases, en tu bolsillo", que es del alumno.
export const metadata: Metadata = { title: 'Panel · BoxAdmin' };

/**
 * La puerta del panel.
 *
 * Corre en el SERVIDOR y lee las cookies httpOnly, asi que no se puede saltar
 * desde el navegador. Rechaza en tres casos, y el tercero NO de la misma
 * manera que los otros dos: ver `SinPermiso`.
 */
export default async function LayoutDeAdmin({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sesion = await leerSesion();
  const alLogin = `/${slug}/login?volverA=${encodeURIComponent(`/${slug}/admin`)}`;

  if (!sesionValidaPara(sesion, slug)) redirect(alLogin);

  // `sesionValidaPara` ya garantizo que `access` existe.
  const yo = await leerRol(sesion.access as string);

  // Null es token invalido o caducado: eso SI se arregla volviendo a entrar.
  if (yo === null) redirect(alLogin);

  if (!rolAlcanza(yo.rol, 'ADMIN_OPERATIVO')) return <SinPermiso rol={yo.rol} slug={slug} />;

  return (
    <Armazon slug={slug} rol={yo.rol} nombre={yo.nombreCompleto}>
      {children}
    </Armazon>
  );
}
```

- [ ] **Step 6: Un `Armazon` mínimo para que compile**

Crear `apps/web/src/app/[slug]/(admin)/armazon.tsx` provisional; la Task 4 lo completa:

```tsx
import type { RolUsuario } from '@boxadmin/shared';

export function Armazon({
  children,
}: {
  slug: string;
  rol: RolUsuario;
  nombre: string;
  children: React.ReactNode;
}) {
  return <div>{children}</div>;
}
```

- [ ] **Step 7: Verificar que pasa**

Ejecutar: `pnpm --filter @boxadmin/web exec vitest run "(admin)/layout"`
Esperado: PASS, 8 tests.

- [ ] **Step 8: Mutaciones**

| Mutación                                                                 | Debe caer                                   |
| ------------------------------------------------------------------------ | ------------------------------------------- |
| Rol insuficiente → `redirect(alLogin)` en vez de `<SinPermiso>`          | «con ROL INSUFICIENTE muestra una pantalla» |
| `yo === null` → `return <SinPermiso>`                                    | «si /auth/me falla, manda al login»         |
| `rolAlcanza(yo.rol, 'ADMIN_OPERATIVO')` → `yo.rol === 'ADMIN_OPERATIVO'` | «un ADMIN_SALON entra»                      |
| Quitar `sesionValidaPara` y mirar sólo `access`                          | «con sesion de OTRO GIMNASIO»               |
| `volverA` sin `encodeURIComponent`                                       | las dos primeras                            |

**Y la abierta.** Pista de dónde mirar: esta puerta recibe el objeto entero de `/auth/me`, que lleva
más datos de los que necesita.

---

## Task 4: El armazón y la navegación por rol

**Files:**

- Modificar: `apps/web/src/app/[slug]/(admin)/armazon.tsx`
- Crear: `apps/web/src/app/[slug]/(admin)/navegacion-admin.ts`
- Crear: `apps/web/src/app/[slug]/(admin)/armazon.spec.tsx`
- Crear: `apps/web/src/app/[slug]/(admin)/page.tsx`

- [ ] **Step 1: La lista declarativa**

Crear `apps/web/src/app/[slug]/(admin)/navegacion-admin.ts`:

```ts
import type { RolAsignable, RolUsuario } from '@boxadmin/shared';
import { rolAlcanza } from '@boxadmin/shared';

export interface EnlaceDelPanel {
  ruta: string;
  texto: string;
  /** El rol MINIMO que lo ve. */
  minimo: RolAsignable;
}

/**
 * Los enlaces del panel, declarados y no repartidos por el JSX.
 *
 * Cuando lleguen las otras cuatro areas (Operacion, Dinero, Analisis,
 * Configuracion), agregarlas es una linea aqui y no un `if` nuevo escondido en
 * un componente. Es tambien lo que permite que un test fije el conjunto ENTERO.
 */
export const ENLACES_DEL_PANEL: readonly EnlaceDelPanel[] = [
  { ruta: '', texto: 'Inicio', minimo: 'ADMIN_OPERATIVO' },
  { ruta: 'usuarios', texto: 'Personas', minimo: 'ADMIN_OPERATIVO' },
  { ruta: 'invitaciones', texto: 'Invitaciones', minimo: 'ADMIN_OPERATIVO' },
];

export function enlacesPara(rol: RolUsuario): EnlaceDelPanel[] {
  return ENLACES_DEL_PANEL.filter((enlace) => rolAlcanza(rol, enlace.minimo));
}
```

- [ ] **Step 2: Los tests que fallan**

Crear `apps/web/src/app/[slug]/(admin)/armazon.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Armazon } from './armazon';
import { enlacesPara } from './navegacion-admin';

vi.mock('next/navigation', () => ({ usePathname: () => '/mi-gym/admin' }));

function enlacesDelDocumento(): [string, string][] {
  return [...document.querySelectorAll('a')].map((a) => [
    a.textContent?.trim() ?? '',
    a.getAttribute('href') ?? '',
  ]);
}

describe('la navegacion se dibuja desde el rol', () => {
  // LISTA BLANCA, no lista negra: se fija el conjunto ENTERO. Un enlace de mas
  // —el error que ningun test de presencia ve— rompe esto.
  it('un ADMIN_OPERATIVO ve ESTOS enlaces y solo estos', () => {
    render(
      <Armazon slug="mi-gym" rol="ADMIN_OPERATIVO" nombre="Ana">
        <p>contenido</p>
      </Armazon>,
    );

    expect(enlacesDelDocumento()).toEqual([
      ['Inicio', '/mi-gym/admin'],
      ['Personas', '/mi-gym/admin/usuarios'],
      ['Invitaciones', '/mi-gym/admin/invitaciones'],
    ]);
  });

  it('enlacesPara no devuelve nada que el rol no alcance', () => {
    expect(enlacesPara('ALUMNO')).toEqual([]);
    expect(enlacesPara('PROFESOR')).toEqual([]);
  });

  it('el armazon dice quien sos y de que gimnasio', () => {
    render(
      <Armazon slug="mi-gym" rol="ADMIN_OPERATIVO" nombre="Ana Perez">
        <p>contenido</p>
      </Armazon>,
    );

    expect(screen.getByText('Ana Perez')).toBeInTheDocument();
  });

  it('pinta el contenido que le pasan', () => {
    render(
      <Armazon slug="mi-gym" rol="ADMIN_OPERATIVO" nombre="Ana">
        <p>contenido</p>
      </Armazon>,
    );

    expect(screen.getByText('contenido')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Verificar que falla**

Ejecutar: `pnpm --filter @boxadmin/web exec vitest run armazon`
Esperado: FAIL — el `Armazon` provisional no dibuja enlaces.

- [ ] **Step 4: El armazón**

Reemplazar `apps/web/src/app/[slug]/(admin)/armazon.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { RolUsuario } from '@boxadmin/shared';
import { enlacesPara } from './navegacion-admin';

/**
 * Barra lateral en escritorio, cajon en telefono.
 *
 * Al reves que la PWA del alumno, que es una barra inferior pensada para usarse
 * de pie y con una mano. Son dos usos distintos: el admin trabaja en un
 * mostrador y sus pantallas son densas.
 */
export function Armazon({
  slug,
  rol,
  nombre,
  children,
}: {
  slug: string;
  rol: RolUsuario;
  nombre: string;
  children: React.ReactNode;
}) {
  const rutaActual = usePathname();
  const enlaces = enlacesPara(rol);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-1 border-b border-slate-200 bg-white p-3 md:w-56 md:border-b-0 md:border-r">
        <p className="px-2 pb-2 text-sm font-medium text-slate-900">{nombre}</p>

        <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {enlaces.map((enlace) => {
            const href = enlace.ruta === '' ? `/${slug}/admin` : `/${slug}/admin/${enlace.ruta}`;
            const activa = rutaActual === href;

            return (
              <Link
                key={enlace.ruta}
                href={href}
                aria-current={activa ? 'page' : undefined}
                className={
                  'whitespace-nowrap rounded px-3 py-2 text-sm font-medium ' +
                  (activa ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')
                }
              >
                {enlace.texto}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="flex-1 bg-slate-50 p-4 md:p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 5: El inicio**

Crear `apps/web/src/app/[slug]/(admin)/page.tsx`:

```tsx
import Link from 'next/link';

export default async function InicioDelPanel({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Panel</h1>
      <p className="text-slate-600">
        Desde aca se administran las personas del gimnasio y las claves de invitacion.
      </p>
      <Link href={`/${slug}/admin/usuarios`} className="font-medium text-slate-900 underline w-fit">
        Ver las personas
      </Link>
    </section>
  );
}
```

- [ ] **Step 6: Verificar**

```bash
pnpm --filter @boxadmin/web exec vitest run armazon
pnpm --filter @boxadmin/web exec tsc --noEmit
```

Esperado: PASS, 4 tests. `tsc` limpio.

- [ ] **Step 7: Mutaciones**

| Mutación                                                                          | Debe caer                       |
| --------------------------------------------------------------------------------- | ------------------------------- |
| Agregar `{ ruta: 'pagos', texto: 'Pagos', minimo: 'ADMIN_OPERATIVO' }` a la lista | «ESTOS enlaces y solo estos»    |
| `enlacesPara` devuelve `ENLACES_DEL_PANEL` sin filtrar                            | «enlacesPara no devuelve nada…» |
| `minimo` de Personas → `'ALUMNO'`                                                 | «enlacesPara no devuelve nada…» |
| El `href` de Inicio → `/${slug}/admin/` con barra final                           | «ESTOS enlaces y solo estos»    |

**Y la abierta.**

---

## Task 5: La puerta vieja del alumno exige rol

**Files:**

- Modificar: `apps/web/src/app/[slug]/(alumno)/layout.tsx`
- Crear: `apps/web/src/app/[slug]/(alumno)/layout.spec.tsx`

Hoy el layout de alumno sólo comprueba que la sesión sea de ese gimnasio: **un admin con sesión válida
entra al área del alumno.** No es un agujero de datos —la API responde según el rol— pero es una regla
más floja conviviendo con la nueva.

- [ ] **Step 1: Los tests que fallan**

Crear `apps/web/src/app/[slug]/(alumno)/layout.spec.tsx` con la misma estructura de dobles que
`(admin)/layout.spec.tsx` (Task 3, Step 2), y estos casos:

```tsx
describe('la puerta del area de alumno', () => {
  it('sin sesion manda al login', async () => {
    leerSesion.mockResolvedValue({ access: undefined, slug: undefined });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirigir).toHaveBeenCalledWith('/mi-gym/login');
  });

  it('con sesion de otro gimnasio manda al login', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'otro-gimnasio' });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirigir).toHaveBeenCalledWith('/mi-gym/login');
  });

  it('un ALUMNO entra', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'ALUMNO' });

    await montar();

    expect(screen.getByText('el area del alumno')).toBeInTheDocument();
  });

  // El caso que esta tarea existe para cerrar.
  it('un ADMIN_OPERATIVO NO entra al area del alumno', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'ADMIN_OPERATIVO' });

    await montar();

    expect(screen.queryByText('el area del alumno')).not.toBeInTheDocument();
  });

  it('a un admin se le ofrece ir a SU panel, no se lo manda al login', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'ADMIN_OPERATIVO' });

    await montar();

    expect(redirigir).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /panel/i })).toHaveAttribute('href', '/mi-gym/admin');
  });
});
```

⚠️ **Al admin tampoco se lo manda al login**, por el mismo motivo que en la Task 3: volver a entrar no
cambia el rol. Se le muestra una pantalla con el enlace a su panel.

- [ ] **Step 2: Verificar que falla**

Ejecutar: `pnpm --filter @boxadmin/web exec vitest run "(alumno)/layout"`
Esperado: FAIL en los dos últimos.

- [ ] **Step 3: La implementación**

En `apps/web/src/app/[slug]/(alumno)/layout.tsx`, después del `sesionValidaPara` existente:

```tsx
const yo = await leerRol(sesion.access as string);
if (yo === null) redirect(`/${slug}/login`);

// El area del alumno es del alumno. Un admin que llegue aqui no se manda al
// login —volver a entrar no cambia el rol— sino a su panel.
if (yo.rol !== 'ALUMNO') {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">Esta no es tu area</h1>
      <p className="text-slate-600">Tu cuenta no es de alumno, asi que aca no hay nada tuyo.</p>
      <Link href={`/${slug}/admin`} className="font-medium text-slate-900 underline">
        Ir al panel
      </Link>
    </main>
  );
}
```

Añadir los imports de `Link` y `leerRol`.

⚠️ **La comparación es `!== 'ALUMNO'` y no `rolAlcanza`.** Aquí no vale la jerarquía: un admin **no**
es «un alumno con más permisos», es otra persona. Si se usara `rolAlcanza(rol, 'ALUMNO')` entrarían
todos.

- [ ] **Step 4: Verificar**

```bash
pnpm --filter @boxadmin/web exec vitest run "(alumno)"
pnpm --filter @boxadmin/web test
```

Esperado: los 5 nuevos en verde y **los 351 de antes sin tocar**.

- [ ] **Step 5: Mutaciones**

| Mutación                                               | Debe caer                     |
| ------------------------------------------------------ | ----------------------------- |
| `yo.rol !== 'ALUMNO'` → `rolAlcanza(yo.rol, 'ALUMNO')` | «un ADMIN_OPERATIVO NO entra» |
| El admin se manda a `redirect(login)`                  | «se le ofrece ir a SU panel»  |
| Quitar la comprobación entera                          | «un ADMIN_OPERATIVO NO entra» |

**Y la abierta.**

- [ ] **Step 6: Comprobar que Playwright sigue verde**

```bash
pnpm --filter @boxadmin/web build
pnpm --filter @boxadmin/web test:e2e
```

Esperado: verde. `ciclo-del-alumno.spec.ts` entra como alumno, así que no debería notar el cambio; si
cae, el doble de rol no está resolviendo y hay que mirarlo antes de seguir.

---

## Task 6: Los hooks de Personas

**Files:**

- Crear: `apps/web/src/hooks/use-usuarios.ts` · `use-usuarios.spec.tsx`

- [ ] **Step 1: Las claves y las consultas**

Crear `apps/web/src/hooks/use-usuarios.ts`:

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AltaUsuarioRespuesta,
  TipoUsuarioNegocio,
  UsuarioDetalle,
  UsuarioResumen,
} from '@boxadmin/shared';
import { type ErrorDeApi, pedir } from '@/lib/cliente';

export interface FiltrosDeUsuarios {
  tipo?: TipoUsuarioNegocio;
  salaId?: string;
  activo?: boolean;
  autoRegistrado?: boolean;
}

/** Las claves, en un solo sitio, como en `use-calendario`. */
export const clavesDeUsuarios = {
  lista: (filtros: FiltrosDeUsuarios) => ['usuarios', filtros] as const,
  uno: (id: string) => ['usuario', id] as const,
};

/**
 * Los filtros viajan como query y SOLO los que tienen valor.
 *
 * Mandar `activo=` vacio no es lo mismo que no mandarlo: el `ParseBoolPipe` de
 * la API lo rechazaria con un 400.
 */
export function queryDeFiltros(filtros: FiltrosDeUsuarios): string {
  const partes = new URLSearchParams();

  if (filtros.tipo !== undefined) partes.set('tipo', filtros.tipo);
  if (filtros.salaId !== undefined && filtros.salaId !== '') partes.set('salaId', filtros.salaId);
  if (filtros.activo !== undefined) partes.set('activo', String(filtros.activo));
  if (filtros.autoRegistrado !== undefined)
    partes.set('autoRegistrado', String(filtros.autoRegistrado));

  const texto = partes.toString();
  return texto === '' ? '' : `?${texto}`;
}

export function useUsuarios(filtros: FiltrosDeUsuarios) {
  return useQuery({
    queryKey: clavesDeUsuarios.lista(filtros),
    queryFn: () => pedir<UsuarioResumen[]>(`/usuarios${queryDeFiltros(filtros)}`),
  });
}

export function useUsuario(id: string) {
  return useQuery({
    queryKey: clavesDeUsuarios.uno(id),
    queryFn: () => pedir<UsuarioDetalle>(`/usuarios/${id}`),
  });
}

/** Tras cualquier escritura hay que invalidar la ficha Y la lista. */
function useInvalidar() {
  const cliente = useQueryClient();

  return (id: string) => {
    void cliente.invalidateQueries({ queryKey: clavesDeUsuarios.uno(id) });
    void cliente.invalidateQueries({ queryKey: ['usuarios'] });
  };
}

export function useActualizarUsuario(id: string) {
  const invalidar = useInvalidar();

  return useMutation<UsuarioDetalle, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) =>
      pedir<UsuarioDetalle>(`/usuarios/${id}`, { metodo: 'PATCH', cuerpo: datos }),
    onSuccess: () => invalidar(id),
  });
}

export function useActualizarSalas(id: string) {
  const invalidar = useInvalidar();

  return useMutation<UsuarioDetalle, ErrorDeApi, string[]>({
    mutationFn: (salaIds) =>
      pedir<UsuarioDetalle>(`/usuarios/${id}/salas`, { metodo: 'PATCH', cuerpo: { salaIds } }),
    onSuccess: () => invalidar(id),
  });
}

export interface EstadoDePago {
  alDia: boolean;
  cubreHasta?: string;
  nota?: string;
}

export function useFijarEstadoDePago(id: string) {
  const invalidar = useInvalidar();

  return useMutation<UsuarioDetalle, ErrorDeApi, EstadoDePago>({
    mutationFn: (datos) =>
      pedir<UsuarioDetalle>(`/usuarios/${id}/estado-pago`, { metodo: 'PATCH', cuerpo: datos }),
    onSuccess: () => invalidar(id),
  });
}

export function useDarDeBaja(id: string) {
  const invalidar = useInvalidar();

  return useMutation<UsuarioDetalle, ErrorDeApi, void>({
    mutationFn: () => pedir<UsuarioDetalle>(`/usuarios/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => invalidar(id),
  });
}

/** Devuelve la contraseña nueva. Se ve UNA vez. */
export function useResetearPassword(id: string) {
  return useMutation<{ passwordTemporal: string }, ErrorDeApi, void>({
    mutationFn: () =>
      pedir<{ passwordTemporal: string }>(`/usuarios/${id}/reset-password`, { metodo: 'POST' }),
  });
}

export function useCrearPersona(tipo: TipoUsuarioNegocio) {
  const cliente = useQueryClient();

  return useMutation<AltaUsuarioRespuesta, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) =>
      pedir<AltaUsuarioRespuesta>(`/usuarios/${tipo === 'alumno' ? 'alumnos' : 'profesores'}`, {
        metodo: 'POST',
        cuerpo: datos,
      }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['usuarios'] }),
  });
}
```

- [ ] **Step 2: Los tests**

Crear `apps/web/src/hooks/use-usuarios.spec.tsx`, siguiendo el estilo de
`use-comprobantes.spec.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { queryDeFiltros } from './use-usuarios';

describe('queryDeFiltros', () => {
  it('sin filtros no manda query', () => {
    expect(queryDeFiltros({})).toBe('');
  });

  it('un booleano en false SI se manda', () => {
    // `activo: false` es un filtro ("damelos de baja"), no la ausencia de
    // filtro. Un `if (filtros.activo)` se lo comeria.
    expect(queryDeFiltros({ activo: false })).toBe('?activo=false');
  });

  it('un booleano en true se manda', () => {
    expect(queryDeFiltros({ activo: true })).toBe('?activo=true');
  });

  it('una sala vacia NO se manda', () => {
    expect(queryDeFiltros({ salaId: '' })).toBe('');
  });

  it('manda los cuatro juntos', () => {
    expect(
      queryDeFiltros({ tipo: 'alumno', salaId: 's1', activo: true, autoRegistrado: false }),
    ).toBe('?tipo=alumno&salaId=s1&activo=true&autoRegistrado=false');
  });
});
```

Añadir además un test de integración del hook con un doble de `pedir`, comprobando que
`useUsuarios({ tipo: 'alumno' })` llama a `/usuarios?tipo=alumno`.

- [ ] **Step 3: Verificar**

```bash
pnpm --filter @boxadmin/web exec vitest run use-usuarios
pnpm --filter @boxadmin/web exec tsc --noEmit
```

- [ ] **Step 4: Mutaciones**

| Mutación                                               | Debe caer                             |
| ------------------------------------------------------ | ------------------------------------- |
| `filtros.activo !== undefined` → `if (filtros.activo)` | «un booleano en false SI se manda»    |
| `filtros.salaId !== ''` fuera                          | «una sala vacia NO se manda»          |
| `useInvalidar` invalida sólo la ficha                  | el test de integración de la mutación |

**Y la abierta.**

---

## Task 7: El listado de usuarios

**Files:**

- Crear: `apps/web/src/app/[slug]/(admin)/usuarios/page.tsx` · `page.spec.tsx` · `filtros.tsx`
- Crear: `apps/web/src/componentes/tabla.tsx`

- [ ] **Step 1: Los tests que fallan**

Crear `usuarios/page.spec.tsx`. Lo que no puede faltar:

```tsx
function columnasDelDocumento(): string[] {
  return [...document.querySelectorAll('th')].map((th) => th.textContent?.trim() ?? '');
}

describe('el listado de personas', () => {
  it('muestra ESTAS columnas y solo estas', () => {
    montar({ usuarios: [unAlumno()] });

    expect(columnasDelDocumento()).toEqual(['Nombre', 'Email', 'Rol', 'Estado', 'Pago al dia']);
  });

  it('los filtros viajan en la URL, no en estado', async () => {
    montar({ usuarios: [] });

    await elegirFiltro('Tipo', 'Alumnos');

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/usuarios?tipo=alumno');
  });

  it('lee los filtros DE la URL al cargar', () => {
    montar({ usuarios: [], busqueda: '?tipo=profesor&activo=false' });

    expect(pedirEspia).toHaveBeenCalledWith('/usuarios?tipo=profesor&activo=false');
  });

  it('sin resultados lo dice, y no deja una tabla vacia', () => {
    montar({ usuarios: [] });

    expect(screen.getByText(/no hay nadie/i)).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
  });

  it('un 401 manda al login', () => {
    /* ... */
  });
  it('un error de red se distingue y se puede reintentar', () => {
    /* ... */
  });
});
```

Escribí los helpers `montar`, `elegirFiltro` y los dobles siguiendo el estilo de `page.spec.tsx` de la
landing, que ya resuelve montar un componente de servidor y espiar `pedir`.

- [ ] **Step 2: Verificar que falla**, implementar el listado y los filtros, y verificar que pasa.

Los filtros se escriben con `useRouter().push` y se leen con `useSearchParams()`. **Nunca con
`useState`**: un filtro en estado se pierde al navegar y no se puede compartir.

- [ ] **Step 3: La tabla compartida**

`componentes/tabla.tsx`: tabla en `md:` y tarjetas debajo, con la cabecera como `<th>` para que el test
de columnas tenga de dónde agarrarse.

- [ ] **Step 4: Verificar**

```bash
pnpm --filter @boxadmin/web exec vitest run usuarios
pnpm --filter @boxadmin/web exec tsc --noEmit
```

- [ ] **Step 5: Mutaciones**

| Mutación                                       | Debe caer                      |
| ---------------------------------------------- | ------------------------------ |
| Agregar una columna «Telefono»                 | «ESTAS columnas y solo estas»  |
| Los filtros en `useState` en vez de la URL     | «los filtros viajan en la URL» |
| Mostrar la tabla vacía en vez del estado vacío | «sin resultados lo dice»       |
| `activo=false` se omite al construir la URL    | «lee los filtros DE la URL»    |

**Y la abierta.** Pista: `UsuarioResumen` trae `tenantId` y `perfilId`, que ninguna columna necesita.

---

## Task 8: La ficha — carga y datos

**Files:**

- Crear: `usuarios/[id]/page.tsx` · `page.spec.tsx` · `bloque-datos.tsx`

- [ ] **Step 1** Tests: la ficha carga con `GET /usuarios/:id`; el formulario de datos manda **sólo los
      campos cambiados** en el `PATCH`; un 422 pinta el error **en el campo** y no en un cartel de
      arriba; los campos de alumno (`packId`, `clasesExtra`, vigencias) **no se dibujan para un
      profesor**, porque el DTO los rechaza con 400.

- [ ] **Step 2** Implementar con react-hook-form + zod, como `formulario-de-login.tsx`.

- [ ] **Step 3** Verificar y mutar:

| Mutación                                          | Debe caer                              |
| ------------------------------------------------- | -------------------------------------- |
| Mandar el formulario entero en vez de lo cambiado | el test de «sólo los campos cambiados» |
| Pintar el error del 422 en un cartel global       | el test del error en el campo          |
| Dibujar `packId` para un profesor                 | el test de los campos de alumno        |

**Y la abierta.**

---

## Task 9: La ficha — salas, estado de pago y acciones

**Files:**

- Crear: `bloque-salas.tsx` · `bloque-estado-pago.tsx` · `bloque-acciones.tsx`
- Crear: `apps/web/src/componentes/confirmar.tsx` · `confirmar.spec.tsx`

- [ ] **Step 1: Lo que no puede faltar**

```tsx
it('el bloque de resetear NO EXISTE en el DOM para un ADMIN_OPERATIVO', () => {
  montar({ rol: 'ADMIN_OPERATIVO' });

  // `queryByRole`, no una comprobacion de visibilidad: esconderlo con CSS
  // dejaria el boton ahi para quien abra las herramientas del navegador.
  expect(screen.queryByRole('button', { name: /resetear/i })).toBeNull();
});

it('un ADMIN_SALON si lo ve', () => {
  montar({ rol: 'ADMIN_SALON' });

  expect(screen.getByRole('button', { name: /resetear/i })).toBeInTheDocument();
});

it('dar de baja NOMBRA a quien afecta', async () => {
  montar({ usuario: unAlumno({ nombreCompleto: 'Ana Perez' }) });

  await clic('Dar de baja');

  expect(screen.getByText(/dar de baja a Ana Perez/i)).toBeInTheDocument();
});

it('cancelar la confirmacion NO llama a la API', async () => {
  montar({ usuario: unAlumno() });

  await clic('Dar de baja');
  await clic('Cancelar');

  expect(pedirEspia).not.toHaveBeenCalled();
});

it('guardar salas vacias no llega al servidor', async () => {
  // El DTO lo rechaza con 400 y un mensaje largo; avisar aca ahorra el viaje.
  montar({ usuario: unAlumno() });

  await desmarcarTodasLasSalas();
  await clic('Guardar salas');

  expect(pedirEspia).not.toHaveBeenCalled();
  expect(screen.getByText(/al menos una sala/i)).toBeInTheDocument();
});

// El 403 de la API, que es distinto del 403 de la puerta (Task 3). Aqui hay
// sesion y el rol alcanza para entrar al panel, pero no para ESTA accion.
it('un 403 de la API dice QUE ROL hace falta, no "algo salio mal"', async () => {
  montar({ rol: 'ADMIN_SALON' });
  apiResponde({ estado: 403 });

  await clic('Resetear contrasena');
  await confirmar();

  expect(screen.getByText(/administrador del salon/i)).toBeInTheDocument();
});

it('marcar al dia exige una fecha', async () => {
  // `cubreHasta` es obligatorio cuando `alDia` es true: lo comprueba el
  // servicio, no el DTO, asi que un olvido aqui es un 400 sin campo señalado.
  montar({ usuario: unAlumno() });

  await marcar('Al dia');
  await clic('Guardar estado');

  expect(pedirEspia).not.toHaveBeenCalled();
});
```

- [ ] **Step 2** Implementar. El diálogo de `confirmar.tsx` recibe el nombre y lo muestra; no hay
      «¿estás seguro?» genérico en ningún sitio.

- [ ] **Step 3** Verificar y mutar:

| Mutación                                                 | Debe caer                    |
| -------------------------------------------------------- | ---------------------------- |
| Esconder el reset con `hidden` en vez de no renderizarlo | «NO EXISTE en el DOM»        |
| `rolAlcanza(rol,'ADMIN_SALON')` → `'ADMIN_OPERATIVO'`    | «NO EXISTE en el DOM»        |
| El diálogo dice «¿estás seguro?» sin el nombre           | «NOMBRA a quien afecta»      |
| Cancelar igualmente ejecuta                              | «cancelar NO llama a la API» |

**Y la abierta.**

---

## Task 10: La ficha — los días fijos

**Files:**

- Crear: `bloque-dias-fijos.tsx`, `apps/web/src/hooks/use-rutinas.ts`

⚠️ **Una `Rutina` no es un plan de entrenamiento.** Es una **reserva recurrente**: perfil, sala, día de
la semana, horario y nombre del turno. Es el motor de la Fase 2. Por eso vive dentro de la ficha —«¿qué
días viene Ana?»— y no como sección propia.

- [ ] **Step 1** Tests: se listan sólo las de **esa** persona (`?perfilId=`); crear una pide día, hora,
      sala y nombre; dar de baja una confirma nombrando el día y la hora; el listado muestra los días
      **en orden de semana** y no en el que vengan.

- [ ] **Step 2** Implementar, **Step 3** verificar y mutar:

| Mutación                        | Debe caer                            |
| ------------------------------- | ------------------------------------ |
| Listar sin `perfilId`           | el test de «sólo las de esa persona» |
| Ordenar por el orden de llegada | el test del orden de semana          |

**Y la abierta.**

---

## Task 11: El alta y la contraseña temporal

**Files:**

- Crear: `usuarios/nuevo/page.tsx` · `page.spec.tsx` · `clave-temporal.tsx` · `clave-temporal.spec.tsx`

La parte más delicada de la fase. `POST /usuarios/alumnos` devuelve `AltaUsuarioRespuesta`, que incluye
`passwordTemporal`. **Se muestra una vez y no se puede releer.** Y resetearla pide `ADMIN_SALON`, así
que **el operativo que la pierde no puede repararlo solo**.

- [ ] **Step 1: Lo que no puede faltar**

```tsx
it('la clave NO viaja en la URL', async () => {
  await darDeAlta();

  expect(window.location.search).not.toContain('Temp0ral');
  expect(empujar).not.toHaveBeenCalledWith(expect.stringContaining('Temp0ral'));
});

it('no se puede seguir sin confirmar que se anoto', async () => {
  await darDeAlta();

  expect(screen.getByRole('button', { name: /listo/i })).toBeDisabled();

  await marcar(/ya la anote/i);

  expect(screen.getByRole('button', { name: /listo/i })).toBeEnabled();
});

it('la pantalla NO se cierra haciendo clic afuera', async () => {
  await darDeAlta();

  await userEvent.click(document.body);

  expect(screen.getByText('Temp0ral!')).toBeInTheDocument();
});

it('dice que no se va a poder volver a ver', async () => {
  await darDeAlta();

  expect(screen.getByText(/no vas a poder verla de nuevo/i)).toBeInTheDocument();
});

// Las advertencias no son errores: el alta salio bien Y hay algo que mirar.
it('las advertencias del alta se muestran JUNTO a la clave', async () => {
  await darDeAlta({ advertencias: [{ codigo: 'SIN_SALAS', mensaje: 'No tiene salas asignadas' }] });

  expect(screen.getByText(/no tiene salas asignadas/i)).toBeInTheDocument();
});

it('sin advertencias no se dibuja el hueco', async () => {
  await darDeAlta({ advertencias: [] });

  expect(screen.queryByRole('status')).toBeNull();
});

// El alta de profesor NO acepta packId ni vigencias: con
// `forbidNonWhitelisted` mandarlos es un 400.
it('el formulario de profesor no tiene campos de alumno', async () => {
  montar({ tipo: 'profesor' });

  expect(screen.queryByLabelText(/pack/i)).toBeNull();
  expect(screen.queryByLabelText(/vigencia/i)).toBeNull();
});
```

- [ ] **Step 2** Implementar. La clave vive en estado del cliente tras la mutación; **nunca** en la URL
      ni en `sessionStorage`.

- [ ] **Step 3** Verificar y mutar:

| Mutación                                           | Debe caer                           |
| -------------------------------------------------- | ----------------------------------- |
| El botón «Listo» arranca habilitado                | «no se puede seguir sin confirmar»  |
| Pasar la clave por query al navegar                | «la clave NO viaja en la URL»       |
| Usar un diálogo que se cierra al hacer clic afuera | «NO se cierra haciendo clic afuera» |
| Descartar `advertencias` de la respuesta           | «las advertencias se muestran»      |
| Dibujar `packId` en el formulario de profesor      | «no tiene campos de alumno»         |

**Y la abierta.** Pista: es la pantalla donde más fácil es **agregar** algo — la familia que encontró
algo las seis veces en la 6B.

---

## Task 12: Invitaciones

**Files:**

- Crear: `invitaciones/page.tsx` · `page.spec.tsx`, `apps/web/src/hooks/use-invitaciones.ts`

Listar, crear y editar en una sola pantalla.

⚠️ **El `codigo` no se puede cambiar**: es una credencial ya repartida, y rotarla silenciosamente
dejaría fuera a quien la tuviera. El formulario de edición **no lo ofrece**. Para eso se desactiva la
clave y se crea otra.

- [ ] **Step 1** Tests: el campo `codigo` no existe en el formulario de edición; crear exige nombre y
      **al menos una sala**; `usosMax` vacío significa ilimitada y **no cero**; una clave agotada o
      vencida se distingue visualmente de una desactivada a mano.

- [ ] **Step 2** Implementar, **Step 3** verificar y mutar:

| Mutación                      | Debe caer                     |
| ----------------------------- | ----------------------------- |
| Ofrecer editar el `codigo`    | el test del campo inexistente |
| `usosMax` vacío → `0`         | el test de ilimitada          |
| Permitir crear con cero salas | el test de al menos una sala  |

**Y la abierta.**

---

## Task 13: Verificación final, README y tracker

- [ ] **Step 1: Todo verde**

```bash
cd /d/Dev/box-admin/apps/web && pnpm exec tsc --noEmit && pnpm test && pnpm build && pnpm test:e2e
cd /d/Dev/box-admin/apps/api && pnpm exec tsc --noEmit && pnpm exec jest --silent
cd /d/Dev/box-admin && pnpm api:test:e2e
```

⚠️ **No corras `pnpm lint`.** Para formato, `pnpm exec prettier --check` sobre lo que hayas creado.

⚠️ `apps/api` tiene que seguir en **1291 tests / 65 suites** y los e2e en **204 / 12**: esta fase no
toca la API, así que cualquier cambio ahí es un error.

- [ ] **Step 2: El checklist a mano**

Lo que ningún test automático ve:

- Entrar como `ADMIN_OPERATIVO` y comprobar que **no aparece** el botón de resetear contraseña.
- Entrar como alumno a `/{slug}/admin` y comprobar que **no hay bucle**: sale la pantalla de sin
  permiso, no una ida y vuelta al login.
- Dar de alta a un alumno de verdad y comprobar que la contraseña temporal **no se puede saltear** ni se
  pierde al recargar la página.
- Abrir el panel, mirar `Application → Cache Storage` en el navegador y comprobar que **no hay ninguna
  entrada del panel**.
- Abrir el panel en un teléfono y comprobar que el listado sigue siendo usable.

- [ ] **Step 3: README y tracker**

Sección «El panel del admin — Fase 7» en `README.md`, **antes de `## Tests`**. ⚠️ Insertala anclando a
una línea entera (`\n## Tests\n`) y a la **última** aparición: `## Tests` es subcadena de un `### Tests`
anterior, y anclar mal parte ese encabezado en dos.

Y el bloque de la Fase 7 en `docs/superpowers/plans/PROGRESO.md`, con el formato de los anteriores:
tareas, decisiones, **los errores de este plan que encontraste**, trampas nuevas, estado final y deuda.

---

## Lo que esta fase NO hace

- Las otras cuatro áreas del panel (Operación diaria, Dinero, Análisis, Configuración).
- Paginación y búsqueda por texto: la API no las tiene, e inventarlas en el cliente daría la ilusión de
  una capacidad que no existe.
- Pantallas de profesor. Sus endpoints existen desde la Fase 4 y siguen sin cara; el profesor cae en el
  calendario como hoy. **Deuda anotada.**
- Mandar la contraseña temporal por email.
- Cambiar qué rol puede resetear contraseñas.
- **Cualquier cambio en `apps/api`.**
