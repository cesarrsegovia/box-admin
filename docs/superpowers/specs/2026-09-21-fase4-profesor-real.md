# Fase 4 — El profesor como entidad real

**Fuente:** `docs/BoxAdmin_Fase4_ProfesorReal.pdf`
**Fecha:** 2026-09-21
**Estado:** aprobado por Cesar

---

## 1. Objetivo

Hoy, en TurnoFit, el vínculo entre una profesora y un horario es **una parte del nombre de la
actividad**: "Circuito (Fati)". No es una relación; es una cadena de texto que nadie puede filtrar,
contar ni liquidar. El único vínculo real vive escondido en la planilla de liquidación.

Esta fase lo convierte en una relación de primera clase:

- `Turno.profesorId` apunta a un `Perfil` real.
- La profesora tiene su propia vista: **sus** clases, con **sus** alumnos.
- Queda el dato estructurado para liquidar por horas dictadas. **El cálculo en pesos es de la Fase
  6**, y esta fase no lo adelanta.

El criterio de éxito del PDF: asignar una profesora a un turno se ve en el calendario del admin, en
la vista propia de la profesora, y sirve para liquidar — **sin tocar el nombre de la actividad**.

---

## 2. Dos contradicciones del PDF, resueltas antes de empezar

El PDF de esta fase tiene dos huecos que no se pueden dejar para el momento de escribir el código.

**Primero: el horario de la profesora, ¿crea turnos o los etiqueta?** El modelo dice que
`HorarioProfesorAsignado` "alimenta la generación de turnos igual que `RutinaFija`". Tres líneas
después dice que el motor debe, "al crear/actualizar un Turno, resolver si existe un horario que
matchee sala+día+hora y setear `profesorId`". Crear y etiquetar no son lo mismo. Lo resuelve **D1**.

**Segundo: la asistencia no está modelada.** El PDF pide `POST /mis-clases/:turnoId/asistencia` pero
su sección de modelo de datos no la menciona, y en el schema actual no existe el concepto: `Reserva`
tiene `esPrueba`, `pagoRealizado` y la cancelación, nada más. Lo resuelve **D2**.

Hay un tercer detalle menor: `tarifaPorHora` se documenta como "null = usa la tarifa general del
tenant", y esa tarifa general **no existe** en `Tenant`. Lo resuelve **D3**.

---

## 3. Decisiones cerradas

### D1 — El horario solo etiqueta; nunca crea turnos

Un `HorarioProfesorAsignado` **no genera ningún turno**. Los turnos siguen naciendo de donde nacían:
de las rutinas fijas de los alumnos y del alta manual del admin. Cuando nace uno, el motor busca si
hay una profesora asignada a esa sala, ese día y esa hora, y le pone el `profesorId`.

**Por qué.** Es lo que hace que "horas contratadas vs. horas dictadas" signifique algo. Si el horario
creara el turno, toda hora contratada sería automáticamente una hora dictada y la métrica que el PDF
pide mediría siempre cero. Con el etiquetado, la franja que el gimnasio le paga a la profesora y
donde no se anotó nadie queda **contratada y no dictada** — que es exactamente el agujero que el
relevamiento de TurnoFit encontró y que esta fase tiene que hacer visible.

```
Lunes 18:00, Sala A · profesora contratada: Fati · rutinas de alumnos: 2
  -> se crea el turno, con profesorId = Fati

Martes 18:00, Sala A · profesora contratada: Fati · rutinas de alumnos: 0
  -> no se crea turno

Liquidacion del mes: contratadas 8 h | dictadas 4 h
```

### D2 — La asistencia es un campo de `Reserva`

`Reserva.asistio Boolean?`: `null` = todavía no se pasó lista, `true` = vino, `false` = faltó.

**Por qué.** La asistencia es una propiedad de "este alumno en esta clase", y eso es exactamente una
`Reserva`. No hace falta una tabla nueva con sus FK compuestas por tenant, ni dos sitios donde viva
"quién estuvo en esta clase" y puedan discrepar. El rastro de quién pasó lista y cuándo ya lo da
`historial_acciones`, que existe desde la Fase 0.

