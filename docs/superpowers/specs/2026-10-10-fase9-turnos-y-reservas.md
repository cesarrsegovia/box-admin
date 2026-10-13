# Fase 9 — Turnos y reservas

**Fecha:** 2026-10-10
**Estado:** aprobado, pendiente de plan

## 1. Por qué existe esta fase

La Fase 8 entregó la pantalla que **genera** el mes. Esta entrega la que permite **tocarlo**: ver un
turno, editarlo, poner una suplencia, anotar a alguien a mano, cancelarle y reasignarle la reserva.

Es lo que recepción hace todo el día, y hoy exige un `curl`. Sin esto se puede publicar un mes entero y
después no se puede mover nada de él.

## 2. El hueco que obliga a tocar la API

**No hay forma de que un admin vea quién está anotado en un turno.**

- `TurnoPublico` trae `reservasActivas`, que es un **contador**, no la lista.
- El único endpoint que lista alumnos de una clase es `GET /mis-clases/:turnoId/alumnos`, y su servicio
  llama a `exigirTurnoPropio(..., perfil.id)`: **exige que el turno sea del profesor que llama.** Un
  admin no pasa.

Resultado: el admin puede **crear** una reserva, y puede **cancelar** o **reasignar** una cuyo id ya
conozca — pero no tiene de dónde sacar ese id salvo de la respuesta del POST que él mismo acaba de
hacer. Dos endpoints que existen y nadie puede usar.

Es la misma forma del hueco de la Fase 6B, donde el admin no podía conocer los ids que el borrado de
testimonios necesitaba. Allí se resolvió igual: **un endpoint de lectura que falta se agrega donde se
descubre.**

⚠️ **Esta fase rompe, a propósito y por una sola vez, la regla de «la fase no toca la API»** que
sostuvieron las fases 7 y 8. Es el único cambio en `apps/api`.

### El contrato nuevo

**No se reusa `AlumnoEnClase`**, que tiene `perfilId`, `nombreCompleto` y `asistio` — **no trae el id de
la reserva**, que es justamente lo que el admin necesita para cancelar o reasignar.

`GET /turnos/:id/reservas` con `@Roles('ADMIN_OPERATIVO')` devuelve un contrato propio con: **id de la
reserva**, `perfilId`, `nombreCompleto`, `origen`, `esPrueba`, `pagoRealizado`, `asistio`, `canceladaEn`
y `cancelacionTipo`.

Devuelve **todas**, activas y canceladas, y la pantalla las separa. No se inventa un parámetro para
filtrar: un solo endpoint sirve a los dos usos, y ver quién canceló recuperable es contexto que el admin
quiere.

### Lo que el endpoint hereda de las reglas de la API

- ⚠️ **NO entra en el inventario de rutas públicas**, y eso es lo que hay que comprobar. Ese test
  (`common/guards/rutas-publicas.spec.ts`) enumera las rutas que **no piden JWT**; una con `@Roles` no
  es una de ellas. Lo valioso es que el inventario es **bidireccional**: si alguien marcara esta ruta
  con `@Public()` por error, el test lo caza como un `@Public()` que sobra. O sea que la comprobación
  aquí es que el inventario **siga igual** después de agregar el endpoint — si cambia, algo salió mal.
- El aislamiento por inquilino lo da la extensión de Prisma sola, **siempre que no use `findUnique` ni
  `upsert`**, que la extensión rechaza (`UnsafeUniqueOperationError`).
- El contrato va en `packages/shared`, que hay que **reconstruir** después de tocarlo porque los demás
  paquetes resuelven los tipos desde `dist/`.
- Lleva unitarios **y e2e**. La Fase 6B dejó la regla escrita con sangre: _un doble escrito a mano sólo
  sabe lo que su autor creía_ — allí dos funciones centrales resultaron no haber funcionado nunca con
  1290 tests en verde. **El e2e es el que prueba que el endpoint existe de verdad.**

## 3. Decisiones cerradas con Cesar

1. **Se agrega el endpoint que falta**, en vez de reducir el alcance o relajar el de profesor. Relajar
   `exigirTurnoPropio` haría que `/mis-clases` significara dos cosas según quién pregunte, y la pantalla
   del profesor depende de ese filtro para no ver las clases de otra.
