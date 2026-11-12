# Fase 17 — Deuda de la web

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans`, tarea por tarea. Los pasos llevan casillas (`- [ ]`).

**Objetivo:** cerrar la deuda de la Fase 16 que vive sólo en `apps/web`: un único texto de sesión
vencida, ningún guardado que muestre «Unauthorized», el nombre recortado al editar una sala y los
meses en un solo sitio. Ninguna función nueva.

**Arquitectura:** una constante `TEXTO_DE_SESION_CADUCADA` en `lib/sesion-caducada.ts` que usan
todas las pantallas y los specs; una función `textoDelError` en `lib/errores-de-api.ts` que sólo
cambia el 401; un `.trim()` en `cambios()` de la ficha de sala; y el tipo `Mes`, el `SelectorDeMes` y
los nombres de mes movidos a `lib/mes.ts` y `componentes/`.

**Spec:** `docs/superpowers/specs/2026-11-12-fase17-deuda-web.md`

---

## Reglas que gobiernan todo este plan

⚠️ **No hacés commits.** Nunca `git add`, `git commit`, `git push`, `git stash`, `git checkout`,
`git reset` **ni `git mv`**. `git status`, `git diff` y `git show` sí. Para mover un archivo, `mv`.
Los commits los hace Cesar.

⚠️ **Nunca `pnpm lint`.** El script lleva `--fix`. Para formato, prettier con `--check`, y `--write`
sólo sobre archivos tuyos. Prettier toma `[slug]`, `[id]` y `(profesor)` como globs: entrá a la
carpeta del archivo y corré `node D:/Dev/box-admin/node_modules/prettier/bin/prettier.cjs --check
<archivo>`. **No uses `node_modules/.bin/prettier` desde PowerShell: no imprime nada.** `apps/web`
**no tiene eslint**.

⚠️ **Nunca `taskkill` ni `Stop-Process` por NOMBRE de proceso.** Hay una sesión viva de Claude Code en
la máquina. Por PID concreto y sólo los que levantaste vos.

⚠️ **Sólo `apps/web`.** `apps/api` y `packages/shared` **no se tocan**. Si algo parece necesitarlo,
**pará y reportalo**.

⚠️ **Nada de strings con barra invertida por heredoc.** Usá la herramienta de edición.

⚠️ El `tsc` lleva **`noUncheckedIndexedAccess`**. **`vitest run` con rutas con corchetes o
paréntesis sólo funciona desde PowerShell**, y el filtro es subcadena (p. ej.
`pnpm --filter @boxadmin/web exec vitest run salas/[id]/page`).

⚠️ **El `build` no es opcional.** Next 15 prohíbe que un `page.tsx` exporte nada que no sea el
`default` (y `metadata` en un componente de servidor).

**Comandos:**

```bash
pnpm --filter @boxadmin/web exec vitest run <archivo>
pnpm --filter @boxadmin/web exec tsc --noEmit
pnpm --filter @boxadmin/web test
pnpm --filter @boxadmin/web build
```

**Punto de partida (medido al cerrar la Fase 16):** `apps/web` **2004 / 94**. **Medilo de nuevo antes
de empezar** y anotá lo que dé.

⚠️ **Antes de nada: `grep -rn "MUTACION TEMPORAL" apps`.** Tiene que dar cero.

### Lo que esta fase hereda

`lib/cliente.ts` (`ErrorDeApi`, con `esSesionCaducada` = estado 401), `lib/sesion-caducada.ts`
(`destinoSiCaducoLaSesion`), `lib/errores-de-api.ts` (`mensajeDeFallo`, `repartirPorCampo`),
`lib/query.tsx` (el `MutationCache` que **ya navega** al login ante el 401 de una escritura: esta fase
sólo cambia lo que se lee el instante antes), `lib/mes.ts`, `componentes/ui.tsx` (`Aviso`).

**Los specs de pantalla montan un `QueryClient` pelado**, no el de `crearClienteDeDatos`: un 401 en
una escritura **no navega** en esos tests. Sólo se ve el texto, que es justo lo que se prueba.

**El guardián global de consola** (`src/test/espia-de-consola.ts`, desde `vitest.setup.ts`) vigila
cada spec. Cada spec amplía el registro con `vigilarEstosDatos({...})`. **El guardián llama a
`cleanup()` él mismo** y **prohíbe cambiar la URL del documento** (`pushState`).

### La mutación abierta

Cada tarea termina con una: **agregar o cambiar algo que no debería estar**, marcado
`// MUTACION TEMPORAL`. Correr la suite de la tarea. **Si pasa en verde, o se cierra el agujero —con
un test que se vea rojo— o se reporta.** Después, quitarla y volver a verde.

⚠️ Cinco agujeros están abiertos y reportados y **no valen como hallazgo nuevo**:
`navigator.clipboard`; un contexto de navegación anidado; los atributos de los descendientes del
`<body>`; partir el dato en trozos; y el `.value` que escriba la limpieza de un `useEffect`.

### Las cinco formas de que un test no pueda fallar

1. **Autorreferencial** — comparar la salida contra la misma función que la produce.
2. **Premisa destruida** — el código bajo prueba borra el borde que el test venía a ejercitar.
3. **Montado en el caso ciego** — fijar algo en el único escenario donde la distinción no existe.
4. **Verde por casualidad ortográfica** — `not.toContain('0%')` **pasa sobre un `100%`**.
5. **El fixture habla el idioma del código y no el del contrato.**

⚠️ **Sobre la constante en los specs (T1):** que un spec de pantalla compare contra
`TEXTO_DE_SESION_CADUCADA` **no** es la forma 1: lo que se prueba es que **esa pantalla** usa el
texto común, no cuál es el texto. El texto literal se fija **una sola vez**, en
`sesion-caducada.spec.ts`.

---

## Estructura de archivos

