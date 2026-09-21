# Fase 5A — El ciclo de cobro

**Fuente:** `docs/BoxAdmin_Fase5_PagosComunicacion.pdf` (primera mitad)
**Fecha:** 2026-09-21
**Estado:** aprobado por Cesar

---

## 1. Por qué la Fase 5 se parte en dos

El PDF de la Fase 5 cubre dos subsistemas con una costura limpia entre ellos:

- **El ciclo de cobro**: el modelo `Pago`, registrar un pago a mano, aprobar un comprobante y saber
  quién está al día.
- **La comunicación**: SMTP cifrado, plantillas, cuatro processors de BullMQ y notificaciones push.

Se parten por lo mismo que se partió la Fase 3. El cobro es pequeño y **se entrega solo**: el admin
gana control del dinero el mismo día. La comunicación es donde vive todo el riesgo —AES-256-GCM,
SMTP real, cron, `web-push`— y además **depende** del cobro: el job de recordatorio necesita saber
quién debe, y eso lo contesta esta fase.

La dependencia va en una sola dirección. Esta es la 5A.

---

## 2. Dos agujeros del PDF

**El importe no está en ninguna parte.** El PDF hace `Pago.monto` obligatorio y dice que aprobar un
comprobante crea el pago, pero un `Comprobante` es **la foto de una transferencia**: tiene archivo,
tipo MIME y estado, y ningún importe. Al aprobarlo, el sistema no sabe de cuánto era. Lo resuelve
**D3**.

**Nadie baja `pagoAlDia`.** Desde la Fase 3A, aprobar un comprobante lo pone en `true`. Nada lo pone
en `false` jamás. Tal como está, después del primer pago todo el mundo queda al día para siempre — y
el job de recordatorio de la 5B, que es el criterio de éxito del PDF, no le sonaría a nadie. Lo
resuelven **D1** y **D2**.

---

## 3. Decisiones cerradas

### D1 — El pago cubre un periodo, y "al día" se deriva

`Pago` gana `cubreDesde` y `cubreHasta`, y **"al día" deja de ser un dato guardado para ser una
pregunta**: ¿hay un pago vigente que cubra hoy?

**Por qué.** Es el criterio que este proyecto viene aplicando desde la Fase 1: el consumo del pack se
cuenta sobre las reservas en vez de guardar un contador, y la posición en la lista de espera se
deriva del orden en vez de guardarse. Un booleano que nadie mantiene es exactamente la clase de dato
que acaba mintiendo.

Y le deja a la Fase 6 la caja del mes casi hecha: un pago ya sabe a qué periodo pertenece.

```
1 de septiembre: pago que cubre del 01-09 al 30-09  -> al dia
1 de octubre:    ese pago ya no cubre hoy           -> pendiente

Nadie toco nada. Cambio la fecha.
```

### D2 — `Perfil.pagoAlDia` se borra; el override es un pago de cortesía

La columna desaparece. **Donde el contrato ya lo expone, no cambia**: `pagoAlDia: boolean` sigue en
`UsuarioDetalle` y en `MiPackPublico`, y la PWA de la 3B no se entera de nada. Lo que cambia es de
dónde sale el valor.

Y se **añade** a `UsuarioResumen`, que hoy no lo lleva. El objetivo que el PDF fija para esta fase es
que "el admin tenga visibilidad y control completo del estado de pago de cada alumno", y eso se ve en
un listado, no abriendo las fichas de uno en uno.

`PATCH /usuarios/:id/estado-pago` —que el PDF pide— pasa a crear **un pago de cortesía**: importe 0,
método `CORTESIA`, con el periodo que el admin indique. Es el gimnasio diciendo "este mes lo doy por
pagado".

**Por qué.** Todo pasa por la misma tabla, así que hay una sola verdad. Y la Fase 6 ve la cortesía
explícitamente en vez de encontrarse un alumno al día que no pagó nada y no poder explicar por qué.

`{ alDia: false }` **anula las cortesías vigentes y no toca los pagos reales**: nadie puede borrar un
cobro desde ese endpoint.

### D3 — El importe y el periodo los pone el admin al aprobar

`PATCH /comprobantes/:id/aprobar` pasa a exigir `monto` y `cubreHasta`, y acepta `metodo`.

**Por qué.** El admin está mirando la foto de la transferencia: es el único que sabe de cuánto era.
Deducirlo del precio del pack registraría un importe que nadie verificó, y se equivocaría en todos
los casos que existen de verdad: pagos parciales, señas, ajustes y alumnos que cambiaron de pack
desde que subieron la foto.

Cambia el contrato de un endpoint de la Fase 3A y hay que retocar sus e2e. Es la fase que le da
sentido: hasta ahora aprobar solo encendía una bandera.