**Pasar lista es una foto del turno entero**, no un incremento:

```
POST /mis-clases/:turnoId/asistencia
  { "presentes": ["perfil-1", "perfil-3"] }

reserva de perfil-1 -> asistio = true
reserva de perfil-2 -> asistio = false
reserva de perfil-3 -> asistio = true
(las canceladas no se tocan)
```

Así es idempotente: pasar lista dos veces con la misma entrada da el mismo resultado, y corregir un
error es volver a mandar la lista buena.

### D3 — La liquidación devuelve horas y la tarifa resuelta, sin multiplicar

`GET /liquidacion/:profesorId?mes=&anio=` devuelve horas contratadas, horas dictadas, horas cerradas
y el detalle franja por franja. En cada franja va **la tarifa que le corresponde, ya resuelta** por
la cascada horario → tenant. **No multiplica nada.**

**Por qué.** El §6 del PDF deja el cálculo en pesos —tarifas, ajustes, el "50% base + horarios sin
profesora asignada"— para la Fase 6, "para no duplicar lógica de reportes en dos lugares distintos
del código". Adelantar la multiplicación sería justo eso.

Pero guardar `tarifaPorHora` sin exponerla ni resolverla repetiría el error de `Sala.exclusiva`: una
columna almacenada que no hace nada y que nadie ejercita hasta que es tarde. Resolviendo la cascada
—y devolviéndola— la columna **se guarda, se ve y se prueba** desde el primer día, y la Fase 6 solo
tiene que agregar la aritmética.

Para que la cascada exista hace falta el eslabón que el PDF da por supuesto:
`Tenant.tarifaPorHoraProfesor Decimal? @db.Decimal(10, 2)`.

### D4 — Al regenerar un mes, el motor solo rellena huecos

El motor pone `profesorId` cuando el turno nace, y en los turnos que ya existen **solo si están sin
profesora**. Nunca pisa un valor puesto.

**Por qué.** Publicar un mes es idempotente y se puede repetir. Si el motor re-resolviera siempre,
la suplencia que el admin puso a mano duraría hasta la próxima publicación y desaparecería sin que
nadie se entere — rompiendo el segundo punto del checklist del PDF.

No hace falta una columna nueva para distinguir "lo puso un humano": **tener profesora ya significa
que alguien lo decidió**. Y la regla cubre los dos caminos reales de golpe:

| Situación | Al regenerar |
|---|---|
| Turno con profesora Ana (suplencia), el patrón dice Fati | Sigue Ana |
| Turno sin profesora, el patrón dice Fati | Queda Fati |
| Turno con profesora Fati, el patrón cambió a Ana | Sigue Fati; el admin lo cambia a mano |

Lo único que esta regla no sabe expresar es "esta franja tiene patrón pero quiero que quede
deliberadamente sin profesora". Se acepta el límite: es un caso que nadie pidió, y resolverlo
costaba una columna y una rama más en cada endpoint que escribe un turno.

### D5 — El alta de un horario rechaza los dos solapes

`POST /horarios-profesor` devuelve **409** si:

1. Ya hay **otra profesora activa** en esa misma sala, día y hora, con rangos de fechas que se
   cruzan. Sin esto el etiquetado sería ambiguo: `Turno.profesorId` es uno solo, y cuál gana
   dependería del orden en que Postgres devolviera las filas.
2. **La misma profesora** ya está asignada a otra sala a esa hora. No puede estar en dos sitios, y
   si el gimnasio la carga así por error, sus horas contratadas salen infladas.

Las dos comprobaciones viven en el servicio, no en un `@@unique`: un índice no sabe de rangos de
fechas que se cruzan.

```
Fati, Sala A, lunes 18:00, desde 01-09   (existente)
Ana,  Sala A, lunes 18:00, desde 15-09   -> 409, se cruzan en la franja
Fati, Sala B, lunes 18:00                -> 409, Fati no puede estar en dos salas
Ana,  Sala A, lunes 18:00, desde 01-10   -> OK si el de Fati termina el 30-09
```

### D6 — Un día cerrado no cuenta como hora contratada

