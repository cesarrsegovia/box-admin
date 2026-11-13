# Fase 19 — La deuda que queda

**Fecha:** 2026-11-12
**Estado:** ejecutada (ver `docs/superpowers/plans/PROGRESO.md`, «Progreso Fase 19»)

## 1. Por qué existe esta fase

Las Fases 17 y 18 cerraron la deuda de la web y de la API que estaba anotada como «grupo A/B/C». Queda
lo que esas fases dejaron escrito como **«sigue»**: el 401 de las lecturas, las dos escrituras con
`pedir` directo, el 403 de invitaciones, los tests con fecha fija y la lista de la Fase 13 (grupo D).

## 2. Decisiones cerradas con Cesar

1. **Un 401 en una LECTURA manda al login, desde un solo lugar**, como ya pasa con las escrituras.
   Esto **cambia la regla de la Fase 17** («sólo cambia el texto, no cuándo navega»).
2. Entran: push y check-in, el 403 de invitaciones, los tests con fecha fija de la API y el grupo D.

## 3. Lo que se midió al diseñar

- **No hay redirección global para lecturas.** `lib/query.tsx` sólo tiene `MutationCache.onError`.
  Unas 17 pantallas atajan el 401 de su lectura principal con su propio `router.push(destinoDeLoginDesde(…))`;
  el resto no hace nada.
- **El texto de un 401 no siempre es «Unauthorized».** El proxy `app/api/bx/[...ruta]/route.ts`
  contesta `'Sin sesion'`, `'Sesion expirada'` o el mensaje del backend, y `pedir` lo usa como `.message`.
- **Lugares que pintan el `.message` crudo de una lectura** (sin `textoDelError` ni control del 401):

  | Archivo (`apps/web/src/app/[slug]/…`)                                 | Lectura                                 |
  | --------------------------------------------------------------------- | --------------------------------------- |
  | `admin/usuarios/[id]/bloque-vacaciones.tsx` ~261                      | `useVacaciones`                         |
  | `admin/usuarios/[id]/bloque-pagos.tsx` ~639                           | `usePagos`                              |
  | `admin/usuarios/[id]/bloque-turnos-libres.tsx` ~330                   | `useTurnosLibres`                       |
  | `admin/turnos/[id]/bloque-anotados.tsx` ~251, ~496                    | anotados y `useTurnos` de reasignar     |
  | `admin/salas/[id]/page.tsx` ~579                                      | `useSala` (navega, pero pinta el crudo) |
  | `admin/usuarios/[id]/page.tsx` ~61, `admin/turnos/[id]/page.tsx` ~59  | el mismo patrón                         |
  | `admin/configuracion/checkin/page.tsx` ~171                           | lectura de la página                    |
  | `admin/configuracion/web/page.tsx` ~362                               | ídem                                    |
  | `admin/configuracion/packs/page.tsx` ~880                             | ídem                                    |
  | `admin/configuracion/email/page.tsx` ~376, `plantillas.tsx` ~557      | ídem                                    |
  | `(alumno)/comprobantes/page.tsx` ~26, `(alumno)/mi-pack/page.tsx` ~17 | ídem                                    |
  | `(alumno)/calendario/vista-de-semana.tsx` ~71                         | `disponibles` (lectura principal)       |

  El plan **vuelve a medir** con un grep antes de tocar: si aparece otro, entra.

  **Medido al ejecutar:** no apareció ninguno fuera de la tabla. Son **16 lugares**, que se cubren
  con **18 tests nuevos**. Dos de ellos van en specs que **no existían** y se crearon:
  `(alumno)/comprobantes/page.spec.tsx` y `(alumno)/mi-pack/page.spec.tsx`. Push y check-in suman
  además `hooks/use-push.spec.tsx` y `hooks/use-check-in.spec.tsx`, y el grupo D suma
  `src/test/portapapeles.spec.ts`.

- **Ninguna ruta pública lee con React Query** (`(publico)/login`, `(publico)/registro`): el 401 global
  no puede llevar al login a quien todavía no entró.
- **Push** (`componentes/boton-de-push.tsx` ~107, ~154) **y check-in** (`checkin/pantalla-de-check-in.tsx`
  ~159) escriben con `pedir` directo: el `MutationCache` no los ve.
- **Invitaciones** es la única pantalla con `repartirPorCampo` sin rama de 403; la ruta pide
  `ADMIN_OPERATIVO`. Su test «un 403 de la API se explica por el rol» afirma `/forbidden/i`.
- **Fecha fija:** 28 specs de la API usan `new Date('20xx…')` y 47 líneas de código leen el reloj. La
  bomba de stats (Fase 18) sólo se vio cuando el calendario pasó la fecha.
