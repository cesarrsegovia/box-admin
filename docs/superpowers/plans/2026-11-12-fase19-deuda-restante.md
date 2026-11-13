# Fase 19 — La deuda que queda

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans`, tarea por tarea. Los pasos llevan casillas (`- [ ]`).

**Objetivo:** que un 401 en cualquier lectura o escritura de la web lleve al login con el texto común;
que invitaciones traduzca el 403; que la API no tenga más tests que dependan del calendario; y cerrar
los dos huecos del grupo D que se pueden cerrar.

**Arquitectura:** un `QueryCache.onError` en `crearClienteDeDatos` gemelo del `MutationCache.onError`
que ya existe, con el mismo `saliendo`; `textoDelError` en los lugares que pintan el `.message` crudo;
push y check-in envueltos en `useMutation` (nuevos hooks en `src/hooks/`); un archivo de setup de Jest
que adelanta `Date`; y dos canales más en el guardián `src/test/espia-de-consola.ts`.

**Spec:** `docs/superpowers/specs/2026-11-12-fase19-deuda-restante.md`

---

## Reglas que gobiernan todo este plan

⚠️ **No hacés commits.** Nunca `git add`, `git commit`, `git push`, `git stash`, `git checkout`,
`git reset` **ni `git mv`**. `git status`, `git diff` y `git show` sí. Los commits los hace Cesar.

⚠️ **Nunca `pnpm lint`** (el script lleva `--fix`). Si querés eslint, sin `--fix`:
`pnpm --filter @boxadmin/web exec eslint <archivos>` (o `@boxadmin/api`).

⚠️ **Prettier:** `node D:/Dev/box-admin/node_modules/prettier/bin/prettier.cjs --check <archivos>`
**sólo sobre lo que tocás** (no `.bin/prettier` desde PowerShell). `--write` sólo sobre archivos tuyos.
`apps/api/src` **nunca pasó `--check` entero**: si un archivo de la API ya fallaba en `HEAD`
(`git show HEAD:<ruta> | node …/prettier.cjs --stdin-filepath <ruta> --check`), no lo reformatees:
anotalo. `PROGRESO.md` ya falla en tablas viejas (~2497–3086): no las toques.

⚠️ **Nunca `taskkill` ni `Stop-Process` por NOMBRE de proceso.** Hay una sesión viva de Claude Code en
la máquina. Por PID concreto y sólo los que levantaste vos.

⚠️ **`docker compose up` pelado está prohibido.** Si hace falta: `docker compose up -d postgres
postgres-test redis` desde la raíz. Esta fase no necesita los e2e salvo en el cierre.

⚠️ **Nada de strings con barra invertida por heredoc.** Usá la herramienta de edición. **No uses
`sed -i` sobre archivos CRLF** (quita los CR); respetá el fin de línea de cada archivo.

⚠️ **`packages/shared` no se toca.** `apps/api` sólo en la T6 (tests y `package.json`, y el parámetro
`ahora` si un servicio no lo deja inyectar).

⚠️ **Vitest y las rutas con corchetes o paréntesis** (`[slug]`, `(alumno)`): sólo funcionan **desde
PowerShell** y con un **filtro por subcadena**, p. ej. `pnpm --filter @boxadmin/web exec vitest run
bloque-vacaciones`.

**Comandos** (desde la raíz):

```bash
pnpm --filter @boxadmin/web exec vitest run <filtro>
pnpm --filter @boxadmin/web test
pnpm --filter @boxadmin/web exec tsc --noEmit
pnpm --filter @boxadmin/web build
pnpm --filter @boxadmin/api exec jest <ruta-o-patron>
pnpm --filter @boxadmin/api test
pnpm --filter @boxadmin/api exec tsc --noEmit
```

**Punto de partida (medido al cerrar las Fases 17 y 18):** web **2041 / 96**, api **1435 / 71**,
e2e **223 / 13**. **Medí web y api de nuevo antes de empezar** y anotá lo que dé.

⚠️ **Antes de nada: `grep -rn "MUTACION TEMPORAL" apps`.** Tiene que dar cero.

### La mutación abierta

Cada tarea termina con una: **cambiar algo que no debería cambiar**, marcado `// MUTACION TEMPORAL`.
Correr la suite de la tarea. **Si pasa en verde, o se cierra el agujero —con un test que se vea rojo— o
se reporta.** Después, quitarla y volver a verde.

### Las cinco formas de que un test no pueda fallar

1. **Autorreferencial** — comparar la salida contra la misma función que la produce.
2. **Premisa destruida** — el código bajo prueba borra el borde que el test venía a ejercitar.
3. **Montado en el caso ciego** — fijar algo en el único escenario donde la distinción no existe (p. ej.
   probar el texto del 401 con un error cuyo `.message` ya es el texto común).
4. **Verde por casualidad ortográfica** — un `toContain` que pasa con texto de más.
5. **El fixture habla el idioma del código y no el del contrato.**

### El guardián de consola

`apps/web/src/test/espia-de-consola.ts` corre en **todos** los specs de la web: prohíbe escribir en
consola, mover la URL del documento y filtrar centinelas (datos secretos registrados) por una lista de
canales. **Un spec no puede llamar a `window.location.assign`**: por eso los specs de pantalla usan un
`QueryClient` pelado y la navegación se prueba en `lib/query.spec.tsx` con `ir` y `donde` inyectados.

---

## Estructura de archivos