Si una `Ausencia` —feriado, reforma, evento— tapa una franja del patrón semanal de la profesora, esa
hora **sale de las horas contratadas** y aparece en un contador propio, `horasCerradas`, con su
motivo.

**Por qué.** Así "contratadas menos dictadas" significa una sola cosa: horas que el gimnasio tenía
contratadas y nadie usó **por falta de alumnos**. Mezclar ahí los feriados, que no son culpa de
nadie y se negocian de otra manera, obligaría a volver a separarlos en la Fase 6 para poder aplicar
reglas distintas.

```
Septiembre, Fati, lunes 18:00 (4 lunes): 1 feriado, 2 con alumnos, 1 sin alumnos

{ "horasContratadas": 3, "horasDictadas": 2, "horasCerradas": 1 }
```

---

## 4. Arquitectura

Tres módulos nuevos y tres tocados.

| Módulo | Qué es |
|---|---|
| `horarios-profesor/` | **Nuevo.** El CRUD del patrón semanal y la detección de solapes |
| `mis-clases/` | **Nuevo.** Las tres rutas del rol `PROFESOR` |
| `liquidacion/` | **Nuevo.** El conteo de horas del mes |
| `turnos/` | Gana `profesor` en la respuesta, el filtro `?profesorId=` y `PATCH /:id/profesor` |
| `jobs/generacion-mes/` | El planificador resuelve profesora y emite etiquetas |
| `reservas/` | `asistio` en el modelo y en el contrato público |

### 4.1 Lo puro y lo que toca la base

Se mantiene el patrón que la Fase 2 dejó montado y que hizo que los ocho casos del checklist fueran
tests unitarios de verdad: **la aritmética va en funciones puras, el I/O vive en el cargador**. Dos
funciones nuevas, las dos sin base de datos:

```ts
/** Cual de los horarios cubre esta franja, si alguno. */
function resolverProfesorDeFranja(
  horarios: HorarioParaPlan[],
  salaId: string,
  fecha: Date,
  horaInicio: string,
): string | null;

/** Las horas del mes de una profesora, ya clasificadas. */
function calcularLiquidacion(entrada: EntradaLiquidacion): LiquidacionProfesor;
```

Las dos se prueban con tablas de casos. `calcularLiquidacion` en particular: es la que va a crecer en
la Fase 6, y conviene que llegue allí con sus casos ya escritos.

### 4.2 Dónde se engancha el etiquetado

Tres caminos crean o mueven turnos, y los tres resuelven profesora:

| Camino | Qué hace |
|---|---|
| `planificarMes` | `TurnoPlanificado` gana `profesorId`; el cargador trae los horarios activos de la sala |
| El mismo plan, sobre turnos que ya existen | Emite `etiquetasDeProfesor[]` **solo para los que tienen `profesorId` null** (D4) |
| `POST /turnos` a mano | Acepta un `profesorId` opcional; si no viene, lo resuelve del patrón |

`planificarMes` sigue siendo pura: los horarios entran como un array más de `EntradaPlanificacion`, y
`TurnoExistenteParaPlan` gana un campo `profesorId` para que el planificador sepa cuáles son huecos.

**Qué cuenta como "esa hora".** El PDF dice "sala+día+hora", pero comparar `horaInicio` por igualdad
exacta dejaría fuera el caso corriente: una profesora contratada de 18:00 a 19:00 y una rutina que
empieza a las 18:30. El turno **cae dentro** de su franja y es suya. La regla es por tanto de
contención: el turno pertenece al horario cuando su `horaInicio` está en `[horaInicio, horaFin)` del
horario. Es la misma noción de solape que usa D5 para rechazar dos horarios en la misma sala, así
que las dos reglas no pueden discrepar.

El aplicador del plan (`publicacion.service.ts`) hace un paso más: recorre `etiquetasDeProfesor` y
actualiza esos turnos. Como el plan solo incluye huecos, el paso es idempotente por construcción.

---

## 5. Modelo de datos

