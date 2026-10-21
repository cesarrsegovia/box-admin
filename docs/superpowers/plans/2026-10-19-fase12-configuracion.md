# Fase 12 — La configuración del gimnasio

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans`, tarea por tarea. Los pasos llevan casillas (`- [ ]`).

**Objetivo:** los 14 endpoints de configuración, todos `ADMIN_SALON`, que hoy sólo se operan por
`curl`. Y cierra una promesa en producción: **la ficha de la sala dice «Hereda del gimnasio» y no hay
dónde mirar qué dice el gimnasio.**

**Arquitectura:** un índice en `/admin/configuracion` y tres pantallas colgando. **No se toca ni un
endpoint.**

**Spec:** `docs/superpowers/specs/2026-10-19-fase12-configuracion.md`

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

⚠️ **El `build` no es opcional y no lo cubre el `tsc`.** La Fase 10 estuvo a punto de cerrarse con el
build roto: **Next 15 prohíbe que un `page.tsx` exporte nada que no sea el `default`**, y ni
`tsc --noEmit` ni los tests lo ven. El error habla de `OmitWithTag` y «not assignable to `never`» y
**no se parece a la causa**. Los ayudantes van en un archivo hermano.

**Punto de partida:** `apps/web` **1421 tests / 64 suites**. `apps/api` **1339 / 67** y **218 e2e**,
sin tocar. `packages/shared` 103 / 4.

### Lo que esta fase hereda

`componentes/tabla.tsx`, `componentes/confirmar.tsx`, `admin/usuarios/[id]/errores.ts`,
`useRolDeQuienMira()`, `src/test/andamiaje-de-hooks.tsx` y `src/test/consulta-ajena.ts`.

**Diez canales globales** corren solos en `vitest.setup.ts` contra un registro común que cada spec
amplía con `vigilarEstosDatos({...})`: `console.*`, `document.title`, `window.name`, `document.head`,
los tres almacenes del navegador, `performance.mark`/`measure`, el `src` de una imagen, las salidas
laterales (`postMessage`/`BroadcastChannel`/`sendBeacon`), **CacheStorage** y **el service worker**.
Más `montarElRatoLibre()`, que monta `requestIdleCallback` para que lo aplazado corra dentro del test.

> ⚠️ **Errata 1, corregida al cerrar la fase (2026-10-21).** Eran diez **al escribir este plan**; al
> cerrar son **trece canales y dos ejes**. Esta fase sumó **IndexedDB** (el once), **los atributos
> del `<html>` y del `<body>`** (el doce) y **la URL del documento** (el trece). `montarElRatoLibre()`
> es el **eje catorce** y los **eventos de salida de la pestaña** (`src/test/salida-de-la-pestana.ts`)
> el **quince**: no abren una puerta nueva, **mueven el momento** en que los tapones miran.

⚠️ **Esta fase siembra la credencial de un servidor de correo.** Los centinelas importan más que en
ninguna otra: la clave SMTP, el usuario, el host y los textos de las plantillas.

### La mutación abierta

Cada tarea termina con una. Van **treinta y ocho de treinta y ocho**. La familia es siempre **agregar
algo que no debería estar, sin quitar nada**; lo que cambia es **dónde nadie estaba mirando**. Ejes ya
quemados: el payload RSC, dos cachés, los tres almacenes, un atributo del DOM, las dos clases de
cabecera, `console.*`, el título, `window.name`, `document.head`, el argumento recibido, navegar al
montar, la History API, el alcance de una invalidación, lo que se pide **después** de escribir, un
`logger.debug`, un `retry: 2` en un POST (**el camino de error**), una **lectura** de más, un `fetch`
fuera de `pedir`, **el reloj**, la auditoría, el búfer de User Timing, el `src` de una imagen,
`postMessage`/`BroadcastChannel`/`sendBeacon`, **CacheStorage** y **el service worker**.

**Diez de esos ejes ya los cierran los tapones globales. Buscá uno nuevo.** Dos lecciones de la
Fase 11 que aquí pesan más, porque hay una credencial en pantalla:

1. **Una API que jsdom no implementa es un sitio donde nadie mira por construcción.** El `?.` que
   escribe alguien con cuidado convierte la ausencia del entorno de test en un silencio. Cuatro de
   las seis fugas de la Fase 11 pasaron por ahí.
2. **No todo es un canal.** `requestIdleCallback` no era una puerta de salida sino **un reloj que
   apagaba los otros nueve**: mismo dato, mismo canal vigilado, y la diferencia entera era el
   envoltorio. **Pensá también en qué podría desactivar una defensa en vez de esquivarla.**

### Las cinco formas de que un test no pueda fallar

1. **Autorreferencial** — comparar la salida contra la misma función que la produce.
2. **Premisa destruida** — el código bajo prueba borra el borde que el test venía a ejercitar.
3. **Montado en el caso ciego** — fijar algo en el único escenario donde la distinción no existe.
4. **Verde por casualidad ortográfica** — `not.toContain('0%')` **pasa sobre un `100%`**.
5. **El fixture habla el idioma del código y no el del contrato** — por el lado de **la entrada**.
   **Incoherente en lo derivado, posible en todo lo demás.**

### Sobre la densidad

La Task 1 trae el código completo. Las Tasks 2 a 6 traen **los tests y la tabla de mutaciones, no la
implementación**. **Si aparece una decisión que los tests no determinan, paralo y preguntá.**

Y la advertencia de la Fase 7: cuando los tests salen de una especificación detallada, **la
implementación que sale de esa misma especificación los pasa a la primera**. El rojo inicial sólo
prueba que el archivo no existía. **La confianza la da la tabla de mutaciones.**

---

## Estructura de archivos

```
apps/web/src/
  hooks/
    use-configuracion.ts · .spec.tsx    CREAR   los 14, cuatro areas
  app/[slug]/admin/
    navegacion-admin.ts                 TOCAR   una linea
    configuracion/
      page.tsx · page.spec.tsx          CREAR   el indice + el health-check
      checkin/
        page.tsx · page.spec.tsx        CREAR
      web/
        page.tsx · page.spec.tsx        CREAR   la mas grande: 6 endpoints
        listas.tsx                      CREAR   testimonios y FAQ
      email/
        page.tsx · page.spec.tsx        CREAR   SMTP
        plantillas.tsx · .spec.tsx      CREAR   el iframe aislado
