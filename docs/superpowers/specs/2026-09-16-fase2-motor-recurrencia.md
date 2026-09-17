# Fase 2 — Motor de recurrencia

**Fecha:** 2026-09-16
**Estado:** aprobado
**Fuente:** `docs/BoxAdmin_Fase2_MotorRecurrencia.pdf`
**Base:** Fase 1 completa — ver `docs/superpowers/specs/2026-09-14-fase1-nucleo-operativo.md`

---

## 1. Objetivo

Un admin carga la rutina fija de un alumno **una sola vez** ("martes y jueves a las 18:00 en Pilates")
y el sistema genera los meses futuros por su cuenta, mostrando antes de confirmar todo lo que necesita
una decisión humana.

Es el mecanismo que en TurnoFit resolvían a mano "Rutina" y "Armado del mes siguiente".

**Criterio de éxito:** cargar 10 rutinas fijas y generar el mes siguiente produce las reservas
correctas sin intervención manual, y el sistema lista de forma acotada los casos que requieren
revisión.

---

## 2. Decisiones cerradas

Cuatro decisiones que el PDF deja abiertas o contradictorias. Las cuatro fueron consultadas y
aprobadas antes de escribir este documento.

### D1 — `previsualizar` es síncrono; `publicar` va a un job

`POST /calendario/:salaId/:anio/:mes/previsualizar` devuelve **200 con el plan completo**. No escribe
nada en la base, así que no hay razón para hacer esperar al admin ni para almacenar un resultado
intermedio.

`POST .../publicar` devuelve **202 con el `jobId`** y encola el trabajo en BullMQ. `GET
/calendario/:salaId/:anio/:mes` informa del estado del mes y del último job.

**Por qué:** el punto 7 del checklist exige que la generación real corra en background y no bloquee el
request, y eso es lo que justifica el job. Pero la previsualización es de solo lectura y es
interactiva: mandarla a una cola obligaría al admin a sondear para ver una lista de conflictos que el
servidor ya tiene calculada.

**Descartado:** ambas asíncronas (el admin espera dos veces y hay que persistir el resultado de la
previsualización en algún sitio); ambas síncronas (incumple el checklist).

### D2 — El cupo sale de la sala; el nombre, de la rutina

`Turno` exige `nombre` y `cupo`, y `RutinaFija` no los tiene. El cupo del turno generado sale de
**`Sala.cupoBase`** y el nombre de un campo `nombre` nuevo en `RutinaFija`.

Si `Sala.cupoBase` es `null`, esa sala **no puede generar** y aparece como conflicto explícito
`SALA_SIN_CUPO_BASE`, en lugar de inventar un cupo por defecto.

**Por qué:** `cupoBase` se almacena desde la Fase 1 y nunca se consumió; era deuda declarada. El cupo
es una propiedad del espacio físico, no de la rutina de un alumno.

**Descartado:** `cupo` en la rutina (diez rutinas del mismo martes a las 18:00 podrían pedir cupos
distintos para el mismo turno y habría que decidir cuál gana); un modelo `PlantillaTurno` aparte (más
limpio y probablemente el futuro, pero añade una entidad y una pantalla que el documento no pide).

### D3 — `VacacionAlumno.devuelveClase` queda inerte

Las fechas cubiertas por unas vacaciones **no generan reserva**. Como el consumo de clases se deriva
de las reservas (decisión D2 de la Fase 1), no generarla ya equivale a no gastarla: no hay nada que
"devolver".

El campo se almacena y se documenta como sin efecto hasta que exista facturación o créditos (Fase 5).

**Por qué:** cero código especulativo. La alternativa de sumar a `Perfil.clasesExtra` reintroduciría
un contador acumulativo que se desincroniza al reeditar las vacaciones o al repetir la generación,
que es exactamente lo que la Fase 1 eliminó.

**Descartado:** generar la reserva y cancelarla según el campo (llena el calendario de reservas
canceladas y ocupa cupo un instante); sumar crédito a `clasesExtra`.

### D4 — Vacaciones y ausencias son exclusiones, no conflictos

El PDF se contradice: su paso 3 dice que las vacaciones solo excluyen fechas, pero la interfaz de
retorno incluye un conflicto `AUSENCIA_ALUMNO`.

Se resuelve separando las dos cosas en el resultado:

- **`conflictos`** — requieren decisión humana: `CUPO_LLENO`, `FUERA_DE_PACK`, `SALA_SIN_CUPO_BASE`.
- **`exclusiones`** — informativas, resultado de datos cargados a propósito: `AUSENCIA_SALA`,
  `VACACION_ALUMNO`.