```prisma
model Turno {
  // ...campos existentes...
  profesorId String?
  // FK COMPUESTA por tenant, como todo el schema desde la Fase 1: la base
  // impide por si misma que un turno cuelgue de una profesora de otro gimnasio.
  profesor   Perfil? @relation("TurnoProfesor", fields: [tenantId, profesorId], references: [tenantId, id])

  @@index([tenantId, profesorId])
}

model Reserva {
  // ...campos existentes...
  // null = todavia no se paso lista. Ver D2.
  asistio Boolean?
}

model Tenant {
  // ...campos existentes...
  // El eslabon que faltaba de la cascada de tarifas. Ver D3.
  tarifaPorHoraProfesor Decimal? @db.Decimal(10, 2)
}

model HorarioProfesorAsignado {
  // El patron semanal de una profesora: "lunes y miercoles 18:00 en Pilates".
  //
  // Conceptualmente es lo mismo que RutinaFija, pero para DICTAR en vez de para
  // tomar, y se mantiene como modelo aparte porque las reglas de negocio no se
  // parecen: no consume pack, no tiene cancelaciones, y alimenta la liquidacion
  // en vez del consumo de clases.
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  profesorId String
  profesor   Perfil @relation(fields: [tenantId, profesorId], references: [tenantId, id], onDelete: Cascade)
  salaId     String
  sala       Sala   @relation(fields: [tenantId, salaId], references: [tenantId, id], onDelete: Cascade)

  diaSemana  Int    // 0 = domingo ... 6 = sabado, como RutinaFija
  horaInicio String // "HH:MM", misma convencion que Turno
  horaFin    String

  activo Boolean   @default(true)
  desde  DateTime  @db.Date
  hasta  DateTime? @db.Date // null = indefinido

  // null = usa Tenant.tarifaPorHoraProfesor. Ver D3.
  tarifaPorHora Decimal? @db.Decimal(10, 2)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([tenantId, profesorId])
  // El indice del etiquetado: el motor pregunta por sala + dia en cada franja.
  @@index([tenantId, salaId, diaSemana])
  @@map("horarios_profesor_asignados")
}
```

Las FK del PDF vienen simples (`fields: [profesorId]`). Aquí se reescriben **compuestas por tenant**,
igual que se hizo con `RutinaFija` en la Fase 2, que llegó con el mismo problema.

Prisma exige el otro lado de cada relación, así que también se añaden:
`Perfil.turnosComoProfesor Turno[] @relation("TurnoProfesor")`,
`Perfil.horariosAsignados HorarioProfesorAsignado[]`, `Sala.horariosProfesor` y
`Tenant.horariosProfesor`.

Migración: `fase4_profesor_real`.

---