```

---

## Task 1: Los hooks de las cuatro áreas

**Files:** crear `apps/web/src/hooks/use-configuracion.ts` · `use-configuracion.spec.tsx`

**Catorce endpoints, cuatro recursos independientes.** Siete lecturas y siete escrituras.

> ⚠️ **Errata 2, corregida al cerrar la fase (2026-10-21).** **Son CINCO lecturas y NUEVE
> escrituras**, medido por la T1 contra los controllers. Los 14 endpoints estaban bien; el reparto,
> no. Importa porque **cada escritura es un `gcTime: 0` y una decisión de invalidación**, y **dos de
> las nueve no tienen nada que invalidar** (`useEncolarHealthCheck`, que no tiene GET ni clave, y el
> borrado que ya cubre la clave de la web).

- [ ] **Step 1: Verificá las rutas antes de escribir**

| Método | Ruta | Devuelve |
| --- | --- | --- |
| GET / PUT | `/config/web-salon` | `ConfiguracionWebSalon` |
| POST | `/config/web-salon/testimonios` | `TestimonioAdmin` |
| DELETE | `/config/web-salon/testimonios/:id` | **void** |
| POST | `/config/web-salon/faq` | `PreguntaAdmin` |
| DELETE | `/config/web-salon/faq/:id` | **void** |
| GET / PUT | `/config/smtp` | `ConfiguracionSmtpPublica` |
| GET | `/config/plantillas` | `PlantillaPublica[]` |
| PUT | `/config/plantillas/:tipo` | `PlantillaPublica` |
| GET / PUT | `/config/checkin-qr` | `ConfigCheckIn` |
| GET | `/config/checkin-qr/imagen` | **una imagen** |
| POST | `/jobs/health-check` | `{ jobId }` |

⚠️ **Comprobalas vos contra los controllers.** En la Fase 10 deduje una ruta del nombre del módulo y
era falsa, y el 404 se veía en pantalla como un dato vacío. Ojo además con que
`config-email.controller.ts` vive en `apps/api/src/comunicacion/`, no en un módulo `config-email`.

⚠️ **`GET /config/checkin-qr/imagen` devuelve una imagen, no JSON.** `pedir` parsea JSON: **no la
pidas con él.** Va como `src` de un `<img>` contra `/api/bx/...`, que lleva la cookie sola porque
`pedir` usa `credentials: 'same-origin'` contra el mismo proxy. **Comprobá esa premisa.**

- [ ] **Step 2: El molde**

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ConfigCheckIn,
  ConfiguracionSmtpPublica,
  ConfiguracionWebSalon,
  PlantillaPublica,
  TipoPlantilla,
} from '@boxadmin/shared';
import { type ErrorDeApi, pedir } from '@/lib/cliente';

export const clavesDeConfig = {
  webSalon: () => ['config', 'web-salon'] as const,
  smtp: () => ['config', 'smtp'] as const,
  plantillas: () => ['config', 'plantillas'] as const,
  checkin: () => ['config', 'checkin-qr'] as const,
};

export function useConfigWebSalon() {
  return useQuery({
    queryKey: clavesDeConfig.webSalon(),
    queryFn: () => pedir<ConfiguracionWebSalon>('/config/web-salon'),
  });
}

export function useGuardarWebSalon() {
  const cliente = useQueryClient();
  return useMutation<ConfiguracionWebSalon, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) =>
      pedir<ConfiguracionWebSalon>('/config/web-salon', { metodo: 'PUT', cuerpo: datos }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: clavesDeConfig.webSalon() }),
    gcTime: 0,
  });
}
```

