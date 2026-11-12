# Fase 17 — Deuda de la web

**Fecha:** 2026-11-12
**Estado:** aprobado, pendiente de plan

## 1. Por qué existe esta fase

La Fase 16 dejó deuda en cuatro grupos independientes. Esta fase toma los dos que viven **sólo en
`apps/web`**: lo que se ve (A) y el orden interno de los meses (B). La API y `packages/shared` no se
tocan.

## 2. Decisiones cerradas con Cesar

1. **Alcance: A + B, sólo web.** El grupo C (`.trim()` en los DTO, la búsqueda del perfil repetida en
   8 servicios, `Importe` contra la cadena pelada) va a la Fase 18. El grupo D (la lista de la Fase 13
   en la infraestructura de tests) sigue anotado.
2. **Un solo texto de sesión vencida, con tildes**, en una constante.
3. Los 9 guardados con el `message` crudo usan una función que **sólo cambia el 401**; el comienzo
   de cada aviso se queda.
4. Los valores por defecto de `ir` y `donde` en `crearClienteDeDatos` **no se testean**: se anotan
   como **aceptados**, no como deuda (probarlos obliga a mover la URL del documento, que el guardián
   prohíbe).

## 3. Lo que se midió al diseñar

La deuda anotada no coincidía del todo con el código:

- **Recortar nombres ya está casi hecho.** El alta de sala (`salas/page.tsx:97`), las invitaciones
  (`invitaciones/formulario.tsx`, zod con `.trim()`) y los packs (`configuracion/packs/page.tsx:465,576`)
  ya recortan. Falta **sólo la edición de una sala** (`salas/[id]/page.tsx:149`).
- **El texto de sesión vencida tiene tres grafías, no dos:** «Tu sesion caduco. Te llevamos al
  login.» (17 pantallas), «Tu sesion caduco. Volve a entrar.» (`comprobantes-pendientes.tsx:661`) y
  «Tu sesión caducó. Te llevamos al login.» (`mensajeDeFallo` y `publicar.tsx`).

## 4. Un solo texto para la sesión vencida

- `lib/sesion-caducada.ts` exporta **`TEXTO_DE_SESION_CADUCADA = 'Tu sesión caducó. Te llevamos al
login.'`**.
- Lo usan `mensajeDeFallo` (`lib/errores-de-api.ts`), `textoDelFallo` de
  `admin/calendario/publicar.tsx`, y **las 15 pantallas** que hoy escriben el texto a mano en su
  `<Aviso>` de lectura (incluida `comprobantes-pendientes.tsx`, que deja de decir «Volve a entrar»).
- **Los specs importan la constante**, no copian el texto: los 4 que hoy esperan la versión sin
  tildes (`mis-clases/[turnoId]/page.spec.tsx`, `analisis/asistencia/page.spec.tsx`,
  `analisis/page.spec.tsx` ×2), los 3 que la buscan con `/tu sesion caduco/i` (que **deja de
  casar** con la versión con tildes: `calendario/page.spec.tsx`, `comprobantes-pendientes.spec.tsx`,
  `pagos-pendientes.spec.tsx`) y los 4 que esperan la versión con tildes.
- **Un test lo fija:** `sesion-caducada.spec.ts` comprueba el texto literal de la constante una vez.
  Ése es el único sitio del repo donde se escribe la frase fuera de la constante.
- Al terminar: `grep -rn "Tu sesion caduco" apps/web/src` da **cero**, y `grep -rn "Tu sesión
caducó" apps/web/src` da **dos** (la constante y su spec).

## 5. Los guardados que muestran «Unauthorized»

La deuda anotaba 9; la búsqueda del plan encontró **13**. Las 4 de más: el alta de una pregunta
(`web/listas.tsx:448`), apagar la web (`web/page.tsx:444`, el `error` del diálogo), la acción del
alumno en su calendario (`(alumno)/calendario/vista-de-semana.tsx:64`) y el alta de usuario
(`admin/usuarios/nuevo/page.tsx:279`).

`lib/errores-de-api.ts` exporta **`textoDelError(error: Error): string`**:

- `ErrorDeApi` con `esSesionCaducada` → `TEXTO_DE_SESION_CADUCADA`;
- cualquier otro caso → `error.message`, igual que hoy.

**No es `mensajeDeFallo`**: ése también reescribe el 403 y pide un rol mínimo; en estas pantallas el
mensaje de la API es la parte útil («Redis no contesta») y el 403 no está en juego.