**Por qué:** un mes con tres alumnos de vacaciones produciría decenas de "conflictos" que nadie tiene
que resolver y que esconderían los dos que sí. Pero excluirlas en silencio impediría distinguir "no se
generó porque está de vacaciones" de "no se generó por un bug", que es el tipo de silencio que este
proyecto viene corrigiendo desde la Fase 1.

---

## 3. Riesgo técnico a despejar primero

**El worker de BullMQ no tiene contexto de tenant.**

Todo el aislamiento entre gimnasios de BoxAdmin vive en un `AsyncLocalStorage` que abre
`TenantContextMiddleware` a partir del JWT de la request. **Un job no tiene request.** Cuando el worker
llame a Prisma, `getTenantContext()` devolverá `undefined` y la extensión lanzará
`MissingTenantContextError` en la primera query.

Eso no es un fallo: es el diseño fail-closed funcionando. Pero tiene dos consecuencias que hay que
cerrar antes de escribir el motor:

1. El job **debe abrir el contexto explícitamente** con `runWithTenant(tenantId, ...)` a partir de su
   propio payload.
2. El `tenantId` del payload pasa a ser **un dato de seguridad**: quien encola decide qué gimnasio se
   toca. El controller lo toma del JWT del actor, nunca del cuerpo de la petición.

La **primera tarea del plan** es un spike contra Redis y Postgres reales que responda:

1. ¿El worker puede operar envolviendo su trabajo en `runWithTenant`?
2. ¿Sobrevive el `AsyncLocalStorage` a través del `process()` de BullMQ y de sus `await` internos?
3. ¿Qué pasa exactamente si no se abre el contexto? (debe ser `MissingTenantContextError`, no una fuga)

Si la respuesta a (2) fuera negativa, el motor entero cambia de forma y hay que replantear antes de
escribir código.

---

## 4. Modelo de datos

### 4.1 Correcciones al esquema del PDF

| # | Problema en el PDF | Corrección |
|---|---|---|
| C1 | Las relaciones de `RutinaFija` llegan corruptas (`tenantId String @relation(...)`, tres `@relation` sueltos) | Reescribirlas correctamente y, como todo el schema desde la Fase 1, con **claves foráneas compuestas por tenant** (`@relation(fields: [tenantId, perfilId], references: [tenantId, id])`) |
| C2 | `VacacionAlumno` y `Ausencia` declaran `tenantId` sin relación; `Ausencia` no declara ninguna | Añadir las relaciones y las back-relations que faltan en `Tenant`, `Sala` y `Perfil` |
| C3 | `Ausencia.desde/hasta` son `DateTime` completo, junto a un `todoElDia Boolean` | `@db.Date` para las fechas, más `horaInicio` / `horaFin` opcionales en `"HH:MM"` — la misma convención que `Turno`. Cubre "cerramos el sábado de 14 a 18" sin arrastrar husos horarios |
| C4 | `RutinaFija` no tiene `nombre`, pero el `Turno` que genera lo exige | Añadírselo (D2) |
| C5 | Nada garantiza la idempotencia que exige el checklist | `@@unique([tenantId, salaId, fecha, horaInicio])` en `Turno`, y un **índice único parcial** sobre `reservas (tenantId, turnoId, perfilId) WHERE canceladaEn IS NULL`, escrito a mano en el SQL de la migración porque Prisma no declara índices parciales |
| C6 | `MesCalendario.publicadoPor` es un `String?` suelto | Se queda como escalar con el id del usuario, sin FK, igual que `HistorialAccion.usuarioId`: es auditoría, no una relación de negocio |

**C5 cambia una regla de la Fase 1.** Hasta ahora se podían crear dos turnos en la misma sala, fecha y
hora. Nunca debió ser posible —no hay dos clases a la vez en el mismo espacio— y el motor lo necesita
para ser idempotente de verdad. El e2e de la Fase 1 no lo ejercitaba, así que el cambio no rompe
ningún test existente, pero hay que añadir el caso.

**C5 obliga además a pagar una deuda declarada en la Fase 1**: traducir los códigos de error de Prisma
a respuestas HTTP. Un `P2002` de cualquiera de esos dos índices saldría hoy como un 500 opaco, porque
`AllExceptionsFilter` solo distingue `HttpException`. Entra en esta fase: `P2002` → 409, `P2003` →
400, `P2025` → 404.

### 4.2 Modelos nuevos

**`RutinaFija`** — el patrón semanal de un alumno: perfil, sala, `diaSemana` (0 = domingo … 6 =
sábado), `horaInicio` / `horaFin` en `"HH:MM"`, `nombre`, y la vigencia `desde` / `hasta` (con `hasta`
nulo = indefinida).