Los demás siguen la misma forma.

⚠️ **`gcTime: 0` en TODAS las mutaciones.** Hay un barrido (`src/hooks/mutaciones-sin-gctime.spec.ts`)
que recorre `src/hooks/*.ts` y falla nombrando archivo y hook. **Y en esta fase importa de verdad**:
una mutación de SMTP sin `gcTime: 0` deja **la contraseña del servidor de correo** cinco minutos en
el `QueryClient`. Es el mismo caso que el `File` del comprobante de pago de la Fase 7, pero peor.

⚠️ **La invalidación es DIRIGIDA**, por recurso. Guardar el SMTP no toca las plantillas. Usá
`src/test/consulta-ajena.ts`: un unitario monta el hook **solo**, y con un único consumidor una
invalidación global y una dirigida **son indistinguibles**.

- [ ] **Step 3: Lo que no puede faltar**

```tsx
it('cada recurso pide SU ruta, con SU metodo', () => {});
it('cada recurso tiene su propia clave', () => {});

it('la clave SMTP viaja en el cuerpo y NO vuelve en la respuesta', () => {
  // `ConfiguracionSmtpPublica` no la lleva: solo `tieneClave`. Sembrá una
  // respuesta SIN clave y comprobá que nada la reinventa.
});
it('guardar el SMTP no invalida las plantillas', () => {});
it('guardar una plantilla invalida SOLO las plantillas', () => {});

it('el tipo de plantilla viaja en la URL, no en el cuerpo', () => {});
it('borrar un testimonio no manda cuerpo', () => {});
it('una escritura que falla sale UNA sola vez', () => {
  // `retry` solo actua al fallar: los conteos sobre un 200 no lo ven.
  // Esperá a que el error este PINTADO antes de contar.
});
```

- [ ] **Step 4: Implementar**, **Step 5: verificar**, **Step 6: mutaciones**

