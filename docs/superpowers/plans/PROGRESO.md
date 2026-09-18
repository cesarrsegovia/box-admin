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