---

## 4. Modelo de datos

```prisma
/// Enum y no `String` libre como el PDF: un typo en un string libre es un bug
/// silencioso, y el enum lo convierte en error de compilacion. Mismo criterio
/// que TipoCancelacion (Fase 1) y EstadoComprobante (Fase 3A).
enum MetodoPago {
  EFECTIVO
  TRANSFERENCIA
  CORTESIA
  OTRO
}

model Pago {
  id       String @id @default(cuid())
  tenantId String
  tenant   Tenant @relation(fields: [tenantId], references: [id])

  // FK COMPUESTAS por tenant, como todo el schema desde la Fase 1: la base
  // impide por si misma que un pago cruce de gimnasio.
  perfilId String
  perfil   Perfil @relation(fields: [tenantId, perfilId], references: [tenantId, id])

  monto  Decimal    @db.Decimal(10, 2)
  metodo MetodoPago

  /// Una sena reserva un lugar; no pone al alumno al dia. Ver seccion 5.
  esSena Boolean @default(false)

  /// El periodo que cubre. Es lo que hace que "al dia" se pueda derivar.
  cubreDesde DateTime @db.Date
  cubreHasta DateTime @db.Date

  comprobanteId String?
  comprobante   Comprobante? @relation(fields: [tenantId, comprobanteId], references: [tenantId, id])

  /// Escalar sin FK, igual que HistorialAccion.usuarioId: es auditoria.
  registradoPor String
  nota          String?

  /// Un pago no se borra: se anula. Es dinero, y borrar la fila reescribe la
  /// caja que la Fase 6 va a leer. Ademas cubre el caso feo y real: el admin
  /// tecleo 250000 en vez de 25000.
  anuladoEn  DateTime?
  anuladoPor String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([tenantId, perfilId])
  /// La pregunta "quien esta al dia" filtra por aqui.
  @@index([tenantId, cubreHasta])
  @@map("pagos")
}
```

`Comprobante` necesita `@@unique([tenantId, id])` para poder ser destino de la FK compuesta, igual
que lo tienen `Usuario`, `Perfil`, `Sala` y `Turno`.

Y `Perfil` **pierde** `pagoAlDia`. La migración la borra.

Migración: `fase5a_ciclo_de_cobro`.

---

## 5. Cómo se deriva "al día"

Una función pura, sin base de datos, como `topeDelPack` (Fase 1) o `calcularLiquidacion` (Fase 4):

```ts
export interface PagoParaEstado {
  esSena: boolean;
  cubreDesde: Date;
  cubreHasta: Date;
  anuladoEn: Date | null;
}

export function estaAlDia(pagos: PagoParaEstado[], hoy: Date): boolean;
```

Un pago cuenta si cumple las tres:

1. **No está anulado.**
2. **No es una seña.** Una seña reserva un lugar, no pone al día. Es la única regla de negocio de
   esta fase que no sale del PDF: se decide aquí y queda anotada por si el gimnasio la ve de otra
   manera.
3. **Cubre hoy**, con los dos extremos incluidos: `cubreDesde <= hoy <= cubreHasta`.

### 5.1 Los listados no hacen N+1

`GET /usuarios` devuelve `pagoAlDia` de cada alumno. Derivarlo alumno por alumno serían N consultas.
En su lugar, **una sola**: se traen los pagos vigentes de todos los perfiles de la página y se
resuelve en memoria.

```ts
async function perfilesAlDia(
  cliente: ClientePrismaTx,
  perfilIds: string[],
  hoy: Date,
): Promise<Set<string>>;
```

Es el mismo patrón que `cargarPerfiles` en `calendario.datos.ts`: el I/O junta los datos y la regla
vive aparte.

---

## 6. Endpoints

| Método | Ruta | Rol mínimo |
|---|---|---|
| POST | `/pagos` | `ADMIN_OPERATIVO` |
| GET | `/pagos?perfilId=&desde=&hasta=` | `ADMIN_OPERATIVO` |
| PATCH | `/pagos/:id/anular` | `ADMIN_SALON` |
| PATCH | `/usuarios/:id/estado-pago` | `ADMIN_OPERATIVO` |
| PATCH | `/comprobantes/:id/aprobar` | `ADMIN_OPERATIVO` (cambia de contrato) |

**Anular pide `ADMIN_SALON`** y el resto no: registrar un cobro es operativo, deshacerlo es contable.

`GET /pagos` filtra por `perfilId` y por rango sobre `createdAt` —cuándo entró el dinero—, no sobre
el periodo que cubre. Son dos preguntas distintas y la de la caja es la primera; la Fase 6 añadirá la
otra si la necesita.