| Mutación | Debe caer |
| --- | --- |
| Guardar SMTP invalida todo (`invalidateQueries()` pelado) | «no invalida las plantillas» + el centinela |
| El tipo de plantilla va en el cuerpo | ese test |
| Quitar un `gcTime: 0` | el barrido, nombrando archivo y hook |
| Dos recursos bajo la misma clave | «cada recurso tiene su propia clave» |
| `retry: 2` en una escritura | «sale UNA sola vez» |

- [ ] **Step 7: La mutación abierta.**

---

## Task 2: El índice, la puerta de rol y el health-check

**Files:** crear `admin/configuracion/page.tsx` · `page.spec.tsx`; tocar `navegacion-admin.ts` y
`armazon.spec.tsx`

**Los 14 endpoints piden `ADMIN_SALON`**, así que la puerta es **del área entera** y no de un bloque
suelto como la caja de la Fase 11.

- [ ] **Step 1: La navegación**

Una línea en `ENLACES_DEL_PANEL` con `minimo: 'ADMIN_SALON'`.

⚠️ **Caen tests de `armazon.spec.tsx`.** Actualizalos y comprobá que siguen teniendo dientes agregando
un enlace de más. El que barre los tres roles **está atado a una lista escrita a mano desde la
Fase 8**, porque derivarlo de `enlacesPara(rol)` era **autorreferencial**. **No lo vuelvas a derivar
de la función que audita.**

⚠️ Es **la primera entrada con `minimo: 'ADMIN_SALON'`** de todo el panel: el resto son
`ADMIN_OPERATIVO`. Comprobá que el armazón ya distingue ese caso y que el test por rol lo cubre; si
no, **ése es el hallazgo**.

- [ ] **Step 2: Lo que no puede faltar**

```tsx
it('un ADMIN_OPERATIVO no tiene Configuracion en el marcado', () => {});
it('y la pantalla no le pide NADA', () => {
  // Gate antes de los hooks, no `enabled: false`. Las dos mitades.
});
it('sin proveedor de rol tampoco se dibuja', () => {});
it('un ADMIN_SALON ve las tres secciones', () => {});

// --- El health-check ---
it('el boton dice que prueba que la API ALCANZA la cola', () => {
  // No dice «todo funciona». No hay endpoint que lea el resultado: el unico
  // rastro es una linea del registro del servidor, que el admin no ve.
});
it('el exito aclara que NO confirma que el job se haya procesado', () => {});
it('un fallo se distingue de un exito', () => {});
it('no se encola dos veces por un doble clic', () => {});
```

- [ ] **Step 3: Implementar**, **Step 4: verificar**, **Step 5: mutaciones**

| Mutación | Debe caer |
| --- | --- |
| `rolAlcanza(rol,'ADMIN_OPERATIVO')` | «no tiene Configuracion en el marcado» |
| La puerta esconde con CSS pero pide igual | «no le pide NADA» |
| El éxito dice «todo funciona» | «aclara que NO confirma…» |
| El botón no se bloquea mientras encola | «no se encola dos veces» |

- [ ] **Step 6: La mutación abierta.**

---

## Task 3: El check-in por QR

**Files:** crear `admin/configuracion/checkin/page.tsx` · `page.spec.tsx`

Tres endpoints y la pantalla más chica. Sirve para fijar el patrón de las otras dos.

- [ ] **Step 1: Lo que no puede faltar**

```tsx
it('dice que ventana rige hoy', () => {});
it('NO afirma si esta configurado o si son los valores por defecto', () => {
  // `ver()` devuelve CONFIG_CHECKIN_POR_DEFECTO cuando no hay fila, asi que
  // desde la respuesta NO se puede saber. A diferencia de los nulos de la
  // Fase 10, aqui el comportamiento es identico en los dos casos: no hay nada
  // que mentir, pero tampoco se afirma lo que no se sabe.
});
it('el QR se pide como imagen, no por `pedir`', () => {
  // `pedir` parsea JSON. Va como `src` de un `<img>` contra /api/bx, que
  // lleva la cookie sola. Afirmá sobre el marcado.
});
it('cero minutos es un valor, no un hueco', () => {});
it('guardar manda los dos campos', () => {});
it('un fallo al leer no se parece a una configuracion en cero', () => {});
```