```
apps/web/src/
  lib/query.tsx · query.spec.tsx                         TOCAR  QueryCache.onError (T1)
  app/[slug]/… (tabla de la T2) y sus specs              TOCAR  textoDelError (T2)
  hooks/use-push.ts · use-push.spec.tsx                  CREAR  (T3)
  hooks/use-check-in.ts · use-check-in.spec.tsx          CREAR  (T3)
  componentes/boton-de-push.tsx · .spec.tsx              TOCAR  (T3)
  app/[slug]/checkin/pantalla-de-check-in.tsx · page.spec.tsx  TOCAR  (T3)
  app/[slug]/admin/invitaciones/formulario.tsx · page.spec.tsx TOCAR  (T4)
  test/espia-de-consola.ts                               TOCAR  dos canales (T5)
  test/lo-que-el-marcado-no-serializa.spec.ts            TOCAR  guardián del canal de atributos (T5)
  app/[slug]/admin/usuarios/nuevo/clave-temporal.spec.tsx · page.spec.tsx,
  app/[slug]/admin/invitaciones/page.spec.tsx            TOCAR  usan el doble del portapapeles (T5)
apps/api/
  test/reloj-adelantado.ts                               CREAR  (T6)
  package.json                                           TOCAR  script test:reloj (T6)
  src/**/*.spec.ts (los que se pongan rojos)             TOCAR  (T6)
README.md · docs/superpowers/plans/PROGRESO.md           TOCAR  (T7)
```

El spec numera 6 tareas; este plan parte la primera en dos (T1 navegación, T2 texto) y pone el grupo D
antes que el reloj.

---

## Tarea 1: el 401 de las lecturas navega, desde `lib/query.tsx`

**Files:**

- Modify: `apps/web/src/lib/query.tsx`
- Test: `apps/web/src/lib/query.spec.tsx`

- [ ] **Paso 1: invertir el test viejo y agregar los nuevos**

En `lib/query.spec.tsx`, **reemplazar** el test «una LECTURA con 401 no lo dispara: eso lo decide cada
pantalla» por este bloque, y agregar el ayudante `leerConFallo` junto a `escribirConFallo`:

```tsx
async function leerConFallo(cliente: QueryClient, error: unknown, clave = 'algo'): Promise<void> {
  await cliente
    .fetchQuery({ queryKey: [clave], queryFn: () => Promise.reject(error) })
    .catch(() => undefined);
}
```

```tsx
  it('una LECTURA con 401 tambien manda al login, con la vuelta a donde estaba', async () => {
    await leerConFallo(crear(), CADUCADA);

    expect(ir.mock.calls).toEqual([
      ['/mi-gym/login?volverA=%2Fmi-gym%2Fadmin%2Fusuarios%3Ftipo%3Dalumno'],
    ]);
  });

  it.each([
    ['un 403', new ErrorDeApi('Forbidden', 403)],
    ['un 404', new ErrorDeApi('No existe', 404)],
    ['sin conexion', new ErrorDeApi('Sin conexion', 0)],
    ['un Error comun', new Error('se rompio')],
  ])('una lectura con %s no navega', async (_caso, error) => {
    await leerConFallo(crear(), error);

    expect(ir).not.toHaveBeenCalled();
  });

  it('una lectura y una escritura con 401 a la vez mandan UNA sola vez', async () => {
    const cliente = crear();

    await Promise.all([
      leerConFallo(cliente, CADUCADA),
      leerConFallo(cliente, CADUCADA, 'otra'),
      escribirConFallo(cliente, CADUCADA),
    ]);

    expect(ir).toHaveBeenCalledTimes(1);
  });

  it('en el login una lectura con 401 no navega: ya esta ahi', async () => {
    const cliente = crearClienteDeDatos(ir, () => ({ pathname: '/mi-gym/login', search: '' }));

    await leerConFallo(cliente, CADUCADA);

    expect(ir).not.toHaveBeenCalled();
  });
```

- [ ] **Paso 2: verlos rojos**

Run: `pnpm --filter @boxadmin/web exec vitest run lib/query.spec`
Expected: FAIL «una LECTURA con 401 tambien manda al login» (`ir` no se llamó). Los de «no navega» y el
del login pasan ya: anotalo, son los de control.

- [ ] **Paso 3: el `QueryCache`**

En `lib/query.tsx`: importar `QueryCache` de `@tanstack/react-query`, sacar el cuerpo del `onError`
a una función local que comparten los dos, y **reescribir el docblock** de `crearClienteDeDatos`
(hoy dice «Las lecturas no»):

```tsx
/**
 * El cliente de datos de la app.
 *
 * UN 401 MANDA AL LOGIN, desde aqui y para todo: lecturas y escrituras. Antes
 * solo las escrituras; las lecturas dependian de que cada pantalla atajara el
 * 401 de su lectura principal, y las que no lo hacian —las cinco de
 * configuracion, mi-pack, los comprobantes y el calendario del alumno, y las
 * lecturas internas de las fichas— se quedaban pintando «Unauthorized».
 *
 * Las pantallas que ya atajan su 401 con su propio `router.push` lo siguen
 * haciendo: van al mismo destino, asi que es una redundancia y no un conflicto.
 *
 * `window.location.assign` y no el router: la recarga entera tira esta cache, y
 * con ella cualquier dato de la sesion que vencio. `saliendo` es UNO para los
 * dos caches: una lectura y una escritura que fallan juntas navegan una vez.
 * `ir` y `donde` se inyectan solo para los tests: el guardian de consola
 * prohibe a un spec mover la URL del documento, asi que el spec no puede
 * ponerse en `/mi-gym/admin/...`.
 */
export function crearClienteDeDatos(
  ir: (destino: string) => void = (destino) => window.location.assign(destino),
  donde: () => { pathname: string; search: string } = () => window.location,
): QueryClient {
  let saliendo = false;

  const alFallar = (error: Error): void => {
    if (saliendo) return;
    const destino = destinoSiCaducoLaSesion(error, donde());
    if (destino === null) return;
    saliendo = true;
    ir(destino);
  };

  return new QueryClient({
    queryCache: new QueryCache({ onError: alFallar }),
    mutationCache: new MutationCache({ onError: alFallar }),
    defaultOptions: {
      // … sin cambios
    },
  });
}
```

