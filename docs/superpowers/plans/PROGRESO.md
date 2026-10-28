# Progreso Fase 0

- [x] T1 Andamiaje del monorepo
- [x] T2 packages/shared (corregido fail-open en rolAlcanza)
- [x] T3 Infraestructura Docker (postgres remapeado a 5434)
- [x] T4 Bootstrap NestJS (strict activado, scripts db:* con dotenv)
- [x] T5 Prisma + migracion (Prisma 7: prisma.config.ts + driver adapter)
- [x] T6 Contexto de tenant (mutacion verificada: el test de concurrencia es el centinela)
- [x] T7 Extension de Prisma (+ T7b: 5 fugas cerradas, 89 tests)
- [x] T8 Middleware de tenant (+ validacion de tenantId, 106 tests)
- [x] T9 Decorators y guards (+ validacion de entorno, 155 tests)
- [x] T10 Auth (+ CAS en rotacion, hash senuelo, argon2 pinado 0.44.0, 160 tests)
- [x] T11 Filtro de errores + main (8 errores de aislamiento cubiertos, 171 tests)
- [x] T12 BullMQ (worker consumiendo jobs, ioredis a v5, 173 tests)
- [x] T13 e2e (16/16, jest sale limpio tras arreglar la conexion de BullMQ)
- [x] T14 README + checklist (9/9, imagen de la API construida y arrancando)

FASE 0 COMPLETA y commiteada por Cesar en `e610e88`. 173 unitarios + 16 e2e.

---

# Progreso Fase 1 — Núcleo operativo

Plan: `docs/superpowers/plans/2026-09-14-fase1-nucleo-operativo.md`
Spec: `docs/superpowers/specs/2026-09-14-fase1-nucleo-operativo.md`

- [x] T0 Spike de transacciones — **las tres preguntas en verde, sin cambios en
      producción**. Verificado contra Prisma 7.10.0 y la base real: `$transaction`
      NO la bloquea el hook que mata el SQL crudo, el contexto de tenant
      sobrevive dentro del callback, y `isolationLevel: 'Serializable'` funciona.
      El spike se borró; la Fase 1 es viable tal como está diseñada.
- [x] T1 Schema, migración, clasificación y centinela — 174 unitarios + 16 e2e.
      Revisión APROBADA: los 10 modelos clasificados en la categoría correcta,
      TRUNCATE completo, migración fiel al schema. Dos trampas documentadas en
      el plan: `db:migrate -- --name` se cuelga, y la base de e2e es un segundo
      contenedor (`postgres-test`, 5433) que hay que levantar aparte.
- [x] T1b Claves foráneas calificadas por tenant (surgida de la revisión de T1)
      `@@unique([tenantId, id])` en Usuario, Sala, Perfil, Pack y Turno, y las 8
      relaciones internas convertidas en FK compuestas. Postgres rechaza ahora el
      cruce entre gimnasios por si mismo (23503), incluso saltandose la extension.
      Prisma exigio ademas `@@unique([tenantId, usuarioId])` en Perfil: el lado que
      define una relacion 1-1 debe ser unico sobre exactamente las columnas de la FK.
      Migracion regenerada (no habia datos ni commit) y ambas bases reseteadas con
      permiso explicito de Cesar. 174 unitarios + 21 e2e, 5 de ellos nuevos en
      `test/aislamiento-fk.e2e-spec.ts`, que lo demuestran con `prisma.base`.
- [x] T2 Contratos compartidos y utilidades de fecha — 18 tests nuevos en shared + 174 en la API. Hubo que montar jest en `packages/shared`, que no tenía
      runner de tests: el plan lo daba por hecho y no existía.
- [x] T3 HistorialService — 178 tests. Por fin se escribe en `historial_acciones`,
      la tabla que llevaba desde la Fase 0 creada y sin usar. Acepta cliente de
      transaccion para que la auditoria se revierta con el cambio que la origino.
- [x] T4 Modulo salas — 188 tests. Destapo un bug de mi plan: el doble de
      `$transaction` no compilaba bajo strict (TS7022, inferencia circular).
      Corregido en las 5 tareas que lo reutilizan.
- [x] T5 Modulo packs — 198 tests. Catalogo de precios como seccion propia, no
      escondido en el alta de alumno. Precio como Decimal dentro y string fuera.
- [x] T6 usuarios — altas de alumno y profesor. 213 tests (198 + 3 de contraseña
      temporal + 12 del alta). Dos DTOs distintos sobre el mismo recurso: el de
      profesor ni siquiera acepta packId, clases ni vigencias, así que con
      `forbidNonWhitelisted` mandárselos es 400 — se acabó el arrastre de campos
      de alumno de TurnoFit. El alta sin salas devuelve 201 con `SIN_SALAS` en el
      cuerpo en vez de guardar en silencio un usuario inservible. El plan predecía
      214 tests, pero su propio spec literal solo contiene 12 casos de alta, no 13.
- [x] T7 usuarios — listado, detalle, edicion, salas, reset y baja — 264 tests
      totales (29 en usuarios). Verificado por mi tras las dos tareas paralelas:
      264 unitarios + 21 e2e, tsc limpio, nada en el indice de git.
- [x] T8 Modulo turnos — 278 tests. Destapo un bug que el plan dejaba "por
      verificar en los e2e" y que resolvi en el momento: la FK de reservas era
      ON DELETE RESTRICT, asi que borrar un turno cuyas reservas estaban todas
      canceladas pasaba la comprobacion y reventaba con un 500 opaco. Verificado
      contra Postgres y arreglado con la migracion reserva_turno_cascade.
- [x] T9 reservas — crear con cupo y concurrencia — 306 tests. Transaccion
      Serializable con reintento solo ante P2034/40001/40P01; los errores de
      negocio no se reintentan. El primer intento de esta tarea murio por limite
      de sesion sin escribir nada y se relanzo limpia.
- [x] T10 reservas — cancelar — 313 tests. RECUPERABLE vs DEFINITIVA sale
      automatico porque el consumo se deriva de las reservas; no hay contador
      que ajustar. cancelacionesUsadas solo sube si cancela el propio alumno.
- [x] T11 reservas — reasignar — 320 tests. Valida cupo y acceso a sala del turno
      DESTINO, en la misma transaccion Serializable que la creacion.
- [x] T12 e2e del checklist, concurrencia y aislamiento — **56 e2e** (16 de auth +
      5 de FK + 35 nuevos), Jest sale con código 0 sin `--forceExit`. El test de
      concurrencia da **exactamente una 201 y nueve 409** sobre un turno de cupo 1,
      repetido 5 veces (3 por el agente, 2 por mí). Los 5 de aislamiento entre
      gimnasios pasaron a la primera. Se corrigió un único test —no código de
      producción—: el plan comprobaba que la respuesta del alta de profesor no
      contuviera la palabra "clase", pero el contrato compartido obliga a emitir
      `clasesExtra: 0`. El plan se contradecía consigo mismo.
- [x] T13 Verificación final, README y cierre — el agente se detuvo al acabar la
      sesión sin dejar nada persistente, así que lo hice yo. Recorrí los diez
      puntos del checklist a mano contra la API corriendo (no solo por e2e) y
      documenté los endpoints en el README.

## Decisiones cerradas con Cesar antes de empezar

1. Alta de usuarios: el API genera la contraseña temporal y la devuelve una sola vez.
2. Clases consumidas: derivadas de las reservas, sin contador almacenado.
3. Pack agotado: se avisa con `PACK_AGOTADO`, no se bloquea la reserva.
4. Cupo: transacción `Serializable` con reintento ante `P2034`.

## Estado final de la Fase 1

**326 tests unitarios + 56 e2e en verde.** `tsc --noEmit` limpio. `prisma migrate
status`: sin deriva. Prettier limpio sobre todo lo que escribe esta fase. Jest sale
con código 0. Nada commiteado: el índice de git está vacío y `.env` / `.env.test`
siguen ignorados.

### Checklist de aceptación del PDF, verificado a mano contra la API real

| #   | Punto                                                            | Resultado                                                                                            |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Crear una sala y configurarla con sus reglas propias             | ✅ 201, `cupoBase: 12`, `exclusiva: true`                                                            |
| 2   | Crear un pack en el catálogo, independiente de cualquier alumno  | ✅ 201, `precio: "12500.00"` como string                                                             |
| 3   | Alta de alumno y de profesor con DTOs y validaciones distintas   | ✅ 201 / 201; mandar `packId` al alta de profesor → **400**                                          |
| 4   | Un alumno sin salas genera un warning visible                    | ✅ 201 con `["SIN_SALAS","SIN_PACK"]`; `PATCH /salas` con `[]` → **400**                             |
| 5   | Crear un turno y asignarle una reserva manual respetando el cupo | ✅ 201 / 201, `fecha: "2026-10-05"` sin huso                                                         |
| 6   | Reservar un turno lleno devuelve 409                             | ✅ **409**, sin registro fuera de cupo                                                               |
| 7   | Recuperable devuelve la clase; definitiva no                     | ✅ tras RECUPERABLE la siguiente reserva no advierte; tras DEFINITIVA avisa `PACK_AGOTADO`           |
| 8   | Reasignar mueve el registro y valida el cupo del destino         | ✅ 200, origen a 0 activas y destino a 1; destino lleno → **409**                                    |
| 9   | Cada operación relevante queda en `historial_acciones`           | ✅ 16 filas (Sala, Pack, Usuario, Turno, Reserva CREADA/CANCELADA/REASIGNADA), **0 sin `usuarioId`** |
| 10  | e2e cubren el flujo completo                                     | ✅ 35 tests nuevos en `nucleo.e2e-spec.ts`                                                           |

- [x] T13b El reintento de serializacion era codigo muerto (surgido de la
      verificacion final) — 326 tests. Detalle abajo.

### Lo que se encontró por el camino

Cinco bugs reales, ninguno de ellos visible en un test verde:

0. **El reintento ante conflictos de serialización nunca se disparó.** La
   detección miraba solo `error.code` contra `P2034`/`40001`/`40P01`, pero con el
   driver adapter `pg` de Prisma 7 el conflicto llega como
   `DriverAdapterError` con `cause.kind === 'TransactionWriteConflict'` y **sin
   `code`**. Era código muerto. No hubo sobrecupo nunca —de eso se encarga el
   aislamiento `Serializable` por sí mismo— pero una petición de cada ~20 recibía
   un 500 opaco. Lo destapó el e2e de concurrencia fallando de forma intermitente
   en la verificación final: 1 creada, 8 rechazadas y una que no era ninguna de
   las dos. Verificado tras el arreglo con 15 rondas de 10 peticiones simultáneas
   y 8 rondas de 20, todas limpias.

1. **`PATCH /salas/:id` con `activa: false` esquivaba la protección de turnos
   futuros.** El 409 vivía solo en el `DELETE`. Estaba en el único método de los
   tres primeros módulos sin un solo test; la correlación no es casualidad.
2. **El `tipo` de un pack era inmutable en la práctica**: ninguna secuencia de PATCH
   permitía pasar de MENSUAL a TOTAL.
3. **Las claves foráneas no estaban calificadas por tenant.** Nada impedía a nivel
   de base que una reserva de un gimnasio apuntase al turno de otro.
4. **Borrar un turno con reservas canceladas daba un 500 opaco** (`ON DELETE
RESTRICT` + un `count` que solo miraba las activas).

Y uno que no era bug sino una trampa heredada: `visibleAlumnos: false` escondía la
sala también a los **profesores**, lo que habría mordido en la Fase 4.

### Deuda declarada

Está en el plan, en "Deuda declarada para la Fase 2 y siguientes". Lo más relevante:
ningún error de Prisma se traduce a HTTP (un `P2002` saldría como 500), los campos
"hereda del tenant" de `Sala` se almacenan pero no se consumen, `comienzoDeHoyUtc`
compara contra medianoche UTC sin zona horaria por tenant, y no hay paginación en
ningún listado.

El repo tampoco pasa su propio `prettier --check` sobre el código de la Fase 0: la
config no declaraba `printWidth` y se aplicaba el default de 80 sobre código escrito
a ~100. Se añadió `"printWidth": 100`, pero **no se reformateó la Fase 0** para no
ensuciar el diff de ésta. Merece un commit propio, solo de formato.

## Siguiente paso

Fase 1 completa. Nada commiteado: hay **16 mensajes de commit sugeridos** esperando
a Cesar (uno por tarea, mas T1b, T5b, el arreglo de la FK de turnos y el del reintento
de serializacion).

---

# Progreso Fase 2 — Motor de recurrencia

Plan: `docs/superpowers/plans/2026-09-16-fase2-motor-recurrencia.md`
Spec: `docs/superpowers/specs/2026-09-16-fase2-motor-recurrencia.md`

- [x] T0 Spike: contexto de tenant dentro de un worker de BullMQ — **las tres
      preguntas en verde, sin cambios en produccion**. Verificado contra Redis y
      Postgres reales: (1) sin abrir contexto, Prisma FALLA en vez de devolver
      datos sin filtrar, asi que el fail-closed aguanta tambien fuera de una
      request; (2) `runWithTenant` dentro del `process()` del worker funciona;
      (3) el contexto sobrevive a varios `await` encadenados. El spike se borro.
- [x] T1 Schema, migracion, indices de idempotencia y clasificacion — 326
      unitarios + 56 e2e, sin regresion. Los dos indices verificados por mi en
      Postgres, con el WHERE parcial presente. Trampa nueva documentada en el
      plan: `prisma migrate dev` no funciona sin TTY cuando la migracion trae un
      aviso (una restriccion de unicidad, por ejemplo); la ruta buena es
      `migrate diff --from-config-datasource --to-schema` + `migrate deploy`.
- [x] T2 Traducir los errores de Prisma a HTTP (deuda de la Fase 1) — 332 tests.
      P2002 es 409, P2003 es 400, P2025 es 404, y se reconoce tambien la forma
      del DriverAdapterError sin `code`, que es la que en la Fase 1 dejo el
      reintento de serializacion sin dispararse durante toda una fase. El
      mensaje que llega al cliente es generico: el detalle va al log.
- [x] T3 Utilidades de calendario y contratos compartidos — 37 tests en shared
      (19 nuevos) + 332 en la API + 56 e2e. Elimino la duplicacion de la
      aritmetica de meses que arrastraba ventana-pack.ts desde la Fase 1; sus 9
      tests pasan sin tocarlos, que era el centinela del cambio.
      Ademas: `packages/shared` no tenia config de Prettier, asi que sus archivos
      se comprobaban con los valores por defecto. Subi el `.prettierrc` a la raiz
      del monorepo y alinee los 3 archivos de la Fase 1 que quedaban (sin tocar
      la Fase 0, que si esta commiteada).
- [x] T4 Modulo rutinas — 347 tests. El patron semanal de un alumno, cargado una
      vez. Valida acceso a la sala con la misma regla que una reserva manual.
      Destapo una contradiccion de mi plan (un test esperaba un `where` que la
      implementacion dictada nunca produce); se resolvio a favor de la semantica
      documentada: sin filtro explicito se listan solo las activas.
- [x] T5 Modulos vacaciones y ausencias — 371 tests + 56 e2e. Los dos puntos
      delicados cubiertos de verdad: un cierre de todo el salon aparece al
      filtrar por cualquier sala, y el filtro por fechas busca solape y no
      contencion (un cierre del 28/09 al 03/10 sale al preguntar por octubre).
- [x] T6 El planificador puro — 404 tests, 33 nuevos. Todo el algoritmo en una
      funcion sin base de datos ni cola. El agente comprobo ademas, por su
      cuenta, que los tests MUERDEN: muto el codigo (invirtio el desempate del
      orden, cambio un >= por >) y verifico que la suite lo caza. Encontro un
      campo muerto (`Franja.turnoPlanificado`) que elimine del codigo y del plan.
- [x] T7 Carga de datos y previsualizacion — 414 tests + 56 e2e. Destapo un bug
      real de mi plan: el `upsert` que dictaba es IMPOSIBLE (la extension de
      aislamiento rechaza siempre esa operacion), y como el spec mockea Prisma,
      el test habria pasado en verde y el 500 habria salido en la primera
      publicacion real. Reescrito con findFirst + create/updateMany en
      transaccion, y el test sustituido por dos mas estrictos.
- [x] T8 Publicacion: worker de BullMQ y escritura — 424 tests. El subagente
      murio por limite de sesion justo despues de escribir los tests y antes de
      implementar (el estado rojo del TDD, el mejor sitio donde te pueden
      interrumpir); lo termine yo inline. Anadio por su cuenta un test que el
      plan no tenia: que un error que NO sea duplicado SI aborte la publicacion,
      porque tragarse cualquier error convertiria la idempotencia en perdida
      silenciosa de datos.
      VERIFICADO CONTRA LA API REAL, no solo con mocks: previsualizar da 4/4 sin
      escribir nada, publicar devuelve 202 y el worker deja 4 turnos con una
      reserva cada uno, y publicar OTRA VEZ da 0/0. La idempotencia es real.
- [x] T9 e2e del checklist — 79 e2e (23 nuevos), Jest sale con codigo 0 sin
      --forceExit. Los tres clave en verde: publicar dos veces no cambia el
      numero de reservas, un job de un gimnasio no crea nada en el otro, y
      POST /publicar responde en menos de un segundo con 10 rutinas. Ningun bug
      de produccion; el plan no tuvo un tercer error interno.
- [x] T10 Verificacion final, README y cierre — hecha inline. Recorri a mano los
      puntos del checklist contra la API corriendo y destape un bug REAL de
      diseno mio: `encolarPublicacion` encolaba el job ANTES de escribir la fila
      de MesCalendario, que es el cerrojo del worker. Un worker rapido no la
      encontraba, su updateMany devolvia 0 y abortaba en silencio: la primera
      publicacion se perdia. Arreglado generando el jobId antes de encolar, con
      test de regresion que afirma el ORDEN de las dos operaciones.

## Decisiones cerradas con Cesar antes de empezar

1. `previsualizar` es sincrono; `publicar` va a un job de BullMQ.
2. El cupo del turno generado sale de `Sala.cupoBase`; el nombre, de la rutina.
3. `VacacionAlumno.devuelveClase` se almacena y queda inerte.
4. Vacaciones y cierres son **exclusiones**, no conflictos.

## Historico

Hubo una pausa por limite de uso de la sesion tras la T7. Leccion aprendida: lanzar un subagente es
la accion mas cara que hago (55k-125k tokens cada uno), asi que cerca del techo
hay que trabajar inline.

## Estado final de la Fase 2

**426 tests unitarios + 37 en shared + 79 e2e en verde.** `tsc --noEmit` limpio,
Prettier limpio sobre todo lo que escribe la fase, `prisma migrate status` sin
deriva, Jest sale con codigo 0. Nada commiteado: indice de git vacio y los dos
`.env` ignorados.

### Checklist del PDF, verificado a mano contra la API real

| #   | Punto                                    | Resultado                                            |
| --- | ---------------------------------------- | ---------------------------------------------------- |
| 1   | Cargar una rutina fija                   | OK 201; 403 si el alumno no tiene acceso a la sala   |
| 2   | `previsualizar` no escribe nada          | OK 4 turnos / 4 reservas, base intacta               |
| 3   | Los conflictos no interrumpen el proceso | OK cupo 1 y dos alumnos: 4 reservas + 4 CUPO_LLENO   |
| 4   | `publicar` real e idempotente            | OK 202, luego 4/4, y al repetir 0/0                  |
| 5   | Una ausencia excluye la fecha para todos | OK el 13 desaparece del plan, sin crear turno        |
| 6   | Una vacacion excluye solo a su alumno    | OK el turno del 20 sigue, con el otro alumno         |
| 7   | El job corre en background               | OK 202 en menos de 1 s con 10 rutinas                |
| 8   | Tests unitarios del algoritmo            | OK 33 tests del planificador, mutaciones verificadas |

### Lo que se encontro por el camino

Tres errores en mi propio plan, ninguno visible en un test verde:

1. **La Task 4 se contradecia**: un test esperaba un `where` que la implementacion
   dictada nunca produce.
2. **La Task 7 dictaba un `upsert` imposible**: la extension de aislamiento lo
   rechaza siempre. Como el spec mockea Prisma, habria pasado en verde y el 500
   habria salido en la primera publicacion real.
3. **La carrera del cerrojo** (ver T10), que se perdia la primera publicacion.

Y dos trampas de entorno:

- **Docker Desktop se cerro solo cuatro veces.** Un `500` repentino en todo suele
  ser eso; comprobar `docker info` antes de buscar el bug en el codigo.
- **Los e2e y la API de desarrollo comparten Redis.** Si `start:dev` esta vivo, su
  worker roba jobs a los tests y los resuelve contra la base equivocada. El sintoma
  —"Sala inexistente" en un job recien encolado— no apunta a la causa.

## Siguiente paso

Fase 2 completa. Nada commiteado: los mensajes de commit sugeridos de las 11 tareas
estan en el plan, uno por tarea.

# Progreso Fase 3A — Self-service del alumno (backend)

**Spec:** `docs/superpowers/specs/2026-09-17-fase3a-self-service-alumno.md`
**Plan:** `docs/superpowers/plans/2026-09-17-fase3a-self-service-alumno.md` (18 tareas, T0–T17)

La Fase 3 del PDF se **partió en dos**. Esta es la API completa; la PWA (`apps/web`, Next.js) va en
la Fase 3B, contra este contrato ya implementado y cubierto por e2e. El motivo no es cosmético: un
frontend escrito a la vez que su API termina corrigiendo el contrato desde la pantalla, que es la
forma más cara de descubrir que un endpoint estaba mal pensado.

- [x] T0 — Spike de riesgo (throttler, orden de guards, firma de S3)
- [x] T1 — Contratos compartidos e `instanteDelTurno`
- [x] T2 — Esquema y migración `20260917121204_fase3a_self_service`
- [x] T3 — Resolución en cascada de la configuración
- [x] T4 — `calcularDisponibilidad`, la tabla de decisión
- [x] T5 — `DisponibilidadService`
- [x] T6 — CRUD de claves de invitación
- [x] T7 — Auto-registro
- [x] T8 — Throttling de las rutas públicas
- [x] T9 — Filtro de altas pendientes
- [x] T10 — Calendario del alumno (lectura)
- [x] T11 — Hook inerte de notificaciones
- [x] T12 — Lista de espera y asignación automática
- [x] T13 — Reserva y cancelación propias
- [x] T14 — Puerto `AlmacenDeArchivos` con adaptadores local y S3
- [x] T15 — Comprobantes de pago
- [x] T16 — Tests end-to-end
- [x] T17 — Verificación final, README y tracker

## Decisiones cerradas con Cesar antes de empezar

1. El alumno solo **descubre** turnos de meses `HABILITADO`; sus reservas las ve siempre.
2. El cupo liberado se **asigna automáticamente** al primero de la cola (notificar no notifica a
   nadie hasta la Fase 5).
3. Almacenamiento como **puerto con dos adaptadores**; el local no es un mock.
4. Configuración heredable en **campos directos de `Tenant`**, cascada `Sala ?? Tenant ?? sistema`.
5. **La clave de invitación lleva las salas y el pack** — tapa un agujero del PDF.
6. La **rutina inicial no entra**; la carga el admin con el `POST /rutinas` de la Fase 2.
7. **`Sala.exclusiva` sigue inerte**: nunca se definió qué hace, en ningún documento.
8. **Throttling por IP** en las rutas públicas de auth.

## Estado final de la Fase 3A

**75 tests en `shared` + 591 unitarios + 127 e2e.** `tsc --noEmit` limpio, Prettier limpio sobre todo
lo que escribe la fase, `prisma migrate status` sin deriva. Los e2e corridos **tres veces seguidas**
con resultado idéntico: los de lista de espera y concurrencia tocan carreras reales, así que un
fallo intermitente ahí sería un bug, no un test frágil.

Nada commiteado: índice de git vacío, `.env` y `.env.test` ignorados, y el directorio del almacén
local también.

### Checklist de aceptación, verificado a mano contra la API real

| #   | Punto                                         | Resultado                                                     |
| --- | --------------------------------------------- | ------------------------------------------------------------- |
| 1   | Auto-registro con clave válida                | OK rol `ALUMNO`, con la sala de la clave                      |
| 2   | El alta aparece en la bandeja de pendientes   | OK `?autoRegistrado=true` la lista                            |
| 3   | El alumno ve su calendario y reserva          | OK `LIBRE` → reserva con `origen: ALUMNO`                     |
| 4   | Un turno lleno **ofrece** la lista de espera  | OK 409 con el mensaje; posición 1                             |
| 5   | Cancelar dispara la asignación del primero    | OK B entra solo, `origen: LISTA_ESPERA`                       |
| 6   | Comprobante: subir, ver, aprobar              | OK PUT 200, **descarga byte a byte igual**, `pagoAlDia: true` |
| 7   | Los turnos de un mes sin publicar no aparecen | OK `[]` antes de publicar                                     |
| 8   | Las rutas públicas tienen límite              | OK `401 401 401 429 429`                                      |

### Lo que se encontró por el camino

**Tres errores en mi propio plan**, ninguno visible en un test verde:

1. **El orden de `prisma generate`.** El plan corría los tests de la extensión de aislamiento antes
   de regenerar el cliente. El spec de la Fase 0 trae meta-tests que comparan la clasificación de
   modelos contra el **DMMF real de Prisma**, y ese DMMF todavía no conocía los cuatro modelos
   nuevos. Los tests de la Fase 0 hicieron exactamente su trabajo.
2. **Un doble de test que mentía.** El mock de `sala.findMany` devolvía siempre las dos salas
   ignorando el filtro `in`, así que cualquier alta de una sola sala fallaba. No era un bug del
   servicio: era el doble comportándose distinto de Prisma.
3. **El límite del throttler habría roto los 79 e2e existentes.** `crearGimnasio` hace un login por
   cada `beforeEach` y un solo archivo encadena más de treinta contra la misma IP: a partir del sexto
   test, todo 429. Resuelto haciendo los límites configurables **con los valores estrictos como
   defecto**, y probando el throttler en un archivo aparte que se baja el límite antes de importar la
   aplicación.

**Un error mío de ejecución:** edité `app.module.ts` con un script de Python en modo texto y convirtió
el archivo entero de LF a CRLF. Con `core.autocrlf=true`, `git diff` mostraba solo las líneas nuevas
y ocultaba el resto — pero Prettier lo veía. Lección: editar archivos del repo con las herramientas
de edición, no con scripts en modo texto.

**Un `.gitignore` que no cubría lo que creía cubrir.** El patrón `var/almacen/` lleva una barra
intermedia, así que git lo ancla a la raíz del repositorio; pero el cwd de los tests es `apps/api`, y
ahí es donde se crea el directorio. Diez PDFs de prueba quedaron sin ignorar. Corregido a
`**/var/almacen/`.

### Trampas de entorno

- **`docker compose up` sin argumentos levanta también el contenedor `api`**, que usa el **mismo
  Redis** que alcanzan los tests desde el host: su worker les roba los jobs. Es la trampa de la Fase
  2 en versión Docker. Levantar solo `postgres postgres-test redis`.
- **Que el puerto 3000 esté libre no significa que no haya una API viva.** Volvió a morder al final
  de la fase: tras el checklist manual maté el proceso que escuchaba en el 3000, `netstat` confirmó
  el puerto libre, y aun así 24 e2e fallaron con "Sala inexistente". Seguían en pie el
  `nest start --watch` y su hijo `dist/main`, y **el worker de BullMQ roba jobs sin escuchar en
  ningún puerto**. Hay que listar los procesos node del repo y matarlos por PID; el comando está en
  el README.
- **Docker Desktop se cerró solo otras dos veces** durante esta fase (seis en total desde la Fase 2).
  Un `P1001` o un 500 repentino en todo suele ser eso: comprobar `docker info` antes de buscar el bug
  en el código.
- El SDK de AWS avisa de que **sus versiones publicadas desde enero de 2027 exigirán Node ≥ 22**, y
  el monorepo está clavado en `">=20 <21"`. No bloquea nada hoy.

### Deuda declarada

- **13 archivos de las Fases 0–2 no pasan `prettier --check`.** Se verificó cada uno contra su
  versión commiteada: ya venían así. No se tocaron, para no mezclar un reformateo masivo con el
  código de esta fase. Sigue pendiente ese commit de solo formato.
- **`Sala.exclusiva`** sigue almacenado sin efecto, a la espera de que alguien defina qué significa.
- **El hook de notificaciones es inerte**: solo escribe en el log. La Fase 5 lo llena.
- **Los husos horarios** siguen sin existir: `horaInicio` se interpreta como UTC en todo el sistema.
  Documentado en `instanteDelTurno`, y si algún día se soportan hay que cambiarlo en todos los sitios
  a la vez.

## Siguiente paso