- [ ] **Step 2: Implementar**, **Step 3: verificar**, **Step 4: mutaciones**

| Mutación | Debe caer |
| --- | --- |
| La pantalla dice «sin configurar» cuando vienen 15 y 15 | «NO afirma si está configurado» |
| El QR se pide con `pedir` | ese test |
| Un cero se manda como ausente | «cero minutos es un valor» |

- [ ] **Step 5: La mutación abierta.**

---

## Task 4: La web pública

**Files:** crear `admin/configuracion/web/page.tsx` · `page.spec.tsx` · `listas.tsx`

**La más grande: 6 endpoints, y dos listas que se guardan solas.**

- [ ] **Step 1: Lo que no puede faltar**

```tsx
it('las banderas apagadas SE VEN, para poder encenderlas', () => {
  // `ConfiguracionWebSalon` es deliberadamente mas ancha que lo que sale sin
  // sesion, y el contrato dice por que.
});

it('mostrarTurnosLibres dice su consecuencia AL LADO', () => {
  // El contrato avisa: «OJO: publica la agenda del gimnasio y cuan vacia
  // esta». Un gimnasio con la agenda vacia publica que esta vacio. No va en
  // una ayuda escondida.
});

it('apagar la web confirma diciendo QUE deja de verse', () => {
  // `activa` es el interruptor maestro. La confirmacion no dice «estas
  // seguro?»: dice que se cae.
});

// --- Las dos listas ---
it('un testimonio se da de alta sin tocar el resto del formulario', () => {
  // POST propio: no depende del PUT general.
});
it('borra el testimonio DE ESA FILA, con dos sembrados', () => {});
it('lo mismo con las preguntas, y las dos listas no se pisan', () => {
  // Con una sola lista sembrada, «borra de la suya» y «borra de la primera»
  // son indistinguibles.
});
it('el alta de una lista no pierde lo que el formulario tenia a medio escribir', () => {});

it('un fallo al leer no se parece a una web sin configurar', () => {});
```

- [ ] **Step 2: Implementar**, **Step 3: verificar**, **Step 4: mutaciones**

| Mutación | Debe caer |
| --- | --- |
| Las banderas apagadas no se dibujan | «SE VEN, para poder encenderlas» |
| La consecuencia de `mostrarTurnosLibres` pasa a un `title=` | «dice su consecuencia AL LADO» |
| Apagar la web no confirma | ese test |
| Borrar manda el id del primero de la lista | «borra el DE ESA FILA» |
| El alta de un testimonio manda también el formulario | «sin tocar el resto» |

- [ ] **Step 5: La mutación abierta.** Es la pantalla que decide qué se publica a internet.

---

## Task 5: El SMTP

**Files:** crear `admin/configuracion/email/page.tsx` · `page.spec.tsx`

⚠️ **Hay una credencial en pantalla. Es la tarea más delicada de la fase.**

- [ ] **Step 1: La clave no se puede conservar, y se dice**

`ConfiguracionSmtpPublica` **no lleva la contraseña, ni enmascarada** —«una máscara sigue confirmando
su longitud»—: sólo `tieneClave: boolean`. Pero el DTO declara **`clave!: string`, obligatoria**.

**No existe «dejá el campo vacío para conservar la que hay».** Cambiar el puerto obliga a reescribir
la contraseña entera. **Verificalo vos contra el DTO**; si resultara opcional, **pará y decímelo**,
porque media tarea cambia.

Y `guardarSmtp` **verifica la conexión ANTES de guardar**, con un test que fija ese orden. Un servidor
mal configurado devuelve un error de SMTP de verdad, ya redactado por `motivoSeguro`. **Se muestra tal
cual y no se reescribe**: el texto del servidor es la única pista de qué está mal.

- [ ] **Step 2: Lo que no puede faltar**