- [ ] **Paso 4: verde**

Run: `pnpm --filter @boxadmin/web exec vitest run lib/query.spec` → PASS.

- [ ] **Paso 5: la suite entera**

Run: `pnpm --filter @boxadmin/web test`. Tiene que dar el número de partida más los tests nuevos, todo
verde. Si algún spec de pantalla usa `crearClienteDeDatos` o `ProveedorDeDatos` en vez de un
`QueryClient` pelado y ahora navega, **pará y reportalo**: no lo arregles callando el guardián.

- [ ] **Paso 6: mutación abierta**

`// MUTACION TEMPORAL`: darle a `queryCache` su propio `let saliendoAlLeer` en vez del compartido.
Esperado: rojo en «una lectura y una escritura con 401 a la vez mandan UNA sola vez». Quitarla.

---

## Tarea 2: el texto del 401 en las lecturas que pintan el `.message` crudo

**Files:** los de la tabla, y el spec de cada uno.

Lo que se lee el instante antes de salir tiene que ser `TEXTO_DE_SESION_CADUCADA`, no «Unauthorized»,
«Sin sesion» ni «Sesion expirada» (los tres textos que puede traer un 401: el proxy
`app/api/bx/[...ruta]/route.ts` contesta `'Sin sesion'` y `'Sesion expirada'`, y si no el mensaje del
backend). El arreglo es **siempre el mismo**: donde se pinta `error.message`, pintar
`textoDelError(error)` (de `@/lib/errores-de-api`). **Si hay un prefijo** («No se pudieron leer los
pagos: »), el prefijo se queda.

- [ ] **Paso 1: volver a medir**

```bash
cd apps/web/src && grep -rn "\.message" app componentes --include=*.tsx | grep -v "spec\.tsx" | grep -v "errors\.\|textoDelError\|mensajeDeFallo"
```

Clasificá cada línea: (a) lectura que pinta el crudo **sin** control previo del 401 → entra; (b) ya
protegida (`!sesionCaducada` delante, o `return null` ante un 401) → no; (c) escritura que ya pasa por
`textoDelError` o `mensajeDeFallo` → no; (d) push y check-in → son de la T3. La tabla de abajo es lo
medido al diseñar; **si aparece otro de tipo (a), entra**; si uno de la tabla resultó ya protegido,
anotalo y no lo toques.

| Archivo (`apps/web/src/app/[slug]/…`)                | Línea aprox. | Cómo simula el 401 su spec hoy                                                                                                                                       |
| ---------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin/usuarios/[id]/bloque-vacaciones.tsx`          | 261          | `admin/usuarios/[id]/page.spec.tsx`: `montar({ errorDeVacaciones: new ErrorDeApi('Unauthorized', 401) })`                                                           |
| `admin/usuarios/[id]/bloque-pagos.tsx`               | 639          | `bloque-pagos.spec.tsx`: ya monta `vi.mock('@/lib/cliente', …)` con `pedirEspia`; rechazar la lectura de pagos                                                       |
| `admin/usuarios/[id]/bloque-turnos-libres.tsx`       | 330          | `bloque-turnos-libres.spec.tsx`: ídem; la lectura sale al pulsar «Buscar donde hay lugar»                                                                            |
| `admin/turnos/[id]/bloque-anotados.tsx` (anotados)   | 251          | `bloque-anotados.spec.tsx`: ídem, rechazar la lectura de reservas del turno                                                                                          |
| `admin/turnos/[id]/bloque-anotados.tsx` (reasignar)  | 496          | ídem, rechazar la lectura de turnos al abrir «Reasignar»                                                                                                             |
| `admin/salas/[id]/page.tsx`                          | 579          | `page.spec.tsx` ~772: `montar({ error: new ErrorDeApi('Unauthorized', 401) })` (hoy sólo afirma la redirección)                                                      |
| `admin/usuarios/[id]/page.tsx`                       | 61           | su `page.spec.tsx`                                                                                                                                                   |
| `admin/turnos/[id]/page.tsx`                         | 59           | su `page.spec.tsx` ~421: `pedirEspia.mockRejectedValue(…)`                                                                                                           |
| `admin/configuracion/checkin/page.tsx`               | 171          | su spec                                                                                                                                                              |
| `admin/configuracion/web/page.tsx`                   | 362          | su spec                                                                                                                                                              |
| `admin/configuracion/packs/page.tsx`                 | 880          | su spec                                                                                                                                                              |
| `admin/configuracion/email/page.tsx`                 | 376          | su spec                                                                                                                                                              |
| `admin/configuracion/email/plantillas.tsx`           | 557          | su spec                                                                                                                                                              |
| `(alumno)/comprobantes/page.tsx`                     | 26           | su spec                                                                                                                                                              |
| `(alumno)/mi-pack/page.tsx`                          | 17           | su spec                                                                                                                                                              |
| `(alumno)/calendario/vista-de-semana.tsx`            | 71           | `vista-de-semana.spec.tsx` se burla del hook entero: devolver `{ isError: true, isPending: false, data: undefined, error: new ErrorDeApi('Unauthorized', 401) }` en `useTurnosDisponibles` |

- [ ] **Paso 2: un test por lugar, rojo primero**

En el spec de cada lugar, con **su** forma de simular el error (columna de la tabla), un test con esta
forma. **Usar «Unauthorized» como `.message`**, nunca el texto común (forma 3: el caso ciego):

```tsx
it('un 401 al leer <lo que lee> dice que la sesion caduco, no «Unauthorized»', async () => {
  // montar con la lectura rechazada con new ErrorDeApi('Unauthorized', 401)

  expect(await screen.findByText(TEXTO_DE_SESION_CADUCADA, { exact: false })).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('Unauthorized');
});
```

Donde hay prefijo, afirmar el texto **entero** del aviso (`toHaveTextContent` sobre el elemento, o
`textContent` con `toBe`), p. ej. `` `${NO_SE_PUDO_LEER}${TEXTO_DE_SESION_CADUCADA}` ``: así un texto de
más también se pone rojo (forma 4).

Run: el spec de cada uno, desde PowerShell con filtro por subcadena. Expected: FAIL, se lee
«Unauthorized».

- [ ] **Paso 3: el arreglo, lugar por lugar**

```tsx
import { textoDelError } from '@/lib/errores-de-api';
// …
<Aviso>{textoDelError(error)}</Aviso>
// o, con prefijo:
{NO_SE_PUDO_LEER}{textoDelError(error)}
```

Si en un lugar `error` puede ser `null` en el tipo, respetá la guarda que ya tenga. No cambies **cuándo**
se muestra el aviso ni el botón «Reintentar».

- [ ] **Paso 4: verde, lugar por lugar, y la suite entera**

Run: cada spec → PASS. Después `pnpm --filter @boxadmin/web test` y
`pnpm --filter @boxadmin/web exec tsc --noEmit`.

- [ ] **Paso 5: mutación abierta**

`// MUTACION TEMPORAL`: devolver **uno** de los lugares (p. ej. `bloque-turnos-libres.tsx`) a
`error.message`. Esperado: rojo en su test. Quitarla.