Fase 3A completa. **Fase 3B: la PWA** (`apps/web`, Next.js, manifest, service worker, offline de "mi
calendario", React Query y las cinco pantallas), contra el contrato que esta fase deja probado.

Nada commiteado: los mensajes de commit sugeridos de las 18 tareas están en el plan, uno por tarea.

# Progreso Fase 3B — La PWA del alumno

**Spec:** `docs/superpowers/specs/2026-09-18-fase3b-pwa-alumno.md`
**Plan:** `docs/superpowers/plans/2026-09-18-fase3b-pwa-alumno.md` (17 tareas, T0–T16)

La segunda mitad de la Fase 3 del PDF: `apps/web`, un Next.js 15 instalable, contra la API que dejó
la 3A.

- [x] T0 — Spike: ¿Serwist genera un service worker de verdad?
- [x] T1 — `GET /mi-pack` en la API
- [x] T2 — CORS para el almacén local
- [x] T3 — Montar `apps/web`
- [x] T4 — El proxy del BFF
- [x] T5 — Las rutas de sesión
- [x] T6 — El cliente de datos
- [x] T7 — El área de alumno
- [x] T8 — Login y registro
- [x] T9 — El calendario (lectura)
- [x] T10 — Reservar, cancelar y hacer cola
- [x] T11 — La pantalla del pack
- [x] T12 — Comprobantes
- [x] T13 — Perfil y cierre de sesión
- [x] T14 — Convertirla en PWA
- [x] T15 — Playwright
- [x] T16 — Verificación final, README y tracker

## Decisiones cerradas con Cesar antes de empezar

1. **Serwist en lugar de `next-pwa`**, que se publicó por última vez en agosto de 2022 — antes de que
   existiera el App Router que el propio PDF pide.
2. **Next 15**, no 16: es donde Serwist está rodado.
3. **Tokens en cookies `httpOnly`**, con Next de intermediario.
4. **El gimnasio va en la ruta**: `/[slug]/...`.
5. **Se añade `GET /mi-pack`** a la API — tapa el agujero del consumo.
6. **Offline: leer el calendario sí, escribir no.**
7. **Tailwind y componentes propios.**

## Estado final de la Fase 3B

**75 tests en `shared` + 606 unitarios de la API + 133 e2e de la API + 106 de Vitest + 5 de
Playwright.** `tsc --noEmit` limpio en los tres paquetes, Prettier limpio sobre todo lo que escribe
la fase, y Playwright corrido **tres veces seguidas** con resultado idéntico.

Nada commiteado.

### Lo que se encontró por el camino

**El spike de la T0 evitó dos trampas antes de construir nada encima:**

1. **`create-next-app@15` se cuelga esperando entrada.** Abre un prompt interactivo preguntando por
   Turbopack; en un entorno no interactivo espera para siempre. La bandera es `--no-turbopack`.
2. **El service worker no compila sin `/// <reference lib="webworker" />`.** Serwist empaqueta el
   bundle perfectamente, pero el chequeo de tipos del build falla con
   `Cannot find name 'ServiceWorkerGlobalScope'`: el tsconfig que genera Next no incluye `WebWorker`
   en su `lib`. Descubrirlo en un proyecto desechable costó cinco minutos; en la T14, con seis
   pantallas encima, habría costado bastante más.

**Tres errores de mi propio plan:**

1. **El e2e de `mi-pack` no podía funcionar.** `mi-pack` cuenta sobre el **mes en curso**, y los
   fixtures del backend usan turnos en **2099** porque la API rechaza generar meses pasados: la
   reserva caía fuera de la ventana. El código estaba bien; el equivocado era el test. Reescrito con
   un pack `TOTAL` sin vigencia, cuya ventana no tiene límites.
2. **El plan mapeaba el pack a mano con `toString()`**, cuando `aPackPublico` ya existía exportado y
   usa `toFixed(2)` — con un comentario explicando que convertir a `number` reintroduciría el error
   de coma flotante que el `Decimal` existe para evitar.
3. **`vitest.setup.ts` solo importaba `jest-dom`**, y eso no basta: la limpieza del DOM entre tests
   no es automática con Vitest salvo en modo `globals: true`. Sin ella los tests fallan con "Found
   multiple elements with the role ...", y el que falla es el segundo mientras el culpable es el
   primero.

**Y dos errores míos de ejecución**, ambos con mutaciones de prueba mal hechas que hubo que repetir:
una comentó de más y tumbó también los tests de casos válidos, con lo que no probaba nada.

### El checklist del §8, recorrido a mano en Chrome

Contra el **build de producción** (el service worker no existe en desarrollo), con un gimnasio recién
creado por la API y las herramientas de desarrollo abiertas.

| #   | Punto                                     | Resultado                                                                                    |
| --- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | Auto-registro con clave de invitación     | ✅ con un matiz: **el pack no se elige, viene en la clave**                                  |
| 2   | Ve el calendario y reserva o cancela      | ✅ reservó, canceló, y el cupo se movió en el momento                                        |
| 3   | Un turno lleno ofrece la lista de espera  | ✅ **con `listaEsperaHabilitada` encendida**; apagada dice "Completo (5/5)" y no ofrece nada |
| 4   | Sube un comprobante y lo ve "pendiente"   | ✅ el archivo llegó al almacén con sus 69 bytes reales                                       |
| 5   | `mi-pack` muestra el consumo real         | ✅ 1 de 8 tras reservar, 0 de 8 y "1 de 2 cancelaciones" tras cancelar                       |
| 6   | Instalable y offline para "mi calendario" | ✅ un service worker activo, manifest sin errores, iconos de 192 y 512 reales                |
| 7   | Cambiar el slug no muestra datos de otro  | ✅ redirige al login del slug nuevo                                                          |
| 8   | Vitest y Playwright                       | ✅ 106 + 5                                                                                   |

Y **`document.cookie` devuelve la cadena vacía** estando la sesión abierta: la decisión D3 se cumple,
el JavaScript de la página no ve el token. Tras cerrar sesión, `/api/bx/mi-pack` responde 401.

**Lo que solo se vio recorriéndolo a mano:**

- **El punto 1 del PDF dice "eligiendo pack" y el formulario no ofrece elegir.** No es un olvido: el
  pack va **en la clave de invitación** (`clave.packId`), y `AutoRegistroDto` no acepta un `packId`
  —corre con `forbidNonWhitelisted`, así que mandarlo sería un 400—. Es el gimnasio quien decide qué
  pack entrega con cada clave, no el alumno. Verificado de punta a punta: clave con pack → el alumno
  ve "8 clases al mes" en `mi-pack` sin haber elegido nada.
- **La lista de espera está apagada por defecto.** Con la sala tal como la crea la API, un turno lleno
  dice "Completo (5/5)" y **"Sin acciones"**, que es exactamente lo que debe decir. El punto 3 del
  checklist da por hecho que la cola está encendida; hay que encenderla para verlo.
- **La promoción de la cola funciona de verdad**: al cancelar la alumna con reserva, el que estaba
  primero en la lista entró solo y el turno volvió a 5/5 en la misma recarga. Es lógica de la Fase 3A,
  pero es la primera vez que se la ve completa desde la pantalla.
- **La subida del comprobante falla con CORS si `WEB_ORIGIN` no es el puerto exacto** desde el que se
  mira, y el alumno lee **"Sin conexion"** — es todo lo que el navegador le cuenta al JavaScript de
  una petición bloqueada. **Playwright no cubre este camino** (el test del ciclo no sube nada), así
  que el recorrido a mano era el único sitio donde podía aparecer. Documentado en el README.
- **Un comprobante creado pero no confirmado se distingue en pantalla**: sale como "Pendiente de
  revision · sin terminar de subir". No estaba planeado mirarlo y es justo lo que hay que ver.
- **La pantalla de perfil es fina**: muestra el gimnasio y el botón de salir, nada más. La API no
  expone un `mi-perfil`, así que el nombre y el email tendrían que venir de un endpoint que no
  existe.

### Trampas de entorno nuevas

- **Instalar paquetes en `apps/web` borra el cliente generado de Prisma.** pnpm reescribe
  `node_modules` y se lleva `.prisma/client`; la API deja de compilar con decenas de
  `Parameter 'tx' implicitly has an 'any' type`, que no mencionan Prisma por ningún lado.
- **Tres paquetes de test ya no soportan Node 20** y hubo que fijarlos: `vitest@3` (la 5 exige Node
  22.12), `jsdom@26` (la 30 arrastra `undici@8` y revienta al cargar) y `@vitejs/plugin-react@5`. El
  patrón: si un paquete de test falla con una traza incomprensible dentro de `node_modules`, mirar
  sus `engines` antes de depurar nada. Sumado al aviso del SDK de AWS de la Fase 3A, **el ecosistema
  está dejando atrás Node 20**.
- **Playwright necesita la API con el throttler aflojado**, o falla con 429 a mitad de suite: cada
  test crea su gimnasio con un login y un auto-registro.
- **Los fixtures de Playwright no pueden usar 2099**, a diferencia de los del backend: el calendario
  abre en la semana de hoy y un turno en 2099 sencillamente no se ve.
- **"El puerto está libre" volvió a no significar "no hay proceso vivo"**, ahora con Next: maté el que
  escuchaba en el 3001 y sobrevivió otro que bloqueaba archivos de `.next`.
- **Docker Desktop se cerró solo otra vez** (séptima desde la Fase 2).
- **Cortar la red desde las DevTools no cambia `navigator.onLine`.** El service worker sirve la
  copia cacheada igual, pero el cartel de "Sin conexion" no aparece: depende de la propiedad y del
  evento, no de que las peticiones fallen. `setOffline` de Playwright sí los cambia, así que el test
  automático lo ve y la comprobación a mano puede no verlo.

### Deuda declarada

- **La pantalla no ofrece salirse de la lista de espera.** `TurnoDisponible` expone `enListaEspera` y
  `posicionEnLista` pero **no el id de la entrada en la cola**, que es lo que pide el endpoint. El
  hook `salirme` está escrito y probado para cuando el contrato lo incluya.
- **Siguen los 13 archivos de las Fases 0–2 que no pasan `prettier --check`**, verificados contra su
  versión commiteada. Pendiente el commit de solo formato.
- **La pantalla de perfil muestra el gimnasio y poco más**: la API no expone un `mi-perfil`, así
  que el nombre y el email tendrían que venir de un endpoint que todavía no existe.
- **`Sala.exclusiva`** sigue almacenado sin efecto.
- **El hook de notificaciones sigue inerte**; lo llena la Fase 5.
- **Los husos horarios** siguen sin existir: `horaInicio` se interpreta como UTC en todo el sistema,
  ahora también en la aritmética de semanas del frontend.

## Siguiente paso

La Fase 3 está completa, API y PWA. Quedan las Fases 4 a 7: profesor vinculado al turno, pagos y
comunicación —donde se llena el hook de notificaciones y se decide qué hacer con
`VacacionAlumno.devuelveClase`, inerte desde la Fase 2—, analítica con web pública y check-in, y el
stretch.

Nada commiteado: los mensajes de commit sugeridos de las 16 tareas que dejan código están en el plan.

# Progreso Fase 4 — El profesor como entidad real

**Spec:** `docs/superpowers/specs/2026-09-21-fase4-profesor-real.md`
**Plan:** `docs/superpowers/plans/2026-09-21-fase4-profesor-real.md` (15 tareas, T0–T14)

La fase que resuelve el hallazgo central del relevamiento de TurnoFit: el vínculo profesora↔horario
era **una parte del nombre de la actividad** ("Circuito (Fati)"), y pasa a ser una FK de verdad.

- [x] T0 — El schema, la migración y la clasificación
- [x] T1 — Los contratos compartidos
- [x] T2 — `resolverProfesorDeFranja`, la función pura del etiquetado
- [x] T3 — El módulo de horarios de profesora
- [x] T4 — `PATCH /turnos/:id/profesor`, la suplencia
- [x] T5 — El calendario admin ve a la profesora
- [x] T6 — El alta manual de un turno resuelve profesora
- [x] T7 — El planificador etiqueta
- [x] T8 — Cargar los horarios y aplicar las etiquetas
- [x] T9 — `/mis-clases`, la vista de la profesora
- [x] T10 — Pasar lista
- [x] T11 — `calcularLiquidacion`, la función pura de las horas
- [x] T12 — El endpoint de liquidación
- [x] T13 — Los e2e del checklist
- [x] T14 — Verificación final, README y tracker

## Decisiones cerradas con Cesar antes de empezar

El PDF de esta fase traía **dos contradicciones y un eslabón que no existía**, y las tres había que
resolverlas antes de escribir código.

1. **El horario solo etiqueta; nunca crea turnos.** El PDF decía las dos cosas en párrafos seguidos.
   Si creara, toda hora contratada sería automáticamente una hora dictada y la métrica que el propio
   PDF pide mediría siempre cero.
2. **La asistencia es `Reserva.asistio`**, y pasar lista es una foto del turno entero. El PDF pedía
   el endpoint pero no modelaba el dato en ningún sitio.
3. **La liquidación devuelve horas y la tarifa resuelta, sin multiplicar.** El §6 deja el cálculo en
   pesos para la Fase 6; guardar `tarifaPorHora` sin exponerla repetiría el error de
   `Sala.exclusiva`. Hizo falta añadir `Tenant.tarifaPorHoraProfesor`, el eslabón que el PDF daba
   por supuesto.
4. **Al regenerar, el motor solo rellena huecos.** Tener profesora ya significa que alguien lo
   decidió; no hace falta una columna que lo marque.
5. **El alta rechaza los dos solapes**: dos profesoras en la misma sala, día y hora, y la misma
   profesora en dos salas a la vez.
6. **Un día cerrado no cuenta como hora contratada**: sale aparte, en `horasCerradas`.

Y una refinación que salió al escribir el plan: **la pertenencia es por contención, no por hora
exacta**. El PDF dice "sala+día+hora", pero comparar `horaInicio` por igualdad dejaría fuera el caso
corriente —contratada de 18:00 a 19:00 y una rutina que empieza a las 18:30—. Es además la misma
noción de solape que usa la regla 5, y las dos no pueden discrepar.

## Estado final de la Fase 4

**86 tests en `shared` + 675 unitarios de la API + 149 e2e de la API**, más los 106 de Vitest de la
PWA, que sigue verde sin tocar una línea: usa `TurnoDisponible` y `MiClase`, no `TurnoPublico`.
`tsc --noEmit` limpio en los tres paquetes y Prettier limpio sobre todo lo que escribe la fase.

Y los siete puntos del checklist, recorridos **a mano** contra la API levantada.

Nada commiteado.

### El checklist del PDF, verificado a mano

| #   | Punto                                               | Resultado                                        |
| --- | --------------------------------------------------- | ------------------------------------------------ |
| 1   | El turno generado trae `profesorId` automáticamente | ✅ y **el nombre de la actividad no se toca**    |
| 2   | Reasignar un turno puntual sin afectar el patrón    | ✅ sobrevive a republicar el mes                 |
| 3   | Un `PROFESOR` ve únicamente sus clases              | ✅ 3 de 4 tras darle una a otra                  |
| 4   | La lista no expone datos de otros                   | ✅ solo `perfilId`, `nombreCompleto` y `asistio` |
| 5   | Horas contratadas vs. dictadas                      | ✅ 240 min contratados, 180 dictados             |
| 6   | El filtro `?profesorId=`                            | ✅                                               |
| 7   | Tests                                               | ✅ 16 e2e nuevos, 5 mutaciones que muerden       |

Más dos que añadió esta fase: pasar lista es idempotente y no toca las canceladas, y el feriado
descuenta de contratadas.

**Y el caso del primer día de uso real**: la liquidación de una profesora **sin ningún horario**
devuelve ceros y una lista vacía, no un 500.

### Las cinco mutaciones, todas muerden

| Qué se mutó                                          | Test que rompió                              |
| ---------------------------------------------------- | -------------------------------------------- |
| `< 0` → `<= 0` en la contención horaria              | `el final de la franja NO le pertenece`      |
| Ignorar el rango de fechas del solape                | `deja pasar el relevo`                       |
| **Quitar `if (turno.profesorId !== null) continue`** | `un turno que YA TIENE profesora no se toca` |
| Ignorar el solape de horas                           | `deja pasar dos clases seguidas`             |
| Quitar `profesorId: null` del `where` del aplicador  | el test del `updateMany` condicionado        |
| `contratada && !cerrada` → `contratada`              | `un feriado no suma a contratadas`           |
| Quitar `profesorId` del `where` de `/mis-clases`     | `devuelve solo las clases propias` (y 2 más) |

La tercera es la que protege la suplencia: si pasara, se perdería en silencio cada vez que alguien
republicase el mes.

### Lo que se encontró al ejecutar el plan

**Un error mío de bulto, del tipo que la Fase 3A ya había enseñado:** mi doble de Prisma en la T3
**mezclaba "la sala existe" con "la profesora tiene acceso"**. El test del acceso pasaba, pero por el
motivo equivocado: fallaba con "Sala inexistente". Separado, el test prueba lo que dice probar.

**Tres tests de fases anteriores que fijaban formas exactas** y que esta fase rompió sin romper nada
real:

1. Un test de la Fase 1 comparaba el `include` **entero** de `GET /turnos`. Ahora comprueba solo el
   recuento, que es lo que su nombre dice que prueba.
2. Dos asserts de la Fase 2 fijaban la forma exacta de `turno.create` y del detalle de auditoría.
   Ampliados con `profesorId` y `etiquetadas`.

Es el mismo patrón las tres veces: **un test que fija la forma completa de una escritura falla cada
vez que alguien añade un campo**, sin tener nada que ver con lo que dice probar.

**Tres erratas del propio plan:**

1. El comando de los e2e **no llevaba `dotenv`**, así que corría con los límites estrictos de
   producción y la suite entera moría con **429 Too Many Requests**: cada test crea su gimnasio con
   seis llamadas de auth. El comando bueno es
   `pnpm exec dotenv -e ../../.env.test -- jest --config ./test/jest-e2e.json`, o directamente
   `pnpm test:e2e`, que ya lo lleva.
2. La mutación del rango de fechas rompe **2** tests, no 3: solo hay dos casos de borde.
3. El plan proponía dobles sueltos para los tests de turnos cuando el archivo ya tenía una fábrica
   `crearServicio()`. Se extendió la que había.

### Deuda declarada

- **No se puede expresar "esta franja tiene patrón pero quiero que quede sin profesora".** Límite
  aceptado de la decisión 4; resolverlo costaba una columna y una rama más en cada endpoint que
  escribe un turno.
- **La liquidación no multiplica**: importes, ajustes y el "50% base + horarios sin profesora" son de
  la Fase 6. La tarifa llega allí ya resuelta.
- **No hay pantalla de profesora.** La PWA de la 3B es solo del alumno y ninguna fase pide otra; las
  tres rutas de `/mis-clases` quedan listas para cuando se pida.
- **Siguen los 13 archivos de las Fases 0–2 que no pasan `prettier --check`**, y ahora también el
  README y este mismo tracker, que ya fallaban en su versión commiteada: Prettier quiere repaginar
  todas las tablas de markdown. Pendiente el commit de solo formato.
- **`Sala.exclusiva`** sigue almacenado sin efecto.
- **El hook de notificaciones sigue inerte**; lo llena la Fase 5. Avisar a una profesora de una
  suplencia es justo uno de sus casos.
- **Los husos horarios** siguen sin existir: `horaInicio` se interpreta como UTC en todo el sistema.

### Trampas de entorno

- **Docker Desktop se cerró solo otra vez** (octava desde la Fase 2). Ya es lo normal, no la
  excepción: comprobar `docker info` antes de nada.
- **El orden de la T0 no era negociable y se cumplió**: `prisma generate` **antes** de correr los
  meta-tests de la extensión de aislamiento, que comparan la clasificación contra el DMMF real. Al
  revés, el error apunta a la clasificación cuando el problema es el cliente sin regenerar.
- **`§` no cabe en un literal de bytes de Python.** Un script con `b"""..."""` que contenía el
  símbolo de sección reventó con `SyntaxError: bytes can only contain ASCII literal characters`
  antes de escribir nada. Para editar archivos con acentos desde Python hay que trabajar en `str` y
  escribir con `encoding='utf-8'`.

## Siguiente paso

Fase 4 completa. Quedan la 5 (pagos y comunicación, donde se llena el hook de notificaciones y se
decide qué hacer con `VacacionAlumno.devuelveClase`, inerte desde la Fase 2), la 6 (analítica, web
pública y check-in, que es donde la liquidación aprende a multiplicar) y la 7 (stretch).

Nada commiteado: los mensajes de commit sugeridos de las 15 tareas están en el plan, uno por tarea.

# Progreso Fase 5A — El ciclo de cobro

**Spec:** `docs/superpowers/specs/2026-09-21-fase5a-ciclo-de-cobro.md`
**Plan:** `docs/superpowers/plans/2026-09-21-fase5a-ciclo-de-cobro.md` (8 tareas, T0–T7)

La primera mitad de la Fase 5 del PDF. Se partió en dos por lo mismo que se partió la 3: el cobro es
pequeño y se entrega solo, y la comunicación —donde vive todo el riesgo— depende de él.

- [x] T0 — El schema, la migración y la clasificación
- [x] T1 — Los contratos compartidos
- [x] T2 — `estaAlDia`, la función pura
- [x] T3 — El módulo de pagos
- [x] T4 — Derivar el estado donde antes se leía la columna
- [x] T5 — Aprobar un comprobante crea el pago
- [x] T6 — Los e2e del ciclo completo
- [x] T7 — Verificación final, README y tracker

## Decisiones cerradas con Cesar antes de empezar

El PDF traía dos agujeros que había que tapar antes de escribir código.

**El importe no estaba en ninguna parte.** El PDF hace `Pago.monto` obligatorio y dice que aprobar un
comprobante crea el pago, pero un `Comprobante` es la foto de una transferencia: tiene archivo, tipo
MIME y estado, y ningún importe.

**Nadie bajaba `pagoAlDia`.** Aprobar lo ponía en `true` desde la Fase 3A y nada lo bajaba jamás. Tal
cual estaba, después del primer pago todo el mundo quedaba al día para siempre, y el job de
recordatorio de la 5B —que es el criterio de éxito del PDF— no le habría sonado a nadie.

1. **El pago cubre un periodo, y "al día" se deriva.** Mismo criterio que el consumo del pack desde
   la Fase 1 y la posición en la lista de espera desde la 3A: derivar en vez de guardar un dato que
   nadie mantiene.
2. **`Perfil.pagoAlDia` se borra; el override del admin es un pago de cortesía** de importe cero. Una
   sola tabla, una sola verdad, y la Fase 6 puede explicar por qué alguien está al día sin haber
   pagado.
3. **El importe y el periodo los pone el admin al aprobar.** Es quien está mirando la foto.

Y una decisión propia, marcada como tal en la spec: **una seña no pone al día**. Reserva un lugar, no
salda el periodo.

## Estado final de la Fase 5A

**86 tests en `shared` + 706 unitarios de la API + 163 e2e de la API**, más los 106 de Vitest de la
PWA, que sigue verde sin tocar una línea. `tsc --noEmit` limpio en los tres paquetes y Prettier limpio
sobre lo que escribe la fase.

Y el checklist recorrido **a mano** contra la API levantada, incluido el punto que ningún unitario
puede ver.

Nada commiteado.

### El checklist, verificado a mano

| #   | Punto                                                     | Resultado                          |
| --- | --------------------------------------------------------- | ---------------------------------- |
| —   | **El pago que vence HOY sigue al día todo el día**        | ✅ contra el reloj real            |
| 1   | Aprobar un comprobante crea el pago y actualiza el estado | ✅ con su `comprobanteId` enlazado |
| 2   | Pago manual sin comprobante                               | ✅ y `15000.50` no pierde centavos |
| 4   | Un pago vencido deja de poner al día solo                 | ✅                                 |
| 5   | Una seña no pone al día                                   | ✅                                 |
| 6   | Anular saca del cálculo sin borrar la fila                | ✅                                 |
| —   | El listado devuelve el estado de todos                    | ✅ 6 alumnos en 17 ms              |

### Las dos mutaciones muerden

| Qué se mutó                     | Test que rompió                           |
| ------------------------------- | ----------------------------------------- |
| `comienzoDeHoyUtc(hoy)` → `hoy` | `el ULTIMO dia del periodo cuenta ENTERO` |
| Quitar el filtro de `anuladoEn` | `un pago anulado no cuenta`               |

La primera es la que importa: sin normalizar la fecha, el estado se cae durante todo el último día
del periodo. Y es un error que ningún test que use medianoche como "hoy" llegaría a ver — por eso el
`HOY` de la tabla de casos son las 14:30.

### Lo que se encontró al ejecutar el plan

**`prisma migrate dev` no funciona sin interactividad cuando la migración es destructiva.** Borrar
`pagoAlDia` —91 valores en la base de desarrollo— hace que el CLI pida confirmación, y en un entorno
no interactivo aborta con un mensaje que habla de `migrate deploy` sin explicar por qué. La salida sin
usar `migrate reset` (que necesita permiso de Cesar) es generar el SQL a mano:

```bash
pnpm exec dotenv -e ../../.env -- npx prisma migrate diff \
  --from-config-datasource --to-schema prisma/schema.prisma --script \
  > prisma/migrations/<timestamp>_<nombre>/migration.sql
```

y después `migrate deploy` en las dos bases. **Ojo con las banderas**: `--from-url` y `--from-schema`
ya no existen en el CLI de Prisma 7; son `--from-config-datasource` y `--to-schema`.

**La migración NO convierte los `pagoAlDia = true` en cortesías, a propósito**, y lleva una cabecera
explicándolo: una cortesía lleva un periodo, y el periodo que cubría cada uno de esos `true` no lo
sabe nadie. Inventarlo sería fabricar datos que la Fase 6 leería como ciertos.

**Cuatro tests de fases anteriores que fijaban lo que ya no existe:**

1. `mi-pack.service.spec.ts` esperaba `pagoAlDia: true` porque venía del fixture del perfil. Ahora sale
   del servicio de pagos, y se añadió un test que lo demuestra: el doble dice `true` y el fixture ya ni
   siquiera tiene el campo.
2. `usuarios.service.spec.ts` comprobaba que el alta de profesor escribía `pagoAlDia: false`.
3. Los e2e de la 3A llamaban a `aprobar` con el cuerpo vacío. Uno de ellos —el del 409 sin archivo—
   habría pasado a dar **400** por el DTO y estaría pasando por el motivo equivocado.
4. Dos constructores de servicio en los specs, que ganaron un tercer argumento.

**Un error mío al sustituir código:** reemplacé `return aUsuarioDetalle(await this.buscarConRelaciones(id), true)`
por una versión de dos líneas con `const datos`, y en tres de los cinco sitios ya existía un `datos`
en ese ámbito. `tsc` lo cazó con `Cannot redeclare block-scoped variable`.

### Trampas de entorno

- **Docker Desktop se cayó otra vez** (novena desde la Fase 2).
- **`.env` apunta al 5434 y `.env.test` al 5433**, no al revés. Mi plan lo decía cambiado; no rompió
  nada porque los comandos usan los archivos de entorno, no los puertos, pero está mal escrito ahí.
- La trampa del `dotenv` en los e2e **no volvió a morder**: el plan la llevaba escrita desde la Fase 4
  y el comando se usó bien a la primera.

### Deuda declarada

- **Queda la Fase 5B entera**: SMTP cifrado con AES-256-GCM, plantillas con Handlebars, los cuatro
  processors de BullMQ y las notificaciones push del navegador.
- **La seña es una decisión propia**, no del PDF. Una línea en `estado-de-pago.ts` si el gimnasio la
  ve de otra manera.
- **`GET /pagos` filtra por cuándo entró el dinero**, no por el periodo que cubre. La Fase 6 añadirá
  la otra pregunta si la necesita.
- **La migración borra una columna con datos.** Con producción haría falta una conversión decidida por
  el gimnasio antes de desplegar.
- **Siguen los archivos de las Fases 0–2 que no pasan `prettier --check`**, más el README y este
  tracker: Prettier quiere repaginar todas las tablas de markdown. Pendiente el commit de solo formato.
- **`Sala.exclusiva`** sigue almacenado sin efecto, y **los husos horarios** siguen sin existir.

## Siguiente paso

La 5B: la comunicación. Es donde el hook de notificaciones deja de estar inerte desde la Fase 3A —
avisar a quien entra desde la lista de espera es su primer caso— y donde entran el cifrado de
credenciales, las plantillas y el push.

Nada commiteado: los mensajes de commit sugeridos de las 8 tareas están en el plan, uno por tarea.

---

# Progreso Fase 5B — La comunicacion

**Spec:** `docs/superpowers/specs/2026-09-22-fase5b-comunicacion.md`
**Plan:** `docs/superpowers/plans/2026-09-22-fase5b-comunicacion.md` (14 tareas, T0-T13)

La segunda mitad de la Fase 5. Aqui el hook de notificaciones deja de estar inerte desde la Fase 3A, y
entran el cifrado de credenciales, las plantillas, el email por gimnasio y el push web.

- [x] T0 — Dependencias, schema, entorno
- [x] T1 — El cifrado
- [x] T2 — Los contratos compartidos
- [x] T3 — Los dos puertos y sus cuatro adaptadores
- [x] T4 — Las plantillas y `resolverMensaje`
- [x] T5 — La configuracion de SMTP y de plantillas
- [x] T6 — Las suscripciones push
- [x] T7 — El mensajero, y el hook que deja de estar inerte
- [x] T8 — El processor de reserva
- [x] T9 — El processor de la lista de espera
- [x] T10 — Los dos jobs diarios y el registro de crones
- [x] T11 — El push en la PWA
- [x] T12 — Los e2e — **ejecutados y en verde el 26/09/2026**: 171 tests / 9 suites
- [x] T13 — Verificacion final, README y tracker — **checklist a mano completo el 28/09/2026**

## Decisiones cerradas con Cesar

1. **El recordatorio de vencimiento se repite cada dia de la ventana, y se deja asi.** Sin un campo de
   "ya avisado", un pack que vence en siete dias manda **ocho** correos: la ventana `[hoy, hoy+7]` es
   inclusiva por los dos lados, y el comentario original decia siete y estaba mal por uno. Cesar lo
   quiere arreglado, pero **en una fase posterior**: la solucion es una columna de estado y conviene
   pensarla junto al resto de "ultima vez que avisamos de X".
2. **`RECORDATORIO_PAGO` se queda vago**, sin importe ni periodo. Un importe en un email queda
   desactualizado con un pago parcial o una cortesia, y discutirlo por correo es peor que no ponerlo.
3. **Cinco plantillas, no seis.** La spec decia seis; se contaron.

Pendientes de respuesta al cerrar la sesion: **la hora y la zona del cron** —hoy `0 9 * * *` se
interpreta en UTC, o sea las 6 de la manana en Argentina— y si se quiere un **tope de envio** por
gimnasio.

## Los errores de este plan, que son la parte que sirve

Veinte, y **dos de ellos habrian pasado los tests en verde mientras el sistema hacia lo contrario de lo
que el test decia comprobar**. Se listan porque el patron se repite: lo que falla no es el codigo que
no compila, es la proteccion que parece estar puesta.

### Los que mentian en verde

- **`Handlebars.compile` es perezoso y no lanza nunca.** El plan pedia validar las plantillas con el.
  Escrito asi, `try { compile(x) } catch` **pasa siempre sin comprobar nada**: el agujero seguia
  abierto con un test certificando lo contrario. Hay que usar `precompile`.
- **`ListaEspera.notificado` no se puede escribir.** `asignarPrimero` borra la fila en la misma
  transaccion que crea la reserva, y el aviso se encola despues del commit: cuando el worker corre, la
  fila ya no existe. El plan pedia marcar ahi, y el compare-and-set que se llego a pedir habria
  suprimido el **100%** de los avisos de lista de espera, sin lanzar y sin log.

### Los de seguridad

- **La contrasena SMTP volvia al cliente en el 400.** nodemailer arma el `EAUTH` como
  `Invalid login: <respuesta literal del servidor>`, y un servidor verboso reimprime el base64 de la
  clave. Probado con servidores SMTP falsos, no de palabra. De ahi salio `motivoSeguro`.
- **Y `motivoSeguro` se rompio despues por cinco caminos**: fragmentacion por un salto de linea
  —alcanzable de verdad, porque nodemailer une las lineas de continuacion de una respuesta multilinea
  con un salto literal—, el `code` devuelto sin sanear, normalizacion NFC/NFD, base64url, y
  `motivoSeguro(null)` que explotaba.
- **La misma fuga por la puerta del log.** El `MensajeroService` logueaba `(error as Error).message` de
  un fallo de envio: el mismisimo texto, a un sitio que ademas se queda escrito.
- **El asunto del email iba escapado como HTML.**
- **`cc` en vez de `bcc`** para la copia interna: el alumno veia la direccion interna del gimnasio.
- **Dos alumnos sobre el mismo navegador.** `suscribir` buscaba por `(perfilId, endpoint)` y el unique
  lleva `perfilId`, asi que Ana y Beto compartiendo el navegador del gimnasio acababan con dos filas
  sobre el mismo endpoint. Y la de Ana no se limpiaba nunca sola, porque el endpoint sigue siendo
  valido: web-push responde 200 y el 404/410 que dispara la limpieza no llega jamas.
- **La cinta defensiva del destinatario protegia el canal equivocado**: el `perfilId` salia de la
  reserva contrastada, pero el `email` salia del perfil buscado por el payload. Con el `where`
  aflojado, eso no era "el aviso equivocado": eran **dos avisos a dos personas distintas por el mismo
  job**.

### Los de concurrencia y jobs

- **Encolar dentro de una transaccion `Serializable`.** Redis no participa del rollback de Postgres: un
  aborto 40001 despues de encolar deja el job vivo y el reintento encola otro. Y pasa justo cuando dos
  personas compiten por el ultimo lugar, que es cuando el aviso importa.
- **`attempts: 1` NO impide una segunda tanda.** El camino _stalled_ de BullMQ re-encola sin consultar
  `attempts`, y para un job repetible **ni siquiera tiene tope**. Un deploy a las 09:00 reenvia la
  tanda entera.
- **`add(..., { repeat })` duplica el cron al cambiar el patron.** La clave del repetible incluye el
  patron y la zona, asi que cambiar la hora —o anadir la zona— creaba un cron nuevo y dejaba el viejo
  disparando: dos tandas de correo masivo al dia, para siempre. Migrado a `upsertJobScheduler`, que
  esta cifrado solo por su id.
- **`upsert` esta bloqueado por la extension de aislamiento** (`UnsafeUniqueOperationError`). Hubo que
  sustituirlo por `findFirst` + `create`/`update` en transaccion, y el `data` del `update` no puede
  llevar `tenantId` o salta `ReasignacionDeTenantError`.

### Los que rompian en arranque, no en test

- **Faltaba registrar `PagosModule`** en `jobs.module.ts`: sin el, Nest no resuelve `PagosService` y la
  aplicacion no levanta.
- **Faltaban los `@OnWorkerEvent('error')`**: sin oyente, BullMQ emite sobre un EventEmitter vacio y
  Node lo convierte en `ERR_UNHANDLED_ERROR`.
- **`fechaLegible(perfil.vigenciaHasta)`** no compilaba: el tipo es `Date | null`.
- **`verificar(): Promise<void>`** en la interfaz rompia `tsc`, porque el test la llama con argumento.

### Los de destino y de cobertura

- **`urlPush` sin el slug del gimnasio.** Las pantallas viven en `/<slug>/calendario`; con la PWA
  cerrada —el caso normal al tocar una notificacion— se abria un **404**.
- **La regla del payload no la defendia ningun test.** Meter el `smtp` entero en el job dejaba la suite
  **en verde, con la credencial dentro**. Estaba escrita en un comentario largo y convincente.
- **Un test de VAPID vacio**: borraba claves de un entorno que nunca se definia, asi que habria pasado
  igual con el comportamiento contrario.
- **Faltaba `@@index([tenantId, vigenciaHasta])`** en `Perfil`, que es justo por donde consulta el job
  diario de vencimientos.

## Trampas nuevas, para no volver a pisarlas

- **Prisma numera las migraciones en UTC.** Una escrita a mano con la hora local queda ordenada
  **antes** de las ya aplicadas.
- **`Prisma.dmmf.datamodel.enums` esta VACIO en Prisma 7.** El test de paridad de enums va por
  `Object.keys($Enums.X)`.
- **`Handlebars.compile` no lanza; `precompile` si.**
- **El matcher `name` de Testing Library es PARCIAL**: `/activar notificaciones/i` casa tambien con
  `"Desactivar notificaciones"`. Hay que anclarlo, o las aserciones posteriores a un cambio de estado
  son vacias.
- **`if (false && ...)` no sirve para mutar**: TypeScript no estrecha tipos dentro de una expresion
  inalcanzable y la suite deja de compilar (`TS18047`). Hay que borrar el bloque entero, que ademas es
  la mutacion honesta.
- **En una cola diaria, `removeOnComplete: N` son DIAS, no avisos.** Copiar el 500 de las colas de
  eventos no poda nunca, y encima parece que si.
- **BullMQ interpreta el patron del cron en la zona del worker**, no en la del gimnasio.
- **`prisma migrate dev` NO regenera el cliente** en Prisma 7 con `prisma.config.ts`. Hace falta
  `prisma generate` aparte, o la suite no compila y el error no apunta a la migracion.
- **`prisma format` realinea modelos ajenos.** Tras tocar el schema deja tres o cuatro lineas de diff
  en modelos que no son los tuyos; hay que revertirlas para que el diff sea solo lo propio.
- **Un fixture con un `null` puede tapar una mutacion entera.** El test preexistente de CANCELACION no
  detectaba que el CAS usara la columna equivocada, porque en su escenario `avisoConfirmacionEn` estaba
  en `null` y el CAS devolvia `count: 1` igual. En produccion toda reserva confirmada ya tiene esa
  fecha, o sea que la mutacion habria significado **que ninguna cancelacion se avisa nunca, en
  silencio**. Cuando una mutacion "no rompe nada", mirar el fixture antes que el codigo.
- **Dos gates solapados esconden el fallo del otro.** Mover el marcado a despues de avisar sobrevivia
  al test obvio de idempotencia mientras existia ADEMAS el early-return sobre `job.data.avisoMarcado`.
  Al quedar el CAS como unica decision, la misma mutacion pasa a tirar diez tests.

## Deuda anotada

- **El recordatorio de vencimiento repetido** (decision 1, arriba).
- ~~Las marcas de idempotencia en Redis~~ — **HECHO el 28/09/2026.** Migracion
  `20260928200428_fase5b_marcas_de_aviso`: tres columnas `DateTime?` en `Reserva`
  (`avisoConfirmacionEn`, `avisoCancelacionEn`, `avisoCupoEn`), escritas como compare-and-set
  (`updateMany` con la condicion `null` en el `where`, y se manda solo si `count === 1`). Cierra los
  agujeros (a) dos jobs distintos, (b) el mismo job en dos workers a la vez y (c) la marca muere con el
  job. **Queda abierto (d) a proposito**: un job agotado se queda en `failed` con la marca puesta, asi
  que un retry manual desde un panel no manda nada — cerrarlo significaria borrar la marca al fallar, y
  entonces un fallo POSTERIOR al envio vuelve a mandar el email, que es justo lo que la marca existe
  para evitar. Lo que si mejora es el diagnostico: la fila dice la fecha exacta del intento.
  Son timestamps y no booleanos porque un `null`/`no null` responde "ya avisamos?" y la fecha responde
  ademas "cuando?", que es lo que alguien va a querer saber el dia que un alumno diga que no le llego
  nada. Los dos jobs diarios NO migran: su `gimnasiosHechos` es una marca por gimnasio dentro de una
  tanda y no cuelga de ninguna reserva.

  **Y dos cosas que la revision encontro y que valen mas que la migracion:**

  - **El CAS tiene DOS terminos que lo sostienen, no uno.** La cabecera protegia el `...En: null` y
    dejaba el `id: reserva.id` sin red: quitarlo dejaba un `updateMany` que, con el `tenantId` que
    inyecta la extension, **marca todas las reservas del gimnasio**. Compilaba, pasaba prettier y
    dejaba 942 tests en verde. En produccion: el primer aviso de confirmacion marcaba la tabla entera
    y **ningun aviso volvia a salir jamas, en silencio** — estrictamente peor que el agujero que esta
    migracion viene a cerrar. La causa era que todos los escenarios tenian UNA sola reserva por
    perfil, asi que nada fijaba la cardinalidad.
  - **La marca cuelga de una FILA; el job identificaba `(perfil, turno, accion)`.** Como no hay unique
    sobre `(tenantId, turnoId, perfilId)`, un alumno con dos reservas en el mismo turno rompia la
    correspondencia: el job de la cancelacion de A, reintentado tarde, encontraba B, marcaba B y
    mandaba; el job de B recibia `count: 0` y se callaba. **Dos cancelaciones legitimas, un solo
    email.** Era una regresion nueva —con la marca en Redis cada job tenia la suya— y se cerro
    metiendo `reservaId` en el payload: ahora el processor **verifica** la fila que el job nombra en
    vez de elegir una.

- **`DatosDePlantilla` es un `Record<string, string>` que no comprueba nada.** Una variable mal escrita
  compila y manda un email con el hueco vacio, y ninguna plantilla declara que variables necesita.
- **Una clave SMTP de menos de 8 caracteres, si viene troceada, se escapa de `motivoSeguro`.** Lo
  cerraria un `@MinLength` en el DTO; es decision de producto, porque rechazaria la contrasena de un
  servidor legitimo que use una corta.
- **La rotacion de la clave de cifrado** sigue sin implementarse; existe el formato (`v1:`).
- **Sin tope ni limite de ritmo** en el envio masivo: un gimnasio con 500 morosos manda 500 correos
  secuenciales en un solo job.
- **`VacacionAlumno.devuelveClase`** se reetiqueta a la Fase 6. **`Sala.exclusiva`** sigue almacenado
  sin efecto y **los husos horarios** siguen sin existir.
- **Siguen los archivos de las Fases 0-2 que no pasan `prettier --check`**, mas el README y este
  tracker. Pendiente el commit de solo formato.

## Estado al cerrar la sesion

**947 unitarios de la API / 53 suites**, **171 e2e / 9 suites**, **96 en `shared` / 4**, **149 en la PWA / 16**. `tsc --noEmit`
limpio en los tres paquetes, `pnpm build` de la web compila, y Prettier limpio sobre lo que escribe la
fase.

**Los e2e YA se corrieron** (26/09/2026, con Docker levantado): **171 tests / 9 suites en verde**, y
repetido cuatro veces para descartar intermitencias. La cabecera de "nunca ejecutado" se retiro del
archivo, que era lo que ella misma pedia.

Un solo caso fallo la primera vez y era el previsto: `reservar a mano manda un email` expiraba por el
timeout de 5 s de Jest, porque `esperarEmails` sondea hasta 6 s el solo. Arreglado con un timeout
explicito de 30 s **en el test y no en el helper**: alargar el helper habria escondido el problema en
todos los tests que lo usen. Con eso, el email llega en menos de un segundo.

⚠️ **Y una leccion de la sesion que no es del codigo:** durante un rato los e2e parecieron
intermitentes (unas corridas verdes, otras con un fallo). No era el codigo. Eran **tres procesos node
huerfanos** de una corrida anterior que se habia cortado: el envoltorio murio y los hijos no, y el
jest superviviente mantenia la app de Nest con sus workers suscritos a la cola del Redis compartido,
asi que se llevaba los emails que el test esperaba. Al matarlos por PID, cuatro corridas seguidas en
verde. Si los e2e de este repo se ponen intermitentes, mirar primero si hay un node vivo de antes
—`Get-CimInstance Win32_Process -Filter "Name='node.exe'"` y leer el `CommandLine`— antes de tocar
una linea.

Las fases 3B, 4, 5A y la 5B hasta la T9 quedaron commiteadas por Cesar en `ae54b60 fase 5`.

## Siguiente paso

Cerrar T13. De los tres puntos del checklist a mano, **el de los crones ya esta hecho** (26/09):
con `JOBS_RECURRENTES=1` aparecen en Redis `bull:recordatorio-pago-queue:repeat:recordatorio-pago-diario`
y su gemelo de vencimiento; con `0`, cero claves y el log lo dice.

Y ahi se comprobo algo que matiza la deuda de la zona horaria: la proxima ejecucion quedo en **12:00
UTC = 09:00 en Argentina**, o sea que **en esta maquina el cron dispara bien**, porque el worker corre
en horario local. El problema de "las 9 son las 6 de la manana" **solo aparece si el contenedor de
produccion corre en UTC**. Es un riesgo de despliegue, no un fallo actual — y la razon por la que
conviene fijar el `tz` explicitamente en vez de depender de donde corra el contenedor.

**Checklist a mano COMPLETO el 28/09/2026**, con la API levantada y `EMAIL_TIPO=smtp`:

- **Host inventado → 400 sin guardar nada.** `PUT /config/smtp` contra `smtp.no-existe-jamas-98765.test`
  devolvio `400 "No se pudo conectar al servidor SMTP: EDNS"`. Cero filas en `configuraciones_smtp`
  para ese gimnasio y `GET /config/smtp` respondiendo 404. El motivo es el `code`, corto y util, sin
  rastro de credencial.
- **La contrasena no vuelve en la respuesta.** El `PUT` que SI guarda devuelve `tieneClave: true` y
  ningun campo con la clave.
- **La contrasena no llega al log, ni al guardar ni al enviar.** Para el envio se monto un servidor
  SMTP falso y deliberadamente charlatan que acepta el saludo y el AUTH —asi que `verify()` pasa y la
  configuracion se guarda— y despues rechaza el `MAIL FROM` con un 550 multilinea **que ecoa el base64
  que acaba de recibir**. Con eso, el log de la API escribio unicamente
  `WARN [MensajeroService] Fallo el email a alumna@check.test: EENVELOPE`, y la busqueda en el log
  entero dio **cero** apariciones de la clave: en claro, en el base64 de AUTH PLAIN, en el base64 de la
  clave sola, y por fragmentos.

  Matiz honesto: ese camino ejercita el **paso 1** de `motivoSeguro` —devolver el `code` cuando tiene
  forma de codigo, que corta antes de mirar el mensaje—. El saneado del mensaje en si lo cubren los
  unitarios con sus cinco clases de ataque. Lo que la prueba manual demuestra es el resultado de punta
  a punta, que es lo que pedia el checklist.

  El servidor falso quedo en el scratchpad de la sesion, no en el repo. Si hay que repetirlo: tiene que
  capturar **AUTH PLAIN**, no solo AUTH LOGIN — en el primer intento solo interceptaba LOGIN,
  nodemailer eligio PLAIN, y el 550 ecoo una cadena vacia. El resultado "cero fugas" de esa primera
  vuelta no probaba nada, porque no habia nada que filtrar.

Queda **solo** la migracion de las tres columnas de idempotencia.

Despues, la Fase 6: analitica, web publica y check-in.

---

# Progreso Fase 6A — La analitica

**Spec:** `docs/superpowers/specs/2026-10-01-fase6a-analitica.md`
**Plan:** `docs/superpowers/plans/2026-10-01-fase6a-analitica.md` (11 tareas, T0-T10)

La Fase 6 del PDF trae tres subsistemas que no comparten modelo ni reglas —analitica, web publica y
check-in por QR— y solo comparten capitulo. Se partio como la 3 y la 5, y por el mismo motivo: **la
analitica es lo unico de la fase que toca dinero real de personas.** La 6B tendra el check-in y la web
publica, que es donde viven los cinco modelos que el PDF propone.

Esta fase **no agrega ni una tabla**. Todo lo que calcula se deriva de datos que ya existen.

- [x] T0 — Los contratos compartidos
- [x] T1 — `calcularImportes`, la funcion pura
- [x] T2 — Los importes entran en la liquidacion que ya existe
- [x] T3 — El cache, con su contador de version
- [x] T4 — `/stats/caja`
- [x] T5 — La invalidacion, en sus (ahora) dieciseis sitios
- [x] T6 — `/stats/operativo`
- [x] T7 — `/stats/turnos-libres` y `/stats/pagos-pendientes`
- [x] T8 — `/stats/composicion-alumnos` y `/stats/asistencia`
- [x] T9 — Los e2e
- [x] T10 — Verificacion final, README y tracker

## Decisiones cerradas con Cesar

1. **A la profesora se le paga por hora dictada, a tarifa fija.** Lo que el gimnasio cobra a los
   alumnos es otro asunto. Esto enderezo la fase entera: ver abajo.
2. **Solo se pagan las dictadas.** Las contratadas sin turno y las cerradas por feriado se calculan y
   se muestran con su importe, pero no entran en el total a pagar.
3. **"Gastos" = el costo de las profesoras.** Es el unico costo que el sistema conoce de verdad, y
   cuadra por construccion porque es el mismo calculo que el reporte individual.
4. **Los cumpleanios quedan fuera.** Necesitan un `fechaNacimiento` que no existe y capturarlo en tres
   formularios, o queda vacio para siempre — el error de `Sala.exclusiva` otra vez. Y no son analitica.
5. **La fase entrega la API, no el panel.** No existe **ninguna** pantalla de admin en el proyecto: la
   PWA de la 3B es solo del alumno. Un panel seria la primera, con su login, su layout y su navegacion.
   Los numeros se validan contra datos reales antes de dibujarlos.

## La decision que enderezo la fase

El PDF propone esta formula:

```
ingresos_totales_alumnos = SUM(Pago.monto) de perfiles cuyas reservas caen en turno
monto_para_estudio       = ingresos - monto_a_profesora + (50% base) + (horarios sin profesor)
```

La primera linea **no se puede calcular sin inventar una regla de reparto**: un alumno paga un pack
mensual y va a clases de varias profesoras, asi que atribuir ese pago a un turno cuenta el mismo peso
mas de una vez. La tercera suma un porcentaje a una resta de pesos.

Con tarifa fija las tres lineas problematicas **desaparecen**, porque eran piezas de un reparto por
porcentaje. Y conviene notar que **el checklist del PDF nunca pidio la atribucion**: pide que la
liquidacion calcule "horas contratadas vs. dictadas y el monto en $". La formula problematica vivia
solo en la prosa.

Esa decision tuvo consecuencias en cascada que se repitieron toda la fase: **los reportes que cuentan
clases se pueden partir por sala; los que cuentan dinero, no.** Por eso `/stats/caja` no acepta
`salaId` —un `Pago` no tiene sala—, `/stats/pagos-pendientes` tampoco, y la cobranza del operativo no
se acota aunque las otras cuatro metricas si.

## Los errores del plan: veintidos, y el patron que los une

Casi todos son de la misma familia: **una proteccion que parece estar puesta y no lo esta.** No es el
codigo que no compila; es el comentario que promete, el test que apunta al lado equivocado, o el
parametro que se acepta y se ignora.

### Los que mentian en verde

- **El valor del test era justo el que el float acierta.** `aCentavos` se probaba con `'1234.56'`, y
  `1234.56 * 100` da exactamente 123456 en doubles. Barriendo los dos millones de tarifas de dos
  decimales, **131.252 pierden un centavo** con la version float — el 6,6%, empezando por `0.29`,
  `0.57`, `1.13`, `1.15`. La regla numero uno de la fase —"nada de coma flotante"— **no estaba fijada
  por ningun test**.
- **`maxRetriesPerRequest: null`**, copiado de la configuracion de BullMQ. Es requisito de los comandos
  bloqueantes, pero en un cache significa que un comando contra un Redis caido **no falla nunca**, y
  `recordar` —escrito para seguir adelante— se habria quedado esperando en vez de calcular. La linea
  anulaba el diseno entero del cache, y pasaba en verde **y compilaba**.
- **`pendienteEstimado` era de hoy, no del mes.** Usaba `new Date()` por defecto dentro de un reporte
  indexado por `anio/mes` y cacheado como `caja:2026-10`: `caja(2020,3)` y `caja(2099,1)` devolvian el
  mismo numero. Y el docblock afirmaba "un mes futuro devuelve ceros", que era falso en uno de los cinco.
- **La cobranza del operativo, lo mismo pero peor**: con `new Date()` los **cuatro meses** del reporte
  daban el mismo valor, y la serie trimestral se leia como "la cobranza no se mueve". Un numero raro se
  nota; **una linea de tendencia aplanada, no**.
- **El denominador de la asistencia se contradecia consigo mismo.** El operativo metia en el
  denominador todas las reservas vivas de un turno con lista pasada —incluidas las que entraron
  despues, con `asistio: null`— mientras el reporte por alumno contaba solo las marcadas. Los mismos
  datos: **33,33% en un reporte y 50% en el otro**, y los dos docblocks afirmando usar "la MISMA
  definicion". Lo delataba que ese alumno salia con `porcentaje: null` en su propio reporte: **el codigo
  ya sabia que ese caso era "no se sabe"** y en el agregado lo contaba como ausencia.

### Los que rompian de verdad

- **`aTexto(-1)` devolvia `"0.-1"`**, una cadena que no es un importe. Y el `margen` se pone en rojo en
  un mes normal. Su propio docblock decia "quien traiga el primer importe en rojo tiene que arreglar
  esto ANTES" — ese momento era la Task 4.
- **Un `lte` contra la medianoche del ultimo dia** se comia en silencio todos los cobros del dia 31.
  Rango semiabierto `[mes, mes+1)`.
- **`@IsDateString()` aceptaba ISO completo**: `?desde=2026-10-01T12:00:00Z` pasaba la validacion y
  reventaba al formatear → **500 opaco en vez de 400**.
- **La composicion contaba profesoras como alumnas.** Una profesora tiene `Perfil` sin pack, asi que
  caia en "Sin pack" e inflaba el reporte que dice cuantos _alumnos_ hay por plan.
- **Un alumno dado de baja desaparecia de la composicion y seguia debiendo en los otros tres.** La
  misma persona era "no es alumno" para un reporte y "alumno que debe" para tres — y la cobranza
  **decaia para siempre** a medida que el gimnasio acumulaba ex-alumnos. Un indicador que baja solo.
  Resuelto unificando la poblacion: los tres reportes miden alumnos activos.
- **Faltaban nueve sitios de invalidacion.** La lista empezo en cinco y termino en dieciseis. El que
  mas dolia era `ComprobantesService.aprobar`: aprobar un comprobante _es_ registrar un cobro.
- **Un parametro que se acepta y se ignora.** `/stats/caja?salaId=` llego a implementarse validandolo,
  metiendolo en la clave del cache y **sin filtrar nada**. Es una mentira con codigo 200: alguien lo
  pasa, recibe un numero y cree que es de esa sala.

### Dos instrucciones mias directamente incorrectas

- Pedi una guarda `if (!Number.isInteger(centavos)) throw` y un test para `'1000.555'`. Pero `'1000.555'`
  da **100555**, que es un entero valido: mi guarda no lo cazaba y **el test que yo mismo pedi habria
  fallado**. Se resolvio con una guarda de forma.
- Pedi arreglar el fixture de `un mes sin movimiento` para cazar el bug de `pendienteEstimado`. **No lo
  habria cazado**: con un perfil sin pagos, "hoy" y "al cierre de 2099" dan los dos lo mismo. Lo caza el
  test de dos relojes.

## Trampas nuevas

- **`Math.round(x / 60)` pasa por un float.** La division entera va con cociente y resto, y
  `resto * 2 >= divisor` decidiendo. Y **se agrupa por tarifa antes de multiplicar**: tres franjas de
  cincuenta minutos dan 249999 centavos redondeando cada una y 250000 redondeando al final.
- **`.toNumber()` sobre un `Decimal(10,2)` NO pierde nada** —cabe exacto en un double—. Lo que abre es
  el _camino_: `0.29 * 100` da 28.999999999999996. La regla comprobable no es "nunca `.toNumber()`",
  es **"nada de float en la conversion a centavos"**.
- **El `Map` indexado por el string crudo de la tarifa.** `'1000.00'`, `'1000.0'` y `'1000'` son el
  mismo dinero y eran tres claves: tres franjas de cincuenta minutos daban 249999. Se indexa por
  centavos.
- **`new Redis()` en un `useFactory` no lo gestiona Nest**: sobrevive a `app.close()` y deja Jest
  colgado. Va en una clase con `onModuleDestroy`. (Es el bug de la Fase 0 con BullMQ, otra vez.)
- **La clave de version del cache no tenia TTL.** Lo encontro el checklist a mano inspeccionando Redis:
  **758 claves con `TTL -1`**. Ningun test lo ve, porque los tests no miran el Redis real.
- **Un test de invalidacion con dos instancias de cache no prueba nada**: el `INCR` cae en otro `Map` y
  el test pasa en verde con la linea borrada. Tiene que ser una sola instancia compartida.
- **El test de dos relojes, y su version invertida.** Para un reporte indexado por periodo, dos fechas
  de sistema distintas tienen que dar **el mismo** numero; para uno que pregunta por hoy, tienen que
  dar **distinto** — ahi un resultado identico significaria que la fecha quedo clavada.
- **Una mutacion que no se puede escribir es mejor que un test.** "Usar el cupo de la sala" era
  inexpresable: el codigo correcto **nunca consulta `Sala`**, y hubo que agregar la consulta dentro de
  la propia mutacion para poder intentarla.

## Cuando una mutacion no rompe nada

Paso ocho veces en esta fase, y el diagnostico fue siempre uno de dos. Conviene distinguirlos antes de
tocar el codigo:

- **El fixture no distinguia los dos comportamientos** (cinco veces): los dos packs de prueba tenian el
  mismo precio, el unico valor decimal era de los que el float acierta, la cortesia valia `0.00`. Se
  arregla el caso, no el codigo.
- **El caso directamente no existia** (tres veces): nadie habia escrito un test para `cache-redis.ts`,
  ni para el borde inferior del mes, ni para el post-commit de `cancelar`. Se escribe el test.

## Estado final

**1157 unitarios de la API / 57 suites**, **177 e2e / 10 suites**, **96 en `shared` / 4**, **149 en la
PWA / 16**. `tsc --noEmit` limpio en los tres paquetes, `pnpm build` de la web compila, y Prettier
limpio sobre todo lo que escribe la fase.

**Veintisiete mutaciones corridas, veintisiete muertas.** Y el checklist a mano recorrido contra el
Redis real, que es lo unico que muestra la forma de las claves y el contador de version incrementandose
(`v0`, `v1`, `v5` del mismo gimnasio).

## Deuda anotada

- **Los cumpleanios**: necesitan `Perfil.fechaNacimiento` y capturarla en tres formularios.
- **Un libro de gastos**: es contabilidad y es otra fase.
- **El panel visual**: necesita un frontend de admin, que no existe.
- **La composicion de un mes pasado usa los packs de HOY.** `Perfil.packId` es el actual y el sistema
  no guarda historial; inventarlo desde los pagos daria un reparto plausible y equivocado.
- **La ocupacion puede pasar de 100%** si bajan el cupo de un turno que ya tenia reservas. Es el numero
  honesto, pero la asimetria con `turnos-libres` —que si contempla el caso— no esta escrita.
- **El corte de "futuro" en turnos-libres es por DIA, no por hora**, porque el sistema no guarda husos.
  El error queda en la direccion inofensiva: sobra un turno de esta manana, nunca falta uno de esta
  tarde.
- **`VacacionAlumno.devuelveClase`** sigue inerte y lleva cuatro fases de mudanza. **Se reetiqueta a la
  6B o se borra**: una columna almacenada que no hace nada es el error de `Sala.exclusiva`.
- **`main.ts` no llama a `enableShutdownHooks()`**, asi que ante un SIGTERM en produccion no corre
  ningun `onModuleDestroy`. Es preexistente y afecta igual a Prisma, pero esta fase agrega el segundo
  recurso que depende de ello.
- **Siguen los archivos que no pasan `prettier --check`** (unos dieciocho en `apps/api/src/**`, mas el
  README y este tracker). Pendiente el commit de solo formato.

## Siguiente paso

La **6B**: check-in por QR y web publica del salon. Ahi entran los cinco modelos que el PDF propone y
las dos cosas que esta fase dejo abiertas sobre ellos: que `Asistencia` con `reservaId @unique` choca
con el `Reserva.asistio` que la Fase 4 ya tiene —serian dos verdades para el mismo hecho—, y que
`WebSalonConfig.slug @unique` compite con el `Tenant.slug` que ya usan todas las rutas de la PWA.

# Progreso Fase 6B — El check-in y la web publica

**Spec:** `docs/superpowers/specs/2026-10-02-fase6b-checkin-web.md`
**Plan:** `docs/superpowers/plans/2026-10-02-fase6b-checkin-web.md` (11 tareas, T0-T10)

La otra mitad de la Fase 6. Aqui viven **los cinco modelos que el PDF propone** y que la 6A no
necesito: `ConfigCheckInQR`, `Asistencia`, `WebSalonConfig`, `Testimonio` y `PreguntaFrecuente`.

Y aqui aparece **la primera superficie publica del sistema**: hasta ahora todo pedia sesion.

- [x] T0 — La zona horaria
- [x] T1 — El schema y la migracion
- [x] T2 — Los contratos, y la salida de `devuelveClase`
- [x] T3 — La firma del QR
- [x] T4 — El check-in
- [x] T5 — La configuracion de la web
- [x] T6 — El endpoint publico
- [x] T7 — La landing
- [x] T8 — La pantalla de check-in
- [x] T9 — Los e2e
- [x] T10 — Verificacion final, README y tracker

## Decisiones cerradas con Cesar

1. **Las clases perdidas no se devuelven.** Cerro de un plumazo una pregunta que yo habia armado como
   opcion multiple. `devuelveClase` se borro del schema y del DTO: una columna que nadie iba a usar.
2. **Una zona horaria para todo el despliegue**, en `ZONA_HORARIA`. No por gimnasio: la complejidad de
   la zona por fila no se paga hasta que haya un gimnasio en otro huso.
3. **`asistio` manda; `Asistencia` es la evidencia.** La columna sigue siendo la verdad para los
   contadores que ya existen; la fila nueva guarda el cuando, el como y el desde donde. Se escriben
   juntas en la misma transaccion.
4. **El QR es estatico, firmado, impreso y pegado en la pared.** Garantiza **comodidad, no presencia**:
   la ventana horaria acota _cuando_, no _donde_. El dia que la asistencia tenga que probar presencia
   hara falta un QR que rote en una pantalla, y eso es otro diseno.
5. **Comodidad por encima de control**: que marcar presente sea rapido es el objetivo declarado.
6. **Un solo secreto, el del `Tenant`**, para firmar el QR.

## El unico endpoint sin sesion, y lo que costo asegurarlo

`GET /public/salon/:slug` es el primero del sistema que lee datos de un gimnasio sin pedir sesion. Casi
todos los hallazgos serios de la fase salieron de ahi, y **ninguno fue un bug de codigo**: fueron
pruebas que parecian cubrirlo y no lo cubrian.

### La escalera de la auditoria

Tres escalones, cada uno descubierto cuando una mutacion atraveso el anterior:

1. **Lista negra** — sembrar un alumno con un email conocido y buscar ese email en la respuesta.
   La atraveso agregar el `id` del pack al contrato: un renglon plausible, porque el id ya se lee para
   decidir cual es el destacado. **Paso los siete tests que lo intentaban.** Una lista negra siempre va
   un campo por detras.
2. **Lista blanca de claves** — fijar las claves exactas del cuerpo y de cada objeto anidado.
   La atraveso una fuga **dentro de un valor legitimo**: meter los lugares libres en el nombre de la
   clase, `"Pilates (8 lugares libres)"`. Las claves quedan identicas y el test que buscaba las
   subcadenas `cupo` y `reservas` no lo vio.
3. **`toEqual` del objeto entero** — comparar contra un valor esperado explicito. Existia en **una
   sola** de las cuatro secciones, y por suerte mas que por diseno. Se llevo a las cuatro.

### Una ruta publica tiene que declarar que la protege en su lugar

Quitarle el `@Public()` al endpoint dejaba **1283 tests y 179 e2e en verde**. No habia un solo test en
toda la API que afirmara que una ruta es publica: `grep` de `IS_PUBLIC|@Public` en los specs daba cero.
La landing se caia entera en produccion sin que nada avisara.

El inventario que salio de ahi (`common/guards/rutas-publicas.spec.ts`) hace dos cosas que un test
puntual no hace:

- **atrapa el `@Public()` que SOBRA**, no solo el que falta — que es el error peligroso;
- declara **que protege a cada ruta publica en lugar del JWT**: `BootstrapKeyGuard` en las dos de
  bootstrap, el freno estricto en las tres de auth, la firma HMAC en las de archivos.

Esto ultimo cerro un agujero que nadie habia mirado: si alguien le quitaba el `BootstrapKeyGuard` a
`POST /auth/tenants`, **la creacion de inquilinos quedaba abierta a internet** y el inventario, que solo
miraba `IS_PUBLIC`, no se enteraba.

## La mutacion abierta: cinco de cinco

En cada tarea pedi, ademas de las mutaciones enumeradas, **una que al implementador le pareciera que el
codigo no sobreviviria y que nadie hubiera probado**. Cinco tareas, cinco hallazgos reales, y **las
cinco de la misma familia**:

| Donde                 | Que se agrego                                         |
| --------------------- | ----------------------------------------------------- |
| Endpoint publico      | el `id` del pack en el contrato                       |
| `turnosLibres`        | los lugares libres dentro del nombre de la clase      |
| Pantalla de check-in  | el consejo de `ya-marcada` sumado a `lista-ya-pasada` |
| Portada de la landing | un contador de "N lugares libres esta semana"         |

**Agregar algo que no deberia estar, sin quitar nada de lo que si.** Ningun test de presencia ve eso;
solo lo ven las comparaciones de totales. El de la pantalla de check-in era ademas el de peor dano: le
decia "no hace falta que hagas nada mas" a quien **no** habia quedado marcado.

## Los errores de este plan

Veintinueve anotados. Casi ninguno es codigo que no compila: son **protecciones que parecian estar
puestas y no lo estaban**, que es el mismo patron que la 6A.

### Los que escribi mal

1. **`hour12: false`** en `desfaseDeZona`, que selecciona h24 y hacia que la medianoche cayera un dia
   antes. Mis cinco tests no tocaban la medianoche.
2. **El mismo bug de huso, dos veces en la misma fase.** Escribi la ventana en la zona del gimnasio y
   despues pedi cargar "las reservas del dia", que es UTC.
3. **`prisma.base`** en el endpoint publico. `base` es el cliente **sin** la extension: salirse del
   aislamiento por ahi es justo lo que prohibe el comentario de al lado. Va `db` dentro de
   `runUnscoped`, que es lo que hace `auth.service.ts`, el precedente que yo citaba mal.
4. **`PackPublico`** ya existia desde la Fase 1 y rompio la compilacion de shared. Quedo `PackEnLanding`.
5. **"Llevar al login y volver" no era implementable.** Un layout de Next 15 no recibe `searchParams`,
   el layout de alumno redirige sin conservar el destino y el login termina siempre en el calendario.
6. **Faltaba `GET /config/web-salon`** en la spec: sin el, el admin no puede conocer los ids que el
   `DELETE` necesita, porque solo salen en la respuesta del POST.
7. **Di por imposible probar el filtro de canceladas con dobles** y lo mande entero a los e2e. Se podia:
   ver el punto 3 de "cuando una mutacion no rompe nada".
8. **Mande recortar los textos** dando por hecho que no se hacia. Ya se hacia en los campos; lo que
   faltaba era en las **filas**.
9. **Dije que el `where` del `_count` existia.** No existia.

### Los que se me pasaron

10. **La lista de ataques de la ruta de retorno estaba incompleta**: faltaban los segmentos `..`, que
    pasan la comprobacion de prefijo y se normalizan fuera del gimnasio, y los caracteres de control,
    que el navegador borra antes de resolver la URL.
11. **El plan daba por hecho que `lib/cliente.ts` servia.** Descartaba el cuerpo del error, o sea el
    `motivo` del 409: los cuatro mensajes del check-in no se podian ni escribir.
12. **No pedi nunca que se fijara una clase de CSS.** El recorte quedaba correcto, el salto de linea
    seguia en el string, y el parrafo salia de corrido igual por falta de `whitespace-pre-line`.
13. **Las cuatro banderas de privacidad no tenian ningun caso** que las atara a su columna: el test que
    yo habia pedido auditaba la **lectura**, no la escritura.
14. **Un test de borrado con un solo registro sembrado**, que no prueba el `where`.
15. **Ningun test afirmaba que una ruta fuera publica.** Ni uno en toda la API.

### Lo que salio mejor de lo que pedi

- El **inventario bidireccional** de rutas publicas, en vez del test puntual que yo habia pedido: atrapa
  el `@Public()` que sobra, que es el peligroso, y declara **que protege a cada ruta en lugar del JWT**.
- El doble que **calcula el `_count` interpretando su `where`**, con el argumento correcto: lo que
  vuelve fragil a un doble es la excepcion, no la regla.
- La regla de que **"en blanco" es un dato que no vino**, que yo no habia pedido.
- Mapear tambien `listarTestimonios`, `listarPreguntas` y los dos `crear*`, porque sin eso la auditoria
  de claves del lado admin no se podia escribir.

## Trampas nuevas

**`hour12: false` no es el ciclo de 23 horas.** En Node 20 selecciona **h24**: la medianoche se formatea
`"24:00"`, `Date.parse` lo acepta, y significa el dia siguiente. `instanteEnZona` con `00:00` devolvia
el dia anterior. Va `hourCycle: 'h23'`.

**La zona se escapa por la consulta.** Escribir la ventana en la zona del gimnasio no alcanza si despues
se cargan "las reservas del dia": _el dia_ es UTC. Hay que cargar **tres dias UTC** y dejar que la
eleccion decida.

**Un layout de Next 15 no recibe `searchParams`.** Por eso la pantalla de check-in vive **fuera** del
grupo `(alumno)`: el redirect del layout se comia el `?f=` del QR y el alumno aterrizaba en el
calendario sin firma, a reescanear parado frente a la pared.

**"Volver a donde iba" es la forma exacta de un open redirect.** `rutaDeRetornoSegura` acepta por lista
blanca: solo `/<slug>/` con la barra final (sin ella, el slug `gim` abre `/gimnasio-rival/x`). Rechaza
`//evil.com`, `https://`, `javascript:`, la barra invertida, los caracteres de control —que el navegador
borra antes de resolver— y los segmentos `..`, que pasan el prefijo y se normalizan fuera del gimnasio.

**`whitespace-pre-line` no colapsa los espacios.** Un `sobreElSalon` pegado desde un Word sale con
lineas en blanco visibles arriba y abajo. Hay que recortar los extremos y respetar los saltos del medio.

## Cuando una mutacion no rompe nada

Se repitieron los dos diagnosticos de la 6A, y aparecio un tercero:

1. **El fixture no distinguia los dos comportamientos.** `RUIDO.tituloPrincipal` era `Studio Fuego`,
   igual que `TENANT.nombre`: un mapeo que cruzara los dos campos pasaba **hasta un `toEqual` del cuerpo
   entero**.
2. **El caso directamente no estaba probado.** Los dos topes de `turnosLibres`, el `@Public()`, las
   cuatro banderas de privacidad del lado admin.
3. **El doble no podia ver la diferencia.** El `_count` se sembraba cocinado, asi que el
   `where: { canceladaEn: null }` era invisible _por construccion_. Se arreglo haciendo que **el doble
   calcule el `_count` interpretando su `where`** — no es una excepcion fabricada para salvar un test:
   el doble ya interpreta `where` con `gte`/`lt`, relaciones anidadas, `orderBy` y `take`. **Lo que
   vuelve fragil a un doble es la excepcion, no la regla.**

Y un cuarto caso, que no es una mutacion que sobrevive sino algo peor: **un test que pasaba por el
motivo equivocado.** El de colores de la landing nunca ejercia las anclas de la expresion, porque
ninguno de sus payloads invalidos llevaba `#`. Pasaba, pero no por lo que decia probar.

## Dos agujeros de borrado que un solo registro sembrado esconde

`deleteMany({ where: { id } })` → `{ where: {} }` pasaba los 41 tests del lado admin. El test del id
ajeno miraba la fila del **otro inquilino**, y el del id propio sembraba **un solo** testimonio: "borro
el suyo" y "borro todos los suyos" daban el mismo resultado. Identico en `borrarPregunta`.

**Un test de borrado con un solo registro sembrado no prueba el `where`.**

## Los e2e encontraron tres bugs reales, y dos dejaban la fase sin funcionar

Esta es la leccion mas cara de la fase: **todo lo anterior estaba en verde.** 1290 unitarios, un repaso
independiente con trece mutaciones, y aun asi dos funciones centrales no habian funcionado nunca.

### 1. El endpoint publico devolvia 500 SIEMPRE

```ts
runUnscoped(() => this.prisma.db.tenant.findUnique({ ... }))   // mal
runUnscoped(async () => await this.prisma.db.tenant.findUnique({ ... }))   // bien
```

Una `PrismaPromise` es **perezosa**. La lambda la devuelve sin esperarla, `runUnscoped` cierra el
`AsyncLocalStorage`, y la consulta arranca **ya fuera** → `MissingTenantContextError` → 500 en cada
llamada. `auth.service.ts` usa el `await` explicito en sus tres `runUnscoped` desde la Fase 0.

Lo que vuelve esto importante: **el repaso independiente verifico ese mismo `runUnscoped`** y lo dio
por correcto. Comprobo que envolvia una sola consulta y que usaba `db` y no `base`, que era lo que yo
le habia mandado mirar, y las dos cosas eran ciertas. **La pereza de la promesa no la mira nadie, y un
doble no es perezoso.**

### 2. El cartel del QR no se podia generar NUNCA

`tenant.findUnique` dentro de un contexto de inquilino lo rechaza la extension
(`UnsafeUniqueOperationError`). Va `findFirst`, como en `liquidacion.datos.ts`. El doble del unitario
**solo tenia `findUnique`**, asi que el test no podia ver el problema: se le quito el metodo prohibido.

### 3. El `where` del `_count` no estaba

El comentario que prometia que las canceladas no ocupan lugar estaba; el `where` no. Un turno de cupo
10 con 8 reservas vivas y 2 canceladas desaparecia de la landing por lleno.

**Los tres son del mismo genero**: un doble escrito a mano no puede contradecir a quien lo escribio.
Sabe lo que el autor creia que pasaba, no lo que pasa.

## La mutacion abierta: seis de seis

La de los e2e fue la mejor de todas porque busco **el unico artefacto que un e2e no puede leer**: lo
que va codificado DENTRO del PNG del cartel.

```ts
const url = `${urlDeCheckIn(origen, tenant.slug, firma)}&gym=${actor.tenantId}`;
```

**Sobrevivio a los 1290 unitarios y a los 204 e2e.** El hueco era exacto: `urlDeCheckIn` esta probada
como funcion pura, y los cuatro casos de `imagenQr` solo comprueban "es un PNG", el 503 y el 404.
**Nadie afirmaba que URL se codifica.**

El `tenantId` habria acabado impreso en un cartel colgado en una pared publica, en el historial del
navegador de cada alumno y en el log de accesos del front. Se cerro espiando `qrcode.toBuffer` y
fijando la URL exacta.

| Donde                 | Que se agrego                                         |
| --------------------- | ----------------------------------------------------- |
| Endpoint publico      | el `id` del pack en el contrato                       |
| `turnosLibres`        | los lugares libres dentro del nombre de la clase      |
| Pantalla de check-in  | el consejo de `ya-marcada` sumado a `lista-ya-pasada` |
| Portada de la landing | un contador de "N lugares libres esta semana"         |
| Cartel del QR         | el `tenantId` en la URL codificada en el PNG          |

## Un comentario que promete lo que el codigo no hace

`eleccion-de-reserva.ts` dice que un alumno con dos clases seguidas que ya marco la primera marcaria la
segunda. El codigo elige **la mas cercana** y despues mira los bloqueos: si la ya marcada sigue siendo
la mas cercana, devuelve `ya-marcada`. En la practica no molesta —cuando el alumno escanea para la
segunda, la segunda ya es la mas cercana— pero el test quedo escrito contra el comportamiento real, no
contra el comentario.

## Estado final

|                      |                                                                |
| -------------------- | -------------------------------------------------------------- |
| `packages/shared`    | **103 tests / 4 suites**, tsc limpio                           |
| `apps/api` unitarios | **1291 / 65 suites**, tsc limpio                               |
| `apps/web`           | **351 / 23 suites**, tsc limpio, `build` OK (`f /[slug]`, SSR) |
| E2E                  | **204 / 12 suites** (115 s)                                    |

De 1234/62 y 179/10 al empezar la fase.

## Lo que falta a mano

Lo que ningun test automatico ve:

- [ ] Escanear el QR con un telefono de verdad y que abra la pantalla correcta.
- [ ] La landing en una ventana de incognito, y que el "ver codigo fuente" **no contenga** los precios
      con la bandera apagada.
- [ ] Que el cron de los jobs diarios, ahora con `tz`, dispare cuando corresponde.

## Deuda anotada

- **`redis-miba` ocupa el puerto 6379**, asi que `box-admin-redis-1` no levanta y los e2e corrieron
  contra esa instancia compartida. Pasaron 204/204 en tres corridas sin intermitencias, pero los jobs
  de BoxAdmin estan compartiendo Redis con otro proyecto.
- **El commit `06fb463` capturo una mutacion viva** de un subagente: `devuelveClase` volvio al DTO en
  HEAD. El arbol de trabajo es correcto; falta commitear
  `apps/api/src/vacaciones/dto/crear-vacacion.dto.ts`.
- **Un commit de solo formato** pendiente: una veintena de archivos de `apps/api/src/**` que nunca
  pasaron `prettier --check`, mas el README y este archivo.
- `conTextosRecortados` de la landing trabaja sobre un nivel; una lista anidada dentro de una fila no la
  alcanza. Documentado en el archivo.
- Dos llamadas a `traerSalon` por visita (`generateMetadata` + pagina), que Next memoiza dentro de la
  misma peticion.

## Siguiente paso

La Fase 6 esta completa, 6A y 6B. Lo que queda del PDF es **el panel del admin**, que es la deuda que
las dos mitades comparten: la 6A entrego siete reportes sin pantalla y la 6B la configuracion del QR y
de la web sin pantalla. Es una fase entera —login de admin, layout, navegacion— y es el orden correcto:
un grafico bonito sobre un numero equivocado es peor que ningun grafico.

# Progreso Fase 7 — El panel del admin: armazón y Personas

**Spec:** `docs/superpowers/specs/2026-10-06-fase7-panel-personas.md`
**Plan:** `docs/superpowers/plans/2026-10-06-fase7-panel-personas.md` (13 tareas)

La primera pantalla de administración del proyecto. Hasta aquí `apps/web` era la PWA del alumno más la
landing: todo lo de admin se hacía con `curl`.

- [x] T1 — El destino por rol
- [x] T2 — El service worker no cachea el panel
- [x] T3 — La puerta del panel
- [x] T4 — El armazón y la navegación por rol
- [x] T5 — La puerta vieja del alumno exige rol
- [x] T5b — El middleware que estampa la ruta _(no estaba en el plan)_
- [x] T6 — Los hooks de Personas
- [x] T7 — El listado
- [x] T8-T10 — La ficha _(ejecutadas juntas: tocan los mismos archivos)_
- [x] T11 — El alta y la contraseña temporal
- [x] T12 — Invitaciones
- [x] T13 — Verificación, README y tracker

## Decisiones cerradas con Cesar

1. **Se empieza por el armazón más Personas.** El panel completo son 69 endpoints en 20 módulos y cinco
   áreas; las otras cuatro heredan el armazón sin volver a discutirlo. Personas se eligió porque es la
   que vuelve usable el sistema y porque **ejercita la frontera entre los dos roles de admin**: quince
   de sus dieciséis endpoints piden `ADMIN_OPERATIVO` y uno, `reset-password`, pide `ADMIN_SALON`.
2. **El panel vive en `apps/web`**, no en una app aparte: duplicar el BFF, la sesión, el cortafuegos y
   el cliente HTTP son cuatro piezas de seguridad con dos implementaciones que hay que mantener iguales.
3. **Un solo login**, con el destino decidido por el rol.
4. **La puerta vieja del área de alumno se cierra en esta fase.**
5. **Escritorio primero**, al revés que la PWA del alumno: son dos usos distintos.
6. **La contraseña temporal tiene pantalla propia con confirmación explícita.**
7. **El `volverA` se vuelve verdad con un middleware**, en vez de sacarlo. Ver abajo.

## El error más grave de la fase, y es mío

**Los grupos entre paréntesis no agregan segmento a la URL.** Lo escribí en la spec —«los grupos entre
paréntesis no afectan la URL, el panel queda en `/{slug}/admin/...`»— y la primera mitad es cierta,
razón por la cual la segunda **no se sigue**. `(admin)/usuarios/page.tsx` resolvía a
`/{slug}/usuarios`.

Lo que el build imprimía de verdad: ninguna ruta `/[slug]/admin`, el panel colgando del raíz del slug, y
`(admin)/page.tsx` colisionando con la landing pública en `/[slug]`.

Consecuencias en cascada: todos los enlaces del panel apuntaban a un 404, `destinoPorRol` mandaba al
admin a un 404, y **la regla del service worker protegía una ruta que no existía** — o sea que las
pantallas con nombres y emails se estuvieron cacheando igual.

Arreglo: renombrar el directorio a `admin/`. **No rompió un solo test**, y ese es el dato que importa:
los 672 tests convivieron con el error porque todos afirmaban sobre las rutas que yo _pretendía_
construir, no sobre las que el framework generaba. El código y los tests compartían la misma suposición
equivocada, así que no había forma de que se contradijeran. Sólo el build podía decirlo, y había que
mirarlo.

Lo encontró un agente que estaba investigando otra cosa y lo reportó «sin buscarlo».

## El `volverA` era decorativo

La puerta del panel cableaba `volverA=/${slug}/admin`, y el destino por rol de un admin **es
exactamente esa misma URL**: el parámetro no cambiaba el aterrizaje de nadie.

Es la forma exacta del `/stats/caja?salaId=` de la 6A, que validaba una sala y devolvía los números de
todas. **Un parámetro que se valida y después se ignora.** Las dos pasaron desapercibidas porque el
código hace algo visible con el parámetro —lo valida, lo pone en la URL— y sólo mirando el resultado
final se ve que da igual.

La causa era estructural: **un layout de Next no recibe `searchParams` ni el pathname**. El repo ya lo
tenía documentado, porque la pantalla de check-in vive fuera del grupo `(alumno)` por esta misma razón.

Se resolvió con un middleware que estampa la ruta en una cabecera. Y esa cabecera **no se confía**: un
cliente puede mandarla, así que pasa por `rutaDeRetornoSegura` igual que el query, con tests que
ejercitan el filtro real y no un doble.

## Un bypass en código ya desplegado

`rutaDeRetornoSegura` aceptaba `/mi-gym/%2e%2e/otro-gimnasio/x`. El parser del navegador decodifica
`%2e` a `.` y aplica _remove_dot_segments_, así que resuelve a `/otro-gimnasio/x`: **es el bypass que la
quinta comprobación existe para impedir, escrito en porcentaje.** No sale del dominio, así que no es un
open redirect — es un **cruce de inquilinos**, la clase de bug más grave de este sistema, vivo desde la
Fase 6B en la pantalla de check-in.

Medido contra `new URL`, no deducido. De paso aparecieron tres formas que no estaban en mi lista:
`.%2e`, `%2e.` y `/mi-gym/%2e%2e` al final, que resuelve a **la raíz del dominio**.

El arreglo decodifica el camino dentro de esa comprobación, en `try/catch` que rechaza ante un `%`
suelto. 16 → 33 tests, con **cero deleciones** en el diff de los originales, y tres de los nuevos
afirman que algo **se acepta**, para que un endurecimiento de más también caiga.

## `reset()` no limpia

`MutationObserver.reset()` de TanStack **sólo quita el observador y programa el recolector**, con
`gcTime` de cinco minutos por defecto. Leído en el fuente.

O sea que `useMutation` deja la respuesta entera —contraseña temporal y ficha médica incluidas— en el
`QueryClient` de toda la aplicación, legible desde la consola cinco minutos después de que el admin se
fue del mostrador.

**Dos agentes lo encontraron por caminos independientes**, uno por la ficha médica y otro por la
contraseña. El segundo descubrió además que el comentario que el primero había dejado —«como todas las
mutaciones de este archivo»— era falso, porque justo la suya no lo tenía.

Arreglado con `gcTime: 0` **en el hook y no en la pantalla**: la limpieza desde el componente protege a
un llamador, el hook protege a todos, incluidos los que todavía no existen. El test que lo fija **lee el
archivo fuente**, para que una mutación nueva nazca cubierta en vez de tener que acordarse de sumarla a
una lista.

## Un borrado que no ocurre

**`GET /usuarios/:id` omite `fichaMedica` salvo para `ADMIN_SALON` o el dueño, pero `PATCH` la acepta de
cualquier operativo.** Dibujar el campo igual lo pinta vacío, y guardar un teléfono mandaría
`fichaMedica: ''`: **historial clínico borrado por corregir un número**, sin que nadie lo vea.

Resuelto condicionando el campo a `'fichaMedica' in usuario` —la clave del payload, no el rol dibujado
aparte—, que es apoyarse en lo que el servidor mandó y no en una regla paralela que puede
desincronizarse.

## `queryByRole` no prueba que algo no exista en el DOM

Errata mía, escrita en el plan y propagada a cuatro archivos. `*ByRole` consulta el **árbol de
accesibilidad**, que ya excluye por su cuenta lo que lleva `hidden`, `aria-hidden` o `display:none`. Un
botón con `hidden` pasó 63 tests escritos con esa creencia.

Importa en los campos de formulario: uno oculto **sigue estando en el formulario y se manda igual**, y
con `forbidNonWhitelisted` eso es un 400 que tira la petición entera.

Afinado al medirlo, en las dos direcciones:

- `queryByLabelText` **sí** ve lo que lleva `hidden`. De once aserciones sospechosas, sólo dos estaban
  descubiertas; lo que salva al resto son las **listas blancas que leen los `<label>` del DOM**.
- Y hay un caso donde `queryByRole` es **lo correcto**: cuando la pregunta _es_ sobre accesibilidad —
  que un bloque se anuncie como `status` y no como `alert`, porque el alta sí se hizo y `alert`
  interrumpe al lector de pantalla.

## Las mutaciones abiertas: dieciséis de dieciséis

Lo que cambia cada vez no es la familia —**agregar algo que no debería estar, sin quitar nada**— sino
**dónde nadie estaba mirando**:

| Dónde apareció                | El eje que nadie auditaba                                     |
| ----------------------------- | ------------------------------------------------------------- |
| un componente de cliente      | lo que cruza la frontera y viaja en el payload RSC            |
| un `router.push`              | cuántas veces se llama, no con qué                            |
| una lista blanca de enlaces   | comprobada con un solo rol                                    |
| un atributo del DOM           | el token, que no era campo de `/auth/me`                      |
| la caché de consultas         | lo que queda guardado, no lo que se pide                      |
| la caché de **mutaciones**    | sobrevive cinco minutos al desmontaje                         |
| una cabecera de **respuesta** | no llevaba el prefijo que la auditoría filtraba               |
| `localStorage`                | sobrevive al logout y al cambio de turno                      |
| el service worker             | **las cabeceras**: ningún test construía peticiones con ellas |
| `console.*`                   | ningún spec de `apps/web` mencionaba `console`                |
| `document.title`              | lo que la pantalla le dice al **navegador**, no al documento  |

Las dos últimas son las que más lejos llegaron. El título de la página va a la base de historial **en
disco**, al archivo de restauración de sesión, al conmutador de pestañas —visible para quien pase por
detrás del mostrador—, a cualquier captura o pantalla compartida, y **es lo que toda SDK de analítica
manda por defecto como nombre de página**: un gimnasio que enchufe analítica mañana publica sus códigos
de invitación a un tercero sin que nadie lo decida.

Los dos tapones quedaron **globales**, enganchados en `vitest.setup.ts`, así que cubren los 36 archivos
y los que se escriban después.

## Lo que los e2e encontraron y los unitarios no podían ver

**El offline del alumno quedó a medias.** La lista blanca del service worker dejaba fuera
`turnos-disponibles`, que antes cubría `defaultCache`. La vista de semana pide **dos** endpoints, así
que sin red una consulta fallaba y pintaba una alerta al lado del banner. La regla se había probado
contra la función, no contra lo que la aplicación necesita.

**`e2e/navegar.ts` es frágil desde siempre**, y no es nuestro: `isVisible()` **no espera**. Mide a los
~218 ms y los datos llegan a los ~337, así que se va a la semana siguiente y tres clics después falla
sobre una semana que legítimamente no tiene turnos. No es mala suerte: la primera mirada cae **siempre**
antes de los datos, y lo único que decide si pasa es si el fetch alcanza a completarse durante la ida y
vuelta de Playwright. Cualquier latencia nueva lo inclina.

## Trampas nuevas

**El middleware no va en `apps/web/middleware.ts`.** Next escanea un solo directorio, el padre de
`appDir`; como `appDir` es `src/app`, el único sitio válido es `apps/web/src/middleware.ts`. En el sitio
equivocado **no se carga y sin aviso**: el archivo existe, los tests pasan, y en producción no corre
nadie. Se confirma en el build, que imprime `ƒ Middleware`.

**El heredoc del Bash tool se come las barras invertidas** aun con el delimitador entre comillas:
`'/x\\..'` queda `'/x\..'` en disco, que en TS es `/x....`. El test falla por eso y no por el código.

**El filtro de vitest es subcadena, no regex**: `vitest run "a|b|c"` no casa nada.

**Con varios agentes en el mismo árbol el total de tests no sirve para comparar.** Lo que vale es que
cada archivo preexistente conserve su número.

## Estado final

|               |                                                   |
| ------------- | ------------------------------------------------- |
| `apps/web`    | **676 tests / 36 suites**, tsc limpio, `build` OK |
| Playwright    | **5 / 5**, los tres specs                         |
| `apps/api`    | **1291 / 65**, sin tocar                          |
| E2E de la API | **204 / 12**, sin tocar                           |

## Deuda anotada

- **El profesor sigue sin pantalla propia.** Sus endpoints existen desde la Fase 4; al llegar al área de
  alumno se le ofrece cerrar sesión.
- **No se puede vaciar `packId` ni las vigencias** de un alumno, ni **quitar un límite ya puesto** a una
  clave de invitación: la API no lo admite. El formulario lo dice en pantalla en vez de fingirlo.
- **`ActualizarInvitacionDto.packId` no lleva `@IsNotEmpty()`** y el de crear sí. Un `packId: ""` pasa la
  validación y luego se trata como ausente.
- `(admin)/invitaciones` importa `errores.ts` de `usuarios/[id]` por ruta relativa: si alguien lo mueve,
  el formulario deja de compilar.
- El contenedor `api` del compose **está roto**: le falta `@nestjs/throttler` en su `node_modules`. Los
  e2e exigen levantar la API en el host.

## Siguiente paso

Las otras cuatro áreas del panel, en el orden que convenga: Operación diaria (~23 endpoints), Dinero
(~9), Análisis (los siete reportes de la 6A, que siguen sin cara) y Configuración (~15, incluida la del
check-in y la web pública de la 6B). Las cuatro heredan el armazón, la puerta, el middleware, la tabla,
el diálogo de confirmación y los dos tapones globales.

# Progreso Fase 8 — La publicación del mes

**Spec:** `docs/superpowers/specs/2026-10-08-fase8-publicacion-del-mes.md`
**Plan:** `docs/superpowers/plans/2026-10-08-fase8-publicacion-del-mes.md` (6 tareas)

La primera de **Operación diaria**, que son **28 endpoints en siete módulos** —no los 23 que estimé
antes de contarlos—. Esta fase entrega sólo el calendario: cuatro endpoints, de los que la pantalla usa
tres, pero es la pantalla más difícil del proyecto, con un trabajo en segundo plano y una acción que
escribe para todo el salón de una vez.

- [x] T1 — Los meses que se pueden ofrecer
- [x] T2 — El hook y el sondeo
- [x] T3 — Los selectores y el estado en la URL
- [x] T4+T5 — Resumen, conflictos, publicar y seguir el trabajo _(juntas: mismos archivos)_
- [x] T6 — Verificación, README y tracker

## Decisiones cerradas con Cesar

1. **Se empieza por la publicación del mes, sola.** Entrega por sí misma y es lo que obligaba a un `curl`.
2. **Una sola pantalla con el estado en la URL**, no un asistente con pasos.
3. **El trabajo se sigue en pantalla pero no la bloquea.**
4. **Resumen y conflictos arriba; las listas completas, plegadas.**

## Por qué no hay asistente

`previsualizar` es **de sólo lectura y síncrono a propósito**, y su resultado es **función pura de
`(salaId, anio, mes)`**. Entonces no existe estado de asistente que se pueda perder: con los tres
parámetros en la URL, recargar, compartir el enlace o volver con el botón de atrás dan lo mismo, sin
una línea de máquina de estados.

Inventar pasos con memoria habría sido una segunda fuente de verdad para algo que el servidor ya sabe.

## El `volverA` sin query: el mismo error, ya diagnosticado en este repo

Las pantallas del panel armaban el `volverA` del 401 con el camino pelado. Al volver del login, el
admin aterrizaba **sin sala y sin mes** — que en el calendario _son_ el estado.

Lo notable es cómo apareció: no leyendo código, sino **un comentario del propio repo que ya había
diagnosticado este error en otro lado** (`admin/layout.tsx`): «este `volverA` NO CONSERVABA NADA…
Parecía que funcionaba, que es peor que no estar». El diagnóstico estaba escrito y nadie lo había
aplicado hacia adelante.

Arreglado con `lib/destino-de-login.ts`, **un helper y no cuatro líneas iguales**: cuatro sitios son
cuatro donde el quinto se olvida. `SIN_QUERY` queda como constante **con nombre y docblock** para las
pantallas que hoy no usan `useSearchParams`; un `''` suelto se lee como un default que nadie decidió.

## Cuatro formas de que un test exista y no pueda fallar

**Lo más transferible de esta fase.** Las cuatro pasan desapercibidas igual: el test está ahí, tiene
buen nombre, y pasa — pero pasaría igual con el bug puesto. Y son peores que un test ausente, porque el
ausente se nota leyendo la lista y éstos ocupan el lugar del que haría falta.

### 1. Autorreferencial

El `it.each` de `armazon.spec.tsx` comparaba el DOM contra `enlacesPara(rol)`. Agregar una entrada a
`ENLACES_DEL_PANEL` **mueve los dos lados a la vez** y el test sigue en verde. Tenía dientes para lo que
fue escrito —un enlace cableado en el JSX bajo un `if` de rol— y **ninguno** para «una entrada de más en
la lista declarativa».

**Una lista blanca derivada del mismo sitio que audita no es una lista blanca.** Tiene que estar escrita
a mano en algún punto de la cadena: esa redundancia es lo que la hace capaz de contradecir al código.

Ese mismo archivo ya había enseñado otra forma de fallar en la Fase 7: la lista blanca **comprobada con
un solo rol**.

### 2. Premisa destruida por el código bajo prueba

El test «el último día del mes todavía ofrece ese mes» le pasa un `Date` del día 30 justamente para
ejercitar ese borde. La mutación `ahora.setUTCDate(1)` lo reescribe **antes de leerlo**: el borde se
evapora y el test sigue verde, con un nombre que ya no describe nada.

### 3. Montado en el caso ciego

El test del 401 de `usuarios/page.spec.tsx` montaba **sin filtros**, o sea que fijaba el `volverA` en el
único escenario donde no hay query que conservar: era **estructuralmente incapaz** de distinguir un
destino que se lleva el query de uno que lo tira.

Apareció dos veces más en la misma fase. Una, para rechazar una instrucción mía: resolver `publicadoPor`
contra el listado de personas habría sido código muerto, porque ese listado **nunca devuelve
administradores**, y el test que lo cubriera tendría que inventar un admin en una respuesta que la API
no produce. Y otra, en el test de centinelas de un agente **a los diez minutos de escribirlo**: los dos
alumnos sembrados resolvían, así que la distinción entre «pinto el nombre» y «pinto el id si no hay
nombre» no existía. Se cerró con un tercer centinela ausente de la lista.

### 4. Verde por casualidad ortográfica

`expect(document.body.innerHTML).not.toMatch(/publicar/i)` pasaba **porque el texto vecino dice
«Publicando…», que no contiene «publicar»**. El propio implementador lo detectó y dejó un comentario
pidiendo que nadie cambiara esa palabra — y ahí está la señal: **una defensa que necesita un comentario
rogando que nadie toque una palabra ya falló.** Se reemplazó por fijar el conjunto entero de `<button>`.

## Las mutaciones abiertas: cuatro de cuatro, y tres ejes nuevos

| #   | Qué se agregó                               | El eje que nadie auditaba                                                                           |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 17  | `ahora.setUTCDate(1)` «para normalizar»     | **el argumento recibido**: que la función sea pura en lo que **recibe**, no sólo en lo que devuelve |
| 18  | `setQueryData` con la respuesta de publicar | **dos cachés distintas**: `gcTime: 0` tapa la de mutaciones y esto ensucia la de consultas          |
| 19  | un `useEffect` que «normaliza» la URL       | **navegar al montar**, no al cambiar algo                                                           |
| 20  | `data-perfiles` con todos los `perfilId`    | **los atributos**: los tests miraban texto, roles, recuentos y rutas                                |

La 18 es la más instructiva: la defensa estaba puesta —`gcTime: 0` en todas las mutaciones— y el ataque
usó el otro almacén. Además, TypeScript no la veía (`setQueryData` con una clave sin `DataTag` infiere
`unknown`) y ningún test montaba los dos hooks sobre **el mismo** `QueryClient`, que es como viven en la
pantalla real. El daño era exacto: el mes guardado pierde `publicacion`, el sondeo lee `undefined` y
**para** — justo en el único momento para el que existe.

La 20 es la más grande en volumen: el plan trae las **listas completas**, así que no era un id suelto
sino todos los alumnos de la sala en el código fuente de la página.

## Trampas nuevas

**El mes corrido no distingue «mes 13» de «enero del año siguiente»**: `2026*12 + 13` y `2027*12 + 1`
son el mismo número. Un test de secuencia basado en meses corridos es por tanto **estructuralmente
ciego** a una mutación que fije el año. Por eso el rango `1..12` va en su propio test: es una afirmación
sobre la **forma** de cada elemento, no sobre la distancia entre dos.

**La lista blanca, aplicada a una secuencia.** Los tests miraban `[0]`, `slice(0, 3)` y
`toHaveLength(12)`: un mes repetido en la posición 7 pasaba los siete. El agujero no era «la salida
acepta campos de más» sino **«la cola de la lista acepta cualquier cosa»** — la cabeza siempre estuvo
vigilada.

**Con temporizadores falsos, `userEvent` se cuelga** esperando un `setTimeout` que nadie adelanta. En
los specs del sondeo va `fireEvent`.

**TanStack agrupa los avisos a los observadores en un temporizador**, y uno programado _durante_ un
avance de cero no entra en ese mismo avance: los ayudantes de espera avanzan vueltas de 1 ms, no de 0.

## Estado final

|                   |                                                   |
| ----------------- | ------------------------------------------------- |
| `apps/web`        | **802 tests / 41 suites**, tsc limpio, `build` OK |
| `apps/api`        | **1291 / 65**, sin tocar                          |
| `packages/shared` | **103 / 4**, sin tocar                            |

De 676 tests en web al empezar la fase.

## Deuda anotada

- **El 401 del POST de publicar no manda al login** (sí muestra «Tu sesión caducó»). Cablearlo exige
  unir la señal de la mutación con la de las dos consultas, y hacerlo a la ligera crea una **segunda
  fuente de navegación**, que es justo lo que un test vigila. Queda para su propia tarea.
- **`publicadoPor` se muestra como id.** Resolverlo exige tocar `usuarios.service.listar`, que filtra
  por alumnos y profesores y nunca devuelve administradores.
- Sigue en pie la deuda de las fases anteriores: el profesor sin pantalla propia, `main.ts` sin
  `enableShutdownHooks()`, el envío masivo sin tope, la rotación de la clave de cifrado, y el contenedor
  `api` del compose roto por falta de `@nestjs/throttler`.

## Siguiente paso

Lo que queda de Operación diaria: **turnos y reservas** (9 endpoints: ver y editar un turno, la
suplencia, anotar a alguien a mano, cancelar, reasignar) y **la configuración operativa** (15: salas,
horarios de profesor, vacaciones, ausencias). Después, las áreas de Dinero (~9) y Análisis (los siete
reportes de la 6A, que siguen sin cara).

# Progreso Fase 9 — Turnos y reservas

**Spec:** `docs/superpowers/specs/2026-10-10-fase9-turnos-y-reservas.md`
**Plan:** `docs/superpowers/plans/2026-10-10-fase9-turnos-y-reservas.md` (6 tareas)

Las pantallas que permiten **tocar** el mes que la Fase 8 genera. Sin esto se podía publicar un mes
entero y después no mover nada de él.

- [x] T1 — El endpoint que faltaba (API)
- [x] T2 — Los hooks
- [x] T3 — El listado de turnos
- [x] T4 — La ficha: datos, profesora y borrar
- [x] T5 — Los anotados: listar, anotar, cancelar, reasignar
- [x] T6 — Verificación, README y tracker

## La decisión que abrió la fase: tocar la API

**No había forma de que un admin viera quién está anotado en un turno.** `TurnoPublico` trae un
contador; el único listado de alumnos de una clase exige que el turno sea **del profesor que llama**.

Resultado: el admin podía crear una reserva, cancelarla y reasignarla, pero **no tenía de dónde sacar el
id** salvo de la respuesta del POST que él mismo acababa de hacer. **Dos endpoints que existían y nadie
podía usar.**

Es la misma forma del hueco de la Fase 6B con los ids de los testimonios, y se resolvió igual: **un
endpoint de lectura que falta se agrega donde se descubre.** Fue el único cambio en `apps/api` de toda
la fase.

## Cancelar no es una sola cosa

Según `ConsumoDePack`, las clases consumidas son «las no canceladas **y las canceladas como
DEFINITIVA**». O sea: **una definitiva le gasta la clase al alumno y una recuperable se la devuelve.**

La pantalla pregunta qué le pasa a la clase, no el tipo con dos siglas, y **no tiene valor por
defecto**: elegir por él sería decidir en nombre del alumno. Es la misma clase de problema que la
contraseña temporal de la Fase 7 —una decisión cuyo costo lo paga otra persona— y se resuelve igual,
haciéndola explícita.

## Las mutaciones abiertas: cinco de cinco, y cinco ejes nuevos

| #   | Qué se agregó                                | El eje que nadie auditaba                                                                        |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 21  | un log con los nombres resueltos             | **la otra puerta por la que salen los datos**: la lista blanca cubre el _cuerpo_ de la respuesta |
| 22  | `invalidateQueries()` sin filtro             | **el alcance de una invalidación**                                                               |
| 23  | `history.replaceState` por detrás del router | **la History API real**, no el router doblado                                                    |
| 24  | un `prefetchQuery` tras guardar              | **lo que una acción pide DESPUÉS de escribir**                                                   |
| 25  | `window.name` con la lista de anotados       | **el único almacén no atado al origen**                                                          |

**La 25 es la más aguda de las veinticinco.** `window.name` no es `sessionStorage` con otro nombre:
`sessionStorage` muere al cambiar de origen y esto no, así que la lista de quién está anotado viaja **a
la siguiente web que esa pestaña abra**, en una máquina de mostrador que usan cuatro personas por turno.

**La 22 es la más instructiva.** Era invisible _por construcción_: los unitarios montan el hook solo, y
con un único consumidor del `QueryClient` una invalidación global y una dirigida **son
indistinguibles**. No faltaba un caso, faltaba el escenario donde la distinción existe. De ahí salió
`src/test/consulta-ajena.ts`, que deja una consulta ajena y activa en el mismo cliente — con dato
sembrado **y** `staleTime: Infinity`, porque con el valor por defecto la consulta nace rancia y el
centinela no distingue nada.

**La 21 tenía un agravante medido:** en los e2e la salida del `Logger` de Nest no aparece en absoluto,
así que el e2e tampoco podría haberla visto nunca. Se cerró interceptando `process.stdout.write` y no
`Logger.prototype.log`, porque espiar el método dejaría pasar `logger.debug` o `console.log` — verde por
casualidad ortográfica.

## Lo que fallaba estaba en nuestras propias defensas

Esta fase casi no encontró bugs de producto. Encontró **defensas que no defendían**:

**Los tapones compartidos eran uno, no tres.** `vitest.setup.ts` registraba sólo el del título;
`espiarLaConsola()` había que engancharlo spec por spec, así que `console.*` estaba sin vigilar en 44 de
49 archivos. **Y el del título era una lista negra de tres literales**: un `document.title` con el
nombre de una profesora pasaba en verde. El patrón contra el que el repo predica, aplicado al revés y en
infraestructura compartida. Lo encontraron **dos agentes por caminos independientes**.

Ahora `vigilarLosCanalesDeSalida()` vigila los tres canales en los 49 specs contra **un registro común**
que cada spec amplía con lo que sembró.

**El analizador del `gcTime` tenía dos agujeros.** Delimitaba el bloque de opciones por sangría, así que
una mutación declarada a otra profundidad **heredaba el `gcTime: 0` de la de al lado**. Y leía el fuente
con comentarios, así que un «`gcTime: 0`, como todas las de este archivo» **vestía a una mutación
desnuda**. Ahora cuenta llaves y analiza con comentarios y textos vaciados.

**Y el guardia que debía impedir que el analizador pasara con las manos vacías era autorreferencial**:
preguntaba «¿no saqué nada?» con la misma expresión que extraía. Se descubrió porque **el test que debía
fallar no falló**.

**El `gcTime` nunca se había propagado.** La regla se decidió y se midió en la Fase 7, pero
`use-acciones-de-turno` y `use-comprobantes` quedaron fuera porque no los tocamos entonces — y
`useSubirComprobante` guardaba el **`File` entero**, o sea el comprobante de pago del alumno, cinco
minutos en el `QueryClient`. **Una decisión que no se propaga en el momento en que se toma queda a
merced de que alguien vuelva a pasar por ahí.**

Ahora un **único barrido** sobre `src/hooks/*.ts` cubre 23 mutaciones en 7 archivos, y un archivo nuevo
**nace cubierto sin necesitar su propio spec**.

## El hallazgo que no es de código: un guardia que filtra al fallar

`expect(x).not.toContain(secreto)` **imprime el secreto en el informe.** El fallo de una contraseña
filtrada la filtraba otra vez — al registro de CI, que la guarda más tiempo y la lee más gente que la
consola del mostrador.

Cambiado a `expect(texto.includes(valor), 'la consola dijo claveDelReset').toBe(false)`: lo único que se
publica es el nombre del dato.

Y otro del mismo cierre: los specs llaman a `vi.restoreAllMocks()` en su propio `afterEach`, que con el
orden de hooks de Vitest corre **antes** que el tapón. Sin re-enganchar el espía en cada `beforeEach`, a
partir del segundo test de cada archivo habría estado mirando una consola que ya nadie dobla: **verde y
ciego**.

## Los errores de este plan

1. **La lista blanca de claves que di estaba mal ordenada.** `.sort()` compara carácter a carácter, así
   que `'cancelacionTipo'` va antes que `'canceladaEn'`. Copiada tal cual, el test quedaba **en rojo con
   el código correcto**.
2. **Vengo diciendo mal lo del build de `shared`.** Los dos configs de jest mapean `@boxadmin/shared` a
   `src/`, no a `dist/`. El build hace falta para `tsc` y para `apps/web`, pero **un test en verde no
   prueba que el `dist` esté al día**.
3. **Afirmé que había dos tapones globales. Había uno.**
4. **Cité el comentario del servicio en vez del mensaje que viaja** en el 409 del cupo.
5. **Escribí una aserción verde por casualidad ortográfica**: `/necesit/i` sobre un mensaje que dice
   «Para esto hace falta ser X. Tu rol no alcanza». No fijaba nada.
6. **«Es una línea en `bloque-borrar.tsx`» habría sido código muerto**: la URL de la ficha no llevaba
   los filtros, porque el enlace de fila del listado no propagaba el query. El arreglo estaba en el otro
   extremo del camino.

Las seis las encontraron los agentes al verificar en vez de acomodarse, y las seis habrían quedado como
tests en verde que no prueban nada.

## Trampas nuevas

**`vitest run "turnos/[id]"` sólo funciona desde PowerShell**: por Bash los corchetes se comen el patrón
y da «No test files found».

**Un helper de peticiones necesita el método pegado a la ruta.** Tras escribir, la invalidación vuelve a
pedir el recurso, y sin el método esa lectura legítima y la escritura que la causó son la misma cadena.

**`document.cookie` es el tercer almacén y el único que viaja**: se adjunta a cada petición y acaba en
los logs del servidor. Ningún test del repo lo miraba.

## Estado final

|                   |                                                   |
| ----------------- | ------------------------------------------------- |
| `apps/web`        | **971 tests / 49 suites**, tsc limpio, `build` OK |
| `apps/api`        | **1299 / 65**                                     |
| E2E de la API     | **212 / 13**                                      |
| `packages/shared` | 103 / 4                                           |

De 802 tests en web y 1291 en la API al empezar la fase.

## Deuda anotada

- **Un segundo 403 que no es de rol, en anotar**, con un mensaje que le pone una ruta de API delante a
  quien está en el mostrador: «Asignasela con `PATCH /usuarios/:id/salas`». Es `apps/api`.
- **`use-rutinas.ts` no tiene un solo test**, con 3 mutaciones. El `gcTime` ya lo cubre el barrido.
- **Sobre-invalidación de `/mi-pack`** en `use-acciones-de-turno`: se invalida también al entrar y salir
  de la **lista de espera**, que no consume clases. Medido: 1 → 2 peticiones, en el teléfono del alumno.
- El helper de la consulta ajena **no detecta eso**: mide «no toca lo que no es de nadie», y no puede
  juzgar si una clave **propia** de un hook sobra para una acción concreta.
- Sigue en pie la deuda vieja: el profesor sin pantalla, `main.ts` sin `enableShutdownHooks()`, el envío
  masivo sin tope, la rotación de la clave de cifrado, y el contenedor `api` del compose roto por falta
  de `@nestjs/throttler`.

## Siguiente paso

**La configuración operativa** —salas, horarios de profesor, vacaciones y ausencias, 12 endpoints—, que
cierra Operación diaria y son los datos de los que se alimenta el calendario. Después **Análisis** (los
siete reportes de la 6A, que llevan tres fases sin cara), **Dinero** (9) y **Configuración** (14).

# Progreso Fase 10 — La configuración operativa

**Spec:** `docs/superpowers/specs/2026-10-15-fase10-configuracion-operativa.md`
**Plan:** `docs/superpowers/plans/2026-10-15-fase10-configuracion-operativa.md` (6 tareas)

Los datos **de los que se alimenta** el calendario que la Fase 8 publica. Cierra **Operación diaria**.
**No se tocó ni un endpoint**: son 15 que ya existían y no tenían pantalla.

- [x] T1 — Los cuatro hooks (`use-salas-admin`, `use-horarios`, `use-ausencias`, `use-vacaciones`)
- [x] T2 — Salas: el catálogo con alta, y la ficha con los cuatro ajustes, activa y baja
- [x] T3 — Horarios de profesor, con filtros en la URL
- [x] T4 — Ausencias («Cierres»)
- [x] T4bis — Sacar la franja horaria de las ausencias (decisión de Cesar, en caliente)
- [x] T5 — Las vacaciones, en la ficha de la persona
- [x] T6 — Infraestructura de los canales, verificación, README y tracker

## Las cuatro decisiones que no estaban en el plan y hubo que inventar

**No hay hook de lista de salas.** `GET /salas` no acepta filtros y el service ya recorta por rol, así
que una «lista de administración» sería **byte por byte la misma petición** que `useSalas()`. Dos claves
para la misma petición son dos copias que se desincronizan. La pantalla usa `useSalas()`.

**La clave de la ficha es `['sala', id]`, en singular.** Con `['salas', id]`, invalidar el catálogo la
arrastraría por prefijo y «invalida el catálogo» e «invalida la ficha» serían **el mismo hecho**: dos
tests que se vuelven uno sin que se note. Caso ciego, evitado antes de escribirlo.

**El test del catálogo no espía `invalidateQueries`**: monta `useSalas()` de verdad y mira si el
`GET /salas` vuelve a salir. Con el espía sería autorreferencial — la clave invalidada comparada contra
la misma que el hook usa, verde aunque las dos se desviaran juntas a una clave paralela que ninguna
pantalla observa.

**Cada ajuste heredable tiene su propio botón y su propia mutación**, para que el cuerpo sea
literalmente `{ cupoBase: 12 }`. Un único «Guardar» mandaría las ocho claves y **pisaría la herencia en
silencio**.

## Los errores de este plan

Los diez, sin suavizar. Los encontraron los agentes al verificar en vez de acomodarse.

1. ⚠️ **`/vacaciones` no existe: el controller es `vacaciones-alumnos`.** El módulo, el service y el
   contrato se llaman sólo «vacaciones», así que deducir la ruta del nombre del módulo da 404 — y un
   404 en ese GET **se ve en pantalla como «este alumno no tiene vacaciones cargadas»**. Un error de
   ruta disfrazado de dato vacío, la misma forma del `?salaId=` de la Fase 6A: no falla, **miente**. De
   ahí salió la decisión de que el estado de error del bloque **no comparta dibujo con el vacío**.
2. **El borrado de vacaciones es real, no baja lógica.** Lo dice el comentario del propio controller, y
   devuelve la fila para poder deshacer. Salas y horarios sí son baja lógica. En mi tabla de endpoints
   las puse a las tres iguales.
3. ⚠️ **`cupoBase` no hereda del gimnasio: `Tenant` no tiene esa columna**, y el schema dice por escrito
   por qué no la tiene. **No son cuatro los ajustes heredables: son tres.** Pintar «hereda del gimnasio»
   habría prometido un valor que no existe, con el síntoma **a un mes de distancia**.
4. ⚠️ **`profesorId` no es el id del usuario: es el `perfilId`.** El modelo relaciona
   `profesor Perfil @relation(fields: [tenantId, profesorId])`. De ahí salió un **bug vivo de la Fase
   8** (ver Deuda).
5. **Predije que el recuento de T4bis bajaría y no bajó**: 56 → 56, se fueron 3 y entraron 3. Lo que
   faltaba en la predicción es que **la cobertura no se borra, se reemplaza desde el lado nuevo**.
6. **«Siete copias a mano» eran once.** La cuenta con la que dimensioné la T6 estaba corta.
7. **Dije que `use-salas-admin.ts` tenía cuatro escrituras.** Tiene **tres**.
8. **Dije que `exclusiva` aparecía «en un solo sitio».** Está en los dos DTOs, en `crear`, en el schema
   y en el contrato. Lo cierto —y lo que importa— es que **ninguna regla lo lee**.
9. **Dije que el campo muerto de las ausencias era `recuperable`.** También lo son `todoElDia`,
   `horaInicio` y `horaFin`, y **éstos son peores**: los dos primeros son inertes, la franja **cancela
   turnos que deberían existir**. Cuatro consumidores mapean sólo `{ salaId, desde, hasta }`.
10. **Dije que los e2e de la API eran de Playwright.** Son **Jest + supertest**
    (`apps/api/test/jest-e2e.json`, 13 specs); Playwright es de `apps/web` y es otra cosa. Las dos
    trampas que advertí —levantar la API en el host, el contenedor `api` roto— **no aplican a estos
    e2e**: arrancan la app de Nest dentro del proceso de Jest. La del freno de auth sí, porque hay un
    `throttling.e2e-spec.ts`.

## Las mutaciones abiertas: cinco de cinco, y van 31 de 31

| #   | Qué se agregó                                       | El eje que nadie auditaba                                    |
| --- | --------------------------------------------------- | ------------------------------------------------------------ |
| 27  | `retry: 2` en un POST                               | **el camino de error**: los 6 recuentos corrían sobre un 200 |
| 28  | un `useSalas()` «para precalentar» en la ficha      | **la lista de peticiones**: una lectura de más               |
| 29  | `localStorage` con la profesora y su tarifa         | **los almacenes del navegador**                              |
| 30  | un `fetch()` crudo a `/api/bx/stats/caja`           | **la lista blanca espiaba `pedir`, no la red**               |
| 31  | `<meta name="description">` con nombre y vacaciones | **`document.head`** — sobrevivió los **1272** tests          |

**La 27 es la más cara si pasa.** Los seis `toHaveBeenCalledTimes(1)` del plan corrían todos sobre una
respuesta **200**, y sobre un 200 no hay reintento que contar: `retry` sólo actúa cuando la petición
falla. Familia «montado en el caso ciego» — el escenario donde la distinción existe no se montaba nunca.
Un POST no es idempotente: un 500 **después** de que la fila ya se escribió da **tres cierres
duplicados**, y en horarios **tres copias se le pagan tres veces a la profesora**, porque la liquidación
suma las horas de cada patrón. El test fija **«una escritura que falla sale una vez»** y no «el hook no
declara `retry`»: da igual el mecanismo, se mide cuántas veces salió la petición.

**La 28 enseñó que la lista blanca tiene que ser por rol.** Todo lo demás miraba el DOM y los **cuerpos**
que salen, y ninguna de esas dos cosas ve una **lectura** de más: una consulta que no se dibuja no cambia
un nodo y no manda ningún cuerpo. La clave del cierre es que hay **una lista por rol**: la de
`ADMIN_OPERATIVO` es `['/salas/s1']` y nada más — a quien no puede dar de baja no se le pide la agenda de
la sala. **Ese test el del rol alto no lo habría visto.**

**La 30 encontró el agujero debajo de una defensa de dos tareas antes.** La lista blanca espiaba `pedir`,
no la red, así que un `fetch()` crudo iba al proxy con la cookie de sesión y traía la caja del gimnasio a
una pantalla que no tiene nada que ver con el dinero — rompiendo en silencio la doctrina con la que abre
`lib/cliente.ts`: «el único fetch del navegador en toda la aplicación». **Sobrevivió los 1233 tests.** Se
cerró doblando el **`fetch` global** con un doble que **contesta un 200** —para que un fallo sea por la
aserción y no por un `TypeError`— y afirmando que la lista de destinos es `[]`.

**La 31 es la más aguda de las treinta y una.** React 19 **sube solo al `<head>`** los `<meta>`,
`<title>` y `<link>` renderizados en cualquier parte del árbol, desde un componente cliente, sin tocar el
`metadata` de Next ni el layout. Y **todo este repo afirma sobre el `<body>`**: `screen.*`, `innerHTML`,
el árbol de accesibilidad. Medido con una sonda, no supuesto:

```
HEAD>>> <meta name="description" content="Ana Perez (ana@gym.test, 11 4444-4444) — 2026-12-24 a 2027-01-05: Viaje...">
BODY_TIENE_META>>> false
```

No la vieron: el `body.innerHTML`, las dos listas blancas de peticiones, el doble del `fetch` global, los
tres almacenes, las dos cachés, el reloj, ni los tres tapones globales. `<meta name="description">` es
**el** campo que leen por defecto las SDK de analítica, los previsualizadores de enlaces y los
rastreadores: sale con «ver código fuente» y en cualquier volcado del DOM, y publicaría nombre, correo,
teléfono y **cuándo esa persona no está en su casa**. Y la línea pasa una revisión sin ruido: **parece
SEO**. Reportada, no tapada: el arreglo es de infraestructura y motivó el cuarto canal global.

**Un eje más, descartado por estar ya cerrado pero medido igual: el reloj.** Ningún test del paquete
adelantaba el tiempo. Un `setInterval(() => ausencias.refetch(), 30_000)` cae sólo por el
`describe('el tiempo')` con timers falsos. Daño: con el token recién caducado, una relectura de fondo
arranca al admin del formulario a medio escribir.

## Las dos defensas nuevas en `vitest.setup.ts`, y por qué cada una son dos mecanismos

Las dos nacieron de una mutación que sobrevivió, y las dos son **una dimensión, no un caso**: suben al
tapón global para que las hereden los 57 archivos, en vez de que cada pantalla se acuerde de pedirlas —
y la que no se acuerde es justamente la que lo va a necesitar.

**El cuarto canal: el `<head>`.** Hacen falta **las dos mitades, y no son la misma**. «No contiene
centinelas» caza un dato metido en un nodo que **ya estaba**; «no crecieron los nodos» caza el nodo
**nuevo** aunque lo que lleve dentro no sea ninguno de los datos sembrados — un `<meta>` con la lista de
las clases del día no lleva centinela y publica el gimnasio entero. El informe nombra **sólo la
etiqueta** (`<meta>`), nunca el `content`: el nodo que el tapón existe para cazar es justamente el que
lleva el dato, y copiarlo al registro de CI es el mismo modo de fallo que el espía de la consola evita.

**El quinto canal: los tres almacenes.** También dos mecanismos, y también hacen falta los dos:

- **El estado solo no basta** porque los specs limpian los almacenes en SU propio `afterEach`, que con
  el orden de hooks de Vitest corre **antes** que el tapón: lo que el test guardó ya no está cuando
  miramos. Y una escritura seguida de un `removeItem` no deja estado y pasaría.
- **Las escrituras solas tampoco** porque en jsdom `localStorage.lo = 'x'` —asignación por propiedad—
  **no pasa por `setItem`**: lo resuelve el proxy del almacén. Medido con una sonda. Ese camino sólo lo
  ve el estado.

Se afirma sobre las **claves** y no sobre los valores, por lo de siempre: un `toEqual` con los contenidos
imprimiría en el informe de CI justamente el dato que se escapó. Y los canales se restauran **antes** de
afirmar, para que el test que ensucia no arrastre a los de atrás — con **el `<head>` como única
excepción**: arrancarle un nodo que React subió ahí rompe el desmontaje con un «Cannot read properties of
null (reading 'removeChild')», medido.

**El agujero era del spec, no del repo.** Once pantallas ya tenían el test de los almacenes, **cada una
con su copia a mano** de `contenidoDe` y `galletasDelDocumento`, y a las demás les faltaba sin que nada
avisara.

## Dos arreglos de infraestructura de la T6

**El `cleanup()` se movió dentro del tapón, y el orden es la parte delicada.** El tapón se registra
después de `afterEach(cleanup)`, así que corre **antes** — lo cual es necesario, porque el `<head>` hay
que mirarlo con el árbol todavía montado. Pero al lanzar una afirmación, Vitest **aborta la cadena** y
`cleanup()` no corre: el DOM se arrastra y los tests siguientes caen con «Found multiple elements with
the role», que acusa al inocente. Era **preexistente** —los canales de consola y título ya lo tenían—,
pero los dos canales nuevos lo hicieron visible.

Medido con la mutación 31 reaplicada, sobre los 89 tests de la ficha de la persona:

|                | tests que caen | líneas «Found multiple elements» |
| -------------- | -------------- | -------------------------------- |
| sin el arreglo | 87 de 89       | **74**                           |
| con el arreglo | 78 de 89       | **0**                            |

Y el canal **sigue viendo la mutación** (68 «metió nodos en el `<head>`» más el centinela del motivo),
que era la condición para que el arreglo entrara: un canal ciego es peor que el ruido. **No se puede
mover una línea más arriba**: con el `cleanup()` delante de la foto, React desmonta y se lleva sus
`<meta>`, y el cuarto canal quedaría ciego en verde sin que nada lo diga. El `afterEach(cleanup)` de
`vitest.setup.ts` se queda: es idempotente y cubre el caso de que el tapón no llegue a correr.

⚠️ **`pnpm build` estaba ROTO y ni `tsc --noEmit` ni los 1253 tests lo veían.** `ausencias/page.tsx` y
`horarios/page.tsx` exportaban `filtrosDeLaBusqueda` (y la primera, cuatro ayudantes de texto y una
constante más), y **Next 15 prohíbe que un `page.tsx` exporte cualquier cosa que no sea el `default`** y
su lista corta de claves de configuración. Compila con `tsc`, compila con el bundler, y revienta después
en el paso de «Linting and checking validity of types» con un error sobre `OmitWithTag` y una propiedad
«not assignable to `never`» que **no se parece en nada a la causa**. Arreglado como ya lo hacía
`turnos/filtros.tsx`: los filtros a un `filtros.ts` hermano —que el spec importa desde ahí—, y los cuatro
ayudantes sin `export`, porque nadie los importaba.

## Trampas nuevas

**Un `export` de más en un `page.tsx` es un fallo de `next build`, no de `tsc`.** Es la única
comprobación del repo que lo ve, y el mensaje no se parece a la causa. Los ayudantes de una pantalla van
a un archivo hermano.

**`repartirPorCampo` ordena por longitud del nombre**, así que `horaFin debe ser posterior a horaInicio`
aterriza bajo **Hora de inicio** (`horaInicio` mide 10, `horaFin` mide 7). En vacaciones mordió de verdad
—«hasta no puede ser anterior a desde» nombra a los dos y **miden lo mismo**, así que gana el primero de
la lista— y se resolvió pasando `['hasta', 'desde', 'motivo']` a propósito, con test dedicado.

**Un campo en la lista del reparto SIN control que lo pinte se traga la frase en silencio**: `porCampo`
se la queda y no se dibuja en ningún sitio. Fuera de la lista caería en `sueltas` y saldría en el cartel.
Camino de silencio, inalcanzable pero silencioso. Por eso `perfilId` y `todoElDia` quedan fuera.

**`Campo` deriva el `id` de la etiqueta**, y la ficha de la persona ya tenía un «Desde» en el bloque de
días fijos. Dos controles con `id="desde"` rompen el `htmlFor` de los dos. De ahí «No viene desde» / «No
viene hasta» / «Motivo»; los `name` siguen siendo `desde`/`hasta`/`motivo`, que es lo que necesita el
reparto.

**Dos controles con el mismo nombre accesible son indistinguibles** para un lector de pantalla y para un
test: los filtros de horarios se renombraron a «Filtrar por profesora» / «Filtrar por sala».

**`DELETE /horarios-profesor/:id` responde 204 sin cuerpo**, el único de los cuatro.

**La lista blanca por rol no siempre aplica, y se dijo en vez de fingirse**: en horarios los tres roles
del panel piden lo mismo, porque `ADMIN_OPERATIVO` es el piso del panel entero. La distinción sólo existe
contra `PROFESOR`/`ALUMNO`/sin proveedor, que piden cero. **Dos listas reales, no tres iguales
disfrazadas de tres casos** — montarlas habría sido el caso ciego.

## Estado final

|                   |                                                    |
| ----------------- | -------------------------------------------------- |
| `apps/web`        | **1253 tests / 57 suites**, tsc limpio, `build` OK |
| `apps/api`        | **1320 / 66**, eslint en cero — sin tocar          |
| E2E de la API     | **212 / 13**                                       |
| `packages/shared` | 103 / 4                                            |

De 971 tests en web al empezar la fase.

## Deuda anotada

**Nueva de esta fase:**

- **Tres campos muertos.** `Sala.exclusiva` y `Ausencia.recuperable` son **inertes**: están en los DTOs,
  el schema y el contrato, y ninguna regla los lee. **La franja horaria de una ausencia es peor**: un
  cierre de 18:00 a 20:00 **excluye el día entero**, porque los cuatro consumidores
  (`generacion-mes.service.ts:202`, `calendario.datos.ts:104`, `liquidacion.datos.ts:80` y
  `calcular-liquidacion.ts:32-38,87-93`) mapean sólo `{ salaId, desde, hasta }` y deciden con
  `fechaEnRango`. Hacer que los tres signifiquen algo es **negocio**, no pantalla.
- ✅ **Reactivar un horario dado de baja: ARREGLADO el 2026-10-16** (ver el apartado de abajo). El
  diagnóstico de aquí estaba a medias: `@IsOptional()` **ya dejaba pasar el `null`**; el único bloqueo
  era la línea del service. Y el problema de fondo no era el null, sino que **la baja destruye la
  vigencia original** y reactivar no puede adivinarla.
- ⚠️ **Un profesor SÍ puede tener vacaciones cargadas por la API**: `VacacionesService.crear` sólo
  comprueba que el perfil exista, sin mirar el rol — devuelve 201 y guarda la fila, que no hace nada
  (`planificarMes` cruza vacaciones sólo contra los `perfilId` con **rutinas** en la sala, y la ausencia
  de una profesora se gestiona con `HorarioProfesorAsignado`). **La restricción es del front**,
  documentada y con tres tests. Si algún día la API las honra, hay que borrar esos tests a mano.
- **El defecto de `repartirPorCampo`**, que ordena por longitud del nombre y manda el mensaje al campo
  equivocado. Arreglarlo es tocar `errores.ts`, del que cuelgan muchos specs.
- ✅ **El id de la profesora: ARREGLADO el 2026-10-16** (ver el apartado de abajo). Era un bug vivo de
  la Fase 8 con **tres** síntomas, no uno.
- **Los specs viejos siguen con su copia a mano** del andamiaje de hooks.
  `src/test/andamiaje-de-hooks.tsx` nació en la T1 (`montar`, `dobleDeFetch`, `dobleDe204`,
  `dobleQueFalla`, `llamada`, `cacheDeConsultas`) y lo usan los cuatro hooks nuevos; unificar los viejos
  no era de esta tarea — y cuatro copias más era exactamente lo que `src/test/mutaciones-sin-gctime.ts`
  condena por escrito.
- **`Seleccion` se importa desde `usuarios/[id]/controles.tsx`** en vez de estar en
  `componentes/formulario.tsx`. Su propio comentario invita a subirlo cuando una segunda pantalla lo
  pida —que es ahora—, pero mover un archivo del que cuelgan 56 specs no era de esta tarea.
- **`Record<string, unknown>` en los payloads de los hooks**: TypeScript no impide que una pantalla
  mande `tarifaPorHora: 1500`. **El test lo fija en el cable, no en el tipo.**
- **La tarifa acepta sólo `.` como separador**; `1500,50` se rechaza en pantalla. En Argentina la coma
  es lo natural: **falta decidir si se normaliza.**
- **`use-ausencias.spec.tsx` documenta un cuerpo que la aplicación ya no produce nunca**
  («`todoElDia: false` SÍ viaja: es un valor, no la ausencia de valor»). El hook es transporte genérico
  y lo que el test fija sigue siendo verdad; queda con un comentario que lo dice.

**Vieja, y sigue en pie:**

- **`use-rutinas.ts` no tiene un solo test**, con 3 mutaciones. El `gcTime` ya lo cubre el barrido.
- **Sobre-invalidación de `/mi-pack`** en `use-acciones-de-turno`: se invalida también al entrar y salir
  de la **lista de espera**, que no consume clases. Medido: 1 → 2 peticiones, en el teléfono del alumno.
- **El 403 de anotar le pone una ruta de API delante a quien está en el mostrador**: «Asignasela con
  `PATCH /usuarios/:id/salas`». Es `apps/api`.
- **El job de recordatorios es idempotente por gimnasio y no por persona.**
- **La rotación de la clave de cifrado.**
- **El contenedor `api` del compose está roto** por falta de `@nestjs/throttler`.
- **Las pantallas de profesor**, que siguen sin existir después de cinco fases.

## Siguiente paso

Quedan tres áreas y las pantallas que faltan:

- **Análisis** — los siete reportes de la 6A, que llevan **cuatro fases sin cara**. Es lo más viejo sin
  tocar.
- **Dinero** — 9 endpoints.
- **Configuración del gimnasio** — 14 endpoints, y son justamente **los valores que las salas heredan**:
  hoy la ficha de la sala dice «Hereda del gimnasio» y no hay dónde mirar qué dice el gimnasio.
- **Las pantallas del profesor.**

## El checklist a mano (para Cesar)

Cinco comprobaciones que **ningún test puede hacer** y que no se corrieron: no hay navegador en el
entorno. Se ejecutan en el panel, a mano.

- [ ] **Entrar como `ADMIN_OPERATIVO`** y comprobar que en **salas** (catálogo y ficha) y en **cierres**
      no hay **ningún** botón de escritura: ni alta, ni guardar, ni borrar, ni el interruptor de activa.
      En la ficha de la sala tiene que verse un `<dl>` de sólo lectura, no formularios apagados.
- [ ] **Ponerle un cupo propio a una sala**, guardarlo, **volver a «Hereda del gimnasio»** en uno de los
      tres que sí heredan (`minMinutosCancelar` es el bueno: ahí existen los tres estados de verdad), y
      comprobar que **el valor del gimnasio manda otra vez** — que el `null` explícito restauró la
      herencia y no dejó el valor viejo pegado.
- [ ] **Provocar los tres choques de horario** y leer los tres mensajes, que tienen que ser distintos:
      (a) otra profesora en la misma sala, día y hora; (b) la misma profesora en **otra** sala a la
      misma hora; (c) **el mismo horario repetido** en la misma sala. Y mirar que el panel «En esa
      franja ya hay» los anticipaba.
- [ ] **Intentar dar de baja una sala con turnos futuros**, por las **dos** puertas: el botón de Baja y
      el interruptor de **Activa**. Las dos tienen que dar el mismo 409 con el número de turnos.
- [ ] **Comprobar que no hay entradas del panel en `Cache Storage`** (DevTools → Application). El
      service worker es de la web pública; el panel no se cachea.

---

# Arreglo posterior — el id de la profesora (2026-10-16)

El primer punto de la deuda de la Fase 10, hecho. Salió de la T3, al verificar que `profesorId` es un
`perfilId`: **un solo error de concepto con tres síntomas**, y el que estaba anotado era el más leve.

| Síntoma | Qué pasa | Cómo se ve |
| --- | --- | --- |
| El filtro de `turnos/filtros.tsx` | Filtra la columna que referencia a `Perfil` con un id de usuario | **Nada.** Devuelve cero turnos, que parece un resultado legítimo |
| **Asignar suplencia** (`bloque-profesora.tsx`) | `exigirProfesoraConAccesoALaSala` hace `perfil.findFirst({where:{id}})` → **404 «Perfil inexistente»** | **El bloque entero de la Fase 9 nunca funcionó**, y el mensaje le dice al del mostrador que no existe un perfil que acaba de elegir de un desplegable |
| La opción fantasma | `faltaLaPuesta` compara `profesora.id` contra `puesta.id`, **cruzando los dos espacios** → siempre `true` | Toda profesora asignada aparece duplicada como «(dada de baja)», y el selector arranca en esa opción |

Verificado contra `schema.prisma:374`, `aTurnoPublico` (`turnos.service.ts:58`, que pone
`id: turno.profesorId` dentro de `profesor`) y `horarios-profesor.service.ts:307`.

El arreglo son dos líneas de valor más una comparación; el `useState(turno.profesor?.id ?? '')` **no
hubo que tocarlo**: una vez que las opciones llevan `perfilId`, la siembra ya casa.

**El barrido del resto de `apps/web` no encontró más sitios.** Lo demás ya estaba bien y lo documenta:
`admin/horarios/`, `bloque-anotados.tsx`, `bloque-vacaciones.tsx`, `bloque-dias-fijos.tsx` y
`calendario/plan.tsx`. En los 13 specs con fixtures de personas, `id` y `perfilId` nunca coinciden.

## La quinta forma de que un test no pueda fallar: el fixture habla el idioma del código

Las cuatro conocidas son: autorreferencial, premisa destruida, montado en el caso ciego, y verde por
casualidad ortográfica. **Ésta es nueva y es por el lado de la ENTRADA.**

El fixture daba `id: 'prof-1'` y `perfilId: 'p-prof-1'`, o sea que **los dos espacios sí estaban
separados** y el test podía distinguirlos. Pero el turno se sembraba así:

```tsx
unTurno({ profesor: { id: 'prof-4', nombreCompleto: 'Dani Rios' } })
```

`'prof-4'` es un id de **usuario** en el vocabulario de ese mismo fixture, y ahí el servidor manda un
`perfilId`. **El fixture se construyó desde la creencia del código en vez de desde el contrato**:
código y test de acuerdo, los dos equivocados respecto de la API. Ninguna aserción sobre un dato mal
sembrado puede delatar nada — el fixture no era evidencia independiente.

### Y la medición que lo cierra

Se midió la mutación «sembrar los dos ids iguales», con un matiz que corrige la predicción del
encargo. Mutar **sólo** la línea del fixture (`perfilId: \`p-${id}\`` → `perfilId: id`) hace caer 6
tests, **pero por desajuste de literales**: el fixture deja de ser coherente consigo mismo y
`'p-prof-2'` ya no existe como opción. Eso no mide el cruce de espacios, mide que se rompió el fixture.

La medición honesta es colapsar el fixture **y** ajustar las aserciones a ese valor, que es lo que
habría escrito quien lo construyera así desde el principio. Hecho eso y aplicado encima el bug
original: **10 tests en verde, los dos nuevos incluidos.**

**No es que ninguna aserción lo cace: es que ninguna aserción PUEDE cazarlo.** Una aserción compara
valores, y dos ids con el mismo valor no se distinguen comparando. La separación de los dos espacios
vive en el fixture y no hay otro sitio donde ponerla. Por eso no se "arregló" con un test —no tiene
arreglo por esa vía—: queda **medido y escrito en los dos fixtures**, diciendo que quien iguale esas
dos líneas no rompe ningún test, sino la capacidad de todos ellos de ver el bug.

## Un centinela que contradecía a su propio comentario

`turnos/page.spec.tsx` tenía **`ni el tenantId del turno, ni el de la sala, ni el perfilId de la
profesora`**, afirmando que el `perfilId` no llega al DOM. Con el arreglo **tiene** que llegar: es el
`value` del `<option>`. Y el comentario que encabeza esa misma lista ya decía lo contrario, por
escrito: «los ids de sala y de profesora SÍ están: son el `value` de sus `<option>`, y sin ellos el
filtro no podría escribir la URL».

Invertido: el centinela ahora es el **id de usuario**, que es el que no tiene nada que hacer en esa
pantalla, más un `toContain` del `perfilId` que fija la otra mitad.

## Tests, antes y después

**Nuevos (2):** «el filtro de profesora manda su perfilId en la URL, NO el id de su usuario» (no
existía nada que fijara ese `router.push`) y «una profesora activa y puesta NO aparece duplicada como
dada de baja» — **el caso sano, que es el que faltaba**: el test que había sólo montaba la profesora
dada de baja de verdad, donde la opción fantasma y la legítima son indistinguibles. Caso ciego, y se
confirmó midiendo: la mutación de `faltaLaPuesta` **no** hace caer ese test viejo.

**Cambiados de sentido**, todos endureciéndose y no aflojándose:

- «asignar una profesora manda su id» → «…manda su perfilId, NO el id de su usuario», con un
  `not.toEqual` del id de usuario.
- «la que ya esta puesta viene elegida en el selector» → «…por su perfilId», **y ahora afirma también
  el texto de la opción**, porque un `toHaveValue` solo pasaría igual apuntando a la opción fantasma.
- «una profesora dada de baja no se ofrece…»: fixture corregido más un `not.toContain` del id de
  usuario.
- En el spec de la lista, `id: 'p1'` → `id: 'usuario-de-ana'`: **`'p1'` parecía un perfilId y era un
  id de usuario.** El nombre de una variable de fixture también miente.

## Estado

| | |
| --- | --- |
| `apps/web` | **1255 tests / 57 suites**, tsc limpio |
| `apps/api` | 1320 / 66 — sin tocar |

---

# Arreglo posterior — reactivar un horario de profesora (2026-10-16)

El segundo punto de la deuda de la Fase 10. **Es el primer cambio en `apps/api` desde la Fase 9.**

## El hueco no era «el null no pasa»: era que la baja destruye la vigencia

`DELETE /horarios-profesor/:id` **da de baja Y ADEMÁS cierra la vigencia en hoy**, pisando `hasta`
cuando era `null` o futuro. Después de una baja, `hasta` es «hoy» (pisado) o una fecha pasada
(conservada), y **ya no hay forma de saber si ese horario era indefinido o terminaba en marzo**.

Por eso «Reactivar» **no podía ser un botón que mandara `{ activo: true, hasta: null }`**: eso *adivina*
que era indefinido y le borra el final a un horario que legítimamente lo tenía. Es la misma clase de
problema que la cancelación de la Fase 9 —una decisión cuyo costo lo paga otro— y se resolvió igual.

**El diseño que salió: se propone lo que sobrevivió y se pregunta lo que se destruyó.** `desde` no lo
toca el DELETE, así que viene puesto y editable —no es adivinar, es el dato que hay, a la vista— con un
párrafo que dice qué significa dejarlo: la vigencia vuelve a cubrir el hueco de la baja y **la
liquidación cuenta esas horas como contratadas**. `hasta` sí se destruyó: el desplegable arranca en
«Elegí si tiene fin», **sin valor**, y no elegir es un error, no un silencio.

Las tres claves **viajan siempre**, al revés que la edición, que manda sólo lo que cambió: el punto
entero es volver a declarar la vigencia, y omitir `hasta` dejaría puesto el que escribió la baja.

No se copió el interruptor de la ficha de sala: allí la baja no pierde nada.

## Tres cosas que el encargo afirmaba y eran falsas

1. ⚠️ **«El DTO declara `hasta?: string`, así que `null` no pasa la validación.» FALSO.** Verificado
   contra el `ValidationPipe` real con las opciones de `main.ts`: **`@IsOptional()` ya dejaba pasar
   `hasta: null`** y el whitelist conservaba la clave — `{"hasta": null}` llegaba entero al service. Es
   lo mismo que `ajuste-heredable.tsx` ya documentaba para `tarifaPorHora`. **El tipo es de compilación
   y el pipe no lo mira.** El único bloqueo real era el `dto.hasta ? … : existente.hasta` del service.
   El `@ValidateIf` se puso igual porque declara la intención, pero **en runtime es equivalente a
   `@IsOptional`**: no es el arreglo.
2. **«Actualizá el comentario que explica por qué el interruptor no estaba.» No existía.** Grep de
   `interruptor`/`activo`/`reactiv` en la pantalla, en el plan de la Fase 10 y en el README: la decisión
   no estaba escrita en ningún lado. Venía del informe de un agente, no del código. **Ahora sí está.**
3. **`'hasta' in dto` sí distinguiría hoy**: este repo no emite campos de clase, así que con la clave
   ausente la propiedad no existe en la instancia. Se compara contra `undefined` igual, porque eso no
   depende del tsconfig.

La condición final es `@ValidateIf((_o, v) => v !== null && v !== undefined)`: excluye también
`undefined` porque aquí hay **tres** estados, y con `v !== null` a secas un PATCH sin la clave daría 400.

## La mutación abierta 32: lo que el servicio escribe en la auditoría

`detalle: { ...dto, anterior: existente }` — «para poder deshacer una reactivación, dejemos en la
auditoría cómo estaba la fila». **Sobrevivió a todo**: 1335 unit, 218 e2e, eslint 0, tsc 0.

**El eje: el `detalle` del historial.** `historialFalso` era un mock que **ningún test de este archivo
interrogaba**, así que lo que las tres operaciones escriben en la auditoría estaba sin vigilar entero.
Y no es un canal inocente: `historial.service.ts` ya documenta para SMTP que «el historial es la otra
puerta por la que se escaparía, **porque lo lee el mismo admin por otra ruta**», y la fila de un
horario lleva `tenantId` y `tarifaPorHora`.

Cerrada con `toEqual` sobre el objeto entero —y no `not.toContain('tenantId')`, que depende de que
nadie renombre el campo— más centinelas de tenant y de dinero por si alguien relaja los `toEqual`.

## Dos huecos encontrados y NO arreglados

- ⚠️ **Un horario con `desde` futuro, dado de baja, queda con `hasta` anterior a `desde`.** `eliminar`
  escribe `hasta = hoy` sin compararlo con `desde`. A partir de ahí **cualquier PATCH que no reenvíe
  una de las dos fechas devuelve 400 «hasta no puede ser anterior a desde»**, aunque sólo venga a
  cambiar la tarifa. La pantalla de reactivar lo esquiva porque manda siempre las dos. Queda
  **documentado con un e2e que afirma el comportamiento actual** —no que sea correcto—, para que si
  alguien lo arregla en `eliminar` el test se caiga y lo obligue a mirar. No se tocó porque **cambiar
  el DELETE es cambiar la premisa de toda esta tarea**.
- **`PATRON_FECHA` acepta `2026-13-01`**, y quien lo rechaza es `desdeFechaISO` en el service con una
  `FechaInvalidaError` que nadie traduce → **500 opaco en vez de 400**. Es el mismo agujero que
  `consulta-rango.dto.ts` ya documenta para los otros diez DTOs con fechas. No es nuevo.

## Estado

| | antes | después |
| --- | --- | --- |
| `apps/api` unit | 1320 / 66 | **1339 / 67** |
| `apps/api` e2e | 212 / 13 | **218 / 13** |
| `apps/web` | 1255 / 57 | **1266 / 57** |
| `packages/shared` | 103 / 4 | 103 / 4 |

eslint de la API en cero, `tsc` limpio en los dos paquetes.

---

# Progreso Fase 11 — Análisis

**Spec:** `docs/superpowers/specs/2026-10-17-fase11-analisis.md`
**Plan:** `docs/superpowers/plans/2026-10-17-fase11-analisis.md` (7 tareas)

Los **seis reportes de `/stats`** de la 6A, que llevaban **cuatro fases terminados en la API y sin
ninguna forma de leerlos que no fuera un `curl`**. Cierra el área **Análisis**. **No se tocó un solo
endpoint.**

- [x] T1 — Los seis hooks (`use-stats.ts`)
- [x] T2 — El operativo: las cinco métricas del mes y el trimestre
- [x] T3 — La caja y la composición de alumnos
- [x] T4 — La asistencia, con pantalla y entrada propias
- [x] T5 — Pagos pendientes, **en la portada del panel**
- [x] T6 — Turnos libres, **en la ficha de la persona**
- [x] T7 — Verificación, README y tracker

**Y una corrección de arranque que arrastrábamos desde el resumen de la 6A: son SEIS endpoints, no
siete reportes.** `operativo` trae cinco porcentajes más el trimestre adentro, y de ahí salía la cuenta
vieja.

## Los errores de este plan

Los nueve, sin suavizar. Los encontraron los agentes **midiendo**, no acomodándose.

1. ⚠️ **`perfilId` no sirve para abrir la ficha de nadie.** La ruta es `/usuarios/[id]` →
   `GET /usuarios/:id`, que compara contra `actor.sub` (id de **Usuario**) y lee `datos.perfil.id`
   aparte. Con la respuesta de `pagos-pendientes` sola **no se puede enlazar a ninguna ficha**, así que
   mi test «cada fila lleva a la ficha de ESA persona» era **imposible tal cual**. Se resolvió con una
   segunda petición a `GET /usuarios` —el único sitio donde los dos ids viajan juntos—, contada en la
   lista blanca, con el fixture sembrando `id` ≠ `perfilId` y una aserción de que **ningún `href` usa
   el `perfilId`**. Sin eso las dos implementaciones eran indistinguibles.
2. ⚠️ **El mensaje de rango invertido de stats NO es el de los otros cinco módulos.**
   `/stats/asistencia` contesta **«El rango esta invertido: hasta es anterior a desde.»**
   (`stats.service.ts:763`); `hasta no puede ser anterior a desde` es el de `ausencias`, `vacaciones`,
   `rutinas`, `horarios-profesor` y `mi-calendario`. **Stats es el raro**, y queda anotado en el spec
   para que nadie lo «uniforme».
3. ⚠️ **El trimestre trae SIEMPRE tres meses.** Dije que un gimnasio nuevo devolvería un trimestre
   corto: `calcularOperativo` recorre `mesesAnteriores(anio, mes, 3)` **sin condiciones**
   (`stats.service.ts:375-380`). Un gimnasio nuevo recibe **tres meses con denominador cero**, o sea
   que ese caso **es** el caso del control de porcentaje y no uno aparte.
4. ⚠️ **`not.toContain('0%')` pasa sobre un `100%`.** Un test mío era verde **por casualidad
   ortográfica**. Todas las aserciones del cero pasaron a igualdad exacta sobre `[data-numero]`.
   (Es la cuarta forma de que un test no pueda fallar, y aquí mordió de verdad.)
5. ⚠️ **`navigator.sendBeacon` NO EXISTE en jsdom.** O sea que `navigator.sendBeacon?.(dato)` —la forma
   que escribe cualquiera con cuidado— **no revienta, no hace nada y pasa en verde**, mientras en el
   navegador manda la petición. **Eso no era cobertura: era un agujero con forma de código prudente.**
6. ⚠️ **`window.postMessage` es un ACCESOR PROPIO de `window`, no un método de prototipo.** Su
   descriptor trae `get`/`set` y no `value`, y `Object.getPrototypeOf(window)` es un `Object` pelado:
   se **redefine**, no se espía. Es la trampa de `performance` otra vez en otra forma. Y de paso:
   `postMessage(x, '*')` **no lo recibe «cualquier iframe o ventana abridora»** — despacha un `message`
   en **esta** ventana y se lo lleva cualquier script que comparta la página (analítica, chat
   embebido, content script de una extensión). El peligro es real; el mecanismo era otro.
7. ⚠️ **Vitest 3.2.7 no tiene una lista de relojes por defecto escrita** —la calcula en caliente en
   `FakeTimers#useFakeTimers`— **y su documentación miente sobre el `@default`**: dice «todo menos
   `nextTick`» y también quita `queueMicrotask`. Además el tipo `FakeMethod` **no incluye `'Intl'`**
   aunque el runner sí lo falsea: hizo falta un cast documentado. **El tipo va por detrás del
   runtime.**
8. ⚠️ **«React y el runner emiten sus propias marcas de rendimiento»: FALSO hoy.** Medido con una sonda
   sobre los 58 archivos: **cero marcas y cero medidas**, con React 19.1 y Vitest 3.2. La forma de
   `window.name` («no hay ninguna marca») habría sido verde hoy mismo. Se mantuvo la forma de los
   almacenes igual, pero por dos razones que sí aguantan: ese verde **no depende de nosotros** y
   **medir latencia es legítimo**.
9. ⚠️ **La hipótesis de la T6 era falsa, y medirla fue el hallazgo.** El plan decía que los turnos
   libres debían alimentar los destinos del reasignar de la Fase 9. **Pierde información**:
   `TurnoLibre` no trae el nombre del turno, y con los destinos acotados a una sala `salaNombre` es
   constante — el cambio daría «18:00 · Pilates (7/10)» ocho veces donde hoy dice `Flow`. Y la
   ocupación escrita, que es lo único que ganaría, **ya la tiene**.

**Y dos más del mismo linaje, que se encontraron a sí mismos:** los primeros fijos de la T1 sembraban
**recortes que la API no puede devolver** («pedí 24 meses, me devolvió 1») y **pasaban los 30 tests**;
y el portapapeles resultó tener **dos** sitios legítimos y no uno (`usuarios/nuevo/clave-temporal.tsx`
y `invitaciones/page.tsx:39`), los dos con centinelas registrados.

## Las mutaciones abiertas 33 a 38: seis de seis, y van 38 de 38

| #   | Qué se agregó                                    | El eje que nadie auditaba                                                      |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| 33  | `performance.mark` con el margen y el rango      | **el búfer de User Timing** — sobrevivió los **1296**                          |
| 34  | `new Image().src` con el volcado del operativo   | **una petición de red que no pasa por `fetch`** — **1326**                     |
| 35  | `window.postMessage` con la caja                 | **una puerta de salida que no es `fetch` ni el DOM** — **1352**                |
| 36  | `caches.open(…).put(…)` con la asistencia        | **CacheStorage: dos puertas al mismo almacén, una sola custodiada** — **1375** |
| 37  | `requestIdleCallback(() => console.info(…))`     | **no es un canal: es un reloj que apaga los otros nueve** — **1409**           |
| 38  | `navigator.serviceWorker.controller.postMessage` | **el hilo que sobrevive a la pestaña** — **1421**                              |

**La 33 parece instrumentación de latencia.** El búfer lo lee cualquier script de la página con una
línea, sobrevive a toda la navegación de la SPA, sale entero en cualquier volcado de rendimiento o
traza compartida con soporte, y **las SDK de RUM se llevan los user timings por defecto** — igual que
pasó con `document.title`, sin que nadie lo decida.

**La 34 sale sin `fetch` y sin DOM.** El test de «no habla con la red por fuera de `pedir`» dobla el
**`fetch` global**, y una imagen no lo usa; y la imagen **nunca se adjunta al documento**, así que no
la ven el `body`, el `<head>`, la consola, el título, `window.name`, los tres almacenes, el búfer de
User Timing ni las dos cachés. Sale igual —con la cookie si comparte dominio— y la URL entera queda en
el registro de acceso del otro lado.

**La 36 es la más grave, y no por la mutación: el repo YA TIENE esa política escrita, y del otro
lado.** `apps/web/src/app/sw.ts` dice literalmente que el panel del admin no entra nunca en la
CacheStorage —«un listado de gente con nombres, emails y teléfonos quedaría en la CacheStorage del
navegador del mostrador, que es una computadora compartida, legible por quien se siente después»— y lo
cumple con una lista blanca de dos rutas del alumno. **Hay dos puertas al mismo almacén y la política
sólo custodiaba una**: una pantalla puede escribir ahí por su cuenta sin pasar por el service worker, y
ese almacén **sobrevive al cierre de sesión, al de la pestaña y al reinicio**. Es la misma forma que el
`gcTime` de la Fase 7: una decisión tomada, escrita, y custodiada en un solo camino.

**La 37 no es un canal y ésa es toda la lección** (ver abajo).

**La 38 es la asimetría inversa del noveno canal.** Aquél cerró «la página escribe en el almacén del
worker sin pasar por su lista blanca»; éste cierra «la página le pasa el dato al worker y el `caches`
que vigilamos ya no lo ve». Eje nuevo por **tres razones medidas**: jsdom no implementa
`navigator.serviceWorker`; **no es ninguno de los dos `postMessage` ya vigilados** —el tapón dobla el de
`window`, que es propiedad propia, y el de `BroadcastChannel.prototype`; el del worker vive en
`ServiceWorker.prototype`—; y **acá hay un service worker de verdad** (`sw.ts` + `@serwist/next` +
`boton-de-push.tsx`), así que `controller` no es `null` en el mostrador: es un hilo que sobrevive a la
pestaña y puede hacer `fetch` y `caches.put` con lo que reciba.

## Los cinco canales globales nuevos, y el porqué de cada decisión de forma

`document.head` y los tres almacenes venían de la Fase 10 (canales cuarto y quinto). Esta fase sumó
cinco más, todos en `vitest.setup.ts` / `src/test/espia-de-consola.ts`, y todos **como dimensión y no
como caso**: suben al tapón global para que los hereden los 64 archivos, en vez de que cada pantalla se
acuerde de pedirlos — y la que no se acuerde es justamente la que lo va a necesitar.

**6. El búfer de User Timing (`mark` y `measure`).** Dos mecanismos y los dos hacen falta, medido: el
búfer solo no alcanza porque `clearMarks()` es API pública y marcar-y-limpiar no deja rastro (el
`setItem` + `removeItem` de los almacenes otra vez); el espía solo no alcanza porque una marca puesta
en el cuerpo de un módulo **ya está en el búfer antes de que el espía exista**. Cubre **el `detail`**
de las dos, que no estaba en el encargo: el segundo argumento se guarda dentro de la entrada y sale en
su `toJSON()` — un nombre inocente con el secreto en el `detail` es la fuga más silenciosa de las tres.

**7. El `src` de una imagen.** Se midió que **React 19 pasa por el accesor `src` también al pintar un
`<img>` de JSX**, no sólo por `setAttribute`, así que un `<img>` escondido en el árbol cae por el mismo
sitio. Vigila las dos mitades: lo asignado al accesor y lo que queda en el documento.

**8. Las salidas laterales.** Tres puertas: `window.postMessage`, `BroadcastChannel.prototype
.postMessage` y `navigator.sendBeacon` (URL **y** cuerpo, incluido el cuerpo `Blob`, que es la forma de
los docs). El tapón **define** `sendBeacon`, que jsdom no tiene, con el precio escrito: la detección de
capacidades ve una baliza que el entorno no implementa. Y el reenganche por test hace falta de verdad:
las mutaciones hacen caer **los 18 tests del spec y no sólo el primero**, porque ese spec llama a
`vi.restoreAllMocks()` en su `afterEach` y el `BroadcastChannel` va con `vi.spyOn`.

**9. CacheStorage.** Afirma por centinelas **y** por «no se guardó nada», como los tres almacenes.

**10. El service worker.** Tres puertas: `controller`, `ready.active` y `register`.

**La forma: por centinelas y no por prohibición, en los cinco.** No se puede afirmar «no hay ninguna
marca» (React instrumenta con `performance.measure` en sus pistas y basta una versión), ni «ninguna
imagen» (la portada de un gimnasio pinta su logo con una URL externa arbitraria), ni «ningún mensaje al
worker» (lo hace el botón de push). **Un canal que prohíba algo legítimo es un canal que alguien
desactiva**, y entonces no vigila nada. La asimetría con el `<head>` —que sí tiene segunda mitad, «no
crecieron los nodos»— es que meter un `<meta>` en el `<head>` **en esta app no es legítimo nunca**.

**El informe nombra la clave y jamás el valor.** Contado sobre informes reales: en el sexto canal
`6666.66` sale **cero** veces y `margenDelSalon` siete; en el octavo, `claveDelAlta` veinte veces y
`Temp0ral!` **cero**. El nodo que el tapón existe para cazar es justamente el que lleva el dato, y
copiarlo al registro de CI es el mismo modo de fallo que el espía de la consola evita. En el sexto no
se imprime **ni el nombre de la marca**, aunque daría contexto: el nombre es donde vive la fuga, y
redactarlo sería una lista negra que publicaría el dato que nadie registró.

**El coste asumido y escrito**, en los cinco: un dato **no registrado** como centinela pasa en verde.
El canal es tan bueno como los centinelas de cada spec.

**El portapapeles queda SIN vigilar, a conciencia**, y el motivo de peso no es el que anticipé
(«sería rojo con el código correcto»). Es que **no se puede ver desde el tapón**: los tres specs que lo
ejercitan le ponen el doble con `Object.defineProperty(navigator, 'clipboard', …)` —propiedad
**propia**— **dentro del cuerpo del test**, donde ningún `beforeEach` llega. Sonda: el doble del tapón
registró **0** escrituras. Sería **verde y ciego justo en los tres sitios donde el canal se usa**, y
«funcionando» en los 61 donde no se puede usar. El agujero queda escrito en `espia-de-consola.ts` con
su exploit literal —`await navigator.clipboard?.writeText(dato)` dentro de un `try/catch` pasa en
verde— para que nadie lo descubra creyendo que esto lo tapaba. Se tapa el día que el portapapeles se
monte una vez para todo el paquete desde el tapón.

**Vecinos descartados con motivo**: `MessagePort`/`MessageChannel` (tubo punto a punto, sólo alcanza a
quien tenga el otro puerto, que uno mismo crea y guarda), `Worker` (no existe en jsdom), `window.opener`
(`undefined` en jsdom, y `parent`/`top` ya caen por el enganche de `window`).

## El montaje de `requestIdleCallback` y el guardián de los relojes

**El punto ciego de los relojes (cerrado).** `vi.useFakeTimers()` **sin `toFake` sustituye el objeto
`performance` global entero** por el falso de sinon, que acepta `mark()` y no guarda nada: ni el espía
(quedó colgado del objeto de verdad) ni el búfer (la marca nunca llegó). **Tres specs ciegos.** El
arreglo no fue parchear los tres sino `test.fakeTimers.toFake` en `vitest.config.ts`, con la lista en
`src/test/relojes-falsos.ts` y su procedencia escrita: **el próximo `vi.useFakeTimers()` nace
cubierto**, que es lo que no pasó con el `gcTime` en la Fase 7.

| Sitio                              | ANTES            | DESPUÉS     |
| ---------------------------------- | ---------------- | ----------- |
| `ausencias/page.spec.tsx:1172`     | **pasa** (ciego) | **cae**     |
| `usuarios/[id]/page.spec.tsx:1805` | **pasa** (ciego) | **cae**     |
| `use-calendario-admin.spec.tsx:36` | 23/23 (ciego)    | **11 caen** |

Con **control de que la sonda se ejecuta de verdad**: con la misma sonda puesta, un test del mismo
archivo que corre con relojes reales sí cae. Sin ese control, «antes no caía» no probaría nada. (Y la
ventana congelada de `usuarios/[id]:1805` **está vacía**: ese test monta antes de falsear el reloj y
durante los cinco minutos no corre ni una línea de producción — ahí el agujero era **latente**, no
alcanzable hoy.)

**La pieza que lo hace durar: `relojes-falsos.spec.ts`, un guardián que MIDE en vez de comparar contra
otra lista escrita a mano.** Calcula en ejecución el conjunto por defecto de Vitest y el nuestro, y
exige que la única diferencia sea `performance`. El día que Vitest agregue un reloj, el test **lo
nombra**.

**Y se pagó solo en la T5.** Montar `requestIdleCallback` en el global hizo que sinon lo encontrara,
entró en lo que falsea un `vi.useFakeTimers()` desnudo, y el guardián **se puso rojo al instante**. Al
medirlo apareció una asimetría: **sinon sustituye `requestIdleCallback` y NO `cancelIdleCallback`**, al
revés que `setTimeout`/`clearTimeout` y `requestAnimationFrame`/`cancelAnimationFrame`. La lista lleva
uno y no la pareja, con el porqué escrito: con relojes falsos, cancelar un rato libre no lo cancela —
lo cual, para lo que el tapón existe, **cae del lado seguro**.

**El montaje, no la prohibición.** `requestIdleCallback` se cerró con `montarElRatoLibre()`
(`src/test/rato-libre.ts`): lo aplazado corre dentro del test y los nueve tapones lo ven solos, **sin
que ninguna pantalla tenga que saber que existe**. Aplazar trabajo caro es legítimo, y el propio
archivo del espía razona que un canal que obliga a escribir el código bueno de una forma concreta es el
que alguien desactiva. Reaplicada la mutación: caen 18 de 28, y **el test que la mata no es uno propio
sino el tapón global de la consola**.

## Dos lecciones generales, que es lo más transferible de la fase

**1. Una API que jsdom no implementa es un sitio donde nadie mira por construcción.** El `?.` que
escribe alguien con cuidado convierte **la ausencia del entorno de test en un silencio**: el código
prudente pasa en verde y en el navegador hace la fuga entera. **Cuatro de las seis fugas de esta fase
pasaron por ahí** — `sendBeacon`, `globalThis.caches`, `requestIdleCallback` y
`navigator.serviceWorker`. No es un descuido de quien escribió el `?.`: es la forma correcta de
escribirlo, y por eso la defensa tiene que estar en el tapón y no en la revisión.

**2. No todo es un canal: `requestIdleCallback` era un reloj que apagaba los otros nueve.** Medido:

```
console.info('[pagos-pendientes]', datos)       → caen 28 de 28
window.requestIdleCallback?.(() => lo mismo)    → pasan 28 de 28
```

**Mismo dato, mismo canal ya vigilado, y la diferencia entera era el envoltorio.** Los nueve tapones
corren en un `afterEach`; lo que se esconde detrás de una API que jsdom no implementa ocurre
**después** del test. Antes de escribir el décimo canal hay que preguntarse si lo que se encontró es
una salida nueva o **un aplazamiento de una salida vieja**.

## La regla del fixture: incoherente en lo derivado, posible en todo lo demás

**Es la quinta forma de que un test no pueda fallar, y gobernó la fase entera.** Los seis contratos
están llenos de campos derivados —`porcentaje` contra `numerador`/`denominador`, `margen` contra sus
sumandos, `texto` contra `centavos`, `mesesAdelante` y `hasta` que vuelven recortados— y **un fixture
coherente los vuelve a todos indistinguibles**: con `{ numerador: 3, denominador: 4, porcentaje: 75 }`
ningún test puede decir cuál de los dos pinta la pantalla; con `99`, sí. Un fixture incoherente no es un
fixture sucio: **es el único que prueba algo**, y es por el lado de la **entrada** — ninguna aserción
sobre un dato mal sembrado puede delatar nada.

**Pero la mitad que faltaba la descubrió la T1 fallando:** sus primeros fijos sembraban recortes que la
API **no puede devolver** y pasaban los 30 tests. Era un fixture que no hablaba **ni** el idioma del
código **ni** el del contrato: distinguía argumento de respuesta, que era para lo que estaba, pero
describía un servidor que no existe. Corregidos a los recortes reales (24 → 12; y 2026-03-01→2028-12-31
que vuelve 2027-03-01, 366 días contando el primero).

→ **La regla completa: incoherente en lo derivado Y posible en todo lo demás.**

## Trampas nuevas

**Una API que jsdom no implementa no falla: calla.** Ya está arriba, pero es la que hay que recordar.

**`performance` y `window.postMessage` no son métodos de prototipo.** El primero lo sustituye entero
`vi.useFakeTimers()`; el segundo es un **accesor propio** de `window`, con `get`/`set` y sin `value`.
Los dos se redefinen; ninguno se espía.

**`not.toContain('0%')` pasa sobre un `100%`.** La prohibición ancha por subcadena sólo sirve cuando la
raíz no es subcadena de nada legítimo — ahí sí es la correcta: el test de pagos pendientes prohíbe la
raíz **`deud`** sobre el HTML en minúsculas y caza de un golpe «Deuda», «DEUDA», «adeuda» y «deudor»,
con la premisa afirmada antes para que una pantalla en blanco no pase.

**Un `<select>` en «todas las salas» manda `''`, no `undefined`.** `salaId: ''` y `salaId: undefined`
se normalizan a la **misma clave** en el mismo sitio donde se decide si el parámetro viaja. Un
`salaId ?? null` habría dado **dos claves para una sola petición**, y `''` es el caso común.

**El cero que viaja y el cero que no.** `mesesAdelante: 0` se compara contra `undefined` y **viaja**: el
cero es un 400 explícito del `@Min(1)`, y borrarlo le devolvería a quien pidió cero **el reporte por
defecto de 12 meses como si fuera su respuesta**. En cambio la mutación del `||` de la T1 no la caza el
caso de enero (`mes: 1` pasa igual por un `if (m.mes)`): **la mata el `mes: 0`**.

**Un filtro en la URL dentro de la ficha de la persona rompe dos cosas en silencio.** La ficha declara
`SIN_QUERY` y no monta frontera de Suspense; meter el filtro de sala en la URL rompería las dos, y
**`next build` fallaría con `missing-suspense-with-csr-bailout` lejos del archivo**. Por eso el filtro
del bloque de turnos libres vive en `useState`. (Prima hermana de la trampa de la Fase 10: el `export`
de más en un `page.tsx`.)

**Juntar dos tests para que la mutación no pueda matar sólo la mitad que no importa.** Con «lista
vacía» y «fallo al leer» en specs separados, una mutación del bloque de turnos libres tiraba **sólo el
del fallo** y el otro pasaba en verde. Se juntaron en un test que afirma que **no se ven igual**.

**Hay filtro cliente aunque el service ya filtre.** El bloque descarta `libres > 0` por su cuenta
porque **lo que la pantalla afirma es más fuerte que lo que el endpoint promete**, y entremedio hay un
caché de 5 minutos.

**Un chequeo de rol que la API no hace no se inventa en la pantalla.** El bloque de turnos libres **no
tiene puerta de rol ni filtra por `rol === 'ALUMNO'`**: se buscó ese chequeo en `reservas.service.ts` y
**no existe**. Esconderlo en la ficha de una profesora sería inventar una regla que la API no tiene.

**Un hook que no está montado no pide nada.** La lista blanca de la ficha **no cambió, a propósito**:
el reporte de turnos libres se pide **al abrir el bloque**, siguiendo el patrón de `FormularioDeAnotar`.
Dientes comprobados.

**`rutasPedidas()` ordena alfabéticamente.** Con tres reportes, React corre los efectos de los hijos
antes que los del padre (caja → composición → operativo). Fijar ese orden haría que **mover un bloque
rompiera tests sin que cambie nada para quien mira**. Lo que la lista blanca fija es _qué_ y _cuántas
veces_, y **sigue sin deduplicar**.

**`doblePorRuta` local en el spec de los hooks.** El andamiaje no da un doble que conteste distinto
según la ruta, y sin eso «cada reporte tiene su propia clave» **no puede ver una colisión**: seis copias
del mismo dato se ven igual estén donde estén. Caso ciego evitado.

**Un formulario con botón, no navegación en cada `onChange`.** Un mes es un valor; un rango son dos y
se teclean. Navegar por tecla manda peticiones de rangos que nadie pidió (`2026-0`), llena el historial
y **entre el `desde` nuevo y el `hasta` nuevo hay un instante con el rango invertido**: la pantalla
mostraría un error que nadie pidió ver.

**No recortar en el cliente, por una razón de test.** Si la asistencia recortara a 366 días en la
pantalla, el `hasta` pedido y el devuelto **coincidirían siempre** y el aviso de recorte **nunca podría
dispararse**. Y el fixture por defecto **ya viene recortado**, no sólo el del test del recorte, para que
caiga **cualquier** test que pinte el `hasta` equivocado.

## Estado final

|                   |                                                    |
| ----------------- | -------------------------------------------------- |
| `apps/web`        | **1421 tests / 64 suites**, tsc limpio, `build` OK |
| `apps/api`        | **1339 / 67**, eslint en cero — sin tocar          |
| E2E de la API     | **218 / 13** — ver abajo                           |
| `packages/shared` | 103 / 4                                            |

De 1266 tests en web al empezar la fase: **+155**, repartidos T1 +30, el guardián de relojes +3, T2
+27, T3 +26, T4 +23, T5 +34, T6 +12.

⚠️ **Los e2e de la API NO se volvieron a correr en este cierre**: el demonio de Docker no estaba
levantado y necesitan `postgres-test`. El 218 / 13 es el de la última corrida; **esta fase no tocó
`apps/api` ni `packages/shared`**, y el `tsc`, los 1339 unitarios y el eslint de la API sí se midieron
y están en verde.

## Deuda anotada

**Nueva de esta fase:**

- ⚠️ **`centavos: 0` significa TRES cosas y no se distinguen desde la respuesta.** `pendientesDe` pone
  cero cuando `precioPack === null`, que es a la vez «pack a consultar» y «pack borrado» — y **un pack
  que cueste cero da el mismo cero**. Y un «0.00» al lado de un nombre, **en la pantalla desde la que
  se llama por teléfono**, se lee «no debés nada» justo a quien está ahí por no tener pago vigente. Hay
  un aviso por fila redactado para ser verdad en los tres casos, pero **arreglarlo de verdad necesita
  el endpoint**.
- **El nombre del pack colapsa tres casos en la composición.**
  `packId === null ? SIN_PACK : (packs.get(packId)?.nombre ?? SIN_PACK)`: «Sin pack» significa a la vez
  **sin plan**, **pack borrado** y **un pack real llamado justamente «Sin pack»**. (En pagos pendientes
  **no** se repite: `perfilesConPack()` filtra `packId: { not: null }`, así que ahí `packNombre: null`
  significa exactamente «su pack ya no está en la tabla», y la pantalla se ramifica por `=== null` y
  nunca por el texto.)
- ⚠️ **`PanelDeReasignar` ofrece como destino turnos PASADOS y LLENOS.** Llama a
  `useTurnos({ salaId })` **sin filtro de fecha**. Encontrado en la T6 y **no arreglado**: el arreglo
  no es este reporte sino pasarle `soloLibres: true` y un `desde`, que `GET /turnos` ya acepta y que
  **conserva el nombre de la clase**. Toca comportamiento de la Fase 9.
- **El portapapeles sigue sin vigilar**, con su exploit escrito en `espia-de-consola.ts`. Se tapa el
  día que se monte una vez para todo el paquete desde el tapón.
- **El cuerpo de las respuestas de CacheStorage no se mira**: `Response.text()` es asíncrono y `put()`
  se registra en el acto. Mientras la afirmación sea «no se guardó nada», el cuerpo no llega a existir
  — el día que haya una excepción legítima, sí.
- **`textoDeCentavos` duplica el `aTexto` de la API.** Es copia deliberada (aritmética entera), y no se
  puede importar sin tocar `packages/shared`.
- **Los doce nombres de mes están duplicados** desde `calendario/selectores.tsx`, que es un
  `'use client'` del que no se puede importar una constante sin arrastrarlo entero.

**Vieja, y sigue en pie:**

- **`use-rutinas.ts` no tiene un solo test**, con 3 mutaciones.
- **Sobre-invalidación de `/mi-pack`** en `use-acciones-de-turno`: se invalida también al entrar y salir
  de la lista de espera, que no consume clases. Medido: 1 → 2 peticiones, en el teléfono del alumno.
- **El 403 de anotar le pone una ruta de API delante a quien está en el mostrador**: «Asignasela con
  `PATCH /usuarios/:id/salas`». Es `apps/api`.
- **El job de recordatorios es idempotente por gimnasio y no por persona.**
- **La rotación de la clave de cifrado.**
- **El contenedor `api` del compose está roto** por falta de `@nestjs/throttler`.
- **Los tres campos muertos** (`Sala.exclusiva`, `Ausencia.recuperable` y la franja horaria de una
  ausencia, que **excluye el día entero**).
- **Las pantallas de profesor**, que siguen sin existir **después de siete fases**.

## Siguiente paso

Quedan dos áreas y las pantallas que faltan:

- **Dinero** — packs, pagos y comprobantes desde el panel.
- **Configuración del gimnasio**, que es **la contrapartida de la Fase 10**: hoy la ficha de la sala
  dice «Hereda del gimnasio» y **no hay dónde mirar qué dice el gimnasio**.
- **Las pantallas del profesor.**

### El inventario, rehecho el 2026-10-19 — y los números viejos eran correctos

Se cruzaron las **97 rutas** de los controllers contra lo que `apps/web` pide de verdad. **Quedan 26
endpoints sin pantalla**, en tres áreas:

| Área | Endpoints | Desglose |
| --- | --- | --- |
| **Configuración del gimnasio** | **14** | web pública 6, email 4, check-in QR 3, jobs 1 |
| **Dinero** | **9** | pagos 3, packs 3, comprobantes 2, liquidación 1 |
| **Pantallas del profesor** | **3** | `mis-clases`: listado, alumnos de una clase, pasar lista |

**O sea que los conteos que veníamos arrastrando de la 6A eran exactos.** Lo que estaba mal era una
cuenta cruda por módulo que hice al vuelo —«packs tiene 5, no 3»— que contaba **todos** los endpoints
del módulo en vez de **los que no tienen pantalla**: de los 5 de packs, 2 ya se consumen como
catálogo. La sospecha de que el inventario estaba desactualizado era mía y era infundada.

⚠️ **Tres cosas que parecen huecos y no lo son**, por si alguien repite el cruce:

- **Los 7 de `auth`** no pasan por `pedir`: van por los route handlers de Next (`/api/auth/login`) y
  por `lib/sesion.ts`.
- **`GET /calendario/:salaId/:anio/:mes/conflictos` NO se pide a propósito**, y está escrito en
  `use-calendario-admin.ts`: devuelve exactamente `plan.conflictos`, que ya viene dentro de la otra
  respuesta. Una segunda petición sería pedir dos veces lo mismo.
- **Los 2 de `archivos-locales`** son URLs firmadas que **genera la propia API** (`almacen-local.ts`)
  y que el navegador abre como archivo, no desde el cliente de peticiones.

Y dos trampas del cruce automático, para quien lo rehaga: **un archivo puede tener varios
`@Controller`** (`reservas.controller.ts` tiene dos: `turnos/:turnoId/reservas` y `reservas`), y
**muchas rutas se arman en un helper** (`` pedir(`${base(mes)}/publicar`) ``), así que un `grep` del
literal las da por no consumidas.

## El checklist a mano (para Cesar)

Seis comprobaciones que **ningún test puede hacer** y que no se corrieron: no hay navegador en el
entorno. Se ejecutan en el panel, a mano.

- [ ] **Entrar como `ADMIN_OPERATIVO`** y comprobar en `/analisis` que **la caja no está en el
      marcado** —no escondida con CSS— y que **no se pide**: la pestaña de red no debe mostrar ninguna
      llamada a `/stats/caja`.
- [ ] **Mirar un mes sin turnos** y comprobar que la ocupación **no dice `0%`**: tiene que decir
      `Sin datos` con la fracción al lado.
- [ ] **Mirar a un alumno al que nunca se le pasó lista** en `/analisis/asistencia` y comprobar que
      **no dice 0% de asistencia**, sino que no tiene clases con lista pasada.
- [ ] **Pedir 24 meses de turnos libres** desde la ficha de una persona y comprobar que la pantalla
      **dice que miró 12**.
- [ ] **Registrar un pago** y volver a `/analisis`: la caja **tiene que moverse** (el caché se invalida
      por escritura). **Si no se mueve, es un hallazgo.**
- [ ] **Abrir el panel en la máquina del mostrador** y comprobar en DevTools → Application que **no hay
      nada del panel en Cache Storage**.

# Progreso Fase 12 — La configuración del gimnasio

**Spec:** `docs/superpowers/specs/2026-10-19-fase12-configuracion.md`
**Plan:** `docs/superpowers/plans/2026-10-19-fase12-configuracion.md` (7 tareas)

Los **14 endpoints de configuración**, **todos `ADMIN_SALON`**, que hasta hoy sólo se operaban por
`curl`. **No se tocó un solo endpoint.** Y cierra una promesa que estaba en producción: **la ficha de
la sala de la Fase 10 dice «Hereda del gimnasio» y no había dónde mirar qué dice el gimnasio.**

- [x] T1 — Los hooks de las cuatro áreas (`use-configuracion.ts`) · 1421 → 1481
- [x] T2 — El índice, la puerta de rol y el health-check · 1481 → 1496
- [x] T3 — El check-in por QR · 1494 → 1509 _(los 2 que faltan entre 1496 y 1494 los quita el canal
      doce al subir a global: la copia local que reemplaza era 2 tests duplicados)_
- [x] T4 — La web pública, con testimonios y FAQ · 1509 → 1537
- [x] T5 — El SMTP · 1537 → 1561
- [x] T6 — Las plantillas de email · 1561 → 1572
- [x] T7 — Verificación, erratas, README y tracker

Y **seis piezas de infraestructura de tests**, que es la mitad del valor de la fase: **tres canales
globales nuevos** (el once, el doce y el trece), **un eje nuevo** (el quince) y **dos mutaciones
abiertas reportadas y no cerradas**.

## Los errores de este plan

Sin suavizar. Los encontraron los agentes **midiendo**, no acomodándose.

1. ⚠️ **No eran «siete lecturas y siete escrituras»: son CINCO y NUEVE.** Los 14 endpoints estaban
   bien; el reparto, no. Las cinco lecturas incluyen **la imagen del QR**, que no pasa por `pedir`.
   Importa porque **cada escritura es un `gcTime: 0` y una decisión de invalidación**.
   **Y el recuento de la T1 también nació mal, encontrado al cerrar:** su propio docblock decía «dos
   de las nueve no tienen nada que invalidar» cuando es **UNA** (`useEncolarHealthCheck`: ocho
   `onSuccess` y un `useMutation` sin él, contados), y decía «las **SEIS** escrituras de la web»
   cuando son **CINCO** — las seis son las **rutas** del `@Controller('config/web-salon')`, y una de
   las seis es el `GET`. **Los dos números quedaron corregidos en el archivo.**
2. ⚠️ **`ConfigCheckInController` NO TIENE ARCHIVO PROPIO.** Es el **segundo `@Controller`** dentro de
   `apps/api/src/checkin/checkin.controller.ts`, debajo de `CheckinController`. Buscar
   `config-checkin.controller.ts` no da nada. **Es exactamente la misma trampa que
   `reservas.controller.ts`**, que ya había mordido al rehacer el inventario de endpoints de la
   Fase 11 — y está anotada ahí, al final de aquel bloque, y volvió a morder igual.
3. ⚠️ **El POST del FAQ es `/config/web-salon/faq`**, aunque el contrato y el service las llamen
   `preguntas`. **Deducir la ruta del nombre del tipo es un 404.** (Y un 404 en esta fase se dibuja
   como dato vacío, que es la trampa de la Fase 10.)
4. ⚠️ **Un test que pedí NO PODÍA FALLAR.** «El índice no le pide NADA a un operativo», sola, está
   **montada en el caso ciego**: este índice no tiene **ninguna** consulta —los cuatro recursos viven
   en las pantallas de las tareas 3 a 6—, así que tampoco pide nada siendo `ADMIN_SALON`. Se resolvió
   sin inventar un endpoint: el test **pulsa todo botón del marcado crudo** con `fireEvent`, que
   dispara sobre lo oculto, y **recién después** afirma que `pedir` no se llamó — **las dos
   afirmaciones en ese orden a propósito**, porque con la del marcado delante el test abortaría ahí y
   la mitad de «no pide» no se ejercitaría nunca.
5. ⚠️ **`mostrarPrecios` y `seguro` vienen en `true` por defecto.** `WEB_SALON_POR_DEFECTO.mostrarPrecios`
   es `true` y `guardar()` hace `dto.mostrarPrecios ?? ese_defecto`; `seguro` es `@IsOptional()` en el
   DTO y `dto.seguro ?? true` en el service. O sea que el reflejo natural —«los opcionales se omiten
   cuando están vacíos»— **publica los precios de un gimnasio que los tenía ocultos** y **le enciende
   el TLS a uno que corría sin cifrar**, sin que nadie haya tocado nada. Y hay dos más del mismo
   linaje: omitir `activa` (defecto `false`) **despublica el sitio**, y el service hace
   `emailDestino: dto.emailDestino ?? null`, así que omitirlo **borra** la dirección de respuesta.
   Por eso los cinco booleanos de la web y el `seguro` del SMTP **viajan siempre con su valor**, con
   test propio.
6. ⚠️ **`ESPERADO_POR_ROL` de `armazon.spec.tsx` eran TRES REFERENCIAS AL MISMO ARREGLO.** El `it.each`
   que «barre los tres roles» **afirmaba tres veces lo mismo**, y lo único medido de `enlacesPara` era
   la dirección de la lista vacía (`ALUMNO`, `PROFESOR`). **Que un rol que SÍ entra vea MENOS que otro
   no había pasado nunca**, porque las once entradas del panel pedían `ADMIN_OPERATIVO`: esta fase
   estrena esa dirección con **la primera entrada `ADMIN_SALON`**. Arreglado con las dos piezas
   escritas a mano y **las dos mitades en el mismo test**: por separado, la primera pasaría con la
   entrada borrada y la segunda con un `minimo: 'ADMIN_OPERATIVO'`; lo que se fija es **la diferencia**.
7. ⚠️ **«Diez canales globales» eran once al empezar la T2 y son trece al cerrar.** Y el plan
   describía **cuatro pantallas**: quedaron **tres más el botón de health-check en el índice**, porque
   encolar un ping es una acción de operación y **una página entera para un botón es peor que la
   alternativa**. Las tres erratas quedaron corregidas en la spec y en el plan, con nota de que se
   corrigieron al cerrar.
8. ⚠️ **`verSmtp()` lanza 404 cuando no hay fila** (`'Este gimnasio no tiene SMTP configurado'`).
   Dibujarlo como fallo de lectura deja a un gimnasio recién dado de alta **sin el único formulario
   desde el que se configura el correo**: la bandera apagada que no se puede encender, con el área
   entera adentro. Se separó **por el estado y no por el mensaje**: 404 → formulario vacío con cartel;
   cualquier otro estado → sin formulario. Par de tests (404 abre / 503 no).
9. ⚠️ **`motivoSeguro` garantiza que la clave no sale, pero el texto que llega casi nunca es el del
   servidor**: devuelve el `code` de nodemailer (`EAUTH`, `ECONNREFUSED`) **en cuanto tiene forma de
   code, y descarta el mensaje**. El caso común le enseña `EAUTH` al admin, no la línea `535 5.7.8`.
   Por eso el test de «TAL CUAL» corre sobre **dos** mensajes, uno de cada forma: con uno solo, una
   pantalla que lo tuviera escrito a mano pasaba en verde.
10. **El molde de hook que di (`useActualizarHorario(id)`) no servía.** La pantalla lista N
    testimonios con su botón de borrar por fila, y un hook por fila es **un hook dentro de un bucle**.
    El `id` viaja en **las variables**, con precedente escrito en el repo (`useCambiarActiva` de
    `use-invitaciones.ts`). Lo mismo el `tipo` de plantilla, **y eso es deliberado**: si fuera
    argumento del hook, «el tipo no viaja en el cuerpo» **sería cierto por construcción y el test no
    podría caer nunca**.
11. **Corrección menor de nombres:** los hooks del check-in son `useConfigCheckIn` y
    `useGuardarCheckIn`, con **I mayúscula**.
12. ⚠️ **Tres límites de jsdom que el plan no contemplaba, en la T6:** **no carga el `srcdoc`** (el
    `contentDocument` queda vacío, así que «el HTML vive dentro del marco» no se puede ejercitar — lo
    que el test fija es que **no es nodo del documento de arriba**); **no implementa
    `HTMLIFrameElement.sandbox`** (`marco.sandbox` es `undefined`, así que afirmar sobre el marcado no
    era sólo lo correcto, **era lo único posible**); y **`userEvent.type` interpreta las llaves**
    (`{` abre un descriptor de tecla), así que tecleando `{{alumno}}` escribe otra cosa — **todo el
    texto de plantilla va por `fireEvent.change`**.

**Y una afirmación mía que resultó benigna, medida en vez de supuesta:** los tres enlaces del índice a
rutas que todavía no existían **no rompían el build**. `next.config.mjs` **no activa `typedRoutes`**,
así que el `href` de un `<Link>` es una cadena y el build no valida el destino; al pulsar uno salía el
**404 de Next en tiempo de ejecución**. Las tareas 3 a 6 no tuvieron que tocar nada.

## Las mutaciones abiertas 39 a 44: seis de seis, y van 44 de 44

| #   | Qué se agregó                                              | El eje que nadie auditaba                                                             |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 39a | `navigator.credentials.store(new PasswordCredential(…))`   | **no es un almacén nuestro: la credencial sale del edificio**                         |
| 39b | `objectStore.put(variables, 'smtp')` con la clave en claro | **IndexedDB, el quinto almacén y el único fuera de la lista** — **1480/1481**         |
| 40  | `document.documentElement.dataset.ultimoHealthCheck`       | **los dos elementos que no mira nadie** — sobrevivió los **1494**                     |
| 41  | `history.replaceState(null, '', '#dijo=' + error)`         | **la URL del documento: el hueco ENTRE dos defensas** — **1507**, 67 specs            |
| 42  | `href={…?vista=${JSON.stringify(web)}}` en un `<Link>`     | **los atributos de los DESCENDIENTES del `<body>`** — 26/28 y trece tapones ciegos    |
| 43  | `addEventListener('pagehide', … localStorage.setItem(…))`  | **no es un canal nuevo: está programada para DESPUÉS de los tapones** — **1561/1561** |
| 44  | un `<iframe>` oculto que escribe en su `title` y su `name` | **los tapones están atados a UN documento y UNA ventana** — **35/35**                 |

**La 39a es la que pasa una revisión sin ruido**, porque `navigator.credentials.store` existe
**exactamente para eso**. El eje es que **no es un almacén nuestro**: los tapones vigilan sitios de
este origen y esta pestaña, y el gestor de contraseñas **se sincroniza con la cuenta de Google o
Firefox de quien esté en el mostrador y aparece en su teléfono**. Y es la lección 1 de la Fase 11
medida con sonda: **`typeof navigator.credentials` es `'undefined'` en jsdom**, así que escrita como la
escribiría alguien con cuidado —`if ('credentials' in navigator)` + `?.`— **no hace nada y pasa en
verde**. Cerrada en el spec **con un test de instrumento propio** que comprueba que el doble registra
lo que sí se le manda: sin eso, el otro sería verde para siempre.

**La 39b sobrevivió y por eso hay un canal once.** Dos razones, las dos medidas: `typeof indexedDB` es
`'undefined'` en jsdom —y las **doce** clases `IDB*` también—, así que `globalThis.indexedDB?.open(…)`
es un no-op silencioso; y ⚠️ **el tapón de «los tres almacenes» es una LISTA CERRADA**: `CacheStorage`
se agregó en su día por ser un cuarto almacén y **IndexedDB es el quinto y quedó fuera**. Y es **peor
que los tres vigilados**: sobrevive al logout, al cierre de la pestaña y al reinicio igual que
`localStorage`, pero **no tiene tope de 5 MB** y **guarda objetos estructurados** — `put(variables)`
mete el objeto entero sin que nadie tenga que acordarse de serializar.

**La 40 es distinta de las cinco fugas anteriores.** Aquéllas pasaban por APIs que jsdom no implementa;
**jsdom implementa esto entero**, así que **no hay ningún `?.` que delate nada**. El sitio no estaba
ciego por el entorno: **estaba ciego porque nadie lo nombró nunca.** Cero coincidencias de
`documentElement` en todo `apps/web/src`. Y **no vive en el árbol que `render` monta, así que
`cleanup()` no lo borra**: contamina los tests siguientes del mismo archivo — se vio en vivo, el
segundo test falló por el atributo que había dejado el primero.

**La 41 es el hueco ENTRE DOS DEFENSAS, no detrás de una.** Los tests de pantalla miran dentro del
`<body>` y la lista de peticiones; los doce tapones miraban todo lo demás. **`location` no caía en
ninguno de los dos lados**, y `cleanup()` no lo toca: se observó la query de un test apareciendo
intacta en el siguiente. Es de los peores canales de un navegador —va en la barra de direcciones de la
máquina del mostrador, entra en el historial, se copia y se pega entera y **viaja como `Referer` a
terceros**— y nada de eso deja rastro en la pestaña de red ni en el marcado.

**La 43 no abre una puerta: mueve el momento.** ⚠️ **El canal NO estaba sin vigilar** —`localStorage`
es uno de los trece—: **la fuga está programada para DESPUÉS de que todos los tapones hayan corrido**.
Medido con sonda: despachando `pagehide` a mano dentro de un test, el tapón la agarra al instante. **El
instrumento funcionaba; lo único que faltaba era el evento**, y jsdom no dispara nunca `pagehide`,
`beforeunload`, `unload`, `visibilitychange` ni `freeze`. Es pariente de `requestIdleCallback` en la
forma, con otro mecanismo: allí la respuesta fue **montar** la API, acá **despachar los eventos de
salida antes de auditar**.

**Las 42 y 44 se reportaron y NO se cerraron como canal.** Van como deuda, con su medición, abajo.

## Los tres canales globales nuevos y el eje quince, con el porqué de cada decisión de forma

Van en `vitest.setup.ts` / `src/test/espia-de-consola.ts`, y **como dimensión y no como caso**: suben
al tapón global para que los hereden los 70 archivos, en vez de que cada pantalla se acuerde de
pedirlos — y la que no se acuerde es justamente la que lo va a necesitar.

### 11. IndexedDB — forma FUERTE, y los centinelas delante igual

**La forma fuerte es «no se usó en absoluto», y la decisión se midió por TRES caminos**, no por dos: el
grep (cero coincidencias en `apps/web/src`), la revisión de dependencias, y —la que de verdad decide—
**instalar el tapón con la afirmación fuerte puesta y correr los 65 specs**. Verdes. O sea que **nadie
del árbol abre una base durante un test, medido y no deducido**.

**Pero los centinelas van primero y a propósito.** Con la fuerte sola, el informe diría «la pantalla
escribió en IndexedDB» y habría que ir a buscar **qué** se fue; con los centinelas delante lo dice
solo. Ésa es la regla general de las dos formas: **la fuerte decide si hay que mirar, el centinela dice
qué mirar**, y la fuerte sólo se puede usar cuando se ha medido que el árbol entero no toca esa API.

⚠️ **`serwist` SÍ abre una base** (`openDB` de `idb`, para la expiración de cachés). **Lo que la
neutraliza es que `src/app/sw.spec.ts` mockea el módulo entero con `vi.mock`**, y queda escrito en el
docblock: **si alguien quita ese mock, la afirmación fuerte se pone ROJA con el código correcto**, y
hay que bajar a centinelas.

⚠️ **Se aplaza con `Promise.resolve().then()` y NO con `queueMicrotask`.** Hay que aplazar porque la
fuga asigna `apertura.onsuccess` **después** de que `open()` devuelva. Y no con `queueMicrotask`
**porque está en el conjunto que sinon falsea**: un spec con `vi.useFakeTimers()` lo dejaría encolado
hasta que alguien avanzara el reloj, o sea nunca — **el canal funcionaría en 60 specs y mentiría en los
que usan relojes falsos**. Es la lección de `performance` aplicada a otra cosa.

Puertas cubiertas: `objectStore.put`, `objectStore.add`, **`IDBCursor.update`** (la tercera puerta, que
no pasa por ninguna de las otras dos), **la clave además del valor** (`put(1, claveSecreta)` cae), **el
nombre de la base** (`open(claveTemporal)` publica el dato sin escribir un registro) y el de
`deleteDatabase`. **Dos formas de escuchar** —`peticion.onsuccess = …` y `addEventListener('success')`—
porque cubrir una sola era la trampa de `mark` sin `measure`, y el evento lleva `target` porque la
forma común no es `peticion.result` sino `evento.target.result`. **La base de mentira guarda de
verdad**: sin registros no hay cursor, y `openCursor()` sobre un almacén vacío entrega `null`, con lo
que `cursor.update(dato)` no se ejecutaría nunca y el test sería verde mientras en el navegador la
misma línea reescribe cada fila.

**El informe nombra la clave y JAMÁS el valor**, grepeado sobre el real: **cero apariciones de los
cinco secretos**. Lo único que se publica es el nombre del dato y un `true`. Es la misma política que
se le exigió a la copia local del canal doce, y el motivo es que el informe **viaja a CI**.

### 12. Los atributos del `<html>` y del `<body>` — el único canal SIN espía

**1496 → 1494** (bajan 2 por los duplicados de la copia local, que la global cubre entera).

⚠️ **Es el único canal sin espía, y por un motivo real que queda escrito para que nadie «arregle» la
ausencia.** Los otros doce doblan una función o un accesor y tienen que reengancharse en cada
`beforeEach`, porque el `vi.restoreAllMocks()` de los specs corre antes. **Acá no hay nada que doblar**:
el estado que delata la fuga son **los atributos que quedan en el documento**. Sin espía no hay nada
que restaurar y nada que `restoreAllMocks` pueda apagar.

**Se lee DESPUÉS de `cleanup()`, al revés que el `<head>`**, y se verificó en vez de razonarlo: el
`<head>` hay que leerlo antes porque React **se lleva** sus `<meta>` al desmontar; estos atributos **no
los borra el desmontaje**, así que leer después no pierde nada **y gana cazar el atributo que escribe
la limpieza de un `useEffect`** — medido con una mutación extra, que cae nombrando `data-al-desmontar`.
Leyendo antes, eso sería verde y ciego.

**Y el tapón BORRA los atributos antes de afirmar**, en el bloque donde ya se restauran los almacenes:
sin eso, quien escribe uno hace caer también a todos los tests que vengan detrás y **el informe acusa
al inocente**. Se nota en la tabla de la mutación: fallan **4 de 12**, no 12 de 12.

**Se afirma por igualdad contra el conjunto VACÍO y no contra una foto inicial**: con una foto, un
atributo dejado por un test anterior estaría en las dos y pasaría en verde. **`lang = 'es'` cae
también, y no es falso positivo**: poner el idioma desde un efecto de _pantalla_ es exactamente el
error que el canal existe para cazar — **el idioma lo decide el layout, del lado del servidor, donde
este tapón no corre**.

**La copia local que se sacó era peor que la global en un eje que nadie había pedido:** usaba
`expect(atributosDe(...)).toEqual([])`, que **imprime los atributos con sus VALORES** al fallar — el
mismo modo de fuga hacia CI contra el que predica todo el archivo.

### 13. La URL del documento — forma FUERTE, y salió gratis

**1509 → 1509**: sale 1 test (el de la Fase 9) y entra 1 que cubre lo que el canal no cubre.

**La medición que decide**: los **26 specs** que usan `next/navigation` **lo doblan todos** con
`vi.mock` y **ninguno toca `location`**; y la prueba de verdad, instalar la forma fuerte y correr los
67 specs, salió verde. **La forma fuerte sale gratis.**

**Mira la URL partida en cinco —origen, ruta, query, hash y ESTADO del historial— y no el `href`
entero**, por dos motivos: el informe dice «cambió: hash», que **ubica la fuga sin publicar un
carácter** (un `href` entero en el mensaje sería la fuga otra vez), y **`history.state` no es parte del
`href`**. **Dos mitades**: la comparación contra la foto de **al cargar** (no del `beforeEach`, mismo
argumento que el canal 12) **sin espía**, más un espía sobre las **cinco puertas de
`History.prototype`** que **registra y deja pasar** — si se tragara la llamada dejaría ciega a la
primera mitad. **Se lee después de `cleanup()`**, por el mismo motivo que el doce.

**Cinco cosas que se afirmaron y eran falsas o incompletas:**

1. **`location.href`, `search` y `hash` no son tres puertas equivalentes**: sólo `hash` hace algo en
   jsdom. Y **ninguna de las tres es doblable**: son accesores **propios** con `configurable: false`.
2. **`location.assign`/`replace` no se pueden doblar DE NINGUNA MANERA**, ni con un `Proxy`: es
   invariante del lenguaje. Se intentó y **se documentó en vez de fingir que estaban cubiertas**.
3. ⚠️ **`history.state` es una puerta que ninguna de las dos listas nombraba.** Un
   `pushState(datos, '', la misma URL)` guarda el objeto entero **sin mover un carácter de la URL**
   —medido— y ese estado va al **archivo de restauración de sesión en disco**.
4. ⚠️ **La codificación.** Un centinela con espacios **no aparece literal** en el `href` (`%20`). Sin
   mirar la URL **también decodificada**, la mitad de las fugas con un mensaje de la API dentro pasaban
   en verde. **Es la diferencia entre que el canal funcione y que no.**
5. **`location.hash = …` deja `history.state` en `undefined` mientras que al cargar es `null`**: sin
   igualar las dos cosas, una escritura de hash **acusaba además a la parte `estado`**, que nadie había
   escrito.

**Lo que el canal NO ve, dicho en el código y no escondido:** las navegaciones **a otro documento**,
que en jsdom son no-ops. Cerrarlo pedía fabricar un `Location` entero de mentira **y entonces el canal
mediría nuestro doble**. Además es el menos grave: una navegación a otro documento **se lleva la
página**, y la fuga callada —la que deja a la persona donde estaba y le mete el dato en la barra— es
siempre al mismo documento, y ésa cae entera.

### 15. Los eventos de salida de la pestaña — por qué va como PRIMERA LÍNEA del `afterEach`

**1561 → 1561.** No abre una puerta nueva: **mueve el momento**. Los canales siguen siendo trece; ahora
hay **dos ejes** (el catorce es el rato libre, el quince es éste). Archivo propio
(`src/test/salida-de-la-pestana.ts`) pero **llamado desde dentro del `afterEach` del espía**, no desde
`vitest.setup.ts`: su sitio exacto depende del `cleanup()`, y un `afterEach` suelto en el setup
**dependería del orden de registro del archivo**, que cualquiera puede reordenar sin darse cuenta.

⚠️ **La medición que lo decidía: el oyente NO sobrevive a `cleanup()`.** Sonda con el mismo
`dispatchEvent` dos veces: **antes, 1 golpe; después, 0**. **Despachar tarde habría cerrado el eje en
falso, verde y ciego.** Y tampoco servía «antes del `cleanup()` pero después de las lecturas»: el
`<head>` y los `<img>` se leen **antes** de desmontar, así que un oyente de salida que subiera un
`<meta>` no lo vería nadie. → **primera línea del `afterEach`**, para que los trece tapones miren **un
mundo en el que la pestaña ya se cerró**.

**El orden de los cinco eventos no es arbitrario:** `beforeunload` primero, **cancelable y con la
pestaña todavía visible** —es el único cancelable: existe para que la persona pueda decir que no se va,
y mandarlo con la pestaña ya oculta describiría un mundo donde ya se fue y todavía se le pregunta—;
`visibilitychange` con `visibilityState` en `'hidden'`, que es **el evento que la plataforma recomienda
para guardar estado** y por tanto donde más probable es encontrar la línea que escribe; `freeze`, que
viene **de** oculta y por eso va aquí y no detrás; `pagehide` como **`PageTransitionEvent` con
`persisted: false`**, porque el código real lee `evento.persisted` y con un `Event` pelado valdría
`undefined`, que no es ni una cosa ni la otra; y `unload` último, aunque esté en retirada. **La pestaña
vuelve a visible en un `finally`**: un oyente que explote dejaría `visibilityState` en `'hidden'` para
todo el resto del archivo y **el informe acusaría al inocente**.

**Tres cosas que se afirmaron y salieron distintas:**

1. **Esta vez el global y la clase SÍ son lo mismo**: `Object.getPrototypeOf(document) === Document.prototype`.
   La trampa de `performance` no se repitió. Se saca del objeto igual, que es lo que no depende de que
   siga siendo cierto.
2. **El canal de la consola NO queda ciego**, al revés de lo que se supuso: medido con un
   `console.error` dentro del oyente, **tiró 3 tests de 24**. El límite existe y está acotado: **18 de
   los 69 specs** llaman a `vi.restoreAllMocks()` en su propio `afterEach`. **Los canales que se leen
   por ESTADO** —los cinco almacenes, el título, `window.name`, el `<head>`, los atributos, la URL, el
   búfer de marcas— lo ven en los 69, **y son justamente los que esta forma de fuga usa**: un oyente de
   `pagehide` _guarda_ algo, no lo cuenta.
3. **Licencia deliberada, dicha para que no se descubra sola**: `freeze` se despacha **burbujeando**
   aunque la plataforma no lo haga, porque un `window.addEventListener('freeze', …)` —la forma que
   escribe cualquiera por simetría con `pagehide`— **no se oiría aquí y sí en el navegador**, que es el
   agujero que el archivo existe para cerrar.

**Alguien ya escuchaba uno:** `usuarios/nuevo/clave-temporal.tsx:66` escucha `beforeunload` para frenar
un F5 con la contraseña temporal en pantalla. Su oyente hace **sólo `preventDefault()`** y acá nadie
mira si se canceló, así que despacharlo en los 69 archivos no le cambia nada — medido, sus specs siguen
verdes. **Ninguna otra pantalla escucha `pagehide`, `unload`, `visibilitychange` ni `freeze`.**

## ⚠️ EL HALLAZGO DE LA FASE, y no es de este proyecto

**Un `<input type="password">` CONTROLADO de React escribe la contraseña en el ATRIBUTO `value` del
marcado.** React sincroniza `node.defaultValue` con el valor controlado, y **`defaultValue` ES el
atributo**. El `outerHTML` del documento traía `value="Clave-SMTP-Del-Mostrador-77"` **en claro**.

O sea: **la forma normal de escribir ese campo** —igual que todos los demás del panel— deja la
credencial del servidor de correo escrita en el HTML, de donde la levanta cualquier foto del DOM: un
reportador de errores, un `innerHTML` en un log, una captura de sesión.

**Lo mismo un `<textarea>`**, donde el `defaultValue` **es su texto hijo**: queda
`<textarea>CENTINELA</textarea>` en el `innerHTML`.

⚠️ **Se descubrió porque un test falló, no por sospecha.** El campo de la clave se rediseñó: es **el
único NO controlado de la pantalla**, se lee con un `ref` al guardar y se vacía a mano en el
`onSuccess`. El `<textarea>` de las plantillas **se dejó así, y escrito por qué**: el cuerpo de una
plantilla **no es un secreto** —vuelve entero en cada `GET` y se dibuja—, a diferencia de la clave, que
no vuelve nunca. Pero **una foto del DOM lleva el texto de las cinco**, y eso queda como deuda.

## ⚠️ LA REGLA QUE COSTÓ CARO: no instalar dobles locales de nada que vigile el tapón global

`turnos/page.spec.tsx` doblaba las cinco puertas de la History API **como propiedades PROPIAS de
`window.history`** —que **tapan** el espía del prototipo— y además **se tragaba la llamada** en vez de
reenviarla, así que `location` tampoco llegaba a moverse.

**Medido:** con una fuga sembrada en `turnos/page.tsx`, fallaba **1 test de 25** y **los otros 24
pasaban en verde con la fuga delante**. Quitado el doble, la misma mutación hace caer **25 de 25**.

**No era una copia local redundante: era una copia local que APAGABA la defensa general**, y llevaba
ahí desde la Fase 9. → **Regla: no se instala un doble local de nada que ya vigile el tapón global.**
Es el mismo criterio por el que la T4 se escribió **sin ningún doble local**.

## ⚠️ Una categoría nueva de deuda: una MEDICIÓN ANOTADA envejece

El comentario del sexto canal decía: _«MEDIDO, hoy el buffer está vacío en los 58 archivos […] así que
un `toBe(0)` sobre las entradas nuevas pasaría en verde ahora mismo»_. Remedido sobre los 66: **ya es
falso.** Y no por React ni por el runner: **lo volvió falso el propio spec que custodia ese canal**
—`relojes-falsos.spec.ts` siembra una marca a propósito para probar que con los relojes falsos la marca
llega al búfer de verdad—. O sea que **la forma fuerte ahí sería roja hoy, y contra el único spec que
existe para custodiar ese canal**.

El comentario se reescribió: ya no dice «pasaría en verde», dice **qué se midió entonces, qué se mide
ahora**, y suma una tercera razón —que dejó de ser hipotética— para no usar la fuerte ahí. Se
arreglaron además las cuentas desactualizadas de `vitest.setup.ts`, del docblock de `espia-de-consola.ts`
y de `rato-libre.ts`, que repetía cinco veces «diez canales».

**Es deuda que parece documentación**: una medición escrita envejece en silencio, y el que la lee la
toma por cierta. **Conviene revisarlas cuando el número de specs cambia mucho.** (Y al cerrar esta fase
mordió otra vez, en el docblock de `use-configuracion.ts`: ver el error 1.)

## Trampas nuevas

**Un `page.tsx` no puede exportar nada que no sea el `default`** (Next 15), así que los textos van como
**constantes del módulo SIN exportar** y el spec los repite escritos a mano. **Y además**: importar la
constante y compararla contra sí misma **dejaría pasar en verde un «todo funciona»**. Autorreferencia
evitada por partida doble, y verificado con la mutación.

**Igualdad exacta y no `toContain` para el nombre de un botón.** `toContain('Probar')` pasa sobre
«Probar que todo funciona», que es justo lo que el botón NO puede afirmar.

**Un centinela numérico es un falso positivo con patas.** La pantalla del check-in tiene en la mano
**dos enteros**: un centinela `'15'` o `'0'` es subcadena de casi cualquier cosa y dispararía en los
doce ejes a la vez — **la casualidad ortográfica, del lado del tapón**. Lleva **un solo centinela**, y
el motivo está escrito.

**No buscar subcadenas para afirmar una ausencia de cartel.** Un `not.toContain('sin configurar')` pasa
sobre «Sin Configurar» y sobre las otras veinte formas de decirlo. El test **monta la pantalla dos
veces** (15/15 y 7/42) y afirma que el `textContent` es **idéntico salvo los dígitos** (`\d+` → `#`):
eso mata cualquier cartel que aparezca sólo en el caso por defecto, **lo diga como lo diga y esté donde
esté**. El escenario donde la distinción existe **es el par de montajes**: con uno solo el test no
podría fallar.

**El caso ciego se cubre por pares.** «Un fallo al leer no se parece a ceros» iría verde con una
pantalla que no pintara nunca nada, así que tiene su gemelo «y una ventana en cero de verdad sí se
dibuja». Y el test de los campos vacíos (`Number('') === 0`) es el espejo del de cero.

**Un fallo al leer no dibuja formulario, ni deshabilitado.** Dos ceros son una ventana **válida y
plausible**: un formulario vacío se lee como «mi gimnasio está así».

**La validación del cliente sólo parsea; la política se queda en el DTO.** El tope de 720 **no se
repite** en la pantalla: sería una segunda fuente de verdad que el día que cambie deja la pantalla
rechazando lo que la API acepta.

**Un `<img>` pelado y no `next/image`.** El componente de Next reescribe el `src` a
`/_next/image?url=…`, que es **su optimizador y no nuestro proxy**: por ahí no viaja la cookie. Y un
`ADMIN_OPERATIVO` **tampoco tiene el `<img>`**, porque **el `src` es una petición de red que no pasa
por `fetch` ni por `pedir`** y un `hidden` la dejaría saliendo igual.

**El diálogo que apaga la web enumera sólo lo que está encendido de verdad.** Una lista fija diría
«dejan de verse los precios» a un gimnasio que los tiene ocultos — **una frase falsa dentro del diálogo
que decide si se apaga el sitio**. Par de tests: con dos banderas y con las cuatro.

**El interruptor maestro manda lo del SERVIDOR con `activa` cambiada, no el borrador.** Con el borrador
delante, pulsar «apagar» **publicaría de paso el tagline a medio escribir**.

**Los colores van en cajas de texto, no en `<input type="color">`.** `@IsHexColor` acepta `#abc` y
`#aabbccdd`, y el selector nativo **reescribe a `#000000` lo que no entiende** — convertiría «no sé
dibujar tu color» en «tu color es negro».

**Cada plantilla monta su propio `useGuardarPlantilla`.** Uno compartido haría que un 400 de una **se
pintara debajo de las cuatro que están bien**. Y el SMTP usa su propia instancia del hook en el
diálogo, por lo mismo.

**`ErrorDeApi` se deja REAL en el spec del SMTP.** La pantalla hace `instanceof` para separar el 404, y
con una clase de mentira ese `instanceof` sería `false` para siempre y **el 404 caería del lado
equivocado en verde**.

**Los errores de campo no se pintan hasta el primer intento de guardar.** Con un gimnasio sin
configurar, la pantalla recibiría a quien viene a configurar el correo **con cinco carteles rojos de
cosas que todavía no tuvo ocasión de hacer mal**.

**El borrado por fila no confirma, pero el botón NOMBRA la fila** («Borrar el testimonio de Lucía
Ferrer»): un testimonio se recupera reescribiéndolo, el sitio público no. **Y los ids de fila no se
escriben en el marcado** (ni `id`, ni `data-`, ni `aria-controls`): viajan sólo dentro del `onClick`.

**El `orden` se ofrece en el alta porque no hay endpoint de edición**, y **vacío se omite**: mandar `0`
sería elegir por quien no eligió.

**La lista de marcadores se conserva con un `useRef<Map>`, que no deduce nada: recuerda lo que vio
llegar por defecto en esta sesión.** Sin eso la lista desaparecía **justo al guardar**, que es cuando
se está usando.

**El ejemplo de la previsualización se fabrica con el nombre del marcador** (`{{alumno}}` → «alumno»):
una tabla de ejemplos sería otra lista a mano, y **no podría cubrir un marcador que todavía no existe**.

**El asunto va como texto y fuera del marco.** `resolverMensaje` lo renderiza **sin escapar** y termina
en el `subject`, que es texto plano: dibujarlo como HTML enseñaría algo que no existe.

**El sandbox no impide que el documento anidado pida recursos**, y está escrito: un
`<img src="https://…">` dentro de una plantilla **hace su petición al previsualizar**. Por eso va
también `referrerPolicy="no-referrer"`.

## Estado final

|                   |                                                    |
| ----------------- | -------------------------------------------------- |
| `apps/web`        | **1572 tests / 70 suites**, tsc limpio, `build` OK |
| `apps/api`        | **1339 / 67**, eslint en cero — sin tocar          |
| E2E de la API     | **218 / 13** — medidos en este cierre, verdes      |
| `packages/shared` | 103 / 4                                            |

De 1421 tests en web al empezar la fase: **+151**, repartidos T1 +60, T2 +15, el canal doce −2, T3 +15,
el canal trece ±0, T4 +28, T5 +24, el eje quince ±0, T6 +11.

**Los e2e sí se corrieron en este cierre** (`docker start` de `postgres`, `postgres-test` y `redis`;
nunca `docker compose up` pelado), al revés que en la Fase 11. **Esta fase no tocó `apps/api` ni
`packages/shared`**, y los 218 siguen verdes.

## Deuda anotada

**Nueva de esta fase:**

- ⚠️ **`planDestacadoId` no tiene editor, y el `PUT` REEMPLAZA.** El campo se devuelve tal cual y
  omitirlo lo pone en `null`: **guardar el tagline borraría el plan destacado de la landing en
  silencio**. Elegirlo de verdad pide `usePacks()`, que es un **séptimo endpoint** y la tarea tenía
  seis; una caja de texto para pegar un id de base no es un editor. **Está en el checklist a mano:**
  si al guardar el tagline el plan destacado desaparece, la deuda queda confirmada.
- ⚠️ **El contexto de navegación ANIDADO — la mutación 44, reportada y NO cerrada.** Los trece tapones
  están atados a **UN documento y UNA ventana, la de arriba**. No es la brújula de los descendientes
  del `<body>`: **esto es otro documento.** La tabla, medida:

  | Canal                                   | ¿Lo ve el tapón dentro de un iframe?                                                                                                                                      |
  | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `contentWindow.console.*`               | **SÍ**, pero **por accidente de jsdom** (todo embudea en la misma `VirtualConsole`). En un navegador son dos consolas: **ese verde se vuelve falso si el tapón se porta** |
  | `contentWindow.localStorage`            | **SÍ** (objeto distinto, misma área por mismo origen)                                                                                                                     |
  | `contentDocument.title`                 | **NO**                                                                                                                                                                    |
  | `<meta>` en el `<head>` anidado         | **NO**                                                                                                                                                                    |
  | `contentWindow.name`                    | **NO** — y en un navegador **sobrevive a la navegación de ese marco**: el canal clásico de transferencia a un tercero                                                     |
  | atributos del `documentElement` anidado | **NO**                                                                                                                                                                    |

  **Se decidió no cerrarlo**: hoy **hay un solo `<iframe>` en todo el repo**, es el de las plantillas,
  va con `sandbox` sin permisos, y la mutación necesitó **crear un segundo marco oculto** — bastante
  más raro de escribir que un `setItem`. Los canales de esta fase tapaban agujeros que **cualquier
  pantalla podía abrir con una línea**; éste no. **La forma del arreglo, para cuando aparezca el
  segundo iframe**: recorrer `document.querySelectorAll('iframe')` al terminar cada test y auditar
  `contentDocument.title`, su `<head>`, los atributos de su `documentElement` y su
  `contentWindow.name`; y para el marco que se crea y se borra en el mismo tick, doblar
  `document.createElement('iframe')` o `HTMLIFrameElement.prototype.remove`. **No sería un canal nuevo:
  sería «el mismo canal, en otro documento»** — la misma forma de hueco que el eje catorce (otro
  momento) y el quince (otro momento).

- ⚠️ **Los atributos de los DESCENDIENTES del `<body>` — la mutación 42, también abierta.** El tapón
  del canal doce mira `document.documentElement` y `document.body`, **los dos elementos, NO sus
  descendientes**, y los tests de pantalla miran `textContent`, que **no ve ningún atributo**. Es el
  mismo hueco entre defensas que dio la URL, **un nivel más adentro**. Se cerró **en el spec de la T4**
  con dos tests —uno barre nombre y valor de todos los atributos de todo lo que cuelga del `<body>`
  buscando los cinco ids, **con una premisa `atributos.length > 50` para que el barrido no sea ciego**;
  el otro afirma la lista entera de enlaces por igualdad y no con un `not.toContain`— pero **es una
  dimensión, no un caso**: queda como **candidato a canal catorce**.
- **El `<textarea>` controlado deja el texto de las cinco plantillas en el `innerHTML`** (y en el
  `srcdoc`, que es otro atributo con el mismo texto). Se dejó así **y escrito**: el cuerpo de una
  plantilla no es un secreto, vuelve entero en cada `GET` y se dibuja. Pero **una foto del DOM lleva el
  texto de las cinco**.
- ⚠️ **La cobertura de la consola dentro de un iframe funciona POR ACCIDENTE de jsdom**, no por
  diseño: todo embudea en la misma `VirtualConsole`. En un navegador son dos consolas distintas. **Ese
  verde se vuelve falso el día que el entorno se porte bien**, que es la peor clase de verde.
- **La imagen del QR no la ve ningún tapón de red**, por construcción: el `src` de un `<img>` no pasa
  por `fetch` ni por `pedir`. Está cubierto en esta pantalla por un test que afirma que un operativo no
  tiene el `<img>` en el marcado, pero **no hay nada global que lo vigile**.

**Vieja, y sigue en pie:**

- **`use-rutinas.ts` no tiene un solo test**, con 3 mutaciones.
- **Sobre-invalidación de `/mi-pack`** en `use-acciones-de-turno`: se invalida también al entrar y
  salir de la lista de espera, que no consume clases. Medido: 1 → 2 peticiones, en el teléfono del
  alumno.
- **El 403 de anotar le pone una ruta de API delante a quien está en el mostrador**: «Asignasela con
  `PATCH /usuarios/:id/salas`». Es `apps/api`.
- **El job de recordatorios es idempotente por gimnasio y no por persona.**
- **La rotación de la clave de cifrado.**
- **El contenedor `api` del compose está roto** por falta de `@nestjs/throttler`.
- **Los tres campos muertos** (`Sala.exclusiva`, `Ausencia.recuperable` y la franja horaria de una
  ausencia, que **excluye el día entero**).
- **`PanelDeReasignar` ofrece como destino turnos PASADOS y LLENOS.**
- **`centavos: 0` significa TRES cosas** y no se distinguen desde la respuesta.
- **Las pantallas de profesor**, que siguen sin existir **después de ocho fases**.

## Siguiente paso

⚠️ **El inventario está rehecho y verificado el 2026-10-19 y está en el tracker, al final del bloque de
la Fase 11: 26 endpoints sin pantalla. NO HAY QUE REHACERLO.** Esta fase se lleva **14**, así que
**quedan 12**, en dos áreas:

| Área                       | Endpoints | Desglose                                                 |
| -------------------------- | --------- | -------------------------------------------------------- |
| **Dinero**                 | **9**     | pagos 3, packs 3, comprobantes 2, liquidación 1          |
| **Pantallas del profesor** | **3**     | `mis-clases`: listado, alumnos de una clase, pasar lista |

Y las dos trampas del cruce que ya están anotadas allí **volvieron a morder en esta fase**, así que
valen el doble: **un archivo puede tener varios `@Controller`** (lo de `ConfigCheckInController`) y
**muchas rutas se arman en un helper**, así que un `grep` del literal las da por no consumidas.

## El checklist a mano (para Cesar)

Siete comprobaciones que **ningún test puede hacer** y que no se corrieron: no hay navegador en el
entorno. Se ejecutan en el panel, a mano.

- [ ] **Entrar como `ADMIN_OPERATIVO`** y comprobar que **Configuración no está en la navegación** —no
      escondida con CSS— y que las **tres rutas** (`/configuracion/web`, `/configuracion/email`,
      `/configuracion/checkin`) **no piden nada**: la pestaña de red no debe mostrar ninguna llamada.
- [ ] **Guardar el SMTP con una contraseña mal puesta** y comprobar que **el error que se ve es el del
      servidor de correo** y que **no contiene la contraseña** en ninguna parte.
- [ ] **Cambiar sólo el puerto** y comprobar que **la pantalla avisa de que hay que reescribir la
      clave** — no que la conserva.
- [ ] **Escribir `{{clase}}` en la plantilla de recordatorio de pago** y comprobar que **avisa sin
      bloquear**: el aviso tiene que aparecer y el botón de guardar tiene que seguir funcionando.
- [ ] **Apagar `activa`** y comprobar que la web pública **deja de verse**, y volver a encenderla.
- [ ] **Encender `mostrarTurnosLibres`** y mirar la web pública **desde una ventana sin sesión**.
- [ ] **Guardar el tagline** y comprobar **si el plan destacado sigue ahí**. ⚠️ **Si desaparece, la
      deuda de `planDestacadoId` queda confirmada** y hay que arreglarla antes de la fase de Dinero.

# Progreso Fase 13 — El área del profesor

**Spec:** `docs/superpowers/specs/2026-10-22-fase13-profesor.md`
**Plan:** `docs/superpowers/plans/2026-10-22-fase13-profesor.md` (4 tareas)

Los **3 endpoints de `mis-clases`**, que existían desde la Fase 4 y que en nueve fases no tuvieron
dónde dibujarse — lo que el bloque de la Fase 12 anotó como «las pantallas de profesor, que siguen sin
existir después de ocho fases». **No se tocó un solo endpoint.** Y es la primera fase en la que **una
pantalla que faltaba dejaba mintiendo a una que ya estaba entregada**: hasta hoy **nadie en todo el
sistema podía marcar una ausencia**, así que el reporte de asistencia de la Fase 11 contaba presentes
y ausentes **y los ausentes sólo podían ser cero**.

- [x] T1 — El hook (`use-mis-clases.ts`) · 1572 → 1599
- [x] T2 — El área, la puerta de rol y la agenda · 1608 → 1645
- [x] T3 — Pasar lista · 1650 → 1665
- [x] T4 — Verificación, los dos arreglos anotados, README y tracker · 1675 → 1689

Y **cuatro piezas de infraestructura de tests**, que es la mitad del valor de la fase: **el alfabeto de
centinelas** (1599 → 1608), **el canal catorce** (1645 → 1650), **el canal quince** (1665 → 1675) y los
**recuentos** — quince canales, ejes decimosexto y decimoséptimo.

## Los errores de este plan

Sin suavizar. Los encontraron los agentes **midiendo**, no acomodándose. Cada corrección mejoró el
resultado.

1. ⚠️ **`POST /mis-clases/:turnoId/asistencia` SÍ devuelve cuerpo útil.** El plan decía «sin cuerpo
   útil» y lo quería tipado `null`, a la manera de los 204 de la Fase 10. El controller lo declara
   `Promise<AlumnoEnClase[]>` y `pasarLista` termina con `listaDeAlumnos(cliente, turnoId)` **después
   del commit**: devuelve **la lista entera ya marcada**. Tipado como `null`, **la pantalla habría
   tirado el único dato que le llega al instante** — y es justo el que hace que el cartel de «guardada»
   cuente la respuesta y no lo tildado.
2. ⚠️ **`<input type="hidden">` NO se escapa, y la premisa del informe que descubrió la mutación 47
   era falsa.** El informe decía que el `.value` de un control es una propiedad que no se refleja al
   atributo. **Es verdad sólo a medias, y se midió tipo por tipo con sonda**: el `.value` tiene **dos
   modos**. En _modo valor_ (`text`, `password`, `search`, `tel`, `url`, `email` y `<textarea>`)
   asignarlo **no** toca el atributo; en **modo defecto** —`hidden`, `checkbox`, `radio`, `submit`,
   `button`, `image`, `reset`, y también `<button>`, `<output>`, `<data>`, `<option>`— **el `.value` es
   un reflejo del atributo y asignarlo lo escribe**. Comprobado aplicando la mutación original tal cual,
   con `type="hidden"`: **la caza el test de marcado que ya existía**. El agujero real es otro, y más
   chico de lo que decía el informe: **el `.value` que NO se refleja**, más el **`shadowRoot` abierto**.
3. **Las copias a mano del test de red eran CUATRO, no tres.** El docblock de la cuarta —la de la T2—
   decía «ese test existe en tres specs de setenta y cuatro, y este no era uno de ellos»; al escribirla
   pasó a ser la cuarta y la cuenta se quedó vieja en el mismo commit que la cambió.
4. **Un «no se llamó a `fetch`» sería rojo en 23 de 74 specs, no «en casi todos».** En los otros 51
   `pedir` está doblado con `vi.mock` y el `fetch` real no se llama nunca.
5. ⚠️ **`true`, `false` y `null` SÍ conviven en una misma clase**, comprobado en vez de supuesto:
   **`ReservasService.crear` no mira el reloj del turno** —no hay ni una comprobación de fecha en el
   método—, así que un admin puede anotar a alguien que llegó tarde **cuando la lista ya estaba
   pasada**, y esa reserva nace en `null` y entra en la lista. Es lo único que deja probar por separado
   «`false` llega sin tildar» y «`null` llega sin tildar» **con un `true` al lado cerrando el caso
   ciego**. Y en el otro sentido: el fijo del QR es mitad y mitad **sin ningún `false`**, porque no
   podría tenerlo — `false` sólo lo escribe `pasarLista`, que marca la clase entera de una vez.
6. **El fijo de la mutación del conteo era IMPOSIBLE.** No cayó a la primera porque tenía 3 anotados y
   0 marcados, así que `faltan` y `anotados` valían los dos 3 — caso ciego de manual. Y al ir a
   arreglarlo: `listaPasada: true` sobre tres `asistio: null` **es una respuesta que la API no puede
   dar**, porque el `.some()` sería falso. La quinta forma otra vez. Rehecho como el caso real —uno
   marcado por el QR, los otros dos en `null`, 3/1/2— los tres números son distintos entre sí, y como
   los dos montajes ya no pueden tener la misma lista, la comparación pasó a ser **el texto con los
   dígitos enmascarados**: literalmente «idéntico salvo los números», y **más fuerte**.
7. Dos citas mal: los mensajes del rango están en `:55` y `:58`, no en `:53`; la rama de la lista vacía
   está en `:155-170`, no `:154-169`.

## Las mutaciones abiertas 45 a 47: tres de tres, y van 47 de 47

| #   | Qué se agregó                                                        | El eje que nadie auditaba                                                                      |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 45  | `console.info('…', btoa(encodeURIComponent(JSON.stringify(lista))))` | **no es una puerta nueva: es un ALFABETO** — pasó por el canal más vigilado, **1599/1599**     |
| 46a | un `fetch` a un dominio externo con la lista entera de cada clase    | **la red por fuera de `pedir`**, que sólo se vigilaba en 3 de 74 specs — **19/19**             |
| 46b | `void navigator.clipboard?.writeText(JSON.stringify(alumnos.data))`  | **el portapapeles es del SISTEMA, no de la pestaña** — **20/20**, y **SIGUE ABIERTA**          |
| 47  | `caja.current.value = JSON.stringify(alumnos)` en un `<input>`       | **lo que el marcado no serializa: el `.value` que no se refleja** — **1665/1665**, 76 archivos |

### ⚠️ El hallazgo más transferible de la fase: un ALFABETO y no una puerta

La 45 **pasa por el canal más vigilado de los trece y no la nota nadie**. El dato codificado con
`btoa` **derrotaba los trece canales a la vez**, y el motivo no lo enunciaba ningún test: **todos
afirman por búsqueda de subcadena del valor vigilado**. Corolario: **cualquier transformación del dato
los derrota a todos** — `btoa`, un `TextEncoder`, un `replacer`, un `.split('')`, una compresión.

**Control que aísla la causa**: la misma línea **sin codificar** hace caer **8 tests** (el plan decía 5;
medido contra el espía viejo y el nuevo, son 8). El instrumento funcionaba: **lo único que cambia entre
caer y no caer es la codificación.** Y es **la brecha más barata de explotar** de las 47 — no hay que
encontrar nada, se escribe sola, y «lo codifico para que no se lea de un vistazo en la consola» **suena
a buena práctica**.

Por eso el arreglo **no es un canal catorce**: cada centinela se convierte en una **lista de agujas**
(`formasDe`, memoizada por valor) y hay **un solo punto de comparación**, `formaQueSeFue(texto, valor)`,
que devuelve **qué forma** emparejó. Ningún canal prohíbe ninguna llamada nueva: **sólo cambió cómo se
busca**. En claro va **primera**, para que el informe de la fuga normal sea idéntico al de antes.

⚠️ **El detalle que lo hace funcionar: base64 se alinea en bloques de 3 bytes**, así que la codificación
de una subcadena sólo aparece dentro de la del todo si se generan **los tres desplazamientos** y se
recortan los bordes. Medido sobre `'Sofia-Pereyra-Vino-Marcador'` dentro de un volcado, con relleno de 0
a 5: **la aguja ingenua `btoa(NOMBRE)` empareja 2 de 6** —sólo las posiciones múltiplo de 3, o sea que
**dos de cada tres fugas se le escapan**— y **los tres desplazamientos, 6 de 6**, exactamente una cada
vez. **Las dos están en el guardián, y la ingenua se mide a propósito**: si se pusiera verde con las
seis, las tres agujas sobrarían.

### ⚠️ Y la generalización que parecía correcta y era la mala

Lo natural sería **decodificar el volcado** en el sitio común, en vez de codificar la aguja. **No**:
`decodeURIComponent` **revienta con un `%` suelto** —un `console.log` que diga «50% de asistencia» ya lo
tiene— y el `catch` **se comería el volcado entero, dejando el canal ciego por haberlo querido
reforzar**. Codificar la aguja no tiene ese modo de fallo y se paga **una vez por centinela**, no una
por volcado y por test. (El canal de la URL sí decodifica y se dejó: ahí `urlComoTexto` le pega su
`decodeURIComponent` al `href`, que es **más fuerte** que una aguja.)

**Descartadas, con el argumento escrito en el código**: partir el dato (exigiría buscar subsecuencias, y
el que parte en dos parte en tres), comprimir (nadie comprime una traza sin intención, y no hay API
síncrona para el `afterEach`), hashear o cifrar (**no se puede**: sal, algoritmo y codificación no
tienen fondo) y los bytes sueltos (donde pasa de verdad —el cuerpo de una baliza— **ya estaba cubierto
por el otro lado**).

**Costo: +0,1 s**, dentro del ruido; las agujas se calculan **una vez por centinela para todo el
archivo**. **Guardián propio** (`alfabeto-de-centinelas.spec.ts`, 9 tests), porque la aritmética de los
desplazamientos es invisible desde fuera: simplificar las tres agujas a una **deja los 1599 en verde** y
el tapón ciego justo para la fuga real. Y el guardián ejercita la familia `btoa(encodeURIComponent(…))`
con `'Sofia Pereyra Vino Marcador'` **con espacio**, porque los centinelas de ese spec son con guiones,
que `encodeURIComponent` no toca: **sin un nombre con espacio o acento esa familia quedaba sin probar**.

## El canal catorce — la red por fuera de `pedir` (1645 → 1650)

**El criterio es LA PILA, no la URL.** `pedir` llama a `fetch` **sincrónicamente** desde su cuerpo, así
que un `new Error().stack` trae `at pedir (…/src/lib/cliente.ts)` como segundo marco. **Por qué se
descartó la URL, medido**: el agujero que deja es **exactamente la mutación que `ausencias/page.spec.tsx`
ya tiene documentada** —un `fetch('/api/bx/stats/caja')` en un `useEffect`, que va al proxy con la cookie
y por la URL es indistinguible de `pedir`—. Con la pila cae; con la URL pasaba.

⚠️ **La trampa que se comió y quedó escrita**: la primera sonda buscaba `/src/lib/cliente.ts` con las
barras al derecho, y en Windows la pila las trae al revés. Resultado: «ninguna de las 467 pasó por
`pedir`». **Las dos formas están fijadas en el guardián.**

⚠️ **Y la segunda entrada de la puerta, que es lo que lo hace servir**: las 467 peticiones pasan por un
doble que el spec instala con **`vi.stubGlobal`**, ni una por el `fetch` del entorno. Un enganche sólo en
`beforeEach` estaría ciego **en los 23 specs donde corre el `pedir` de verdad** —los únicos con tráfico
que vigilar—. Medido en la fuente de Vitest: `stubGlobal` hace `defineProperty` con `value`, que
**sustituye el descriptor entero** (un accesor no sobrevive), y ningún hook corre después del
`beforeEach` del spec. Por eso el espía **engancha `vi.stubGlobal` una vez al cargar**.

**La forma de cada puerta**: `fetch` por **centinelas** —hay 96 peticiones legítimas por fuera de
`pedir`, así que la fuerte sería **roja con el código correcto en cinco specs**, y sostenerla pediría una
**lista blanca de destinos**, el patrón contra el que este repo predica—; `XMLHttpRequest`, `WebSocket` y
`EventSource` **fuertes**, y este último **se DEFINE** porque no existe en jsdom y un
`if ('EventSource' in window)` **no hace nada y pasa en verde**. **El precio, sin adornar**: un `fetch` a
otro origen **sin ningún centinela** pasa en verde. **El informe no publica la URL**: nombra el origen y
nunca la ruta ni el query, y pasa igual por `claveSegura`.

**Las cuatro copias a mano se quedan**: comprueban **la forma fuerte**, que en esos cuatro specs sale
gratis —`pedir` está doblado y no hay ni una petición legítima— y caza además **el dato que nadie
registró**. Lo global cubre los 74 con centinelas y tres puertas más; lo local cubre cuatro con la
fuerte. **No se tapan.** Costo +0,3 % a +1,8 %.

### La auditoría retroactiva: nada escondido, pero una promesa falsa

**467 peticiones al `fetch` global en los 74 archivos: 371 de `pedir` y 96 que no**, de **cinco sitios de
producción, todos deliberados y con su motivo escrito** (la landing pública desde el servidor con
`credentials: 'omit'`, las tres pantallas que llaman a las rutas del BFF que escriben la cookie
httpOnly, y el `PUT` del comprobante a la URL firmada del almacén). **Nada escondido: no hubo que parar
ni arreglar.**

⚠️ **Pero dejó una frase falsa en pie**: `lib/cliente.ts` se abría diciendo «el único fetch del navegador
en toda la aplicación», y hacía cuatro fases que no era cierto. **Es la tercera vez en tres fases que
aparece la misma forma de deuda — una medición anotada envejece, y envejece en silencio porque parece
documentación.** Cerrado en la T4, y **no sólo corrigiendo la frase**: ver abajo.

## El canal quince — lo que el marcado no serializa (1665 → 1675)

**El eje**: el `.value` de un control **no siempre** es un reflejo del atributo (ver el error 2), y
cuando no lo es **no aparece en ningún `innerHTML` ni en ningún `textContent`** — y sin embargo está en
la página, se pinta, se autocompleta, viaja en un envío de formulario y lo lee cualquier extensión. **El
`shadowRoot` abierto es la otra mitad**, medida: `querySelectorAll('*')` **no desciende** a él, el
anfitrión no lo serializa, **y ahí cabe un árbol entero**. Es **el hueco entre las dos defensas**: los
catorce canales miran todo lo que **no** es el `<body>`; los tests de pantalla miran el `<body>` por
`innerHTML` y `textContent`. **Y no es especulativo**: el test de la agenda «ni un nombre ni un
`perfilId` llega al marcado» mira `document.body.innerHTML`, **y el mismo `.value` lo esquiva ahí
también**.

### ⚠️ La forma es por centinelas CON UNA RESTA, la única del archivo que la tiene

**Un centinela sólo cuenta si NO está también en el marcado.** Una pantalla de edición pinta
`<input value={persona.nombreCompleto}>` y React escribe el atributo **y** la propiedad: afirmar «ningún
centinela en ningún `.value`» sería **rojo con el código correcto en media docena de specs**. Lo que se
afirma es que no haya ninguno **escondido**.

⚠️ **La auditoría retroactiva encontró 10 tests rojos en 2 archivos, CON EL CÓDIGO CORRECTO**: la clave
del SMTP y el motivo de unas vacaciones estaban en el `.value` de su campo **porque la persona los
tecleó**. Uno de los que caía se llama _«tras un fallo el formulario sigue ahí, con lo que ya se había
escrito»_: **el valor en el campo ES la cosa afirmada**. El criterio que los distingue, y es medible:
**lo que la persona escribe llega por un evento `input`/`change`, que burbujea; lo que una pantalla
escribe a escondidas en un `useEffect` no despacha ninguno.** Un oyente en captura sobre el `document` y
un `WeakSet`. **El hueco que deja está escrito**: un campo donde la persona escribió **y** que además
recibe una fuga queda fuera.

**Se lee ANTES de `cleanup()`, al revés que diez de los otros**: `cleanup()` vacía el `<body>`, así que
leer después sería leer siempre la lista vacía — **verde y ciego**. Lo que pierde a cambio: el `.value`
que escriba la limpieza de un `useEffect`, que es justo lo que ganan los atributos de alrededor y la URL
leyéndose después. **Y la foto del marcado se toma en la misma línea**, porque si no la resta compararía
contra un cuerpo vacío.

**Fuera, con argumento**: `.checked` / `.selectedIndex` / `.valueAsNumber` (no pueden llevar el dato: un
booleano no tiene un nombre dentro); **`dataset`, que SÍ se refleja** —comprobado, con test propio para
que si deja de ser cierto entre—; el `shadowRoot` **cerrado** (`host.shadowRoot` es `null`: no es
decisión, es la plataforma); los internos de React (`__reactProps$`), porque **no hay forma de escribir
ahí que no sea escribir en el marcado**, y atarse a un interno de framework es lo contrario de lo que
hace el resto del archivo; y `.files`, que es una entrada y no un escondite.

**Costo +0,55 %**, por debajo del ruido. **Guardián propio** (`lo-que-el-marcado-no-serializa.spec.ts`,
10 tests): **tres «simplificaciones» razonables dejan el canal ciego sin poner rojo ni uno de los 1675** —
cambiar el `typeof === 'string'` por una lista de etiquetas, quitar la rama del `shadowRoot` (que hoy no
caza nada porque no hay un `attachShadow` en `src/`, **así que parece código muerto y no lo es**) y mover
la lectura detrás del `cleanup()`.

**La copia local de `[turnoId]/page.spec.tsx` se quedó**, porque comprueba dos cosas que la global no
puede: **la forma estricta sin la resta** (esa pantalla no tiene un solo `<input value={…}>` legítimo) y
**el control del caso ciego** (`escondites.length >= filas().length`).

## Las decisiones de producto, y por qué

- **`listaPasada` NO se usa.** Es `reservas.some(r => r.asistio !== null)` y el check-in por QR escribe
  `asistio`, así que **un solo alumno que escanea hace que la clase figure como «lista pasada»**.
  ⚠️ **Lo que lo vuelve indefendible: el servicio del alumno YA resolvió esto bien** —separa `yaMarcada`
  de `listaPasada` con el comentario «fusionarlos le diría "ya marcaste" a alguien que no marcó»— y **el
  contrato de la profesora los fusiona**. La agenda dice **cuántos quedan sin marcar**, sacado de
  `GET /mis-clases/:id/alumnos`.
- **Rango por defecto HOY y tope de 12 clases.** Un día son 2-3 clases; una semana serían 15-20
  peticiones **en el teléfono de la profesora**. Pasado el tope **no se pide el detalle y se dice**: las
  otras dos salidas eran pedir igual (25 peticiones en paralelo desde un móvil) o **caer al `listaPasada`
  gratis — la peor, porque sólo mentiría en los rangos largos, donde nadie va a comprobarlo**. **Por qué
  12**: el defecto **nunca lo toca** y **una semana siempre lo pasa** (3/día = 21), o sea que «mirar la
  semana» cae del lado honesto **a propósito y no por accidente**. Hay **test del borde exacto**, porque
  sin él un `<` donde va un `<=` pasaría inadvertido.
- **Tres consecuencias del reemplazo total.** (1) ⚠️ **Pasar lista puede pisar un check-in real**, y por
  eso **los que ya tienen `asistio: true` llegan tildados** — no es comodidad, es lo único que impide que
  la pantalla destruya un dato verdadero. (2) **Los tildes se siembran una sola vez**
  (`useState(() => …)` + `key={turnoId}`): si cada respuesta re-sembrara, **el refetch que dispara la
  propia invalidación le borraría a la profesora lo que lleva tildado de pie en la sala**. **No tiene
  test, y lo dice**: con los flujos disponibles no es observable. (3) **El cartel de «guardada» cuenta la
  RESPUESTA, no lo tildado**, aprovechando que el POST devuelve la lista entera; probado con un fijo
  donde los dos números se separan de verdad.
- **Marcar ausente a toda la clase se puede, y confirma nombrando el tamaño** («Marcar ausentes a los N
  anotados de esta clase»), porque **«¿estás seguro?» es un trámite, no una pregunta**. **La confirmación
  sólo existe en ese caso**: una en cada guardado es una que a la tercera clase del día nadie lee, **y
  eso la volvería decorativa justo cuando hace falta**.
- **Las claves del hook van en DOS RAMAS, no anidadas** (`['mis-clases','agenda',…]` y
  `['mis-clases','alumnos',turnoId]`): la agenda hay que invalidarla **en todos los rangos**, así que su
  clave tiene que ser un prefijo que **no** cubra los alumnos. Con `['mis-clases',turnoId,'alumnos']`,
  invalidar la agenda arrastraría los alumnos de todas las clases abiertas **y el test de «y nada más» no
  podría existir**.
- **Orden en `destinoPorRol`: jerarquía primero, `=== 'PROFESOR'` después.** Un
  `rolAlcanza(rol,'PROFESOR')` ahí **mandaría a los tres roles de admin a la agenda de una profesora** si
  alguien reordena las líneas. Hay test que barre todos los roles por ese lado.
- **No hay enlace de «Volver».** El botón de atrás del teléfono es el **único** que devuelve la agenda
  **con el rango que tenía**; un «Volver a mis clases» cableado la devolvería a _hoy_ después de haber
  estado mirando el martes pasado, **y encima parecería que funciona**.

## Los dos arreglos de la T4

### 2a — El mismo bug, del otro lado del mostrador

`admin/sin-permiso.tsx` mandaba a **cualquier** rol rechazado a `/{slug}/calendario`, `PROFESOR`
incluido: una profesora que abría una URL del panel **salía de ahí hacia el «Esta no es tu área» del
alumno**. El `href` sale ahora de `destinoPorRol`, **con la excepción que no se puede delegar: el
`FANTASMA` recibe el botón de cerrar sesión**, porque `destinoPorRol` lo manda al calendario y el
calendario también lo rechaza. **Sí aplicaba**, igual que en el layout del profesor. Tres tests nuevos en
`admin/layout.spec.tsx`, uno de ellos atando el `href` de cada rol rechazado a lo que devuelve
`destinoPorRol`, y las palabras en un `Record` **sin `FANTASMA`** para que agregar un rol al enum rompa
la compilación en vez de pintar un enlace sin texto.

### 2b — ⚠️ La medición anotada, cerrada con un test que CUENTA

`lib/el-unico-fetch.spec.ts`, **11 tests**. No corrige sólo la frase: es el molde de
`apps/api/src/common/guards/rutas-publicas.spec.ts` —**no una lista de archivos sino una tabla de
archivos CONTRA SU MOTIVO**, comparada entera y en los dos sentidos—. Agregar un `fetch` suelto deja la
tabla corta; quitar uno la deja larga; **y `llamadas` está en la tabla además del motivo porque colar una
segunda petición en un archivo que ya está en la lista no agrega ningún archivo nuevo**.

⚠️ **Y midiendo salió una corrección a la auditoría del canal catorce: no son cinco sitios, son DIEZ.**
El canal mide **tráfico en jsdom**, así que sólo ve lo que algún spec ejecuta — o sea, **sólo el
navegador**. El inventario **lee `src/` entero** y encuentra seis más, todos de servidor y ninguno
escondido: **el proxy `api/bx/[...ruta]/route.ts` (2 llamadas)**, las **tres rutas del BFF vistas desde
dentro**, la landing `[slug]/page.tsx`, y ⚠️ **`lib/sesion.ts`, que pide `GET /auth/me` desde el servidor
y no estaba en ninguna de las dos listas**. En el **navegador** son **exactamente cuatro**, y hay un caso
que lo afirma por igualdad — que es la frase de `lib/cliente.ts` convertida en test.

El contador tiene **su propio guardián de 7 casos**, por el motivo de siempre: el `(?<!\w)` que distingue
`fetch(` de los **cuarenta y pico `refetch()`** de React Query, y el recorte de comentarios que impide
que medio repo entre por hablar de `fetch` en sus docblocks, **son invisibles desde fuera** — sin ellos
la tabla cuadraría al tamaño equivocado y lo único que pasaría es que alguien la agranda. **Verificado
con mutación**: un archivo nuevo con un `fetch` pone el inventario rojo nombrándolo. El docblock de
`cliente.ts` se reescribió **apuntando al spec**, y el del canal catorce también.

## Trampas nuevas

**`vitest run "ruta/[id]"` sólo funciona desde PowerShell**: los corchetes del App Router los expande el
shell POSIX y el spec no se encuentra.

**`apps/web` no tiene eslint**: no hay script `lint` ni configuración propia, y `eslint` desde la raíz no
encuentra config para `apps/web/src`. Lo que cubre esos archivos es `tsc --noEmit`, `next build` y
`prettier --check`. **No es un olvido de este cierre: es el estado del repo**, y conviene saberlo antes de
anotar «eslint en cero» para web.

## Estado final

|                   |                                                     |
| ----------------- | --------------------------------------------------- |
| `apps/web`        | **1689 tests / 78 suites**, tsc limpio, `build` OK  |
| `apps/api`        | **1339 / 67**, eslint en cero — sin tocar           |
| E2E de la API     | **218 / 13 — ARRASTRADO, NO MEDIDO** en este cierre |
| `packages/shared` | 103 / 4                                             |

De 1572 tests en web al empezar la fase: **+117**, repartidos T1 +27, el alfabeto +9, T2 +37, el canal
catorce +5, T3 +15, el canal quince +10, T4 +14 (3 del arreglo 2a y 11 del inventario del `fetch`).

⚠️ **Los e2e NO se corrieron**: el demonio de Docker no estaba levantado en esta máquina
(`npipe:////./pipe/dockerDesktopLinuxEngine` no existe), así que no hubo `postgres-test` contra el que
correrlos. **El 218 viene arrastrado de la Fase 12.** Esta fase **no tocó `apps/api` ni
`packages/shared`**, así que no hay motivo para que haya cambiado — pero **no está medido y no se afirma
como medido**.

## Deuda anotada

**Nueva de esta fase:**

- ⚠️ **`navigator.clipboard` — la mutación 46b, reportada y NO cerrada.** `navigator.clipboard` es
  `undefined` en jsdom, así que el `?.` es un no-op silencioso en los 1675. **Ya estaba documentado como
  hueco abierto a conciencia desde la Fase 11** —los tres specs que lo usan le pisan el objeto a
  `navigator` **desde dentro del test**, donde ningún `beforeEach` llega, así que el tapón registraría
  cero escrituras **justo en los tres sitios donde el canal se usa**—. Lo que esta vuelta agrega es el
  argumento de daño: **el portapapeles es del SISTEMA y no de la pestaña** —sobrevive al navegador y
  aterriza en lo próximo donde la persona pegue algo— y **ninguno de los quince canales tiene esa
  propiedad**.
- ⚠️ **El contexto de navegación ANIDADO** (la 44 de la Fase 12) **sigue abierto**, con su tabla medida
  en el bloque anterior.
- ⚠️ **Los atributos de los DESCENDIENTES del `<body>` (la 42 de la Fase 12) SIGUEN ABIERTOS: el canal
  quince NO los cerró.** Comprobado leyendo el tapón: el barrido nuevo recorre
  `document.body.querySelectorAll('*')` pero sólo mira **el `.value` y el `shadowRoot`** de cada nodo;
  los atributos los sigue mirando **el canal doce, y sólo sobre `documentElement` y `body`**, los dos
  elementos y no sus descendientes. La única cobertura sigue siendo **local**, en el spec de la T4 de la
  Fase 12. **El canal quince entra por el mismo bucle, así que cerrarlo ahora cuesta poco**: es el
  candidato más barato a canal dieciséis.
- **Partir el dato en trozos** sigue fuera del alfabeto, **a propósito y con el argumento escrito**:
  cubrirlo exigiría buscar subsecuencias, que pondría rojo cualquier volcado que contenga las letras en
  orden, y el que parte en dos parte en tres.
- **El `.value` que escriba la LIMPIEZA de un `useEffect`** queda fuera del canal quince, porque se lee
  antes de `cleanup()`. Es el precio exacto de no leer siempre una lista vacía, y está escrito en el
  docblock.
- **Un campo donde la persona escribió Y que además recibe una fuga** queda fuera de la resta del canal
  quince. También escrito.

**Vieja, y sigue en pie:**

- **`use-rutinas.ts` no tiene un solo test**, con 3 mutaciones.
- **Sobre-invalidación de `/mi-pack`** en `use-acciones-de-turno`: medido, 1 → 2 peticiones.
- **El 403 de anotar le pone una ruta de API delante a quien está en el mostrador.** Es `apps/api`.
- **El job de recordatorios es idempotente por gimnasio y no por persona.**
- **La rotación de la clave de cifrado.**
- **El contenedor `api` del compose está roto** por falta de `@nestjs/throttler`.
- **Los tres campos muertos** (`Sala.exclusiva`, `Ausencia.recuperable` y la franja horaria de una
  ausencia, que **excluye el día entero**).
- **`PanelDeReasignar` ofrece como destino turnos PASADOS y LLENOS.**
- **`centavos: 0` significa TRES cosas** y no se distinguen desde la respuesta.
- **`planDestacadoId` no tiene editor**, y el `PUT` reemplaza.
- ⚠️ **Nuevo en la lista vieja, y es de contrato: `listaPasada` sigue mintiendo** para cualquiera que lo
  consuma. La pantalla lo esquiva; el campo no se arregló.
- ⚠️ **`GET /liquidacion/:profesorId` pide `ADMIN_SALON`** —«esto enseña tarifas», dice el controller—,
  así que **la profesora hoy no puede ver lo que va a cobrar**. No es una pantalla que falte: es una
  decisión de permisos que hay que tomar antes.

## Siguiente paso

⚠️ **El inventario está rehecho y verificado el 2026-10-19, al final del bloque de la Fase 11: eran 26
endpoints sin pantalla. NO HAY QUE REHACERLO.** La Fase 12 se llevó **14** y ésta **3**, así que
**quedan 9**, en un área sola:

| Área       | Endpoints | Desglose                                        |
| ---------- | --------- | ----------------------------------------------- |
| **Dinero** | **9**     | pagos 3, packs 3, comprobantes 2, liquidación 1 |

Y las dos trampas del cruce siguen valiendo: **un archivo puede tener varios `@Controller`** y **muchas
rutas se arman en un helper**, así que un `grep` del literal las da por no consumidas.

## El checklist a mano (para Cesar)

Seis comprobaciones que **ningún test puede hacer** y que no se corrieron: no hay navegador en el
entorno.

- [ ] **Entrar con una cuenta de profesora** y comprobar que se aterriza en **la agenda**, no en «Esta no
      es tu área». ⚠️ Es el bug que esta fase existe para arreglar: **entrar correctamente la echaba**.
- [ ] **Entrar como alumno y como admin** y comprobar que **no** se entra a `/{slug}/mis-clases` — y que
      a cada uno se le ofrece su sitio con el nombre puesto.
- [ ] **Abrir una URL del panel con la cuenta de profesora** y comprobar que **ahora ofrece su área** y
      no el calendario (el arreglo 2a).
- [ ] **Chequearse por QR en una clase** y comprobar que la agenda **no dice «lista pasada»** y sí dice
      **cuántos faltan por marcar**.
- [ ] **Abrir esa clase** y comprobar que **quien se chequeó llega tildado**. ⚠️ Si llega destildado,
      guardar le borra un check-in real.
- [ ] **Pasar lista** y comprobar en el **reporte de asistencia de Análisis** que **aparecen ausentes**.
      ⚠️ Es la comprobación que cierra la fase: **hasta hoy ese número sólo podía ser cero.**

# Progreso Fase 14 — Dinero

**Spec:** `docs/superpowers/specs/2026-10-23-fase14-dinero.md`
**Plan:** `docs/superpowers/plans/2026-10-23-fase14-dinero.md` (6 tareas)

Los **9 endpoints de dinero** que quedaban sin pantalla: pagos 3, packs 3, comprobantes 2 y la
liquidación. **No se tocó un endpoint ni se agregó una entrada a la navegación**: el pago va en la ficha
de la persona, la cola de comprobantes en la portada, los packs en Configuración y la liquidación en
Análisis. ⚠️ **Y el cruce de cierre dice que NO quedan cero endpoints sin pantalla: quedan tres** —ver
abajo—, y el inventario del 19/10 no los veía.

- [x] T1 — Los nueve hooks (`use-dinero.ts`)
- [x] T2 — El pago, en la ficha de la persona (`bloque-pagos.tsx`)
- [x] T3 — La cola de comprobantes, en la portada (`comprobantes-pendientes.tsx`)
- [x] T4 — Los packs, en Configuración · cierra en **1847 / 84**
- [x] T5 — La liquidación, en Análisis · 1847 → **1882 / 86**
- [x] T6 — Verificación, cruce, README y tracker

⚠️ **El historial de la sesión que hizo T1 a T4 se perdió**, y las casillas del plan no se marcaron. El
avance se reconstruyó **de los archivos y de una corrida de la suite**, no de un registro: por eso no
hay recuento por tarea entre 1689 y 1847. La sesión se cortó **con la mutación abierta de la T4 todavía
plantada** —25 rojos en el spec de packs, que parecían un bug y eran la mutación funcionando—; se quitó
al retomar.

## Lo que la fase dibuja y no aplana

- **Una seña no pone al día.** `esSena` lleva la consecuencia al lado, en el formulario y en la fila, y
  **viaja siempre**, también en `false`: es la lección de `mostrarPrecios` de la Fase 12.
- **Anular no es borrar.** La fila se queda con `anuladoEn` y `anuladoPor`, sigue en la lista marcada, y
  la pantalla dice si la anuló la misma persona que la cobró —dos ids que se comparan sin nombre: el
  padrón **no tiene a los administradores**, medido—. Anular pide `ADMIN_SALON`: para un operativo el
  botón **no está en el marcado y no se pide**.
- **Aprobar un comprobante es cobrar.** `aprobar` acuña un `Pago` en la misma transacción y el DTO exige
  `monto` y `cubreHasta`: la cola tiene **un formulario de cobro**, no un botón. La URL de descarga es de
  vida corta y no se guarda en ningún sitio.
- **Dar de baja un pack no le hace nada a quien lo tiene**, medido en el service, y **cuántos lo tienen
  no lo dice la API**: la pantalla no lo inventa.
- **La liquidación distingue las cuatro situaciones de una franja** —se dio, nadie se anotó, salón
  cerrado, suplencia sin contrato— y **no calcula nada**: `aPagar`, los importes y las horas se pintan
  como vienen, con el fijo desalineado en los tres sitios derivados para que una cuenta se note. **Los
  minutos sin tarifa van dentro de la cifra de lo que se paga**, con palabras y un enlace a Horarios.
- **La profesora se elige por `perfilId` y vive en la URL** (`?profesora=`). Sin elegir **no se pide el
  sueldo de nadie**, y las de baja se ofrecen porque siguen cobrando sus meses.
- ⚠️ **`Importe` contra la cadena pelada.** `LiquidacionProfesor` y la caja traen `{ centavos, texto }`;
  `PagoPublico.monto` y `PackPublico.precio` son una cadena. Dos formas correctas del mismo dinero
  conviviendo: **deuda de `packages/shared`**.

## Un arreglo que no estaba en el plan

**`useLiquidacion` mandaba el id sin codificar**, y es el único id de `use-dinero.ts` que no sale de una
respuesta de la API sino del `?profesora=` de la URL. Con `../usuarios`, `fetch` resolvía el segmento y
la petición salía **contra el endpoint de al lado con la sesión del admin**. Test primero —rojo con
`'/api/bx/liquidacion/../usuarios?…'`— y `encodeURIComponent` después.

## Las mutaciones

**T5: las cinco del plan caen**, cada una en el test que la fija: «nadie se anotó» pintado como cerrado
(2 rojos), `aPagar` sumado de las franjas (2), los minutos sin tarifa en un `title` (2), las horas
recalculadas de los minutos (1) y el id del usuario en vez del `perfilId` (3).

**Las abiertas que esta fase encontró y CERRÓ**, según lo que quedó en el código —las de T1 a T3 no se
pueden reconstruir con su número y su medida—:

| Qué se agregó                                                                    | El hueco                                                        | Cómo se cerró                                    |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| `console.info('[packs]', precios.map((p) => Number(p).toLocaleString('es-AR')))` | **la forma localizada**: `25000.10` sale `25.000,1` — 1841/1841 | una aguja más del alfabeto (`agujasLocalizadas`) |
| un `<div>` con el catálogo colgado del `<html>`                                  | **el hueco entre tres defensas** — 1841/1841                    | segunda mitad del canal doce                     |
| `href={URL.createObjectURL(new Blob([csv]))}` con la liquidación, sin revocar    | **el almacén de blobs del documento** — **1874/1874**           | **canal veinte**, con guardián propio            |

### ⚠️ El canal veinte, y por qué el veinte

`URL.createObjectURL` **no existe en jsdom**, así que el `typeof` prudente lo vuelve un silencio. En el
navegador el objeto queda vivo hasta que alguien lo revoque, y **en una aplicación de una sola página el
documento no se cierra al salir de la sesión**: el sueldo de la profesora sigue en memoria para el
turno siguiente, y `chrome://blob-internals` lo enseña entero.

Se afirma **por centinelas y por la forma fuerte —nada publicado sin revocar—, leyendo DESPUÉS del
`cleanup()`**, y eso se midió en las dos direcciones: la fuga tira **16 de 25** de `liquidacion.spec`, y
**la misma línea revocada en la limpieza de un `useEffect` pasa los 25**. Lo único que distingue caer de
no caer es revocar. El guardián, `objetos-con-url.spec.ts`, caza que `revocar` vacíe el almacén entero
(2 rojos) y que el contenido se lea con `JSON.stringify` en vez de abrir el `Blob` (4 rojos).

**Es el veinte y no el dieciocho** porque el 18 y el 19 ya eran ejes (`rato-libre.ts` y
`salida-de-la-pestana.ts`). Los recuentos de la infraestructura pasaron a **dieciocho canales**; las
menciones de los specs que cuentan una medida de su momento se dejaron como estaban.

## El cruce de endpoints, rehecho y MEDIDO — y no da cero

El script del 19/10 no estaba guardado en el repo, así que se rehízo: **un recorrido de los
`*.controller.ts` en orden** —cada `@Controller` cambia la base de lo que sigue, que es la trampa de los
archivos con dos— contra **todos los `pedir` de `apps/web/src` fuera de los specs** y los `fetch` del
BFF. Y una comprobación nueva que el inventario viejo no hacía: **que el hook que pide la ruta lo use
alguna pantalla**.

**103 rutas** —el recorrido da 104 porque cuenta un `@Patch(':id')` que vive dentro de un comentario de
`turnos.controller.ts:50`—. **94 tienen pantalla y 9 no.** De las 9:

| Ruta                                         | Por qué                                                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET` y `PUT /archivos-locales/:clave`       | URLs firmadas que genera la API y abre el navegador — **por diseño**                                                                          |
| `GET /calendario/…/conflictos`               | ya viene dentro de `plan.conflictos` — **por diseño**, escrito en el hook                                                                     |
| `POST /auth/tenants` y `POST /auth/register` | alta de un gimnasio con `BootstrapKeyGuard`: **del operador, no de nadie del gimnasio**                                                       |
| `GET /auth/admin-only`                       | **endpoint de prueba** del checklist de la Fase 0                                                                                             |
| ⚠️ **`POST /turnos`**                        | **crear un turno a mano** — fuera a propósito desde la spec de la Fase 9                                                                      |
| ⚠️ **`PATCH /rutinas/:id`**                  | **una rutina se crea y se da de baja, pero NO SE EDITA**: el hook existe y `bloque-dias-fijos.tsx` no lo usa. No está escrito en ningún sitio |
| ⚠️ **`GET /packs/:id`**                      | `usePack` existe —es de la T1— y **ninguna pantalla lo usa**; el plan lo daba por «ya usado»                                                  |

⚠️ **El inventario del 19/10 no veía las tres de abajo**, y la causa es de método: contaba una ruta como
consumida si su literal aparecía en `apps/web`, y **un hook que nadie monta no es una pantalla**.
`POST /turnos` además no figuraba en ninguna de sus tres áreas. Y el «auth no pasa por `pedir`» de
aquel bloque explicaba cinco de las ocho de `auth`, no las ocho: las otras tres no tienen pantalla por
otro motivo.

## Trampas nuevas

**Una sesión cortada a mitad de una mutación deja el árbol en rojo con cara de bug.** Las mutaciones
llevan el marcador `MUTACION TEMPORAL`: al retomar, **un `grep` de eso va antes que cualquier
diagnóstico**.

**`prettier` vive en la raíz del repo**: desde `apps/web`, `pnpm exec prettier` no existe.

## Estado final

|                   |                                                    |
| ----------------- | -------------------------------------------------- |
| `apps/web`        | **1882 tests / 86 suites**, tsc limpio, `build` OK |
| `apps/api`        | **1339 / 67**, eslint en cero — sin tocar          |
| E2E de la API     | **218 / 13 — MEDIDO** en este cierre               |
| `packages/shared` | 103 / 4 — sin tocar, arrastrado                    |

De 1689 en web al empezar la fase: **+193**. T1–T4 y su infraestructura, **+158** (sin desglose: ver
arriba); T5, **+35** —la liquidación 25, el guardián del canal veinte 8, el id codificado 1 y la
liquidación en la lista blanca de Análisis 1—.

## Deuda anotada

**Nueva de esta fase:**

- ⚠️ **`PATCH /rutinas/:id` sin pantalla**: una rutina mal cargada sólo se arregla dándola de baja y
  creándola otra vez.
- **`GET /packs/:id` sin pantalla, con hook**: hoy no hace falta —el catálogo trae todo— y `usePack` es
  código que nadie monta.
- **`POST /turnos` sin pantalla**: la spec de la Fase 9 lo dejó para «cuando exista la configuración
  operativa», que ya existe. **La decisión sigue pendiente.**
- ⚠️ **`Importe` contra la cadena pelada**, en `packages/shared`.
- **Una revocación aplazada con `setTimeout`** cuenta como no revocada para el canal veinte si el test
  termina antes. Falsa alarma, no agujero, y está escrito en su docblock.

**Vieja, y sigue en pie:** la lista de la Fase 13 entera, con `navigator.clipboard`, el contexto de
navegación anidado, los atributos de los descendientes del `<body>`, partir el dato en trozos y el
`.value` que escriba la limpieza de un `useEffect` todavía abiertos; y ⚠️ **que la profesora no pueda ver
su propia liquidación**, que ahora que la pantalla existe es una decisión de una línea de rol y no de
una fase.

## Siguiente paso

Con esta fase **se acabaron las áreas sin pantalla**. Lo que queda son **tres endpoints sueltos y tres
decisiones de producto**: si se crea un turno a mano, si una rutina se edita, y si la profesora ve lo
que cobra.

## El checklist a mano (para Cesar)

Siete comprobaciones que **ningún test puede hacer**: no hay navegador en el entorno.

- [ ] **Registrar un pago** y comprobar que **el estado de pago de la ficha cambia**.
- [ ] **Registrar una seña** y comprobar que **NO pone al alumno al día**.
- [ ] **Entrar como `ADMIN_OPERATIVO`** y comprobar que **anular no está en el marcado** y no se pide.
- [ ] **Anular un pago** y comprobar que **sigue en la lista**, marcado, con cuándo y por quién.
- [ ] **Aprobar un comprobante** y comprobar que **sale de la cola** y que el cobro aparece en la ficha.
- [ ] **Dar de baja un pack** y comprobar **qué les pasa a los alumnos que lo tenían**: nada.
- [ ] **Mirar la liquidación de una profesora con una franja sin tarifa** y comprobar que **el aviso está
      al lado del importe** — y que arreglar la tarifa en `admin/horarios` lo hace desaparecer.