```tsx
it('el campo de clave arranca VACIO, nunca con puntitos de relleno', () => {
  // Un campo relleno que al guardar manda vacio es exactamente la mentira que
  // esta fase existe para no cometer. Afirmá sobre el marcado.
});
it('dice si hay una clave guardada, sin decir nada de ella', () => {
  // `tieneClave`. Ni longitud, ni fecha, ni primeras letras.
});
it('explica que hay que reescribirla para cambiar cualquier otro campo', () => {});
it('la clave NO queda en la cache de mutaciones', () => {
  // `gcTime: 0`. Medilo sobre el QueryClient, no leyendo el hook.
});
it('el error del servidor de correo se muestra TAL CUAL', () => {});
it('la clave no aparece en ninguno de los diez canales', () => {
  // Registrala en vigilarEstosDatos. Es lo mas sensible del sistema.
});
```

- [ ] **Step 3: Implementar**, **Step 4: verificar**, **Step 5: mutaciones**

| Mutación | Debe caer |
| --- | --- |
| El campo arranca con un valor de relleno | «arranca VACIO» |
| Se pinta la longitud de la clave guardada | «sin decir nada de ella» |
| El error de SMTP se reescribe por uno genérico | «se muestra TAL CUAL» |
| Quitar el `gcTime: 0` de esa mutación | «no queda en la cache» + el barrido |

- [ ] **Step 6: La mutación abierta.** **Hay una contraseña de servidor en el formulario.**

---

## Task 6: Las plantillas de email

**Files:** crear `admin/configuracion/email/plantillas.tsx` · `plantillas.spec.tsx`; tocar
`email/page.tsx`

- [ ] **Step 1: Los dos bordes**

**Una plantilla por defecto no es una plantilla tuya.** `esPorDefecto` dice si es la del código o la
que el gimnasio escribió. Pintarla sin decirlo hace creer al admin que él la escribió y que cambiarla
es editar «su» texto, cuando en realidad es crear el primero.

**Los marcadores.** Son **Handlebars** (aceptan `{{#if x}}`), y `DatosDePlantilla` es
`Record<string, string>`: **los válidos de cada tipo no están declarados en ningún sitio**, son los
que cada emisor pasa.

⚠️ **Handlebars renderiza un marcador que no existe como cadena vacía, no literal.** Un `{{clase}}`
en `RECORDATORIO_PAGO` —que sólo recibe `alumno` y `gimnasio`— **sale como un hueco**: «Te esperamos
en » y nada. El admin no se entera nunca; lo sufre un alumno.

**La pantalla lista los marcadores de la plantilla POR DEFECTO de ese tipo**
(`apps/api/src/comunicacion/plantillas.ts`), que es la única fuente real del repo y está garantizada a
funcionar. Puede quedarse corta, **nunca promete uno que no llega**. Y si el texto usa uno de fuera,
**avisa sin bloquear**: la lista under-reporta a propósito, y bloquear convertiría su conservadurismo
en un impedimento.

⚠️ **No puedes importar de `apps/api`.** Decidí cómo obtenés esa lista sin duplicar una segunda fuente
de verdad que se desincronice en silencio, **y contame qué elegiste**. Si no hay forma honesta,
**decilo**: es mejor listar menos que inventar.

- [ ] **Step 2: La previsualización**

Va en un **`<iframe sandbox>` sin permisos**, con los marcadores rellenados con datos de ejemplo.

- [ ] **Step 3: Lo que no puede faltar**

```tsx
it('una plantilla por defecto se distingue de una propia', () => {});
it('las cinco estan, y solo esas cinco', () => {});

it('la previsualizacion va en un iframe con sandbox SIN permisos', () => {
  // Afirmá sobre el MARCADO: que «se vea bien» no prueba nada. Un
  // `sandbox="allow-scripts"` tambien se ve bien.
});
it('el HTML de la plantilla NO se inyecta en el documento del panel', () => {});

it('lista los marcadores de ESE tipo', () => {});
it('usar un marcador de fuera AVISA pero no bloquea', () => {
  // Con `{{clase}}` en RECORDATORIO_PAGO, que es el caso real.
});

it('una plantilla mal formada muestra el motivo de la API', () => {
  // `guardarPlantilla` devuelve 400 ANTES de escribir.
});
it('guardar una plantilla no toca las otras cuatro', () => {});
```