2. **Una pantalla de turnos con filtros**, independiente del calendario: sirve igual para turnos
   publicados o creados a mano, y recepción casi siempre quiere ver **hoy**, no elegir sala y mes.

## 4. Las dos pantallas

### 4.1 El listado — `/{slug}/admin/turnos`

Los cinco filtros que `GET /turnos` ya acepta —`desde`, `hasta`, `salaId`, `soloLibres`, `profesorId`—
**en la URL**, como Personas, Invitaciones y el calendario.

Columnas: fecha, hora, clase, sala, profesora y la ocupación (`reservasActivas` / `cupo`).

### 4.2 La ficha — `/{slug}/admin/turnos/{id}`

Cuatro bloques, **cada uno con su propia mutación**: son cinco endpoints distintos y mezclarlos
convertiría cinco fallos posibles en un único «algo salió mal».

1. **Los datos**: nombre, horario, cupo.
2. **La profesora**: `PATCH /turnos/:id/profesor`, que es su propio endpoint a propósito — cambiarla en
   un turno suelto (la suplencia) no es lo mismo que editar el turno.
3. **Los anotados**: la lista, con cancelar y reasignar por fila, y el formulario para anotar.
4. **Borrar el turno.**

**De dónde salen los dos ids que hacen falta.** Para **anotar** se elige una persona: sale de
`useUsuarios()`, y lo que se manda es el **`perfilId`, no el `id` del usuario** — el DTO lo dice
explícito («los listados de usuarios devuelven `perfilId` justamente para esto»), y `UsuarioResumen` lo
trae. Para **reasignar** se elige un turno destino: sale de `GET /turnos` con los mismos filtros del
listado, acotado por defecto a la sala del turno actual, porque reasignar a otra sala falla si el
alumno no tiene acceso (§6).

⚠️ **Borrar dice de entrada si hay gente anotada.** La API ya se protege: borrar un turno con reservas
activas da 409 con el número («El turno tiene N reserva(s) activa(s). Cancelalas antes de borrarlo»), y
el borrado físico sólo ocurre cuando no queda nadie. La pantalla muestra eso **antes** del clic — y
maneja igual el 409, porque alguien puede anotarse en el medio.

## 5. Cancelar no es una sola cosa

Hay que elegir entre `RECUPERABLE` y `DEFINITIVA`, y **la diferencia no es técnica**. Según
`ConsumoDePack`, las clases consumidas son «las no canceladas **y las canceladas como DEFINITIVA**».

O sea: **una definitiva le gasta la clase al alumno y una recuperable se la devuelve.**

La pantalla no pregunta «¿tipo de cancelación?» con dos siglas: pregunta si se le devuelve la clase o se
le consume, que es la decisión real y la que el admin puede explicarle al alumno.

Es la misma clase de problema que la contraseña temporal de la Fase 7 — una decisión cuyo costo lo paga
otra persona — y se resuelve igual: haciéndola explícita en vez de esconderla detrás de un valor de
enumeración.

## 6. Los errores, que acá son casi todos de negocio

Esta pantalla choca con más reglas del servidor que ninguna anterior. Los mensajes son del servidor y se
muestran **tal cual**: están escritos para quien está en el mostrador.

| Caso                                    | Qué dice la API                                                        |
| --------------------------------------- | ---------------------------------------------------------------------- |
| Borrar con gente                        | «El turno tiene N reserva(s) activa(s). Cancelalas antes de borrarlo.» |
| Anotar en un turno lleno                | «El turno esta completo (N/M).»                                        |
| Anotar a quien ya está                  | «El usuario ya tiene una reserva activa en este turno»                 |
| Cancelar una ya cancelada               | «La reserva ya estaba cancelada»                                       |
| Reasignar una cancelada                 | «La reserva esta cancelada; crea una nueva en vez de reasignarla»      |
| Reasignar a un turno lleno              | «El turno destino esta completo (N/M).»                                |
| Reasignar a quien ya está en el destino | «El usuario ya tiene una reserva activa en el turno destino»           |