```
apps/web/src/
  lib/
    sesion-caducada.ts · .spec.ts          TOCAR   TEXTO_DE_SESION_CADUCADA (T1)
    errores-de-api.ts · .spec.ts           TOCAR   usa la constante (T1); textoDelError (T2)
    mes.ts                                 TOCAR   recibe el tipo Mes (T4)
  hooks/use-stats.ts                       TOCAR   importa Mes de lib/mes (T4)
  componentes/selector-de-mes.tsx          CREAR   (T4)
  app/[slug]/
    … 15 pantallas con el aviso de lectura TOCAR   la constante (T1)
    … 7 specs                              TOCAR   la constante (T1)
    (alumno)/comprobantes/
      subir-comprobante.tsx                TOCAR   textoDelError (T2)
      subir-comprobante.spec.tsx           CREAR   (T2)
    (alumno)/calendario/
      vista-de-semana.tsx                  TOCAR   textoDelError (T2)
      vista-de-semana.spec.tsx             CREAR   (T2)
    admin/configuracion/{page,checkin/page,email/page,email/plantillas,web/page,web/listas}.tsx
                                           TOCAR   textoDelError (T2)
    admin/usuarios/nuevo/page.tsx          TOCAR   textoDelError (T2)
    admin/salas/[id]/page.tsx · .spec.tsx  TOCAR   trim (T3)
    admin/analisis/page.tsx                TOCAR   SelectorDeMes fuera (T4)
    (profesor)/mi-liquidacion/pantalla.tsx TOCAR   SelectorDeMes fuera (T4)
    admin/calendario/selectores.tsx        TOCAR   textoDelMes de lib (T4)
```

---

## Task 1: Un solo texto para la sesión vencida

**Files:**

- Modify: `apps/web/src/lib/sesion-caducada.ts`, `apps/web/src/lib/sesion-caducada.spec.ts`
- Modify: `apps/web/src/lib/errores-de-api.ts:91`, `apps/web/src/lib/errores-de-api.spec.ts:6-10`
- Modify: `apps/web/src/app/[slug]/admin/calendario/publicar.tsx:184`
- Modify: las 15 pantallas y los 10 specs listados abajo

- [ ] **Step 1: Medir el punto de partida**

```bash
grep -rn "MUTACION TEMPORAL" apps
pnpm --filter @boxadmin/web test
```

Esperado: grep vacío; **2004 / 94** verde. Anotá lo que dé.

- [ ] **Step 2: El test de la constante (rojo)**

Al final de `apps/web/src/lib/sesion-caducada.spec.ts`, y agregando `TEXTO_DE_SESION_CADUCADA` al
import de `./sesion-caducada`:

```ts
describe('TEXTO_DE_SESION_CADUCADA', () => {
  /**
   * EL UNICO SITIO DEL REPO donde la frase se escribe a mano fuera de la
   * constante. Las pantallas y sus specs la importan: asi no pueden volver a
   * separarse en dos grafias, que es lo que paso hasta la Fase 17.
   */
  it('es la frase con tildes', () => {
    expect(TEXTO_DE_SESION_CADUCADA).toBe('Tu sesión caducó. Te llevamos al login.');
  });
});
```

Run: `pnpm --filter @boxadmin/web exec vitest run src/lib/sesion-caducada.spec.ts`
Esperado: FAIL (la constante no existe: `undefined`, o error de import).

- [ ] **Step 3: La constante (verde)**

En `apps/web/src/lib/sesion-caducada.ts`, debajo de los imports:

```ts
/**
 * Lo que se lee cuando la sesion vencio: en el aviso de una lectura y, el
 * instante antes de salir, en el de una escritura. UNA frase para toda la app.
 */
export const TEXTO_DE_SESION_CADUCADA = 'Tu sesión caducó. Te llevamos al login.';
```

Run el mismo comando. Esperado: PASS.

- [ ] **Step 4: Los specs pasan a la constante (rojo donde la pantalla todavía no la usa)**

En cada uno, importar `import { TEXTO_DE_SESION_CADUCADA } from '@/lib/sesion-caducada';` (junto a
los demás `@/`) y reemplazar el texto:

| Spec                                                       | Línea      | Antes                                              | Después                                                    |
| ---------------------------------------------------------- | ---------- | -------------------------------------------------- | ---------------------------------------------------------- |
| `app/[slug]/(profesor)/mis-clases/[turnoId]/page.spec.tsx` | 722        | `'Tu sesión caducó. Te llevamos al login.'`        | `TEXTO_DE_SESION_CADUCADA`                                 |
| idem                                                       | 747        | `'Tu sesion caduco. Te llevamos al login.'`        | `TEXTO_DE_SESION_CADUCADA`                                 |
| `app/[slug]/admin/analisis/asistencia/page.spec.tsx`       | 743        | `'Tu sesion caduco. Te llevamos al login.'`        | `TEXTO_DE_SESION_CADUCADA`                                 |
| `app/[slug]/admin/analisis/page.spec.tsx`                  | 1160, 1292 | `.toBe('Tu sesion caduco. Te llevamos al login.')` | `.toBe(TEXTO_DE_SESION_CADUCADA)`                          |
| `app/[slug]/admin/calendario/page.spec.tsx`                | 637        | `getByText(/tu sesion caduco/i)`                   | `getByText(TEXTO_DE_SESION_CADUCADA)`                      |
| `app/[slug]/admin/comprobantes-pendientes.spec.tsx`        | 736        | `getByText(/tu sesion caduco/i)`                   | `getByText(TEXTO_DE_SESION_CADUCADA)`                      |
| `app/[slug]/admin/pagos-pendientes.spec.tsx`               | 711        | `getByText(/tu sesion caduco/i)`                   | `getByText(TEXTO_DE_SESION_CADUCADA)`                      |
| `app/[slug]/admin/calendario/publicacion.spec.tsx`         | 1089       | `'Tu sesión caducó. Te llevamos al login.'`        | `TEXTO_DE_SESION_CADUCADA`                                 |
| `app/[slug]/admin/turnos/nuevo/page.spec.tsx`              | 492        | `'Tu sesión caducó. Te llevamos al login.'`        | `TEXTO_DE_SESION_CADUCADA`                                 |
| `lib/errores-de-api.spec.ts`                               | 8          | `'Tu sesión caducó. Te llevamos al login.'`        | `TEXTO_DE_SESION_CADUCADA` (import de `./sesion-caducada`) |

Las líneas son las medidas al escribir el plan: **buscá el texto**, no confíes en el número.

Run (PowerShell):