### 6.1 `POST /pagos`

```json
{
  "perfilId": "...",
  "monto": "25000.00",
  "metodo": "EFECTIVO",
  "cubreDesde": "2026-09-01",
  "cubreHasta": "2026-09-30",
  "esSena": false,
  "comprobanteId": null,
  "nota": "pago en mano"
}
```

`monto` viaja como **string con dos decimales**, nunca como number: es dinero, y un float binario no
representa 25000.10 exactamente. Misma regla que el precio de los packs desde la Fase 1.

Se rechaza con 400 si `cubreHasta` es anterior a `cubreDesde`. **No** se rechazan los periodos que se
solapan: pagar dos meses por adelantado es normal, y dos pagos que se pisan no crean ninguna
ambigüedad — la pregunta es "¿hay alguno que cubra hoy?", no "¿cuál?".

Si llega `comprobanteId`, se valida que el comprobante exista, sea de ese mismo perfil y esté
`APROBADO`.

### 6.2 `PATCH /usuarios/:id/estado-pago`

```json
{ "alDia": true, "cubreHasta": "2026-09-30", "nota": "beca" }
```

Crea un `Pago` con `monto: "0.00"`, `metodo: CORTESIA`, `cubreDesde` = hoy y el `cubreHasta`
indicado.

Con `{ "alDia": false }` anula **las cortesías vigentes** de ese perfil, y solo esas. Un pago real no
se toca desde aquí: para eso está `PATCH /pagos/:id/anular`, que pide otro rol.

### 6.3 `PATCH /comprobantes/:id/aprobar`

```json
{ "monto": "25000.00", "cubreHasta": "2026-09-30", "metodo": "TRANSFERENCIA", "nota": "..." }
```

Todo en una transacción: el comprobante pasa a `APROBADO` y nace el `Pago` enlazado, con
`cubreDesde` = hoy. Rechazar sigue sin crear nada, igual que hoy: un rechazo no quita un pago
anterior que sí estaba bien.

`metodo` es opcional y por defecto `TRANSFERENCIA`, que es lo que un comprobante es el 99% de las
veces.

---

## 7. Lo que se rompe, a propósito

- **`PATCH /comprobantes/:id/aprobar` cambia de contrato.** Sus e2e de la Fase 3A lo llaman con el
  cuerpo vacío; hay que retocarlos.
- **`pagoAlDia` sale de `CrearAlumnoDto` y de `ActualizarUsuarioDto`.** Con `forbidNonWhitelisted`
  activo, mandarlo pasa a devolver 400 — que es lo correcto: el estado de pago ya no se declara, se
  paga. Hay que retocar los tests que lo mandan.
- **Un alumno recién dado de alta queda pendiente** hasta su primer pago. Hoy también: el default de
  la columna era `false`.

---

## 8. Pruebas

**Unitarios de `estaAlDia`**, con tabla de casos: sin pagos, pago vigente, pago vencido, pago
anulado, seña vigente, y **los dos bordes exactos** de `cubreDesde` y `cubreHasta`.

**Unitarios del servicio**: el periodo invertido, el comprobante de otro perfil, la cortesía que se
anula sin tocar el pago real.

**E2E de la cadena completa**: subir comprobante → aprobar con importe → aparece el pago → el alumno
figura al día en `/usuarios` y en `/mi-pack` → pasa el tiempo y deja de estarlo.

**Mutación en dos sitios**, que son donde un test puede pasar sin probar nada:

1. **El borde de `cubreHasta`**: cambiar `<=` por `<` tiene que romper un test.
2. **El filtro de anulados**: quitarlo tiene que romper otro.

---

## 9. Checklist de aceptación

De los ocho puntos del §5 del PDF, a esta mitad le tocan tres:

1. Aprobar un comprobante crea el `Pago` correspondiente y actualiza el estado del alumno.
2. Se puede registrar un pago manual (efectivo/transferencia) sin comprobante asociado.
3. Tests: aprobación de comprobante → pago → estado.

Y tres que añade esta fase, por las decisiones que cerró:

4. Un alumno con un pago vencido figura como pendiente **sin que nadie toque nada**.
5. Una seña no pone al día.
6. Anular un pago lo saca del cálculo sin borrar la fila.

---

## 10. Fuera de alcance

- **Todo lo de comunicación**: SMTP cifrado, plantillas con Handlebars, los cuatro processors de
  BullMQ y las notificaciones push. Es la Fase 5B, y se apoya en esta.
- **La caja del mes y los reportes agregados**: Fase 6, como dice el propio PDF.
- **Cobrar de verdad**: no hay pasarela de pago ni la pide ninguna fase. Un `Pago` es el registro de
  algo que ya ocurrió fuera del sistema.