---

## Tarea 3: push y check-in pasan a `useMutation`

**Files:**

- Create: `apps/web/src/hooks/use-push.ts`, `apps/web/src/hooks/use-push.spec.tsx`
- Create: `apps/web/src/hooks/use-check-in.ts`, `apps/web/src/hooks/use-check-in.spec.tsx`
- Modify: `apps/web/src/componentes/boton-de-push.tsx`, `boton-de-push.spec.tsx`
- Modify: `apps/web/src/app/[slug]/checkin/pantalla-de-check-in.tsx`, `page.spec.tsx`

**Por qué en `src/hooks/`:** el guardián `src/test/mutaciones-sin-gctime.ts` barre ese directorio y
exige `gcTime: 0` en cada `useMutation`. Una suscripción push lleva el endpoint y las claves del
navegador; un check-in lleva la firma del QR. Puestos ahí, nacen cubiertos.

- [ ] **Paso 1: los hooks, test primero**

`hooks/use-push.spec.tsx` y `hooks/use-check-in.spec.tsx` con `montar` y `dobleDeFetch`/`dobleQueFalla`
de `@/test/andamiaje-de-hooks` (mirá cómo lo usa `hooks/use-vacaciones.spec.tsx`). Por hook:

- manda el método, la ruta y el cuerpo exactos (`POST /push/suscripcion` con el cuerpo serializado;
  `DELETE /push/suscripcion` con y sin `?endpoint=` codificado; `POST /checkin` con `{ firma }`);
- **un 401 pasa por el `MutationCache`**: montar con un `QueryClient` propio cuyo
  `mutationCache: new MutationCache({ onError: espia })`, hacer fallar con 401 y afirmar
  `expect(espia).toHaveBeenCalledWith(expect.objectContaining({ estado: 401 }), …)`. Este es el test
  que dice que el `MutationCache` **ve** la escritura: sin él, la T3 no prueba nada.

Run: `pnpm --filter @boxadmin/web exec vitest run use-push use-check-in` → FAIL (no existen).

- [ ] **Paso 2: los hooks**

```ts
// hooks/use-push.ts
'use client';

import { useMutation } from '@tanstack/react-query';
import { type ErrorDeApi, pedir } from '@/lib/cliente';

/**
 * Las dos escrituras de las notificaciones push.
 *
 * Son `useMutation` y no un `pedir` suelto por una sola razon: asi las ve el
 * `MutationCache` de `lib/query.tsx`, que manda al login ante un 401. Con el
 * `pedir` suelto, un alumno con la sesion vencida leia «Unauthorized» y se
 * quedaba en el perfil. `gcTime: 0` porque la suscripcion lleva el endpoint y
 * las claves de este navegador (ver `src/test/mutaciones-sin-gctime.ts`).
 */
export function useGuardarSuscripcion() {
  return useMutation<unknown, ErrorDeApi, unknown>({
    mutationFn: (suscripcion) =>
      pedir('/push/suscripcion', { metodo: 'POST', cuerpo: suscripcion }),
    gcTime: 0,
  });
}

/** Sin endpoint la API borra TODOS los dispositivos del alumno: ver `boton-de-push.tsx`. */
export function useBorrarSuscripcion() {
  return useMutation<unknown, ErrorDeApi, string | null>({
    mutationFn: (endpoint) =>
      pedir(
        endpoint === null
          ? '/push/suscripcion'
          : `/push/suscripcion?endpoint=${encodeURIComponent(endpoint)}`,
        { metodo: 'DELETE' },
      ),
    gcTime: 0,
  });
}
```

```ts
// hooks/use-check-in.ts
'use client';

import { useMutation } from '@tanstack/react-query';
import type { PresenteMarcado } from '@boxadmin/shared';
import { type ErrorDeApi, pedir } from '@/lib/cliente';

/**
 * Marcar el presente con la firma del QR.
 *
 * `useMutation` para que un 401 lo vea el `MutationCache` y mande al login. El
 * destino conserva la URL entera —`/{slug}/checkin?f=<firma>`—, asi que el
 * alumno vuelve con la firma y no tiene que escanear otra vez. `gcTime: 0`
 * porque la firma es la llave del presente.
 */
export function useMarcarPresente() {
  return useMutation<PresenteMarcado, ErrorDeApi, string>({
    mutationFn: (firma) =>
      pedir<PresenteMarcado>('/checkin', { metodo: 'POST', cuerpo: { firma } }),
    gcTime: 0,
  });
}
```