**`MesCalendario`** — el estado de publicación de una sala en un mes, como máquina de estados
explícita: `BORRADOR` → `HABILITADO`. `@@unique([tenantId, salaId, anio, mes])`, que además sirve de
cerrojo (ver §6).

**`VacacionAlumno`** — un rango de fechas en el que un perfil no genera reservas.

**`Ausencia`** — cierre de una sala o de todo el salón (feriado, evento, reforma). `salaId` nulo
significa "todo el salón". La Fase 6 la expondrá completa en Mantenimiento; el motor ya la respeta
desde aquí.

### 4.3 Qué significa el estado del mes

En la Fase 2 **`HABILITADO` no habilita nada funcionalmente**: no hay self-service todavía, así que
ningún alumno ve ni reserva nada. El estado registra que el mes se publicó, cuándo y quién, y es el
punto de enganche para la Fase 3.

Se documenta así a propósito para que nadie construya lógica sobre una garantía que aún no existe.

---

## 5. El motor de generación

### 5.1 Una función pura

`generacion-mes.service.ts` **no toca la base de datos**. Recibe los datos ya cargados y devuelve un
plan:

```ts
planificarMes(entrada: EntradaPlanificacion): PlanDeMes
```

donde `EntradaPlanificacion` trae `sala`, `anio`, `mes`, `rutinas`, `ausencias`, `vacaciones`,
`turnosExistentes`, `reservasActivas` y los `perfiles` implicados.

**Por qué:** los ocho casos del checklist se convierten en tests de esta función, sin base de datos ni
cola. Un orquestador aparte se encarga del I/O.

### 5.2 Algoritmo

En este orden, siguiendo el §5 del PDF:

1. Rutinas activas de la sala, vigentes en el mes: `desde <= fin_de_mes` y (`hasta` es null o `hasta >=
   inicio_de_mes`).
2. Para cada rutina, todas las fechas del mes que caen en su `diaSemana`, acotadas además por la
   vigencia de la propia rutina.
3. Descontar las fechas cubiertas por una `Ausencia` de esa sala o del salón entero → exclusión
   `AUSENCIA_SALA`. Descontar las cubiertas por una `VacacionAlumno` del perfil dueño de la rutina →
   exclusión `VACACION_ALUMNO`. La vacación de un alumno **no** cancela el turno para los demás.
4. Para cada fecha que sobrevive: si no existe `Turno` para esa sala + fecha + `horaInicio`, marcarlo
   como "a crear"; si existe, comprobar si el perfil ya tiene reserva activa ahí (idempotencia).
5. Comprobar cupo disponible. Sin cupo → conflicto `CUPO_LLENO`, no se crea la reserva y **no se
   aborta el resto**.
6. Comprobar que el perfil está dentro de la vigencia de su pack y le quedan clases según el conteo
   derivado de la Fase 1. Si no → conflicto `FUERA_DE_PACK`.
7. Si `Sala.cupoBase` es `null` y hay turnos que crear → conflicto `SALA_SIN_CUPO_BASE` (D2).
8. Acumular todo. **Nunca abortar la generación por un conflicto individual**: el objetivo es que el
   admin revise una lista acotada, no que un alumno con el pack vencido bloquee el mes entero.

### 5.3 El contrato de salida

```ts
interface PlanDeMes {
  turnosACrear: TurnoPlanificado[];
  reservasACrear: ReservaPlanificada[];
  conflictos: Conflicto[];   // CUPO_LLENO | FUERA_DE_PACK | SALA_SIN_CUPO_BASE
  exclusiones: Exclusion[];  // AUSENCIA_SALA | VACACION_ALUMNO
  resumen: { turnos: number; reservas: number; conflictos: number; exclusiones: number };
}
```

Cada conflicto y cada exclusión llevan `tipo`, `perfilId`, `fecha` y un `detalle` legible.

**Desviación respecto al PDF:** su `ResultadoGeneracionMes` devolvía `turnosACrear` y `reservasACrear`
como simples números. Aquí son las listas completas, porque `previsualizar` tiene que enseñárselas al
admin, y el resumen numérico va aparte en `resumen`.

---

## 6. Idempotencia y concurrencia

Publicar dos veces no debe duplicar nada, y es el caso **normal**: se da de alta un alumno a mitad de
mes, se vuelve a publicar y solo se crea lo que falta. Re-publicar un mes ya `HABILITADO` está
permitido.

Tres capas, de la más específica a la más general:

1. **El plan se calcula contra lo que ya existe**, así que la segunda corrida no encuentra nada que
   crear.
2. **La fila de `MesCalendario` es el cerrojo.** La publicación la toma con un `updateMany`
   condicional, de modo que dos publicaciones simultáneas del mismo mes no se pisan.
