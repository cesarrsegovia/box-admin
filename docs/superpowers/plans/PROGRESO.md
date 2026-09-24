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
- [x] T2 Contratos compartidos y utilidades de fecha — 18 tests nuevos en shared
      + 174 en la API. Hubo que montar jest en `packages/shared`, que no tenía
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

| # | Punto | Resultado |
|---|---|---|
| 1 | Crear una sala y configurarla con sus reglas propias | ✅ 201, `cupoBase: 12`, `exclusiva: true` |
| 2 | Crear un pack en el catálogo, independiente de cualquier alumno | ✅ 201, `precio: "12500.00"` como string |
| 3 | Alta de alumno y de profesor con DTOs y validaciones distintas | ✅ 201 / 201; mandar `packId` al alta de profesor → **400** |
| 4 | Un alumno sin salas genera un warning visible | ✅ 201 con `["SIN_SALAS","SIN_PACK"]`; `PATCH /salas` con `[]` → **400** |
| 5 | Crear un turno y asignarle una reserva manual respetando el cupo | ✅ 201 / 201, `fecha: "2026-10-05"` sin huso |
| 6 | Reservar un turno lleno devuelve 409 | ✅ **409**, sin registro fuera de cupo |
| 7 | Recuperable devuelve la clase; definitiva no | ✅ tras RECUPERABLE la siguiente reserva no advierte; tras DEFINITIVA avisa `PACK_AGOTADO` |
| 8 | Reasignar mueve el registro y valida el cupo del destino | ✅ 200, origen a 0 activas y destino a 1; destino lleno → **409** |
| 9 | Cada operación relevante queda en `historial_acciones` | ✅ 16 filas (Sala, Pack, Usuario, Turno, Reserva CREADA/CANCELADA/REASIGNADA), **0 sin `usuarioId`** |
| 10 | e2e cubren el flujo completo | ✅ 35 tests nuevos en `nucleo.e2e-spec.ts` |

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

| # | Punto | Resultado |
|---|---|---|
| 1 | Cargar una rutina fija | OK 201; 403 si el alumno no tiene acceso a la sala |
| 2 | `previsualizar` no escribe nada | OK 4 turnos / 4 reservas, base intacta |
| 3 | Los conflictos no interrumpen el proceso | OK cupo 1 y dos alumnos: 4 reservas + 4 CUPO_LLENO |
| 4 | `publicar` real e idempotente | OK 202, luego 4/4, y al repetir 0/0 |
| 5 | Una ausencia excluye la fecha para todos | OK el 13 desaparece del plan, sin crear turno |
| 6 | Una vacacion excluye solo a su alumno | OK el turno del 20 sigue, con el otro alumno |
| 7 | El job corre en background | OK 202 en menos de 1 s con 10 rutinas |
| 8 | Tests unitarios del algoritmo | OK 33 tests del planificador, mutaciones verificadas |

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

| # | Punto | Resultado |
|---|---|---|
| 1 | Auto-registro con clave válida | OK rol `ALUMNO`, con la sala de la clave |
| 2 | El alta aparece en la bandeja de pendientes | OK `?autoRegistrado=true` la lista |
| 3 | El alumno ve su calendario y reserva | OK `LIBRE` → reserva con `origen: ALUMNO` |
| 4 | Un turno lleno **ofrece** la lista de espera | OK 409 con el mensaje; posición 1 |
| 5 | Cancelar dispara la asignación del primero | OK B entra solo, `origen: LISTA_ESPERA` |
| 6 | Comprobante: subir, ver, aprobar | OK PUT 200, **descarga byte a byte igual**, `pagoAlDia: true` |
| 7 | Los turnos de un mes sin publicar no aparecen | OK `[]` antes de publicar |
| 8 | Las rutas públicas tienen límite | OK `401 401 401 429 429` |

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

| # | Punto | Resultado |
|---|---|---|
| 1 | Auto-registro con clave de invitación | ✅ con un matiz: **el pack no se elige, viene en la clave** |
| 2 | Ve el calendario y reserva o cancela | ✅ reservó, canceló, y el cupo se movió en el momento |
| 3 | Un turno lleno ofrece la lista de espera | ✅ **con `listaEsperaHabilitada` encendida**; apagada dice "Completo (5/5)" y no ofrece nada |
| 4 | Sube un comprobante y lo ve "pendiente" | ✅ el archivo llegó al almacén con sus 69 bytes reales |
| 5 | `mi-pack` muestra el consumo real | ✅ 1 de 8 tras reservar, 0 de 8 y "1 de 2 cancelaciones" tras cancelar |
| 6 | Instalable y offline para "mi calendario" | ✅ un service worker activo, manifest sin errores, iconos de 192 y 512 reales |
| 7 | Cambiar el slug no muestra datos de otro | ✅ redirige al login del slug nuevo |
| 8 | Vitest y Playwright | ✅ 106 + 5 |

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