- [ ] **Step 4: Implementar**, **Step 5: verificar**, **Step 6: mutaciones**

| Mutación | Debe caer |
| --- | --- |
| `esPorDefecto` no se dibuja | «se distingue de una propia» |
| `sandbox="allow-scripts allow-same-origin"` | «SIN permisos» |
| La previsualización usa `dangerouslySetInnerHTML` | «NO se inyecta en el documento del panel» |
| El aviso de marcador desconocido bloquea el guardar | «AVISA pero no bloquea» |
| Guardar una invalida las cinco | «no toca las otras cuatro» |

- [ ] **Step 7: La mutación abierta.**

---

## Task 7: Verificación final, README y tracker

- [ ] **Step 1: Todo verde**

```bash
cd /d/Dev/box-admin/apps/web && pnpm exec tsc --noEmit && pnpm test && pnpm build
cd ../api && pnpm exec tsc --noEmit && pnpm exec jest --silent && pnpm exec eslint "src/**/*.ts"
```

⚠️ `apps/api` tiene que seguir en **1339 / 67** y el linter en cero. Si no da eso, **es un hallazgo**.

Los e2e son **Jest + supertest** (13 specs, **218 tests**), **no Playwright**: arrancan Nest dentro del
proceso. Necesitan `postgres-test`: `docker compose up -d postgres postgres-test redis` o
`docker start` de los tres. **`docker compose up` pelado está prohibido.** Si Docker no arranca,
**decilo y seguí**, y **marcá el número como arrastrado y no medido**.

- [ ] **Step 2: El checklist a mano**

Al final del bloque del tracker:

- Entrar como `ADMIN_OPERATIVO` y comprobar que **Configuración no está en la navegación** y que las
  cuatro rutas **no piden nada** (pestaña de red).
- Guardar el SMTP con una contraseña mal puesta y comprobar que **el error es el del servidor de
  correo** y que **no contiene la contraseña**.
- Cambiar sólo el puerto y comprobar que **la pantalla avisa de que hay que reescribir la clave**.
- Escribir `{{clase}}` en la plantilla de recordatorio de pago y comprobar que **avisa sin bloquear**.
- Apagar `activa` y comprobar que la web pública deja de verse, y volver a encenderla.
- Encender `mostrarTurnosLibres` y mirar la web pública **desde una ventana sin sesión**.

- [ ] **Step 3: README y tracker**

Sección «La configuración del gimnasio — Fase 12» en `README.md`, **antes de `## Tests`**. ⚠️ Anclá a
una **línea entera** y a la **última** aparición: `## Tests` es subcadena de un `### Tests` anterior.

Y el bloque de la Fase 12 en `docs/superpowers/plans/PROGRESO.md`, con el formato de los anteriores:
tareas, decisiones, **los errores de este plan que encontraste**, trampas nuevas, estado final, deuda
y siguiente paso.

⚠️ **`PROGRESO.md` ya falla `prettier --check` desde antes**: formateá **sólo tu bloque** y pegalo, no
corras `--write` sobre el archivo entero o reformatearás fases ajenas.

**Lo que no puede faltar en el bloque:** que la clave SMTP no se puede conservar y la pantalla lo
explica; que los marcadores no están declarados y de dónde se sacó la lista; que Handlebars renderiza
un marcador inexistente como **hueco** y no literal; y qué pasó con el health-check.

---

## Lo que esta fase NO hace

- **Cualquier cambio en `apps/api`.** Los 14 endpoints están hechos.
- **Un endpoint que lea el resultado del health-check**, que es lo que haría falta para que ese botón
  cumpliera lo que su nombre promete.
- **Subir imágenes** para la web pública: `imagenPrincipalUrl` es una URL.
- **Un editor visual de HTML.** Es un campo de texto con previsualización.
- **Las pantallas del profesor**, que siguen sin existir.