## 6. Endpoints

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/horarios-profesor` | `ADMIN_OPERATIVO` |
| GET | `/horarios-profesor?profesorId=&salaId=` | `ADMIN_OPERATIVO` |
| PATCH | `/horarios-profesor/:id` | `ADMIN_OPERATIVO` |
| DELETE | `/horarios-profesor/:id` | `ADMIN_OPERATIVO` |
| PATCH | `/turnos/:id/profesor` | `ADMIN_OPERATIVO` |
| GET | `/mis-clases?desde=&hasta=` | `PROFESOR` |
| GET | `/mis-clases/:turnoId/alumnos` | `PROFESOR` |
| POST | `/mis-clases/:turnoId/asistencia` | `PROFESOR` |
| GET | `/liquidacion/:profesorId?mes=&anio=` | `ADMIN_SALON` |

La liquidación pide `ADMIN_SALON` y no `ADMIN_OPERATIVO`: enseña tarifas.

### 6.1 La baja de un horario no reescribe el pasado

`DELETE /horarios-profesor/:id` es **baja lógica**: pone `activo = false` y además cierra `hasta` a
hoy si estaba abierto.

Las dos cosas, porque cada una sirve para algo distinto: `activo` es lo que filtran los listados y el
etiquetado; `hasta` es lo que mira la liquidación. **La liquidación no filtra por `activo`**, solo
por el rango de fechas — así, borrar un horario deja de generar etiquetas de hoy en adelante pero no
cambia lo que ya se liquidó en agosto.

`PATCH /horarios-profesor/:id` acepta los mismos campos que el alta, todos opcionales, y **vuelve a
correr las dos comprobaciones de solape** sobre el resultado: mover un horario media hora puede
chocar con otro que antes no molestaba.

### 6.2 `PATCH /turnos/:id/profesor`

Cuerpo: `{ "profesorId": "..." }`, o `{ "profesorId": null }` para quitarla. Valida que el perfil
exista en este gimnasio, que su usuario tenga rol `PROFESOR`, y **que tenga acceso a la sala del
turno** (ver §7).

Es la vía de la suplencia, y no toca el patrón semanal: el horario fijo sigue diciendo lo que decía.

### 6.3 `GET /turnos` (§4 del PDF)

Cada turno devuelto gana `profesor: { id, nombreCompleto } | null`, y el endpoint acepta
`?profesorId=` para que el admin vea de un vistazo la carga horaria de una profesora — lo que en
TurnoFit no se podía porque el dato no existía como relación.

`TurnoPublico` es un contrato compartido, pero **la PWA de la Fase 3B no lo usa** (el alumno ve
`TurnoDisponible` y `MiClase`), así que el campo nuevo no la afecta.

---

## 7. El aislamiento de la profesora

`/mis-clases` devuelve los turnos donde `profesorId` es el perfil del actor, y nada más. No hace
falta filtrar además por sala: el turno es suyo por definición.

Lo que sostiene el punto del checklist sobre "otras salas fuera de su asignación" está un paso antes:
**asignar una profesora a una sala a la que no tiene acceso se rechaza**, tanto en
`POST /horarios-profesor` como en `PATCH /turnos/:id/profesor`. Los profesores ya tienen filas en
`UsuarioSala` desde la Fase 1. Si el admin quiere la suplencia en una sala nueva, primero le da
acceso.

Sin esa puerta, una profesora podría acabar con un turno asignado en una sala que no puede ni ver, y
las dos mitades del sistema dirían cosas distintas sobre la misma clase.

Un admin que llame a `/mis-clases` recibe **404**, igual que en `/mi-calendario` desde la Fase 3A: no
tiene clases propias que mostrar. El patrón ya existe (`perfilDelActor`) y se reutiliza.

### 7.1 Qué ve la profesora de cada alumna

Nombre completo y si vino. **Ni el teléfono ni la ficha médica**: desde la Fase 1, `fichaMedica` "no
aparece en listados y en el detalle solo lo ve `ADMIN_SALON` o el propio usuario", y esta fase no
abre esa puerta.

### 7.2 La ventana para pasar lista

`POST /mis-clases/:turnoId/asistencia` se rechaza si el turno **todavía no empezó**: no se pasa lista
de una clase que no ocurrió. Hacia atrás no hay límite — una profesora que se olvidó tres semanas
puede ponerse al día, y el rastro queda en `historial_acciones`.

---

## 8. Cómo se cuentan las horas

La respuesta es **una sola lista de franjas**, cada una con tres banderas ortogonales, y los totales
derivados de ella.

| `contratada` | `dictada` | `cerrada` | Qué es |
|---|---|---|---|
| sí | sí | no | La clase se dio |
| sí | no | no | **Nadie se anotó** — el agujero que esta fase hace visible |
| sí | no | sí | Feriado: no suma a contratadas (D6) |
| no | sí | — | Suplencia: se dictó sin contrato en esa franja |

- **Contratadas** sale del patrón: cada fecha del mes que cae en `diaSemana`, dentro de
  `[desde, hasta]`, menos las tapadas por una `Ausencia` de esa sala o del salón entero.
- **Dictadas** sale de los turnos: todos los del mes con `profesorId` de esta profesora. Incluye las
  suplencias y las clases donde todos cancelaron — **la profesora fue igual**.
- **Cerradas** son las franjas contratadas que pisó una ausencia, con su motivo.

`minutos` enteros es la verdad; `horas` va como string con dos decimales. La Fase 6 multiplicará
`minutos / 60 × tarifa` en `Decimal`, sin pasar por un float en ningún momento — la misma razón por
la que los precios de los packs son strings desde la Fase 1.

La tarifa de cada franja se resuelve por cascada, y la respuesta dice de dónde salió:

```json
{
  "horasContratadas": "1.00",
  "minutosContratados": 60,
  "horasDictadas": "1.00",
  "horasCerradas": "1.00",
  "franjas": [
    {
      "fecha": "2026-09-07",
      "salaId": "sala-1",
      "horaInicio": "18:00",
      "horaFin": "19:00",
      "minutos": 60,
      "contratada": true,
      "dictada": true,
      "cerrada": false,
      "turnoId": "turno-1",
      "tarifaPorHora": "1500.00",
      "origenTarifa": "HORARIO"
    },
    {
      "fecha": "2026-09-21",
      "salaId": "sala-1",
      "horaInicio": "18:00",
      "horaFin": "19:00",
      "minutos": 60,
      "contratada": true,
      "dictada": false,
      "cerrada": true,
      "motivoCierre": "Feriado",
      "turnoId": null,
      "tarifaPorHora": "1500.00",
      "origenTarifa": "HORARIO"
    }
  ]
}
```

`origenTarifa` es `"HORARIO"`, `"TENANT"` o `null` cuando no hay ninguna definida — y `null` es un
estado legítimo, no un error: un gimnasio puede llevar los horarios sin haber cargado tarifas.

---

## 9. Pruebas

**Unitarios de las dos funciones puras**, con tabla de casos: `resolverProfesorDeFranja` (dentro y
fuera del rango de fechas, horario inactivo, día que no toca, ninguna coincidencia) y
`calcularLiquidacion` (las cuatro combinaciones de banderas, la cascada de tarifas, un mes sin
horarios, una suplencia sin contrato).

**Del planificador**: que un turno nuevo nazca etiquetado, que un turno existente sin profesora se
rellene, y que **uno con profesora no se toque**.

**E2E** para los siete puntos del checklist del PDF.

**Mutación en tres sitios**, que son donde un test puede pasar sin probar nada:

1. La comparación de rangos de fechas del solape (D5): cambiar un `<=` por un `<` tiene que romper un
   test.
2. La regla de "solo rellena huecos" (D4): mutarla a "pisa siempre" tiene que romper un test.
3. El aislamiento por profesora: quitar el filtro de `profesorId` en `/mis-clases` tiene que romper
   un test.

---

## 10. Checklist de aceptación

Los siete puntos del §5 del PDF:

1. Un turno generado desde un `HorarioProfesorAsignado` trae `profesorId` seteado automáticamente,
   sin depender del nombre de la actividad.
2. Se puede reasignar la profesora de un turno puntual (suplencia) sin afectar el patrón semanal.
3. Un usuario con rol `PROFESOR` ve únicamente sus propias clases en `/mis-clases`.
4. `/mis-clases/:turnoId/alumnos` no expone datos de otros profesores ni de otras salas fuera de su
   asignación.
5. El endpoint de liquidación devuelve correctamente horas contratadas vs. horas dictadas para un
   rango de fechas.
6. El filtro `?profesorId=` en `/turnos` funciona para el calendario admin.
7. Tests: asignación de horario fijo, generación con profesora resuelta, reasignación puntual, vista
   de "mis clases" con aislamiento correcto.

Y dos que añade esta fase, por las decisiones que cerró:

8. Pasar lista dos veces con la misma entrada deja el mismo resultado, y no toca las reservas
   canceladas.
9. Un feriado sobre una franja contratada no suma a `horasContratadas` y aparece en `horasCerradas`.

---

## 11. Fuera de alcance

- **El cálculo en pesos**: importes, ajustes y el "50% base + horarios sin profesora asignada" que el
  PDF deja explícitamente para la Fase 6.
- **Avisar a la profesora** de una suplencia o de un cambio de horario: Fase 5, con el hook de
  notificaciones que la 3A dejó preparado e inerte.
- **Una PWA del profesor**: la de la Fase 3B es solo del alumno, y ninguna fase pide otra. Las tres
  rutas de `/mis-clases` quedan disponibles para cuando se pida.
- **Expresar "esta franja tiene patrón pero no quiero profesora"**: límite aceptado de D4.