```
pnpm --filter @boxadmin/web exec vitest run mis-clases/[turnoId] analisis/asistencia analisis/page calendario/page comprobantes-pendientes pagos-pendientes
```

Esperado: **FAIL** en los que hoy pintan la versión sin tildes o «Volve a entrar»
(`turnoId` 747, asistencia, análisis ×2, calendario, comprobantes, pagos). Si alguno pasa en verde,
**pará**: el test no está mirando lo que creés.

- [ ] **Step 5: Las pantallas usan la constante (verde)**

En `lib/errores-de-api.ts:91` y `admin/calendario/publicar.tsx:184`:

```ts
if (error.esSesionCaducada) return TEXTO_DE_SESION_CADUCADA;
```

(con `import { TEXTO_DE_SESION_CADUCADA } from './sesion-caducada';` en `errores-de-api.ts` y
`from '@/lib/sesion-caducada'` en `publicar.tsx`).

En estas 15 pantallas, el `<Aviso>` de la sesión caducada pasa a:

```tsx
{
  sesionCaducada && <Aviso tono="error">{TEXTO_DE_SESION_CADUCADA}</Aviso>;
}
```

```
app/[slug]/(profesor)/mi-liquidacion/pantalla.tsx:119
app/[slug]/(profesor)/mis-clases/page.tsx:441
app/[slug]/(profesor)/mis-clases/[turnoId]/page.tsx:414
app/[slug]/admin/analisis/asistencia/page.tsx:397
app/[slug]/admin/analisis/page.tsx:291
app/[slug]/admin/ausencias/page.tsx:663
app/[slug]/admin/calendario/page.tsx:99
app/[slug]/admin/comprobantes-pendientes.tsx:661      ← hoy dice «Volve a entrar.»
app/[slug]/admin/horarios/page.tsx:725
app/[slug]/admin/invitaciones/page.tsx:231
app/[slug]/admin/pagos-pendientes.tsx:417
app/[slug]/admin/salas/page.tsx:200
app/[slug]/admin/turnos/nuevo/page.tsx:146
app/[slug]/admin/turnos/page.tsx:143
app/[slug]/admin/usuarios/page.tsx:81
```

Respetá el orden de imports de cada archivo (los `@/` van juntos, después de los paquetes).

Run el comando del Step 4 y además `src/lib`. Esperado: PASS.

- [ ] **Step 6: Los greps del spec**

```bash
grep -rn "Tu sesion caduco\|Volve a entrar" apps/web/src
grep -rn "Tu sesión caducó" apps/web/src
```

Esperado: el primero **vacío**; el segundo **dos líneas**: la constante en `sesion-caducada.ts` y su
spec.

- [ ] **Step 7: tsc y suite**

```bash
pnpm --filter @boxadmin/web exec tsc --noEmit
pnpm --filter @boxadmin/web test
```

Esperado: tsc limpio; **la cuenta del Step 1 + 1**, verde.

- [ ] **Step 8: Mutación abierta**

En `comprobantes-pendientes.tsx`, volvé a escribir a mano
`<Aviso tono="error">Tu sesion caduco. Volve a entrar.</Aviso> {/* MUTACION TEMPORAL */}` en lugar
de la constante. Corré su spec: **tiene que dar rojo** (línea ~736). Corré el primer grep del Step 6:
**tiene que encontrarlo**. Deshacé y volvé a verde.

- [ ] **Step 9: Formato**

`prettier --check` sobre los archivos tocados (entrando a cada carpeta con corchetes o paréntesis).

---

## Task 2: Ningún guardado muestra «Unauthorized»

**Files:**

- Modify: `apps/web/src/lib/errores-de-api.ts`, `apps/web/src/lib/errores-de-api.spec.ts`
- Modify: las 13 escrituras de la tabla del Step 3
- Create: `apps/web/src/app/[slug]/(alumno)/comprobantes/subir-comprobante.spec.tsx`
- Create: `apps/web/src/app/[slug]/(alumno)/calendario/vista-de-semana.spec.tsx`
- Modify (tests): `admin/configuracion/page.spec.tsx`, `checkin/page.spec.tsx`, `email/page.spec.tsx`,
  `email/plantillas.spec.tsx`, `web/page.spec.tsx`, `admin/usuarios/nuevo/page.spec.tsx`

- [ ] **Step 1: La función pura (rojo)**

Al final de `apps/web/src/lib/errores-de-api.spec.ts` (agregá `textoDelError` al import):

```ts
describe('textoDelError', () => {
  it('un 401 dice que la sesion caduco, no «Unauthorized»', () => {
    expect(textoDelError(new ErrorDeApi('Unauthorized', 401))).toBe(TEXTO_DE_SESION_CADUCADA);
  });

  /**
   * TODO LO DEMAS, TAL CUAL. A diferencia de `mensajeDeFallo`, el 403 NO se
   * reescribe: en las pantallas que usan esta funcion el mensaje de la API es
   * la parte util («Redis no contesta»).
   */
  it.each([
    ['un 403', new ErrorDeApi('Forbidden resource', 403), 'Forbidden resource'],
    ['un 503', new ErrorDeApi('Redis no contesta', 503), 'Redis no contesta'],
    [
      'sin conexion',
      new ErrorDeApi('Sin conexion: no se pudo subir el archivo.', 0),
      'Sin conexion: no se pudo subir el archivo.',
    ],
    ['un Error comun', new Error('Se rompio algo'), 'Se rompio algo'],
  ])('%s, el mensaje tal cual', (_caso, error, esperado) => {
    expect(textoDelError(error)).toBe(esperado);
  });
});
```

Run: `pnpm --filter @boxadmin/web exec vitest run src/lib/errores-de-api.spec.ts`
Esperado: FAIL (`textoDelError` no existe).

- [ ] **Step 2: La función (verde)**

Al final de `apps/web/src/lib/errores-de-api.ts`:

```ts
/**
 * El `message` de un fallo, SALVO el 401.
 *
 * Para las escrituras que pintan el mensaje de la API tal cual («No se pudo
 * guardar la ventana: Redis no contesta»). Ante un 401 el cliente de datos ya
 * esta mandando al login (`lib/query.tsx`), y lo que se lee el instante antes
 * de salir no puede ser «Unauthorized». No es `mensajeDeFallo`: ese reescribe
 * tambien el 403 y pide el rol minimo de la ruta.
 */
export function textoDelError(error: Error): string {
  if (error instanceof ErrorDeApi && error.esSesionCaducada) return TEXTO_DE_SESION_CADUCADA;

  return error.message;
}
```

Run el mismo comando. Esperado: PASS.

- [ ] **Step 3: Volver a buscar escrituras**

```bash
grep -rn "error\.message\|error?\.message" --include=*.tsx apps/web/src/app | grep -v spec.tsx
```

Al escribir el plan salieron **estas 13 escrituras** (el resto son lecturas, cada una con su propio
aviso de 401, o `leerFallo`/`pantalla-de-check-in`, que no aplican). Si aparece **otra escritura**,
entra con su test; si dudás si algo es lectura o escritura, mirá si el `error` viene de un
`useMutation` (escritura) o de un `useQuery` (lectura).

| #   | Archivo (`apps/web/src/app/[slug]/…`)         | Línea | Cambio                                                                  |
| --- | --------------------------------------------- | ----- | ----------------------------------------------------------------------- |
| 1   | `(alumno)/comprobantes/subir-comprobante.tsx` | 25    | `{subir.error.message}` → `{textoDelError(subir.error)}`                |
| 2   | `(alumno)/calendario/vista-de-semana.tsx`     | 64    | ver abajo                                                               |
| 3   | `admin/configuracion/page.tsx`                | 213   | `{encolar.error.message}` → `{textoDelError(encolar.error)}`            |
| 4   | `admin/configuracion/checkin/page.tsx`        | 258   | `{guardar.error.message}` → `{textoDelError(guardar.error)}`            |
| 5   | `admin/configuracion/email/page.tsx`          | 650   | `{guardar.error.message}` → `{textoDelError(guardar.error)}`            |
| 6   | `admin/configuracion/email/plantillas.tsx`    | 477   | `{guardar.error.message}` → `{textoDelError(guardar.error)}`            |
| 7   | `admin/configuracion/web/page.tsx`            | 444   | `interruptor.error.message` → `textoDelError(interruptor.error)`        |
| 8   | `admin/configuracion/web/page.tsx`            | 592   | `{guardar.error.message}` → `{textoDelError(guardar.error)}`            |
| 9   | `admin/configuracion/web/listas.tsx`          | 251   | `{borrar.error.message}` → `{textoDelError(borrar.error)}` (testimonio) |
| 10  | `admin/configuracion/web/listas.tsx`          | 296   | `{crear.error.message}` → `{textoDelError(crear.error)}` (testimonio)   |
| 11  | `admin/configuracion/web/listas.tsx`          | 403   | `{borrar.error.message}` → `{textoDelError(borrar.error)}` (pregunta)   |
| 12  | `admin/configuracion/web/listas.tsx`          | 448   | `{crear.error.message}` → `{textoDelError(crear.error)}` (pregunta)     |
| 13  | `admin/usuarios/nuevo/page.tsx`               | 279   | `crear.error.message` → `textoDelError(crear.error)`                    |

La 2, en `vista-de-semana.tsx`, porque `error` puede ser `null`:

```tsx
{
  mutacionFallida.error !== null
    ? textoDelError(mutacionFallida.error)
    : 'No se pudo completar la accion';
}
```

**Todavía no toques las pantallas.** Primero los tests.

- [ ] **Step 4: Un test por escritura en los specs que ya existen (rojo)**

En cada spec, agregá `import { TEXTO_DE_SESION_CADUCADA } from '@/lib/sesion-caducada';` y un
`const NO_AUTORIZADO = new ErrorDeApi('Unauthorized', 401);` junto a las demás constantes del
archivo. Cada test va **al lado del test de fallo que ya existe** para esa escritura, y repite su
camino cambiando sólo el error.

**`admin/configuracion/page.spec.tsx`** (junto a «un fallo se distingue de un exito», ~355):

```ts
it('un 401 dice que la sesion caduco, no «Unauthorized»', async () => {
  montar({ fallo: NO_AUTORIZADO });
  await pulsarElBoton();

  expect(textoDe('[data-resultado="error"]')).toBe(
    `No se pudo encolar el ping: ${TEXTO_DE_SESION_CADUCADA}`,
  );
});
```

**`admin/configuracion/checkin/page.spec.tsx`** (junto a ~409):

```ts
it('un 401 al guardar dice que la sesion caduco, no «Unauthorized»', async () => {
  await montarYEsperar({ falloAlGuardar: NO_AUTORIZADO });

  await escribirEnElCampo('minutos-antes', '45');
  await pulsarGuardar();

  expect(textoDe('[data-resultado="error"]')).toBe(
    `No se pudo guardar la ventana: ${TEXTO_DE_SESION_CADUCADA}`,
  );
});
```

**`admin/configuracion/email/page.spec.tsx`** (junto a ~644):

```ts
it('un 401 al guardar dice que la sesion caduco, no «Unauthorized»', async () => {
  await montarYEsperar({ falloAlGuardar: NO_AUTORIZADO });

  await escribirEnElCampo('clave', CENTINELAS.claveSmtp);
  await pulsarGuardar();

  expect(textoDe('[data-resultado="error"]')).toBe(
    `No se pudo guardar la configuracion del correo: ${TEXTO_DE_SESION_CADUCADA}`,
  );
});
```

**`admin/configuracion/email/plantillas.spec.tsx`** (junto a ~726):

```ts
it('un 401 al guardar dice que la sesion caduco, no «Unauthorized»', async () => {
  await montarYEsperar({ falloAlGuardar: NO_AUTORIZADO });

  escribir('#cuerpo-CONFIRMACION', '<p>Hola</p>');
  await pulsarGuardar('CONFIRMACION');

  expect(textoDe('CONFIRMACION', '[data-resultado="error"]')).toBe(
    `No se pudo guardar la plantilla: ${TEXTO_DE_SESION_CADUCADA}`,
  );
});
```

**`admin/configuracion/web/page.spec.tsx`** — cinco tests, uno por escritura (7–12 de la tabla):