Si `PresenteMarcado` no sale de `@boxadmin/shared`, importalo de donde lo importa hoy
`pantalla-de-check-in.tsx`. Copiá el `'use client'` sólo si los otros hooks lo llevan.

Run: `… vitest run use-push use-check-in mutaciones-sin-gctime` → PASS.

- [ ] **Paso 3: los componentes usan los hooks, con `mutateAsync`**

`boton-de-push.tsx`: `const guardar = useGuardarSuscripcion(); const borrar = useBorrarSuscripcion();`
y **sólo** las dos llamadas a `pedir` cambian:

```tsx
await guardar.mutateAsync(serializar(suscripcion));
// …
await borrar.mutateAsync(suscripcion === null ? null : suscripcion.endpoint);
```

**Todo lo demás queda igual**, con sus comentarios: el `unsubscribe` si el POST falla, el 503 →
`'sin-configurar'`, el orden servidor/navegador del DELETE, el `setEstado('inactivo')` antes del
`unsubscribe`. Los dos `setError(fallo instanceof Error ? fallo.message : …)` pasan a
`setError(fallo instanceof Error ? textoDelError(fallo) : …)`. Sacá `pedir` del import si ya no se usa
(`ErrorDeApi` sigue, por el 503).

`pantalla-de-check-in.tsx`: `const marcarPresente = useMarcarPresente();` y en `marcar`:

```tsx
const datos = await marcarPresente.mutateAsync(laFirma);
```

con `marcarPresente.mutateAsync` en las dependencias del `useCallback` (es estable en TanStack v5: el
`useRef` que evita el doble POST sigue funcionando; **comprobalo** con el test de «una vez por firma»
que ya tenga el spec). `setEstado({ tipo: 'error', mensaje: error.message })` pasa a
`mensaje: textoDelError(error)`. `rechazoDeCheckIn` (sólo 409) no cambia.

- [ ] **Paso 4: los specs de los componentes montan con un `QueryClientProvider`**

`boton-de-push.spec.tsx` y `checkin/page.spec.tsx` hoy hacen `render(<…/>)` sin proveedor: con
`useMutation` revientan («No QueryClient set»). Agregá en cada spec un envoltorio local con un
`QueryClient` pelado (`new QueryClient({ defaultOptions: { mutations: { retry: false } } })`, uno por
test) y pasalo como `wrapper` a `render`. **No cambies ninguna afirmación existente**: tienen que pasar
tal cual. Si una no pasa, pará y reportalo.

Y un test nuevo en cada uno, rojo antes del Paso 3 si lo escribís primero:

```tsx
it('un 401 al activar dice que la sesion caduco, no «Unauthorized»', async () => {
  // el doble de la red contesta 401 con { message: 'Unauthorized' } al POST de la suscripcion
  // pulsar «Activar»
  expect(await screen.findByText(TEXTO_DE_SESION_CADUCADA)).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('Unauthorized');
});
```

Lo mismo para desactivar y para el check-in (con la firma del QR). Mirá cómo cada spec dobla la red hoy
y usá esa forma.

Run: `pnpm --filter @boxadmin/web exec vitest run boton-de-push checkin` → PASS; después la suite
entera y `tsc --noEmit`.

- [ ] **Paso 5: mutación abierta**

`// MUTACION TEMPORAL`: en `use-check-in.ts`, sacar el `gcTime: 0`. Esperado: rojo en
`mutaciones-sin-gctime.spec`. Quitarla. Segunda: en `pantalla-de-check-in.tsx`, volver a llamar a
`pedir` directo. Esperado: rojo en el test del 401 de check-in si afirma el `MutationCache`; **si queda
verde, el test de la pantalla no prueba que pasa por la mutación**: anotalo (lo cubre el del hook) y
seguí.

---

## Tarea 4: el 403 de invitaciones

**Files:**

- Modify: `apps/web/src/app/[slug]/admin/invitaciones/formulario.tsx` (~143–190)
- Test: `apps/web/src/app/[slug]/admin/invitaciones/page.spec.tsx` (~663)

La ruta pide `ADMIN_OPERATIVO` (`apps/api/src/invitaciones/invitaciones.controller.ts`). Las otras siete
pantallas con `repartirPorCampo` traducen el 403 antes de repartir (p. ej. `admin/salas/page.tsx` ~118).

- [ ] **Paso 1: el test, rojo**

Reemplazar la afirmación del test «un 403 de la API se explica por el rol, no como «algo salio mal»»:

```tsx
    // El 403 se traduce antes de repartir: «Forbidden» no nombra ningun campo y
    // quedaria suelto, en ingles, en el cartel de arriba.
    expect(screen.getByRole('alert').textContent).toBe(
      'Para esto hace falta ser administrador operativo. Tu rol no alcanza.',
    );
    expect(document.body.textContent).not.toMatch(/forbidden/i);
```

El texto va **literal** y no por `mensajeDeFallo(…)`: si no, el test es autorreferencial (forma 1).
Run: `… vitest run invitaciones` → FAIL.

- [ ] **Paso 2: el arreglo**

```tsx
  const fallo = guardar.error instanceof ErrorDeApi ? guardar.error : null;
  // EL 403 SE TRADUCE, antes de repartir: «Forbidden» no nombra ningun campo,
  // asi que `repartirPorCampo` lo dejaria suelto y en ingles en el cartel.
  const sinPermiso = fallo !== null && fallo.estado === 403;
  const repartido =
    fallo === null || sinPermiso ? null : repartirPorCampo(fallo, CAMPOS_DE_LA_CLAVE);
```