### Dos que NO se tratan como el resto del panel

⚠️ **Hay un 403 que no es de rol.** Reasignar a un turno de una sala a la que el alumno no tiene acceso
devuelve `ForbiddenException`: «El usuario no tiene acceso a la sala del turno destino». El panel
traduce los 403 a «necesitás ser tal rol», y acá eso sería **mentir** — el admin tiene el rol de sobra;
el que no tiene acceso es el alumno. **Este 403 muestra su mensaje tal cual.**

⚠️ **Hay un 409 que sí es reintentable**, a diferencia de los demás. Cuando dos peticiones tocan el
mismo turno a la vez: «Otra peticion esta tocando este turno ahora mismo; reintenta en unos segundos.»
Los otros 409 piden **otra acción**; éste pide **lo mismo, más tarde**, y la pantalla ofrece reintentar.

### Las advertencias

`ReservaCreada extends ReservaPublica, ConAdvertencias`: la reserva se creó **y** hay algo que mirar. No
son errores y no se pueden perder, como en el alta de personas de la Fase 7.

## 7. Lo que se reusa

El reparto de errores por campo (`admin/usuarios/[id]/errores.ts`), la tabla, el diálogo de
confirmación, `useUsuarios()` para elegir a quién anotar, `useRolDeQuienMira()`, el helper del `volverA`
que conserva el query (`lib/destino-de-login.ts`) y los dos tapones globales de `vitest.setup.ts`.

## 8. Cómo se prueba

Lo habitual, más lo que esta pantalla trae de nuevo:

- **La elección de cancelación se hace explícita**: las dos opciones dicen qué le pasa a la clase, no
  las siglas.
- **Cancelar manda el tipo que se eligió**, no el que viene por defecto. Elegir «definitiva» y mandar
  «recuperable» es invisible en pantalla y le regala una clase al gimnasio o se la roba al alumno.
- **El id que se manda es el de esa fila**, con **dos** reservas sembradas. Con una sola, «cancela la
  suya» y «cancela la primera» son indistinguibles — es la lección del borrado de testimonios de la 6B.
- **Los identificadores no entran en el marcado**, con un centinela que incluye un perfil que **no**
  resuelve: con todos resolviendo, «pinto el nombre» y «pinto el id si no hay nombre» no se distinguen
  (Fase 8).
- **Borrar no se ofrece como si fuera a funcionar** cuando hay anotados, y aun así maneja el 409.
- **El 403 de sala no se traduce a un mensaje de rol.**
- **El 409 de concurrencia ofrece reintentar y los otros no.**

### La mutación abierta

Cada tarea lleva una. Van **veinte de veinte** en tres fases. La familia es siempre **agregar algo que
no debería estar, sin quitar nada**, y lo que cambia es **dónde nadie estaba mirando**: el payload RSC,
dos cachés distintas, `localStorage`, un atributo del DOM, una cabecera de respuesta, las cabeceras de
la petición, `console.*`, el título de la pestaña, el argumento recibido, la navegación al montar.

Y las **cuatro formas** que encontramos de que un test exista y **no pueda fallar** — mirarlas en lo que
se escriba:

1. **Autorreferencial**: comparar el DOM contra la misma función que lo alimenta.
2. **Premisa destruida**: el código bajo prueba borra el borde que el test venía a ejercitar.
3. **Montado en el caso ciego**: fijar algo en el único escenario donde la distinción no existe.
4. **Verde por casualidad ortográfica**: una defensa que necesita un comentario rogando que nadie toque
   una palabra.

## 9. Fuera de alcance

- **La configuración operativa** (salas, horarios de profesor, vacaciones, ausencias): 15 endpoints,
  fase posterior. Cierra Operación diaria.
- **Crear un turno a mano.** `POST /turnos` existe, pero el camino normal es publicar el mes; una
  pantalla de alta suelta invita a crear turnos huérfanos del plan. Se evalúa cuando exista la
  configuración operativa.
- **Pasar lista.** Es del profesor y tiene su propio endpoint con su propio rol.
- **Pantallas de profesor**, que siguen sin existir.
- **Cualquier otro cambio en `apps/api`** más allá del endpoint del §2.