| # | Punto | Resultado |
|---|---|---|
| 1 | El turno generado trae `profesorId` automáticamente | ✅ y **el nombre de la actividad no se toca** |
| 2 | Reasignar un turno puntual sin afectar el patrón | ✅ sobrevive a republicar el mes |
| 3 | Un `PROFESOR` ve únicamente sus clases | ✅ 3 de 4 tras darle una a otra |
| 4 | La lista no expone datos de otros | ✅ solo `perfilId`, `nombreCompleto` y `asistio` |
| 5 | Horas contratadas vs. dictadas | ✅ 240 min contratados, 180 dictados |
| 6 | El filtro `?profesorId=` | ✅ |
| 7 | Tests | ✅ 16 e2e nuevos, 5 mutaciones que muerden |

Más dos que añadió esta fase: pasar lista es idempotente y no toca las canceladas, y el feriado
descuenta de contratadas.

**Y el caso del primer día de uso real**: la liquidación de una profesora **sin ningún horario**
devuelve ceros y una lista vacía, no un 500.

### Las cinco mutaciones, todas muerden

| Qué se mutó | Test que rompió |
|---|---|
| `< 0` → `<= 0` en la contención horaria | `el final de la franja NO le pertenece` |
| Ignorar el rango de fechas del solape | `deja pasar el relevo` |
| **Quitar `if (turno.profesorId !== null) continue`** | `un turno que YA TIENE profesora no se toca` |
| Ignorar el solape de horas | `deja pasar dos clases seguidas` |
| Quitar `profesorId: null` del `where` del aplicador | el test del `updateMany` condicionado |
| `contratada && !cerrada` → `contratada` | `un feriado no suma a contratadas` |
| Quitar `profesorId` del `where` de `/mis-clases` | `devuelve solo las clases propias` (y 2 más) |

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

| # | Punto | Resultado |
|---|---|---|
| — | **El pago que vence HOY sigue al día todo el día** | ✅ contra el reloj real |
| 1 | Aprobar un comprobante crea el pago y actualiza el estado | ✅ con su `comprobanteId` enlazado |
| 2 | Pago manual sin comprobante | ✅ y `15000.50` no pierde centavos |
| 4 | Un pago vencido deja de poner al día solo | ✅ |
| 5 | Una seña no pone al día | ✅ |
| 6 | Anular saca del cálculo sin borrar la fila | ✅ |
| — | El listado devuelve el estado de todos | ✅ 6 alumnos en 17 ms |

### Las dos mutaciones muerden

| Qué se mutó | Test que rompió |
|---|---|
| `comienzoDeHoyUtc(hoy)` → `hoy` | `el ULTIMO dia del periodo cuenta ENTERO` |
| Quitar el filtro de `anuladoEn` | `un pago anulado no cuenta` |

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
- [~] T12 — Los e2e — **escritos, NUNCA EJECUTADOS** (Docker caido toda la sesion)
- [ ] T13 — Verificacion final, README y tracker — a medias, por lo mismo

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
- **`attempts: 1` NO impide una segunda tanda.** El camino *stalled* de BullMQ re-encola sin consultar
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

## Deuda anotada

- **El recordatorio de vencimiento repetido** (decision 1, arriba).
- **Las marcas de idempotencia viven en `job.updateData`, o sea en Redis.** Su sitio es una columna de
  `Reserva`, y hacen falta **tres**: confirmacion, cancelacion y cupo de lista de espera. Y **hay que
  escribirlas como compare-and-set**, mirando el `count` de un `updateMany` con la condicion en el
  `where`: con un `update` a secas se cambia la marca de sitio y se lleva el mismo agujero puesto, con
  apariencia de arreglado. Bloqueado por Docker.
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

**936 unitarios de la API / 53 suites**, **96 en `shared` / 4**, **149 en la PWA / 16**. `tsc --noEmit`
limpio en los tres paquetes, `pnpm build` de la web compila, y Prettier limpio sobre lo que escribe la
fase.

**Los e2e NO se corrieron**: Docker Desktop estuvo caido toda la sesion. Los de la T12 estan escritos y
marcados en el propio archivo como nunca ejecutados.

Las fases 3B, 4, 5A y la 5B hasta la T9 quedaron commiteadas por Cesar en `ae54b60 fase 5`.

## Siguiente paso

Levantar Docker y cerrar T12 y T13: correr los e2e (163 de baseline mas los nuevos), recorrer el
checklist a mano contra la API viva —con los tres puntos que ningun test automatico ve: que la
contrasena no aparece en el log, que un host inventado da 400 sin guardar nada, y que los crones
aparecen en Redis con la bandera encendida y no con la apagada— y hacer la migracion de las tres
columnas de idempotencia.

Despues, la Fase 6: analitica, web publica y check-in.