```ts
describe('un 401 en una escritura dice que la sesion caduco, no «Unauthorized»', () => {
  it('al guardar el formulario', async () => {
    await montarYEsperar({ web: WEB_COMPLETA, falloAlGuardar: NO_AUTORIZADO });

    await escribirEnElCampo('tagline', 'Otra cosa');
    await guardarElFormulario();

    expect(textoDe('[data-resultado="error"]')).toBe(
      `No se pudo guardar la web: ${TEXTO_DE_SESION_CADUCADA}`,
    );
  });

  it('al apagar la web, dentro del dialogo', async () => {
    await montarYEsperar({ web: WEB_COMPLETA, falloAlGuardar: NO_AUTORIZADO });

    await pulsar('Apagar la web publica');
    await pulsar('Apagar la web');

    expect(textoDe('[role="dialog"]')).toContain(TEXTO_DE_SESION_CADUCADA);
    expect(textoDe('[role="dialog"]')).not.toContain('Unauthorized');
  });

  it('al borrar un testimonio', async () => {
    await montarYEsperar({ web: WEB_COMPLETA, falloEnLasListas: NO_AUTORIZADO });

    await pulsar(`Borrar el testimonio de ${NOMBRE_DEL_PRIMER_TESTIMONIO}`);

    expect(textoDe('[data-fallo="borrar-testimonio"]')).toBe(
      `No se pudo borrar el testimonio: ${TEXTO_DE_SESION_CADUCADA}`,
    );
  });

  it('al agregar un testimonio', async () => {
    await montarYEsperar({ web: WEB_COMPLETA, falloEnLasListas: NO_AUTORIZADO });

    await escribirEnElCampo('testimonio-nombre', 'Ana Quiroga');
    await escribirEnElCampo('testimonio-texto', 'Vengo hace dos años.');
    await pulsar('Agregar el testimonio');

    expect(textoDe('[data-fallo="crear-testimonio"]')).toBe(
      `No se pudo agregar el testimonio: ${TEXTO_DE_SESION_CADUCADA}`,
    );
  });

  it('al borrar y al agregar una pregunta', async () => {
    await montarYEsperar({ web: WEB_COMPLETA, falloEnLasListas: NO_AUTORIZADO });

    await pulsar(`Borrar la pregunta: ${LA_SEGUNDA_PREGUNTA}`);
    expect(textoDe('[data-fallo="borrar-pregunta"]')).toBe(
      `No se pudo borrar la pregunta: ${TEXTO_DE_SESION_CADUCADA}`,
    );

    await escribirEnElCampo('pregunta-pregunta', 'Hay duchas?');
    await escribirEnElCampo('pregunta-respuesta', 'Si, cuatro.');
    await pulsar('Agregar la pregunta');
    expect(textoDe('[data-fallo="crear-pregunta"]')).toBe(
      `No se pudo agregar la pregunta: ${TEXTO_DE_SESION_CADUCADA}`,
    );
  });
});
```

⚠️ El comienzo de cada aviso (`'No se pudo agregar la pregunta: '`, etc.) **copialo de `listas.tsx` y
`page.tsx`**, no de aquí: si el plan lo escribió mal, el test tiene que decir lo que dice la pantalla.
Si `testimonio-orden` es obligatorio para que el alta salga, escribilo como en el test de ~826.

**`admin/usuarios/nuevo/page.spec.tsx`** (junto a «el error de la API se muestra tal cual», ~631):

```ts
it('un 401 en el alta dice que la sesion caduco, no «Unauthorized»', async () => {
  const { sesion } = montar({ errorDelAlta: NO_AUTORIZADO });
  await esperar();
  await completarYEnviar(sesion);

  expect(screen.getByText(TEXTO_DE_SESION_CADUCADA)).toBeInTheDocument();
  expect(screen.queryByText(/unauthorized/i)).toBeNull();
});
```

Run (PowerShell):

```
pnpm --filter @boxadmin/web exec vitest run admin/configuracion usuarios/nuevo
```

Esperado: **FAIL** en los once tests nuevos, todos por leer «Unauthorized». Si alguno pasa en
verde, **pará**.

- [ ] **Step 5: Los dos specs que nacen (rojo)**

Los dos componentes no tienen spec. Se **doblan sus hooks** (no `pedir`): lo que se prueba es qué
pinta el componente con una mutación fallida, no cómo sube un archivo.

`apps/web/src/app/[slug]/(alumno)/comprobantes/subir-comprobante.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorDeApi } from '@/lib/cliente';
import { TEXTO_DE_SESION_CADUCADA } from '@/lib/sesion-caducada';
import { SubirComprobante } from './subir-comprobante';

const { subirDoble } = vi.hoisted(() => ({
  subirDoble: { current: {} as Record<string, unknown> },
}));

vi.mock('@/hooks/use-comprobantes', () => ({
  useSubirComprobante: () => subirDoble.current,
}));

function conFallo(error: ErrorDeApi): void {
  subirDoble.current = {
    mutate: vi.fn(),
    isError: true,
    isSuccess: false,
    isPending: false,
    error,
  };
}

describe('SubirComprobante', () => {
  it('un 401 dice que la sesion caduco, no «Unauthorized»', () => {
    conFallo(new ErrorDeApi('Unauthorized', 401));
    render(<SubirComprobante />);

    expect(screen.getByText(TEXTO_DE_SESION_CADUCADA)).toBeInTheDocument();
    expect(screen.queryByText(/unauthorized/i)).toBeNull();
  });

  /** Y el resto, tal cual: el tipo de archivo rechazado se explica solo. */
  it('otro fallo se lee como lo dijo quien fallo', () => {
    conFallo(new ErrorDeApi('Solo se aceptan PDF o imagenes (JPEG, PNG o WebP).', 0));
    render(<SubirComprobante />);

    expect(
      screen.getByText('Solo se aceptan PDF o imagenes (JPEG, PNG o WebP).'),
    ).toBeInTheDocument();
  });
});
```