- **Grupo D:** sigue habiendo **un solo `<iframe>`** en el repo (plantillas, con `sandbox`).

## 4. El 401 de las lecturas

**`crearClienteDeDatos` gana un `QueryCache` con `onError`** que hace lo mismo que el de las escrituras:
`destinoSiCaducoLaSesion(error, donde())` y, si no es `null`, `ir(destino)`. **El `saliendo` es el mismo**
para los dos: una lectura y una escritura que fallan juntas navegan una vez.

- Login y rutas sin slug quedan fuera por `destinoSiCaducoLaSesion`, como hoy.
- **Los `router.push` de cada pantalla se quedan.** Sacarlos son 17 pantallas y sus specs. No es una
  redundancia limpia sino **una carrera conocida**: si el `router.push` de la pantalla gana, navega el
  router y la cache no se tira; y las pantallas con `SIN_QUERY` arman otro `volverA` cuando la URL
  lleva query. Se acepta porque las dos salidas terminan en el login del gimnasio.
- **El texto**: cada lugar de la tabla de §3 pasa a pintar `textoDelError(error)` (lo que se lee el
  instante antes de salir). Donde hay prefijo («No se pudieron leer los pagos: …») el prefijo se queda.
- Los specs de pantalla siguen con un `QueryClient` pelado: no navegan. La navegación se prueba en
  `lib/query.spec.tsx` con `ir` y `donde` inyectados, igual que la de las escrituras.

## 5. Push y check-in pasan a `useMutation`

Las dos escrituras se envuelven en un **`useMutation`** y se llaman con `mutateAsync`. Así las ve el
`MutationCache` y **van al login sin código propio**; el texto pasa por `textoDelError`.

- **Push**: el orden servidor/navegador y el 503 → «sin configurar» quedan igual. Lo que se mueve es
  **el `unsubscribe` si el POST falla**: pasa de la pantalla al `mutationFn` de
  `useGuardarSuscripcion`, que recibe la `PushSubscription` y la serializa él. En TanStack v5 el
  `onError` del `MutationCache` —el que navega al login ante un 401— corre **antes** de que
  `mutateAsync` rechace; desde el `catch` de la pantalla, el deshacer competía con la descarga de la
  página y podía quedar una suscripción en el navegador que el servidor no tiene.
- **Check-in**: el `useRef` que evita el doble POST se queda. El destino del login conserva el `?f=`,
  porque `destinoSiCaducoLaSesion` usa `pathname` y `search`: el alumno vuelve con la firma.
- Un 401 en el check-in **no es un rechazo**: `rechazoDeCheckIn` sólo mira el 409, así que no cambia.

## 6. El 403 de invitaciones

`invitaciones/formulario.tsx` gana la rama de 403 que tienen las otras siete pantallas con
`repartirPorCampo`: el cartel dice `mensajeDeFallo(error, 'ADMIN_OPERATIVO')`. Su test pasa a afirmar
ese texto entero y que **no** aparece «Forbidden».

## 7. Tests con fecha fija (API)

- **Medir corriendo la suite con el reloj adelantado.** Un archivo de setup de Jest,
  `apps/api/test/reloj-adelantado.ts`, adelanta `Date` (no los timers) y se usa con un script
  `test:reloj` en `apps/api/package.json`. Se corre a **+1 año y +5 años**.
- **Cada test que se ponga rojo se arregla como el de stats**: pasarle `ahora` al servicio, o fechas
  relativas a un `ahora` fijo del test. **Nunca** cambiando la fecha fija por otra más lejana.
- Si un rojo es del código y no del test (un servicio que no deja inyectar `ahora`), se le agrega el
  parámetro `ahora: Date = new Date()`, como ya tienen `pagos`, `checkin` y `mi-calendario`.
- El script queda: la próxima bomba se encuentra corriéndolo, no esperando al calendario.
- Fuera: los e2e (usan la base y el reloj de Postgres) y la web.

**Medido al ejecutar:**

- El script quedó `"test:reloj": "jest --setupFiles=../test/reloj-adelantado.ts"`. La ruta es
  relativa a `rootDir` (`src`).
- `RELOJ_ANIOS` vale 1 por defecto. Para filtrar se usa `--testPathPattern`, porque una ruta suelta
  se la come `--setupFiles`.
- **No hubo bombas.** La suite dio 1435 / 71 en verde a +0,14, +0,5, +1, +5, +20 y +50 años. No hizo
  falta tocar ningún spec ni agregar `ahora` a ningún servicio.
- No cubre un `useFakeTimers()` sin `setSystemTime`, que arranca en la fecha de verdad. Después de
  `useRealTimers()` vuelve el `Date` adelantado.

