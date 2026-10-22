# Fase 13 — El área del profesor

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans`, tarea por tarea. Los pasos llevan casillas (`- [ ]`).

**Objetivo:** tres endpoints, y la única fase en que **una pantalla que falta deja mintiendo a una que
ya está entregada**: hoy nadie puede marcar una ausencia, así que el reporte de asistencia de la Fase
11 no puede mostrar ni una.

**Arquitectura:** un grupo de rutas nuevo (`(profesor)`) con su layout, su agenda y la pantalla de
pasar lista. Pensado para un teléfono. **No se toca ni un endpoint.**

**Spec:** `docs/superpowers/specs/2026-10-22-fase13-profesor.md`

---

## Reglas que gobiernan todo este plan

⚠️ **No hacés commits.** Nunca `git add`, `git commit`, `git push`, `git stash`, `git checkout` ni
`git reset`. `git status`, `git diff` y `git show` sí.

⚠️ **Nunca `pnpm lint`.** El script lleva `--fix`. Para formato, `pnpm exec prettier --check`, y
`--write` sólo sobre archivos tuyos. `apps/web` **no tiene eslint**.

⚠️ **Nunca `taskkill` ni `Stop-Process` por NOMBRE de proceso.** Hay una sesión viva de Claude Code en
la máquina. Por PID concreto y sólo los que levantaste vos.

⚠️ **No se toca `apps/api` ni `packages/shared`.** Si una pantalla parece necesitar un endpoint,
**pará y reportalo**.

⚠️ **Nada de strings con barra invertida por heredoc.** Usá la herramienta de edición.

⚠️ El `tsc` del repo lleva **`noUncheckedIndexedAccess`**.

⚠️ **`vitest run "ruta/[id]"` sólo funciona desde PowerShell.** El filtro es **subcadena, no regex**.

**Comandos:**

```bash
pnpm --filter @boxadmin/web exec vitest run <archivo>
pnpm --filter @boxadmin/web exec tsc --noEmit
pnpm --filter @boxadmin/web test
pnpm --filter @boxadmin/web build
```

⚠️ **El `build` no es opcional y no lo cubre el `tsc`.** **Next 15 prohíbe que un `page.tsx` exporte
nada que no sea el `default`**; el error habla de `OmitWithTag` y **no se parece a la causa**.

**Punto de partida:** `apps/web` **1572 tests / 70 suites**. `apps/api` **1339 / 67** y **218 e2e**,
sin tocar. `packages/shared` 103 / 4.

### Lo que esta fase hereda

`componentes/tabla.tsx`, `componentes/confirmar.tsx`, `admin/usuarios/[id]/errores.ts`,
`useRolDeQuienMira()`, `src/test/andamiaje-de-hooks.tsx`, `lib/destino-de-login.ts`,
`lib/ruta-pedida.ts` y `lib/sesion.ts`.

**Trece canales globales** y **dos ejes** corren solos en `vitest.setup.ts` contra un registro común
que cada spec amplía con `vigilarEstosDatos({...})`: `console.*`, `document.title`, `window.name`, el
contenido del `<head>`, los tres almacenes, `performance.mark`/`measure`, el `src` de una imagen, las
salidas laterales, `CacheStorage`, el service worker, IndexedDB, los atributos del `<html>` y del
`<body>`, y la URL del documento. Los ejes son `montarElRatoLibre()` y
`despacharLaSalidaDeLaPestana()`.

⚠️ **Esta fase siembra nombres de alumnos y quién vino y quién no**, que es un dato sobre personas que
no están en la sala para defenderse.

⚠️ **Y dos cosas aprendidas en la Fase 12:**

- **Un `<input>` o un `<textarea>` controlado de React escribe su valor en el ATRIBUTO del marcado**
  (React sincroniza `defaultValue`, que *es* el atributo; en un `<textarea>` es su texto hijo).
- **No instales dobles locales de nada que vigile el tapón global.** El de la Fase 9 instalaba las
  puertas como propiedades propias de `window.history` —que **tapan** el espía del prototipo— y
  dejaba **24 de 25 tests en verde con una fuga delante**.

### La mutación abierta

Cada tarea termina con una. Van **cuarenta y cuatro de cuarenta y cuatro**. La familia es siempre
**agregar algo que no debería estar, sin quitar nada**; lo que cambia es **dónde nadie estaba
mirando**.

Las brújulas que vienen funcionando:

1. **Una API que jsdom no implementa** — el `?.` prudente convierte la ausencia del entorno en un
   silencio (`sendBeacon`, `caches`, `navigator.credentials`, IndexedDB).
2. **No todo es un canal**: `requestIdleCallback` era **un reloj**; `pagehide` era **un momento**.
   Pensá en **qué podría desactivar o aplazar una defensa** en vez de esquivarla.
3. **El hueco entre dos defensas** (los atributos del `<html>`, la URL del documento).

Y **dos que están abiertas y reportadas**, así que no valen como hallazgo nuevo: **los atributos de
los descendientes del `<body>`** y **un contexto de navegación anidado** (un `<iframe>`).

### Las cinco formas de que un test no pueda fallar

1. **Autorreferencial** — comparar la salida contra la misma función que la produce.
2. **Premisa destruida** — el código bajo prueba borra el borde que el test venía a ejercitar.
3. **Montado en el caso ciego** — fijar algo en el único escenario donde la distinción no existe.
4. **Verde por casualidad ortográfica** — `not.toContain('0%')` **pasa sobre un `100%`**.
5. **El fixture habla el idioma del código y no el del contrato** — **incoherente en lo derivado,
   posible en todo lo demás**.

⚠️ **Y una técnica que vale repetir, de las fases 11 y 12**: para afirmar que algo **NO** se dice, no
busques la frase. **Montá la pantalla dos veces** con las dos variantes y afirmá que el texto es
**idéntico salvo lo que debe cambiar**. Mata cualquier cartel, lo diga como lo diga y esté donde esté.

---

## Estructura de archivos

```
apps/web/src/
  hooks/
    use-mis-clases.ts · .spec.tsx       CREAR   los tres endpoints
  lib/
    destino-por-rol.ts                  TOCAR   hoy deja a la profesora en la nada
  app/[slug]/
    (profesor)/
      layout.tsx · layout.spec.tsx      CREAR   la puerta del area
      mis-clases/
        page.tsx · page.spec.tsx        CREAR   la agenda
        filtros.ts                      CREAR   el rango en la URL (hermano)
        [turnoId]/
          page.tsx · page.spec.tsx      CREAR   pasar lista