`apps/web/src/app/[slug]/(alumno)/calendario/vista-de-semana.spec.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorDeApi } from '@/lib/cliente';
import { TEXTO_DE_SESION_CADUCADA } from '@/lib/sesion-caducada';
import { VistaDeSemana } from './vista-de-semana';

const { fallo } = vi.hoisted(() => ({ fallo: { current: null as Error | null } }));

const LECTURA_VACIA = { data: [], dataUpdatedAt: 0, isPending: false, error: null };

function mutacion(error: Error | null) {
  return { mutate: vi.fn(), isPending: false, isError: error !== null, error };
}

vi.mock('@/hooks/use-calendario', () => ({
  useTurnosDisponibles: () => LECTURA_VACIA,
  useMisClases: () => LECTURA_VACIA,
}));

vi.mock('@/hooks/use-acciones-de-turno', () => ({
  useAccionesDeTurno: () => ({
    reservar: mutacion(fallo.current),
    cancelar: mutacion(null),
    anotarme: mutacion(null),
    salirme: mutacion(null),
  }),
}));

describe('VistaDeSemana', () => {
  it('un 401 en una accion dice que la sesion caduco, no «Unauthorized»', () => {
    fallo.current = new ErrorDeApi('Unauthorized', 401);
    render(<VistaDeSemana />);

    expect(screen.getByText(TEXTO_DE_SESION_CADUCADA)).toBeInTheDocument();
    expect(screen.queryByText(/unauthorized/i)).toBeNull();
  });

  it('otro fallo se lee tal cual', () => {
    fallo.current = new ErrorDeApi('El turno esta lleno', 409);
    render(<VistaDeSemana />);

    expect(screen.getByText('El turno esta lleno')).toBeInTheDocument();
  });
});
```

⚠️ Antes de correrlos, **leé `vista-de-semana.tsx` entero y `AvisoOffline`**: si leen de los hooks
algo que estos dobles no tienen (otra propiedad, `isFetching`, `navigator.onLine`…), agregalo al
doble **con el valor de una semana sin turnos**, no lo que haga pasar el test. Si el guardián de
consola protesta por algo del montaje, es un hallazgo: reportalo, no lo silencies.

Run (PowerShell): `pnpm --filter @boxadmin/web exec vitest run (alumno)/comprobantes (alumno)/calendario`
Esperado: el primer test de cada uno **FAIL** (lee «Unauthorized»); el segundo PASS.

- [ ] **Step 6: Las 13 escrituras usan `textoDelError` (verde)**

Aplicá la tabla del Step 3. En cada archivo,
`import { textoDelError } from '@/lib/errores-de-api';` (si el archivo ya importa de ahí, sumalo a
ese import).

Run: los comandos de los Steps 4 y 5. Esperado: PASS.

- [ ] **Step 7: tsc y suite**

```bash
pnpm --filter @boxadmin/web exec tsc --noEmit
pnpm --filter @boxadmin/web test
```

Esperado: tsc limpio; verde, con **2 archivos de spec más** que al empezar la tarea.

- [ ] **Step 8: Mutación abierta**

En `web/listas.tsx:448` (alta de pregunta), volvé a `{crear.error.message} {/* MUTACION TEMPORAL */}`.
Corré `web/page.spec`: **el test «al borrar y al agregar una pregunta» tiene que dar rojo.** Deshacé.

Segunda: en `lib/errores-de-api.ts`, hacé que `textoDelError` devuelva la constante **también** con
`error.estado === 403` (`// MUTACION TEMPORAL`). Corré `src/lib/errores-de-api.spec.ts`: **tiene que
dar rojo** el caso del 403. Deshacé y volvé a verde.

- [ ] **Step 9: Formato**

`prettier --check` sobre los archivos tocados y creados.

---

## Task 3: El nombre al editar una sala

**Files:**

- Modify: `apps/web/src/app/[slug]/admin/salas/[id]/page.tsx:145-170`
- Test: `apps/web/src/app/[slug]/admin/salas/[id]/page.spec.tsx` (describe `'los datos de la sala'`, ~431)

- [ ] **Step 1: Los tests (rojo)**

Dentro de `describe('los datos de la sala', …)`:

```ts
/**
 * EL NOMBRE VIAJA RECORTADO, como en el alta (`salas/page.tsx`): un espacio
 * de mas al final no puede crear una sala que se lee igual y no se encuentra.
 */
it('el nombre viaja sin los espacios de los bordes', async () => {
  montar({ sala: unaSala({ nombre: 'Sala 1' }) });

  const nombre = screen.getByLabelText('Nombre');
  await userEvent.clear(nombre);
  await userEvent.type(nombre, '  Box 2  ');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar datos' }));
  await esperar();

  expect(cuerpoEnviado()).toEqual({ nombre: 'Box 2' });
});

it('agregar espacios al nombre no es un cambio', async () => {
  montar({ sala: unaSala({ nombre: 'Sala 1' }) });

  await userEvent.type(screen.getByLabelText('Nombre'), '   ');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar datos' }));
  await esperar();

  expect(() => cuerpoEnviado()).toThrow();
  expect(screen.getByText(/no cambiaste nada/i)).toBeInTheDocument();
});

/**
 * SOLO ESPACIOS ES VACIO, y vacio no se manda. El texto es el MISMO que el
 * del alta: la misma regla no puede tener dos frases.
 */
it('un nombre de solo espacios no se manda y lo dice en el campo', async () => {
  montar({ sala: unaSala({ nombre: 'Sala 1' }) });

  const nombre = screen.getByLabelText('Nombre');
  await userEvent.clear(nombre);
  await userEvent.type(nombre, '   ');
  await userEvent.click(screen.getByRole('button', { name: 'Guardar datos' }));
  await esperar();

  expect(() => cuerpoEnviado()).toThrow();
  expect(nombre).toHaveAccessibleDescription('Ponele un nombre.');
});
```

⚠️ Si `getByLabelText('Nombre')` encuentra más de un control (la ficha tiene otros bloques), acotá
con `within(screen.getByRole('form', { name: 'Datos de la sala' }))`. Si `Campo` no conecta el error
por `aria-describedby`, usá `screen.getByText('Ponele un nombre.')` **y** comprobá que está dentro
del formulario de datos.

Run (PowerShell): `pnpm --filter @boxadmin/web exec vitest run salas/[id]/page`
Esperado: FAIL los tres (el primero manda `'  Box 2  '`, el segundo manda `'Sala 1   '`, el tercero
manda `'   '`).