## 8. Grupo D — la lista de la Fase 13

| Hueco                                            | Qué se hace                                                                                                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Atributos de los descendientes del `<body>` (42) | **Se cierra.** El barrido del `.value` ya recorre `body.querySelectorAll('*')`; se le suman los atributos.                                                              |
| `navigator.clipboard` (46b)                      | **Se cierra.** Un doble de `navigator.clipboard` que registra lo escrito, instalado por el guardián; los 3 specs que hoy lo pisan desde dentro del test usan ese doble. |
| Contexto de navegación anidado (44)              | **Sigue por diseño:** hay un solo `<iframe>` y va con `sandbox`. La forma del arreglo ya está escrita para cuando aparezca el segundo.                                  |
| Partir el dato en trozos                         | **Por diseño**, con el argumento ya escrito. Deja de figurar como deuda.                                                                                                |
| El `.value` de la limpieza de un `useEffect`     | **Por diseño**, con el argumento ya escrito. Deja de figurar como deuda.                                                                                                |

Cada canal cerrado se prueba como los anteriores: **una mutación abierta que hoy pasa en verde** y con
el canal se pone roja.

**Medido al ejecutar (corrige la tabla):**

- **Los atributos (42): cerrada, salvo `href` y `data-*`.** Sumarle los atributos al barrido no
  alcanzaba: un atributo siempre está en el `innerHTML`, así que restarlo contra el marcado lo daba
  por visto, y la mutación (`title={tenantId}` en packs) seguía 29/29 en verde.
  - Los atributos se restan contra el **`textContent`**. `value`, `href` y `data-*` se siguen restando
    contra el marcado, y `href` y `data-*` quedan como huecos conocidos (decisión de Cesar).
  - Con el canal, la mutación da rojo 25/29.
- **El portapapeles (46b): cerrada.**
  - El doble es **único** y lo monta el guardián. Un centinela copiado que **ningún spec reclamó** con
    `reclamarLoCopiado()` pone rojo el test. `escrituraDelPortapapeles()` da el mock de `writeText`.
  - `userEvent.setup()` (user-event 14.6.7) pisaba el doble, también con `writeToClipboard: false`.
    El doble lleva **el símbolo interno de user-event**, importado de
    `dist/esm/utils/dataTransfer/Clipboard.js`, y con eso `setup()` no lo pisa. Si una versión futura
    lo cambia, el guardián lanza al cargar.
  - La mutación de la 46b en la agenda da rojo 12/20, antes 20/20.

## 9. Cómo se prueba

- TDD; cada test nuevo se ve rojo antes de verde.
- **§4:** en `lib/query.spec.tsx`, una lectura con 401 llama a `ir` con el destino; una de 403 o de red
  no; lectura y escritura con 401 juntas navegan una vez; en `/login` no navega. Un test por cada lugar
  de la tabla: con un 401 se lee `TEXTO_DE_SESION_CADUCADA` y no «Unauthorized».
- **§5:** push y check-in con un 401 muestran el texto común; un test de `query.spec` ya cubre que la
  mutación navega. Cada pantalla suma un test que monta un `MutationCache` con un espía (no navega) y
  afirma que el 401 llega una vez —en push, al activar y al desactivar—: con `pedir` directo en la
  pantalla, da rojo. En el hook de push, el `unsubscribe` corre antes que el `onError` del cache. Los
  tests que hoy tienen siguen pasando sin tocar sus afirmaciones.
- **§6:** el test de invitaciones con el texto entero.
- **§7:** `test:reloj` en verde a +1 y +5 años; la suite normal también.
- **§8:** una mutación abierta por canal.
- Una mutación abierta por tarea, marcada `MUTACION TEMPORAL`.
- Cierre: `tsc` y tests de web y api, `build` de web, `prettier --check` sobre lo tocado y
  `grep MUTACION TEMPORAL` en cero.

## 10. Tareas

1. El 401 global de las lecturas (`lib/query.tsx`) y el texto en los lugares de §3.
2. Push y check-in con `useMutation`.
3. El 403 de invitaciones.
4. El reloj adelantado y las bombas que encuentre.
5. Grupo D: los dos canales.
6. Cierre: verificación, README, PROGRESO.

## 11. Fuera de alcance

- Sacar los `router.push` de cada pantalla (§4).
- El contexto de navegación anidado (§8).
- El reloj adelantado en los e2e y en la web.
- La deuda vieja de otras fases que no es del grupo D (`use-rutinas.ts` sin tests, la sobre-invalidación
  de `/mi-pack`, `PanelDeReasignar` con turnos pasados, etc.).