Reemplaza a `<x>.error.message` en las trece, sin tocar el comienzo de cada aviso. Las nueve de la
deuda:

| Archivo                                       | Línea(s)      |
| --------------------------------------------- | ------------- |
| `(alumno)/comprobantes/subir-comprobante.tsx` | 25            |
| `admin/configuracion/checkin/page.tsx`        | 258           |
| `admin/configuracion/email/page.tsx`          | 650           |
| `admin/configuracion/email/plantillas.tsx`    | 477           |
| `admin/configuracion/web/page.tsx`            | 592           |
| `admin/configuracion/web/listas.tsx`          | 251, 296, 403 |
| `admin/configuracion/page.tsx`                | 213           |

Ejemplo de lo que se lee: «No se pudo borrar el testimonio: Tu sesión caducó. Te llevamos al login.»

- Antes de tocar, se vuelve a buscar `error.message` en los `<Aviso>` de `apps/web/src/app` por si
  hay alguna escritura más que la lista no tenga; si aparece, entra.
- Tests: la función pura (401 → constante; 403, 500 y un `Error` cualquiera → su `message`) y **un
  test por escritura** que monte la pantalla, haga fallar esa escritura con 401 y lea el texto
  entero. `subir-comprobante.tsx` y `vista-de-semana.tsx` no tienen spec: nacen uno cada una.
- Las lecturas con `error.message` (y el check-in, que no es una mutación) quedan fuera: cada
  pantalla ya maneja el 401 de su lectura con su propio aviso.

## 6. El nombre al editar una sala

En `admin/salas/[id]/page.tsx`:

- `cambios()` compara y manda el nombre **recortado**: agregar espacios no es un cambio, y lo que
  viaja no los lleva.
- Un nombre que recortado queda vacío **no se manda** y muestra **«Ponele un nombre.»** en el campo,
  el mismo texto del alta.
- Tests: « Box 2 » viaja como «Box 2»; el nombre original más un espacio dice «No cambiaste nada.»;
  sólo espacios muestra el error y no hay petición.

## 7. Los meses en un solo sitio

1. **El tipo `Mes` pasa a `lib/mes.ts`.** `hooks/use-stats.ts` lo importa de ahí; todos los que hoy
   lo toman de `@/hooks/use-stats` pasan a `@/lib/mes`. **Sin reexport** en `use-stats`, por la misma
   razón que en la Fase 16: un puente esconde a quien no se actualizó. Al terminar, ningún import de
   `@/hooks/use-stats` nombra `Mes`.
2. **`SelectorDeMes` pasa a `componentes/selector-de-mes.tsx`**, con prop **`id`** para el
   `<select>` (`analisis-mes` y `mi-liquidacion-mes`, los de hoy). Se lleva el comentario más
   completo de los dos (el de Análisis). Las dos pantallas lo importan; sus specs no cambian.
3. **El calendario deja su copia de `NOMBRES_DE_MES`** (`admin/calendario/selectores.tsx`) y usa
   `textoDelMes` de `lib/mes.ts`. `MesOfrecido` tiene la misma forma que `Mes` (`{anio, mes}`), así
   que lo acepta sin conversión. `valorDelMes` del calendario **no** se toca: es otro formato de URL.
   El comentario de por qué los nombres se escriben a mano pasa a `lib/mes.ts` si allí no está.

Es un movimiento: **ningún texto ni comportamiento cambia**, y los specs existentes pasan sin tocar
sus afirmaciones.

## 8. Cómo se prueba

- TDD; cada test nuevo se ve rojo antes de verde.
- El guardián global de consola vigila cada spec, como siempre.
- **Una mutación abierta por tarea**, marcada `MUTACION TEMPORAL`.
- Cierre: `tsc`, `build`, tests de web, `prettier --check` sobre lo tocado, los `grep` de §4 y §7 y
  `grep MUTACION TEMPORAL` en cero.

## 9. Tareas

1. Un solo texto de sesión vencida (§4).
2. `textoDelError` en los 13 guardados (§5).
3. El nombre al editar una sala (§6).
4. Los meses en un solo sitio (§7).
5. Cierre: verificación, README, PROGRESO.

## 10. Fuera de alcance

- Todo `apps/api` y `packages/shared` (grupo C, Fase 18).
- La infraestructura de tests de la Fase 13 (grupo D).
- Cambiar cómo cada pantalla decide **cuándo** navega con el 401 de sus lecturas: sólo cambia el texto.
- Los valores por defecto de `ir` y `donde`: aceptados sin test.