- [ ] **Step 2: El recorte (verde)**

En `BloqueDeDatos`, `cambios()`:

```ts
const nombre = valores.nombre.trim();
if (nombre !== original.nombre) resultado.nombre = nombre;
```

Y en `enviar()`, **antes** de `const aMandar = cambios();`:

```ts
// Solo espacios es vacio, y vacio no se manda: el mismo texto que el alta.
if (valores.nombre.trim() === '') {
  setPorCampo({ nombre: 'Ponele un nombre.' });
  return;
}
```

(`porCampo` es `Partial<Record<CampoDeDatos, string>>` o similar: si el tipo no acepta el literal,
mirá cómo lo declara el archivo y ajustá **el valor**, no el tipo.)

Run el mismo comando. Esperado: PASS, y los demás tests del archivo siguen en verde.

- [ ] **Step 3: tsc**

`pnpm --filter @boxadmin/web exec tsc --noEmit` — limpio.

- [ ] **Step 4: Mutación abierta**

En `cambios()`, compará `valores.nombre` sin recortar pero mandá el recortado
(`if (valores.nombre !== original.nombre) resultado.nombre = valores.nombre.trim(); // MUTACION TEMPORAL`).
Corré el spec: **«agregar espacios al nombre no es un cambio» tiene que dar rojo.** Deshacé y volvé a
verde.

- [ ] **Step 5: Formato**

`prettier --check` sobre los dos archivos.

---

## Task 4: Los meses en un solo sitio

**Files:**

- Modify: `apps/web/src/lib/mes.ts`, `apps/web/src/hooks/use-stats.ts:44-48`
- Modify: los importadores de `Mes` (lista en el Step 2)
- Create: `apps/web/src/componentes/selector-de-mes.tsx`
- Modify: `apps/web/src/app/[slug]/admin/analisis/page.tsx`,
  `apps/web/src/app/[slug]/(profesor)/mi-liquidacion/pantalla.tsx`,
  `apps/web/src/app/[slug]/admin/calendario/selectores.tsx`

Es un movimiento **sin cambio de comportamiento**: no hay test nuevo; la red es la suite entera, `tsc`
y los greps.

- [ ] **Step 1: El tipo `Mes` pasa a `lib/mes.ts`**

Cortá de `hooks/use-stats.ts` el bloque

```ts
/** Los tres reportes que se piden por mes calendario. */
export interface Mes {
  anio: number;
  mes: number;
}
```

y pegalo en `lib/mes.ts`, en lugar de su `import type { Mes } from '@/hooks/use-stats';`, con este
docblock:

```ts
/** Un mes calendario: lo que piden los reportes mensuales y ofrece el selector. */
export interface Mes {
  anio: number;
  mes: number;
}
```

En `hooks/use-stats.ts`, agregá `import type { Mes } from '@/lib/mes';`. **Sin reexport**: un puente
esconde a quien no se actualizó.

- [ ] **Step 2: Los importadores**

```bash
grep -rln "use-stats" apps/web/src | xargs grep -ln "\bMes\b"
```

Al escribir el plan: `(profesor)/mi-liquidacion/pantalla.tsx`, `admin/analisis/caja.tsx`,
`composicion.tsx`, `liquidacion.tsx`, `liquidacion.spec.tsx`, `page.tsx`, `page.spec.tsx`. Hay otros
que nombran «Mes» en un comentario o en otro identificador (`pagos-pendientes`, `use-dinero`,
`use-stats.spec`): **`tsc` decide**. En cada import, sacá `Mes` de `@/hooks/use-stats` y traelo de
`@/lib/mes`:

```ts
// antes
import { useCaja, type Mes } from '@/hooks/use-stats';
// despues
import { useCaja } from '@/hooks/use-stats';
import type { Mes } from '@/lib/mes';
```

`admin/analisis/filtros.ts` hace `export * from '@/lib/mes'`: ese reexport ya existía y **se queda**
(es la fachada de los filtros de Análisis, no un puente nuevo).

Run: `pnpm --filter @boxadmin/web exec tsc --noEmit` — limpio.

- [ ] **Step 3: `SelectorDeMes` a `componentes/selector-de-mes.tsx`**

Creá el archivo con la versión de Análisis (`admin/analisis/page.tsx:70-130`, la de comentarios más
completos), con `id` como prop y `CLASES_DE_CONTROL` dentro:

```tsx
'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { mesDelValor, mesesOfrecidos, textoDelMes, valorDelMes, type Mes } from '@/lib/mes';

const CLASES_DE_CONTROL =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

/**
 * EL MES ESCRIBE LA URL, NUNCA `useState`.
 *
 * <copiá aquí, entero, el docblock que hoy está encima de `SelectorDeMes` en
 * `admin/analisis/page.tsx`>
 *
 * Lo usan Analisis y «Mi liquidacion» de la profesora: cada una le pasa su
 * `id`, que es lo que ata la etiqueta «Mes» a su `<select>`.
 */
export function SelectorDeMes({ id, elegido, ahora }: { id: string; elegido: Mes; ahora: Date }) {
  // <el cuerpo de la versión de Análisis, con sus comentarios, cambiando
  //  `htmlFor="analisis-mes"` e `id="analisis-mes"` por `htmlFor={id}` e `id={id}`>
}
```

⚠️ Las dos marcas `<…>` de arriba son **instrucciones de copia, no texto**: el cuerpo se copia **tal
cual** de `admin/analisis/page.tsx` (es un movimiento: si lo reescribís, ya no es el mismo
componente que prueban los specs). Verificá con `diff` que la única diferencia con la versión de
Análisis es el `id`.

En `admin/analisis/page.tsx`: borrá la función y su docblock, usá
`<SelectorDeMes id="analisis-mes" elegido={mes} ahora={ahora} />` e importá
`import { SelectorDeMes } from '@/componentes/selector-de-mes';`.

En `(profesor)/mi-liquidacion/pantalla.tsx`: igual, con `id="mi-liquidacion-mes"`.