```tsx
      {sinPermiso && <Aviso tono="error">{mensajeDeFallo(fallo, 'ADMIN_OPERATIVO')}</Aviso>}
      {repartido !== null && repartido.sueltas.length > 0 && (
        <Aviso tono="error">{repartido.sueltas.join(' ')}</Aviso>
      )}
```

Importar `mensajeDeFallo` junto a `repartirPorCampo`. Si TypeScript no estrecha `fallo` dentro del JSX,
usá `fallo !== null && fallo.estado === 403 && …` en el JSX en vez de `sinPermiso`.

Run: → PASS. El test del 401 de al lado tiene que seguir verde.

- [ ] **Paso 3: mutación abierta**

`// MUTACION TEMPORAL`: `'ADMIN_SALON'` en vez de `'ADMIN_OPERATIVO'`. Esperado: rojo. Quitarla.

---

## Tarea 5: grupo D — dos canales más en el guardián

**Files:**

- Modify: `apps/web/src/test/espia-de-consola.ts`
- Modify: `apps/web/src/test/lo-que-el-marcado-no-serializa.spec.ts`
- Modify: `app/[slug]/admin/usuarios/nuevo/clave-temporal.spec.tsx`, `usuarios/nuevo/page.spec.tsx`,
  `admin/invitaciones/page.spec.tsx`

⚠️ **Antes de tocar, leé** en `espia-de-consola.ts`: el comentario del portapapeles (~1252–1305), el
de `CREAR_UNA_URL_DE_OBJETO_ORIGINAL` y el que nombra «EL CUARTO VECINO» (~4350), `escondidoEnElCuerpo`
(~3080–3115) y cómo se registran y comprueban los canales (`beforeEach`/`afterEach`, centinelas,
`claveSegura`, `TECLEADO_POR_LA_PERSONA`). Seguí **sus** convenciones de nombre, numeración de canales
y tono de los comentarios. El archivo cuenta los canales: actualizá el recuento donde aparezca.

### 5a. Los atributos de los descendientes del `<body>` (la 42 de la Fase 12)

Hoy `escondidoEnElCuerpo` recorre `document.body.querySelectorAll('*')` y mira sólo `.value` y
`shadowRoot`; los atributos los mira el canal doce y **sólo** en `documentElement` y `body`.

- [ ] **Paso 1: el guardián, rojo**

En `lo-que-el-marcado-no-serializa.spec.ts`, con la forma de los tests que ya tiene para
`escondidoEnElCuerpo`: un `<div title="CENTINELA">` (o el valor que usen esos tests) dentro del
`<body>` aparece en `escondidoEnElCuerpo()` con un `sitio` que nombra el atributo; y un `<input>` en
`TECLEADO_POR_LA_PERSONA` **no** reporta su atributo `value`. Run: `… vitest run lo-que-el-marcado` →
FAIL.

- [ ] **Paso 2: el barrido**

Dentro del mismo `for`, después del `.value`:

```ts
    // LOS ATRIBUTOS DE CADA DESCENDIENTE. El canal doce los mira solo en
    // `documentElement` y `body`; un `title={dato}` en un `<form>` pasaba en
    // verde (la 42 de la Fase 12, y otra vez la T5 de la Fase 16). El `value`
    // de un campo donde la persona escribio se resta, igual que su `.value`:
    // React lo refleja como atributo.
    for (const atributo of nodo.attributes) {
      if (atributo.value === '') continue;
      if (atributo.name === 'value' && TECLEADO_POR_LA_PERSONA.has(nodo)) continue;
      escondites.push({
        sitio: `el atributo ${claveSegura(atributo.name)} de un ${nombreDelNodo(nodo)}`,
        contenido: atributo.value,
      });
    }
```

Actualizá el docblock de `escondidoEnElCuerpo` y la nota de deuda que dice que la 42 sigue abierta.

- [ ] **Paso 3: la suite entera — acá se mide**

Run: `pnpm --filter @boxadmin/web test`. **Si algún spec de pantalla se pone rojo**, es una de dos:
una fuga real (un dato secreto en un atributo) o una pantalla que muestra un centinela en un atributo
**a propósito** (p. ej. un `value` de un campo de solo lectura con el código de invitación). **No
agregues excepciones por tu cuenta: pará y reportá** cada rojo con el archivo, el atributo y si es
legítimo.

- [ ] **Paso 4: mutación abierta**

`// MUTACION TEMPORAL`: `title={tenantId}` (o el centinela que tenga a mano la pantalla) en el `<form>`
de una pantalla con spec, como en la T5 de la Fase 16. Esperado: rojo. Quitarla.

### 5b. `navigator.clipboard` (la 46b)

El comentario de ~1252 dice cómo se tapa: **montar `navigator.clipboard` UNA vez para todo el paquete,
desde el guardián**, en lugar de que tres specs lo pisen desde dentro del test. Y el problema de los
centinelas (el panel copia secretos **a propósito** en dos pantallas) se resuelve así: **lo que se
copió queda registrado; el spec que copia a propósito lo reclama; lo que quede sin reclamar y contenga
un centinela, pone rojo el test.**

- [ ] **Paso 1: medir primero**

⚠️ `@testing-library/user-event` v14 **instala su propio doble del portapapeles en `navigator`** en
cada `userEvent.setup()`. Medí con una sonda (un spec temporal, que borrás después) si un
`userEvent.setup()` dentro del test pisa un `navigator.clipboard` instalado en un `beforeEach`, y si
`setup({ writeToClipboard: false })` o leer el portapapeles del propio user-event al terminar el test
resuelve. **Anotá lo medido en el reporte y en el comentario del canal.** Si no hay forma de ver la
escritura después de un `userEvent.setup()`, **pará y reportalo**: el canal no se cierra a medias.

- [ ] **Paso 2: el guardián del canal, rojo**