```

---

## Task 1: El hook

**Files:** crear `apps/web/src/hooks/use-mis-clases.ts` · `use-mis-clases.spec.tsx`

Dos lecturas y una escritura.

- [ ] **Step 1: Verificá las rutas y los DTOs**

| Método | Ruta | Devuelve |
| --- | --- | --- |
| GET | `/mis-clases?desde=&hasta=` | `ClaseDelProfesor[]` |
| GET | `/mis-clases/:turnoId/alumnos` | `AlumnoEnClase[]` |
| POST | `/mis-clases/:turnoId/asistencia` | **sin cuerpo útil** |

⚠️ **`desde` y `hasta` son OBLIGATORIOS** y los valida el controller a mano, no un DTO
(`mis-clases.controller.ts:53`): `'desde y hasta son obligatorios, con formato YYYY-MM-DD'` y
`'desde no puede ser posterior a hasta'`. **Verificá los dos textos**; en fases anteriores cité mal un
mensaje más de una vez.

⚠️ **El cuerpo de la asistencia es `{ presentes: string[] }` y nada más.** Es **reemplazo total**: el
servicio marca `asistio: true` a los que están y **`false` a todos los demás**.

- [ ] **Step 2: El molde**

`use-stats.ts` (lecturas con query) y `use-configuracion.ts` (escrituras con invalidación dirigida)
son el patrón. Y `src/test/andamiaje-de-hooks.tsx` ya tiene lo que necesitás.

⚠️ **`gcTime: 0` en la mutación**: hay un barrido (`src/hooks/mutaciones-sin-gctime.spec.ts`) que
recorre `src/hooks/*.ts` y falla nombrando archivo y hook.

⚠️ **La invalidación es dirigida.** Pasar lista cambia **los alumnos de esa clase** y **la agenda**
(porque la agenda cuenta cuántos quedan sin marcar). Pensá qué claves son y **no invalides de más**:
usá `src/test/consulta-ajena.ts`, porque con un solo consumidor del `QueryClient` una invalidación
global y una dirigida **son indistinguibles**.

- [ ] **Step 3: Lo que no puede faltar**

```tsx
it('cada endpoint pide SU ruta, con SU metodo', () => {});
it('el rango viaja siempre: desde y hasta son obligatorios', () => {});
it('los alumnos de dos clases distintas tienen claves distintas', () => {
  // Con una sola clase sembrada no se distingue nada.
});
it('el cuerpo de la asistencia lleva `presentes` y NADA mas', () => {});
it('una lista vacia se manda como lista vacia, no se omite', () => {
  // Marcar ausente a toda la clase es un caso legitimo del servicio. Omitir
  // la clave seria un 400 y el admin no sabria por que.
});
it('pasar lista invalida los alumnos de ESA clase y la agenda, y nada mas', () => {});
it('una escritura que falla sale UNA sola vez', () => {
  // `retry` solo actua AL FALLAR. Esperá a que el error este PINTADO antes de
  // contar, o contarias uno aunque hubiera tres.
});
```

- [ ] **Step 4: Implementar**, **Step 5: verificar**, **Step 6: mutaciones**

| Mutación | Debe caer |
| --- | --- |
| El rango se omite cuando está vacío | «el rango viaja siempre» |
| Los alumnos de todas las clases bajo la misma clave | «claves distintas» |
| La lista vacía se omite del cuerpo | «se manda como lista vacía» |
| `invalidateQueries()` pelado | «y nada más» + el centinela de la consulta ajena |
| Quitar el `gcTime: 0` | el barrido, nombrando archivo y hook |

- [ ] **Step 7: La mutación abierta.**

---

## Task 2: El área y la agenda

**Files:** crear `(profesor)/layout.tsx` · `layout.spec.tsx`, `(profesor)/mis-clases/page.tsx` ·
`page.spec.tsx` · `filtros.ts`; tocar `lib/destino-por-rol.ts` y su spec.

### La puerta

**`(alumno)/layout.tsx` es el molde**: comprueba la sesión, resuelve el rol, y si no es el suyo dibuja
«Esta no es tu area» con una salida hacia donde esa persona sí tiene algo. **Leelo entero.**

⚠️ **Y arreglá `destinoPorRol`**, que es lo que hoy deja a la profesora en la nada: sólo distingue
`ADMIN_OPERATIVO` de todo lo demás y manda al calendario del alumno, cuyo layout exige
`rol === 'ALUMNO'`. **Una profesora que entra con su contraseña aterriza en «Esta no es tu area».**

⚠️ **`destino-por-rol.ts` tiene spec propia y la usa el formulario de login.** Actualizá lo que caiga
y comprobá que sigue teniendo dientes.

**Pensado para un teléfono**: quien pasa lista está de pie en la sala con nueve personas esperando. El
layout de `(alumno)` ya es `max-w-md`; éste va igual.

### La agenda, y la decisión que te toca cerrar

**`listaPasada` NO se usa.** Es `reservas.some(asistio !== null)` y el check-in por QR escribe
`asistio`, así que **un solo alumno que escanea el QR hace que la clase figure como «lista pasada»**
aunque la profesora no la haya tocado. El servicio del alumno ya separa esas dos cosas —`yaMarcada`
mira la fila de `Asistencia`— y su comentario explica por qué. **El contrato de la profesora las
fusiona, y para ella la fusión es la que miente.**

**La agenda dice qué falta de verdad**: por cada clase, cuántos de los anotados tienen estado y
cuántos no — «faltan 7 de 9». Sale de `GET /mis-clases/:id/alumnos`.

⚠️ **Eso cuesta UNA PETICIÓN POR CLASE, y la decisión de alcance es tuya.** Hoy son dos o tres clases
y el costo es despreciable; una semana son quince. **Decidí el rango por defecto y qué pasa cuando el
rango elegido trae muchas clases**, y contame el criterio. **La respuesta honesta puede ser no pedir
el detalle más allá de cierto número y decirlo** — lo que no es aceptable es mostrar un sí/no que
puede ser falso.

El rango va **en la URL**. Mirá `admin/analisis/asistencia/filtros.ts`, que resuelve el mismo problema.

- [ ] **Step 1: Lo que no puede faltar**

```tsx
// --- La puerta ---
it('una profesora llega a su area', () => {});
it('un alumno NO, y se le ofrece donde si tiene algo', () => {});
it('un admin tampoco', () => {});
it('sin sesion se va al login conservando a donde queria ir', () => {});
it('el login manda a una profesora a SU area', () => {});

// --- La agenda ---
it('NO dice «lista pasada» en ningun sitio', () => {
  // Montá dos veces —una clase con `listaPasada: true` por un QR y nadie mas,
  // y otra sin nada— y afirmá que el texto es identico salvo los numeros.
});
it('dice cuantos quedan sin marcar', () => {});
it('una clase con TODOS marcados se distingue de una con ninguno', () => {});
it('el rango viaja en la URL y sobrevive al boton de atras', () => {});
it('un rango invertido muestra el motivo de la API', () => {});
it('una agenda vacia se distingue de un fallo al leer', () => {});
it('cada clase lleva a SU pantalla de lista, con dos sembradas', () => {});
```

- [ ] **Step 2: Implementar**, **Step 3: verificar**, **Step 4: mutaciones**

| Mutación | Debe caer |
| --- | --- |
| La agenda dibuja `listaPasada` | «NO dice lista pasada» |
| El conteo cuenta los anotados y no los que faltan | «dice cuántos quedan sin marcar» |
| `destinoPorRol` vuelve a mandar al calendario | «el login manda a una profesora a SU área» |
| La puerta deja entrar a un alumno | ese test |
| Todas las clases enlazan a la primera | «cada clase lleva a SU pantalla» |

- [ ] **Step 5: La mutación abierta.**

---

## Task 3: Pasar lista

**Files:** crear `(profesor)/mis-clases/[turnoId]/page.tsx` · `page.spec.tsx`

**La pantalla que destraba el reporte de la Fase 11.** Y la más peligrosa de la fase, porque el
endpoint es **reemplazo total**.

- [ ] **Step 1: Las tres consecuencias del reemplazo total**

1. ⚠️ **Pasar lista puede pisar un check-in real.** Si alguien se chequeó por QR y la profesora abre
   la pantalla y tilda sólo a los que ve, **ese alumno queda ausente** aunque vino y lo registró.
   **La pantalla llega con los que ya tienen `asistio: true` ya tildados.** No es una comodidad: es lo
   que impide que el flujo natural destruya un dato verdadero. **Es el test más importante de la
   fase.**
2. ⚠️ **Una lista vacía marca ausente a toda la clase**, y es un camino legítimo del servicio —puede
   no haber venido nadie— **pero no puede ser el resultado de un clic distraído.**
3. ⚠️ **Volver a pasar lista reescribe todo.** No hay forma de corregir a una sola persona.

- [ ] **Step 2: Lo que el servidor ya impide, y la pantalla NO repite**

- **No se pasa lista de una clase que no empezó**: «Esa clase todavia no empezo». **Hacia atrás no hay
  límite**, y está razonado en el servicio: «una profesora que se olvido tres semanas puede ponerse al
  dia». **No repitas esa regla en el cliente**: sería una segunda fuente de verdad, y además
  destruiría la premisa del test que la ejercita.
- **Un id sin reserva activa se rechaza** nombrando los intrusos.

- [ ] **Step 3: Lo que no puede faltar**

```tsx
it('los que ya tienen asistio true llegan TILDADOS', () => {
  // Con una clase mitad y mitad. Es lo que impide que pasar lista pise un
  // check-in por QR.
});
it('los que tienen asistio false llegan sin tildar', () => {});
it('los que no tienen estado llegan sin tildar', () => {
  // `null` y `false` se dibujan igual, pero vienen de sitios distintos: con
  // una sola de las dos sembradas no se distingue nada.
});

it('guardar manda los tildados, y una sola vez', () => {});
it('marcar ausente a TODA la clase se puede, pero no por accidente', () => {});

it('una clase que no empezo muestra el motivo de la API', () => {});
it('una clase sin anotados se distingue de un fallo al leer', () => {});

it('ni el telefono ni la ficha medica aparecen', () => {
  // `AlumnoEnClase` es deliberadamente escueto y esta fase no abre esa puerta.
  // Afirmá sobre el marcado.
});
it('no enlaza a ninguna ficha de alumno', () => {
  // No existe para su rol: ofrecerla seria ofrecer un 403.
});
```

- [ ] **Step 4: Implementar**, **Step 5: verificar**, **Step 6: mutaciones**

| Mutación | Debe caer |
| --- | --- |
| Todos llegan sin tildar | «los que ya tienen asistio true llegan TILDADOS» |
| `asistio: false` llega tildado | «llegan sin tildar» |
| Guardar manda todos los anotados | «manda los tildados» |
| Marcar a toda la clase no pide nada | «pero no por accidente» |
| La pantalla repite la regla de «no empezó» | «muestra el motivo de la API» |

- [ ] **Step 7: La mutación abierta.** Hay nombres de alumnos y quién vino y quién no.

---

## Task 4: Verificación final, README y tracker

- [ ] **Step 1: Todo verde**

```bash
cd /d/Dev/box-admin/apps/web && pnpm exec tsc --noEmit && pnpm test && pnpm build
cd ../api && pnpm exec tsc --noEmit && pnpm exec jest --silent && pnpm exec eslint "src/**/*.ts"
```

⚠️ `apps/api` tiene que seguir en **1339 / 67** y el linter en cero. Si no da, **es un hallazgo**.

Los e2e son **Jest + supertest** (13 specs, **218 tests**), **no Playwright**. Necesitan
`postgres-test`: `docker compose up -d postgres postgres-test redis` o `docker start` de los tres.
**`docker compose up` pelado está prohibido.** Si Docker no arranca, **decilo, seguí, y marcá el
número como arrastrado y NO medido**.

- [ ] **Step 2: El checklist a mano**

Al final del bloque del tracker:

- Entrar **con una cuenta de profesora** y comprobar que se llega a la agenda, no a «Esta no es tu
  área».
- Entrar como alumno y como admin y comprobar que **no** se entra.
- Chequearse por QR en una clase y comprobar que la agenda **no dice «lista pasada»** y sí dice
  cuántos faltan.
- Abrir esa clase y comprobar que **quien se chequeó llega tildado**.
- Pasar lista y comprobar en el reporte de asistencia de Análisis que **aparecen ausentes** — que es
  lo que esta fase existe para destrabar.

- [ ] **Step 3: README y tracker**

Sección «El área del profesor — Fase 13» en `README.md`, **antes de `## Tests`**. ⚠️ Anclá a una
**línea entera** y a la **última** aparición.

Y el bloque de la Fase 13 en `docs/superpowers/plans/PROGRESO.md`, con el formato de los anteriores.
⚠️ **`PROGRESO.md` ya falla `prettier --check` desde antes**: formateá **sólo tu bloque**.

**Lo que no puede faltar:** que hasta esta fase **nadie podía marcar una ausencia** y el reporte de la
Fase 11 no podía mostrar ni una; que `listaPasada` conflaciona el QR con la lista y por eso no se usa;
las tres consecuencias del reemplazo total; y **qué se decidió para el costo de una petición por
clase**.

---

## Lo que esta fase NO hace

- **Cualquier cambio en `apps/api`**, incluido arreglar `listaPasada` en el contrato, que es lo
  correcto de fondo y queda anotado.
- **Que la profesora vea su liquidación**: `GET /liquidacion/:profesorId` pide `ADMIN_SALON`. Hoy
  **no puede ver lo que va a cobrar**, y abrirlo es una decisión de negocio.
- **Editar la asistencia de una sola persona**: el endpoint es reemplazo total.
- **Que la profesora vea la ficha de un alumno**, que no existe para su rol.