En los dos, **borrá lo que quede sin uso** (`CLASES_DE_CONTROL`, `mesDelValor`, `mesesOfrecidos`,
`valorDelMes`, `textoDelMes`, hooks de `next/navigation`): **sólo si `grep` en ese archivo confirma
que ya nadie los usa**. No cuentes con que `tsc` avise de un import sin uso.

- [ ] **Step 4: El calendario usa `textoDelMes` de `lib/mes.ts`**

En `admin/calendario/selectores.tsx`: borrá `NOMBRES_DE_MES`, su docblock y la función local
`textoDelMes`, e importá `import { textoDelMes } from '@/lib/mes';`. `MesOfrecido` (`{anio, mes}`)
tiene la forma de `Mes`, así que se pasa tal cual. **`valorDelMes` del calendario no se toca**: es
otro formato de URL (`2026-3`, sin cero).

En `lib/mes.ts`, borrá del docblock de `NOMBRES_DE_MES` las dos líneas que dicen
«`calendario/selectores.tsx` todavia tiene su propia copia; ya puede importar `textoDelMes` de
aqui.» y poné en su lugar «Los usan Analisis, «Mi liquidacion» y el calendario.».

- [ ] **Step 5: Los greps**

```bash
grep -rnE "import .*\bMes\b.*from '@/hooks/use-stats'|type Mes\b.*use-stats" apps/web/src
grep -rn "function SelectorDeMes" apps/web/src
grep -rn "'enero'" apps/web/src
```

Esperado: el primero **vacío**; el segundo **una** línea (`componentes/selector-de-mes.tsx`); el
tercero **una** (`lib/mes.ts`).

- [ ] **Step 6: tsc, suite y build**

```bash
pnpm --filter @boxadmin/web exec tsc --noEmit
pnpm --filter @boxadmin/web test
pnpm --filter @boxadmin/web build
```

Esperado: tsc limpio; **la misma cuenta que al terminar la Task 3**, verde, **sin tocar ninguna
afirmación** de los specs de Análisis, Mi liquidación ni el calendario; build OK.

- [ ] **Step 7: Mutación abierta**

En `componentes/selector-de-mes.tsx`, cambiá
`new URLSearchParams(parametros.toString())` por `new URLSearchParams() // MUTACION TEMPORAL`.
Corré `admin/analisis/page.spec` y `mi-liquidacion/page.spec`: **alguno tiene que dar rojo** (el
selector no puede borrar lo que la URL ya lleva). Si los dos pasan en verde, el agujero es nuevo:
cerralo con un test en `mi-liquidacion/page.spec.tsx` que monte con `?anio=…&mes=…&otra=1`, cambie el
mes y compruebe que `otra=1` sigue en la URL empujada. Deshacé y volvé a verde.

- [ ] **Step 8: Formato**

`prettier --check` sobre los archivos tocados y creados.

---

## Task 5: Cierre

**Files:**

- Modify: `README.md` (sección nueva antes de `## Tests`)
- Modify: `docs/superpowers/plans/PROGRESO.md` (bloque nuevo al final)

- [ ] **Step 1: Verificación entera**

```bash
grep -rn "MUTACION TEMPORAL" apps
grep -rn "Tu sesion caduco\|Volve a entrar" apps/web/src
grep -rn "Tu sesión caducó" apps/web/src
pnpm --filter @boxadmin/web exec tsc --noEmit
pnpm --filter @boxadmin/web test
pnpm --filter @boxadmin/web build
git status --short apps/api packages/shared
```

Esperado: vacío; vacío; dos líneas; tsc limpio; verde (anotá la cuenta); build OK; **vacío** (ni la
API ni shared se tocaron).

- [ ] **Step 2: README**

Antes de `## Tests`, una sección `## Deuda de la web — Fase 17` con, en prosa corta:

- el texto de la sesión vencida es **uno** (`TEXTO_DE_SESION_CADUCADA`, `lib/sesion-caducada.ts`), con
  tildes, en lecturas y escrituras; los specs lo importan;
- las escrituras que pintan el mensaje de la API usan `textoDelError` (`lib/errores-de-api.ts`): todo
  tal cual menos el 401; cuándo usar ésta y cuándo `mensajeDeFallo`;
- el nombre de una sala se recorta también al editar;
- `Mes` vive en `lib/mes.ts`, `SelectorDeMes` en `componentes/selector-de-mes.tsx` y los nombres de
  mes en un solo sitio.

- [ ] **Step 3: PROGRESO**

Al final, `# Progreso Fase 17 — Deuda de la web`, con las mismas secciones que la Fase 16: los
números (antes/después), lo que la fase hace (por tarea), las mutaciones (cuál, si dio rojo), la
revisión de calidad de cada tarea, trampas nuevas, **deuda anotada** (cerrada / nueva / sigue),
lo que la fase NO hace y el checklist a mano.

En la deuda:

- **Cerrada:** las dos (tres) grafías; los guardados con «Unauthorized» (13, no 9); el recorte de
  nombres (sólo faltaba editar una sala); `SelectorDeMes` duplicado; `Mes` en `hooks/use-stats`; la
  copia de los nombres de mes del calendario.
- **Aceptada, ya no deuda:** los valores por defecto de `ir` y `donde` en `crearClienteDeDatos`, sin
  test porque probarlos mueve la URL del documento.
- **Sigue (Fase 18, API y shared):** `.trim()` en los DTO; la búsqueda del perfil repetida en 8
  servicios; `Importe` contra la cadena pelada. **Sigue (grupo D):** la lista de la Fase 13.

El checklist a mano:

- [ ] Con la sesión vencida, guardar en Configuración → Web: se lee «Tu sesión caducó…» un instante
      y va al login.
- [ ] Una lectura con la sesión vencida (p. ej. Turnos) dice el mismo texto, **con tildes**.
- [ ] Editar una sala con « Box 2 » la deja como «Box 2».
- [ ] El selector de mes de Análisis y el de «Mi liquidación» siguen cambiando el mes y conservan el
      resto de la URL.

- [ ] **Step 4: Formato**

`node node_modules/prettier/bin/prettier.cjs --check README.md docs/superpowers/plans/PROGRESO.md
docs/superpowers/plans/2026-11-12-fase17-deuda-web.md docs/superpowers/specs/2026-11-12-fase17-deuda-web.md`
desde la raíz.