Con la forma de los guardianes de los otros canales (cada canal tiene el suyo en `src/test/*.spec.ts`;
mirá `objetos-con-url.spec.ts`): (1) una escritura con un centinela sin reclamar pone rojo; (2) la misma
escritura reclamada con `reclamarLoCopiado()` no; (3) una escritura sin centinela no; (4) después de un
`userEvent.setup()` sigue viéndose (según lo medido en el Paso 1).

- [ ] **Paso 3: el canal**

En `espia-de-consola.ts`: un doble de `navigator.clipboard` instalado en el `beforeEach` (con
`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: … })`) y restaurado en el
`afterEach` (como `SERVICE_WORKER_ORIGINAL`), cuyo `writeText` es un `vi.fn` que **registra** el texto
y resuelve. Exportar:

```ts
/** Lo que se copio en este test, y lo marca como visto. Para las pantallas que copian a proposito. */
export function reclamarLoCopiado(): string[]

/** El `writeText` del doble, para que un spec lo haga fallar (`mockRejectedValueOnce`). */
export function escrituraDelPortapapeles(): Mock
```

En el `afterEach`, lo registrado y no reclamado que contenga un centinela es una fuga, informada como
las demás (sin publicar el dato: `claveSegura`). **Reemplazá** el comentario «EL PORTAPAPELES NO SE
VIGILA…» y el de «EL CUARTO VECINO…» por la descripción del canal: qué mira, qué reclama un spec y qué
no cubre.

- [ ] **Paso 4: los tres specs usan el doble**

`clave-temporal.spec.tsx`, `usuarios/nuevo/page.spec.tsx` e `invitaciones/page.spec.tsx`: sacar su
`Object.defineProperty(navigator, 'clipboard', …)` y usar `reclamarLoCopiado()` /
`escrituraDelPortapapeles()`. **Las afirmaciones no cambian de sentido**: lo que antes leían de su doble
(«se copio la clave», «no se copia nada hasta que alguien lo pide», el fallo al copiar) ahora lo leen
del global.

Run: los tres specs y el guardián → PASS; la suite entera → PASS.

- [ ] **Paso 5: mutación abierta**

`// MUTACION TEMPORAL`: la 46b tal cual —`void navigator.clipboard?.writeText(JSON.stringify(alumnos.data))`
en una pantalla que lea alumnos con centinelas (p. ej. `admin/usuarios/page.tsx`)—. Esperado: **rojo**
(antes pasaba 20/20). Quitarla.

### 5c. Lo que no se cierra

- [ ] **Paso 6:** en la nota de deuda del guardián (y en PROGRESO, T7): el contexto de navegación
  anidado (la 44) **sigue por diseño** —medido: sigue habiendo un solo `<iframe>`, el de plantillas, con
  `sandbox`—; partir el dato en trozos y el `.value` de la limpieza de un `useEffect` pasan de «deuda» a
  **«por diseño»**, con el argumento que ya tienen escrito. No se cambia código para ellos.

---

## Tarea 6: los tests de la API con fecha fija — el reloj adelantado

**Files:**

- Create: `apps/api/test/reloj-adelantado.ts`
- Modify: `apps/api/package.json` (script)
- Modify: los specs que se pongan rojos (y, si hace falta, el servicio para aceptar `ahora`)

La bomba de la Fase 18: `stats.service.spec.ts` sólo pasaba mientras el calendario no pasara octubre de
2026, porque `pagos.fijarEstado` usa `comienzoDeHoyUtc(ahora)` y el test no le pasaba `ahora`. Se
arregló pasándole `new Date('2026-10-15T09:00:00.000Z')`. Esta tarea busca **todas** las que quedan.

- [ ] **Paso 1: el setup**

```ts
// apps/api/test/reloj-adelantado.ts
/**
 * EL RELOJ ADELANTADO: corre la suite unitaria como si fuera dentro de N años.
 *
 * Un test con una fecha fija contra un servicio que mira «hoy» pasa hasta que
 * el calendario lo alcanza, y ese dia se pone rojo sin que nadie haya tocado
 * nada (la bomba de `stats.service.spec.ts`, Fase 18). Esto adelanta `Date`
 * —`new Date()` sin argumentos y `Date.now()`— y nada mas: los timers siguen
 * reales y una fecha escrita (`new Date('2026-10-15')`) sigue siendo esa.
 *
 * `RELOJ_ANIOS` (por defecto 1) dice cuantos años. Uso:
 *   pnpm --filter @boxadmin/api test:reloj
 *   $env:RELOJ_ANIOS='5'; pnpm --filter @boxadmin/api test:reloj   (PowerShell)
 *
 * NO CUBRE: un spec que llama a `jest.useFakeTimers()`/`useRealTimers()`
 * reinstala el `Date` que jest guardo al arrancar, el de verdad.
 */
const anios = Number(process.env.RELOJ_ANIOS ?? '1');

if (!Number.isFinite(anios) || anios <= 0) {
  throw new Error(`RELOJ_ANIOS tiene que ser un numero positivo, y es «${process.env.RELOJ_ANIOS}»`);
}

const DESFASE_MS = Math.round(anios * 365.25 * 24 * 60 * 60 * 1000);
const DateReal = Date;

function DateAdelantado(this: unknown, ...args: unknown[]): unknown {
  // `Date()` sin `new` devuelve un texto; se respeta.
  if (new.target === undefined) return new DateReal(DateReal.now() + DESFASE_MS).toString();

  return args.length === 0
    ? new DateReal(DateReal.now() + DESFASE_MS)
    : Reflect.construct(DateReal, args);
}

DateAdelantado.prototype = DateReal.prototype;
Object.setPrototypeOf(DateAdelantado, DateReal);
(DateAdelantado as unknown as { now: () => number }).now = () => DateReal.now() + DESFASE_MS;

globalThis.Date = DateAdelantado as unknown as DateConstructor;
```