3. **Los índices únicos de C5** lo garantizan aunque fallen las dos anteriores, y ahora devuelven 409
   en vez de 500.

---

## 7. Endpoints

### 7.1 Rutinas fijas

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/rutinas` | ADMIN_OPERATIVO |
| GET | `/rutinas?perfilId=&salaId=&activa=` | ADMIN_OPERATIVO |
| PATCH | `/rutinas/:id` | ADMIN_OPERATIVO |
| DELETE | `/rutinas/:id` | ADMIN_OPERATIVO — baja lógica (`activa=false`) |

Crear una rutina valida que el perfil tenga acceso a la sala, igual que una reserva manual.

### 7.2 Calendario

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/calendario/:salaId/:anio/:mes/previsualizar` | ADMIN_OPERATIVO — 200 con el plan |
| GET | `/calendario/:salaId/:anio/:mes/conflictos` | ADMIN_OPERATIVO |
| POST | `/calendario/:salaId/:anio/:mes/publicar` | **ADMIN_SALON** — 202 con el `jobId` |
| GET | `/calendario/:salaId/:anio/:mes` | ADMIN_OPERATIVO — estado del mes y del último job |

### 7.3 Vacaciones y ausencias

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/vacaciones-alumnos` | ADMIN_OPERATIVO |
| GET | `/vacaciones-alumnos?perfilId=` | ADMIN_OPERATIVO |
| DELETE | `/vacaciones-alumnos/:id` | ADMIN_OPERATIVO |
| POST | `/ausencias` | **ADMIN_SALON** |
| GET | `/ausencias?salaId=&desde=&hasta=` | autenticado |
| DELETE | `/ausencias/:id` | **ADMIN_SALON** |

**Permisos:** el PDF no los define. El criterio es el mismo de la Fase 1 — configurar el salón contra
operarlo día a día — con una excepción deliberada: **publicar un mes es ADMIN_SALON**, porque crea
reservas para todo el salón de golpe. Cerrar el salón por un feriado también.

---

## 8. Auditoría

`HistorialService` ya existe. Se audita: alta, edición y baja de rutina; alta y baja de vacación y de
ausencia; y la publicación de un mes, con el resumen del plan en el `detalle`.

La publicación se audita **desde el worker**, con el `actorId` que viaja en el payload del job.

---

## 9. Pruebas

**Unitarias del planificador** — es donde está el valor. Los ocho casos del checklist del PDF: sin
conflictos, cupo lleno, pack vencido, ausencia de salón, ausencia de sala concreta, vacación de
alumno, re-ejecución idempotente, y rutina fuera de vigencia. Más los bordes de calendario: meses de
28, 30 y 31 días, y un `diaSemana` que no aparece en el mes.

**Unitarias de los servicios** con Prisma mockeado.

**e2e**:
- Flujo completo: rutina → previsualizar (no escribe nada) → publicar → comprobar en base.
- **Publicar dos veces y verificar que el número de reservas no cambia.**
- Una `Ausencia` de salón excluye la fecha para todos; una `VacacionAlumno` solo para su dueño.
- **El worker respeta el aislamiento**: un job encolado para el gimnasio A no toca datos del B.
- El índice único de turnos: crear dos turnos en la misma sala, fecha y hora da 409, no 500.

---

## 10. Checklist de aceptación

Los ocho puntos del §6 del PDF, verbatim:

1. Se puede cargar una rutina fija para un alumno (día de semana + hora + sala).
2. `previsualizar` devuelve la lista completa de turnos/reservas a crear sin escribir nada.
3. Los conflictos de cupo lleno, pack vencido y vacaciones se detectan y no interrumpen el proceso.
4. `publicar` ejecuta la generación real, es idempotente y actualiza el estado a `HABILITADO`.
5. Una `Ausencia` de salón/sala excluye esas fechas para todos los alumnos.
6. Una `VacacionAlumno` excluye solo a ese alumno, sin afectar el turno para el resto.
7. El job corre en background (BullMQ) y no bloquea el request HTTP.
8. Los tests unitarios del algoritmo cubren los seis casos listados.

---

## 11. Fuera de alcance

Del §7 del PDF: self-service del alumno, profesor vinculado al turno, pagos y comprobantes,
notificaciones.

Añadidos por este spec:

- `VacacionAlumno.devuelveClase` se almacena y no se aplica (D3).
- No hay lista de espera cuando el cupo está lleno: se registra el conflicto y nada más.
- No se regeneran meses pasados; `publicar` sobre un mes ya terminado se rechaza.
- `HABILITADO` no habilita nada funcionalmente todavía (§4.3).
- El motor no reasigna ni cancela nada que ya exista: solo crea lo que falta.