Script en `apps/api/package.json`, junto a `test`:

```json
    "test:reloj": "jest --setupFiles ./test/reloj-adelantado.ts",
```

(El `rootDir` de jest es `src`; la ruta del CLI es relativa a `apps/api`. **Comprobá** que jest la
toma: un spec temporal que haga `expect(new Date().getUTCFullYear()).toBe(<año actual + 1>)`, corrido
con `test:reloj`, verde; con `test`, rojo. Borralo después.) Si `tsc --noEmit` de la API incluye
`test/` y se queja de los tipos, ajustá los casts, no el `tsconfig`.

- [ ] **Paso 2: correr y listar**

```bash
pnpm --filter @boxadmin/api test:reloj
```

y en PowerShell `$env:RELOJ_ANIOS='5'; pnpm --filter @boxadmin/api test:reloj`. Anotá cada test rojo:
archivo, nombre, a +1 y/o a +5, y **por qué** (qué fecha fija choca con qué «hoy» del código).

- [ ] **Paso 3: desactivar cada bomba**

Cada rojo se arregla **como el de stats**: pasarle `ahora` al servicio (casi todos lo aceptan:
`pagos`, `checkin`, `mi-calendario`, `mis-clases`, `disponibilidad`, `mi-pack` y los jobs con
`ahoraISO`), o escribir las fechas del test relativas a un `ahora` fijo del propio test. Con un
comentario de una línea que diga por qué. **Nunca** se arregla moviendo la fecha fija más lejos.

Si el código no deja inyectar `ahora` (un servicio con `new Date()` adentro sin parámetro, p. ej.
`horarios-profesor.service.ts` ~311 o `calendario.service.ts` ~196), agregá el parámetro
`ahora: Date = new Date()` como último argumento, igual que los demás, sin cambiar a los llamadores.

**Un rojo que no sea de fecha** (algo que el reloj adelantado rompe por otro motivo, p. ej. un token
que el doble firma con `Date.now()`): no lo fuerces; anotalo y reportalo.

- [ ] **Paso 4: verde en los tres relojes**

`pnpm --filter @boxadmin/api test`, `test:reloj` (+1) y `test:reloj` con `RELOJ_ANIOS=5`: los tres
verdes. `pnpm --filter @boxadmin/api exec tsc --noEmit` limpio.

- [ ] **Paso 5: mutación abierta**

`// MUTACION TEMPORAL`: en `stats.service.spec.ts`, sacar el cuarto argumento de `pagos.fijarEstado`.
Esperado: rojo con `test:reloj` (y ya con `test`, porque hoy es noviembre de 2026). Quitarla.

---

## Tarea 7: cierre

**Files:** `README.md`, `docs/superpowers/plans/PROGRESO.md`, el estado del spec.

- [ ] **Paso 1: la verificación entera**

```bash
grep -rn "MUTACION TEMPORAL" apps          # cero
pnpm --filter @boxadmin/web test
pnpm --filter @boxadmin/web exec tsc --noEmit
pnpm --filter @boxadmin/web build
pnpm --filter @boxadmin/api test
pnpm --filter @boxadmin/api test:reloj     # y con RELOJ_ANIOS=5
pnpm --filter @boxadmin/api exec tsc --noEmit
docker compose up -d postgres postgres-test redis
pnpm --filter @boxadmin/api test:e2e
```

Y `prettier --check` sobre cada archivo tocado (lista con `git status --short`). Anotá los números.

- [ ] **Paso 2: README**

Una sección `## La deuda que queda — Fase 19` después de la de la Fase 18 (~2588 en adelante; buscá
`## Deuda de la API — Fase 18`), con la forma de las anteriores:

- **El 401, en un solo lugar:** lecturas y escrituras van al login desde `lib/query.tsx`; el texto es
  siempre `TEXTO_DE_SESION_CADUCADA`; los `router.push` de cada pantalla quedan como redundancia.
- **Ninguna escritura con `pedir` suelto:** si una escritura no es `useMutation`, el `MutationCache` no
  la ve.
- **`pnpm --filter @boxadmin/api test:reloj`**: qué hace, cuándo correrlo y la regla «una fecha fija contra un servicio que
  mira hoy se arregla pasando `ahora`».
- **El portapapeles y los atributos** en el guardián: qué tiene que hacer un spec que copia a propósito
  (`reclamarLoCopiado()`).

- [ ] **Paso 3: PROGRESO**

Un bloque `# Progreso Fase 19 — La deuda que queda` al final, con la forma del de la Fase 18: qué se
hizo por tarea, los números antes/después, la lista de bombas encontradas por el reloj, las mutaciones
abiertas y qué dieron, **la deuda anotada** (cerrada; por diseño; nueva) y **«Lo que esta fase NO
hace»** (sacar los `router.push` por pantalla; el contexto de navegación anidado; el reloj en los e2e y
en la web). Y un **checklist a mano** para Cesar:

- [ ] Con la sesión vencida, abrir Configuración → Packs: se lee «Tu sesión caducó…» y va al login.
- [ ] Con la sesión vencida, abrir «Buscar dónde hay lugar» en la ficha de un alumno: ídem.
- [ ] Con la sesión vencida, escanear el QR de check-in: va al login y, al entrar, vuelve con la firma
      y marca el presente.
- [ ] Con la sesión vencida, activar las notificaciones en el perfil: ídem, sin «Unauthorized».
- [ ] Copiar una clave temporal y un código de invitación sigue funcionando.

- [ ] **Paso 4: el spec**

`docs/superpowers/specs/2026-11-12-fase19-deuda-restante.md`: **Estado: ejecutada**, y corregí lo que
el plan haya medido distinto (p. ej. la lista de §3 o la forma del canal del portapapeles).
