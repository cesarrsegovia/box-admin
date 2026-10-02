# Fase 6A — Analítica

**Fuente:** `docs/BoxAdmin_Fase6_AnaliticaWebCheckin.pdf`
**Fecha:** 2026-10-01

## 1. Por qué la Fase 6 se parte en dos

El PDF de la Fase 6 contiene tres subsistemas que no comparten modelo de datos ni reglas de negocio:
analítica, web pública del salón y check-in por QR. Sólo comparten capítulo.

Se parte igual que la 3 y la 5, y por el mismo motivo: **la analítica es lo único de la fase que toca
dinero real de personas.** La liquidación en pesos determina lo que cobra una profesora. Eso merece su
propio ciclo de spec, plan y revisión, sin competir por atención con una landing y un lector de QR.

- **6A (esta spec):** los siete endpoints de estadísticas. Sin modelos nuevos.
- **6B:** check-in por QR y web pública del salón. Ahí viven los cinco modelos que el PDF propone.

## 2. Qué NO entra, y por qué

**El panel visual.** El PDF declara como objetivo que "el admin tiene un panel de estadísticas
equivalente al de TurnoFit", con `recharts`. Pero **no existe ninguna pantalla de admin en todo el
proyecto**: la PWA de la Fase 3B es sólo del alumno, y ninguna fase construyó la del admin. Un panel
no sería agregar una pantalla, sería la primera pantalla de admin que existe —con su login, su
layout, su navegación y su autorización—, y eso es una fase entera.

Esta fase entrega **la API**. Los números se validan contra datos reales antes de dibujarlos, que es
el orden correcto: un gráfico bonito sobre un número equivocado es peor que ningún gráfico.

**Los cumpleaños.** El PDF los pide dentro de `/stats/asistencia` ("próximos 15 días"). `Perfil` no
tiene fecha de nacimiento, y agregarla no es una columna: hay que capturarla en el alta de alumno, en
el auto-registro y en el perfil de la PWA, o queda vacía para siempre — que es exactamente el error de
`Sala.exclusiva`. Además no son analítica: son una herramienta de marketing que se coló en el endpoint
de asistencia. **Deuda anotada, no implementada.**

**Un modelo de gastos.** Ver §5.

**Modelos nuevos de Prisma.** Esta fase no agrega ni una tabla. Es deliberado: todo lo que calcula se
deriva de datos que ya existen. Si algún reporte necesitara una tabla, sería señal de que está
inventando un dato en vez de leerlo.

## 3. La decisión que endereza la fase: cómo se le paga a una profesora

**Por hora dictada, a tarifa fija.** Lo que el gimnasio le cobra a los alumnos es un asunto separado.

**Por qué importa.** El PDF propone esta fórmula:

```
ingresos_totales_alumnos = SUM(Pago.monto) en el rango, de perfiles cuyas reservas caen en turno
monto_a_profesora       = SUM(horas_dictadas × tarifaPorHora)
monto_para_estudio      = ingresos_totales_alumnos - monto_a_profesora
                          + (50% base configurable por tenant)
                          + (ingresos de horarios sin profesor asignado)
```

La primera línea no se puede calcular sin inventar una regla de reparto: un alumno paga un pack
mensual y va a clases de varias profesoras. Atribuir ese pago a un turno concreto **cuenta el mismo
peso más de una vez**, y el resultado depende de cuántas clases tomó ese mes, que es un dato que
cambia hasta el último día. La tercera línea suma un porcentaje a una resta de pesos.

Las tres líneas problemáticas son piezas de un **reparto por porcentaje**. Con tarifa fija no hacen
falta:

- La atribución de ingresos desaparece.
- El "50% base" desaparece.
- Los "ingresos de horarios sin profesor asignado" desaparecen: una franja sin profesora asignada no
  le cuesta nada al gimnasio y no aparece en ninguna liquidación.

Y conviene notar que **el checklist de aceptación del PDF nunca pidió la atribución**: pide que
`/stats/liquidacion` calcule "horas contratadas vs. dictadas y el monto en $". Eso es exactamente lo
que esta spec entrega. La fórmula problemática vivía sólo en la prosa.

### 3.1 Qué horas se pagan

La Fase 4 separó las horas en tres banderas ortogonales **precisamente para que esta fase les aplicara
reglas distintas**. La regla es:

| franja | se paga |
|---|---|
| **Dictada** — hubo turno, incluidas las clases donde todos cancelaron porque la profesora fue igual | **sí** |
| **Contratada y no dictada** — no se creó turno porque nadie se anotó | no |
| **Cerrada** — un feriado o una ausencia pisó la franja | no |

Las tres se calculan y se devuelven con su importe. **Sólo las dictadas entran en el total a pagar.**
Las otras dos aparecen porque son la conversación que el admin va a tener con la profesora, y porque
ocultarlas obligaría a recalcularlas a mano.

## 4. La aritmética del dinero

Dos reglas explícitas, porque en dinero el redondeo no es un detalle de implementación.

**Centavos enteros, sin coma flotante y sin librería decimal.** La tarifa llega como string con dos
decimales (lo es desde la Fase 4), se convierte a centavos enteros, y el importe es
`minutos × tarifaCentavos / 60`. Los órdenes de magnitud —unos diez mil minutos al mes, tarifas de
hasta ocho dígitos— quedan muy por debajo del entero seguro de JavaScript, así que la multiplicación
es exacta. Lo único inexacto es la división, y ahí se redondea: **una sola vez, media unidad hacia
arriba, y a la vista.**

**Se agrupa por tarifa antes de multiplicar.** Una profesora puede tener franjas a tarifas distintas
en el mismo mes. Redondear cada franja y después sumar acumula error; sumar los minutos de cada tarifa
y multiplicar una vez por grupo, no. Cincuenta minutos a mil pesos la hora son 833,33: redondeado tres
veces da un número y redondeado una vez da otro, y la diferencia se la lleva una persona.

**Dónde vive.** `src/liquidacion/calcular-importes.ts`, **función pura, sin una sola query** — junto a
`calcular-liquidacion.ts`, que es su mismo dominio y cambia con ella, y llamada desde la propia
función pura para que todo el que pida una liquidación reciba sus importes sin que ningún service
tenga que acordarse de sumarlos. Recibe el
`LiquidacionProfesor` que la Fase 4 ya produce —con la tarifa ya resuelta por franja— y devuelve
importes. Misma decisión que `estaAlDia` y `calcularLiquidacion`: lo que toca dinero se prueba con una
tabla de casos, no levantando una aplicación.

## 5. La caja del mes

Cuatro números que no se mezclan:

- **Cobrado** — pagos no anulados del mes, desglosados por método. **Excluye las cortesías.**
- **Bonificado** — las cortesías, aparte y siempre visibles.
- **Costo de profesoras** — la suma de las liquidaciones del mes.
- **Margen** — cobrado menos costo de profesoras.

**Por qué el bonificado va aparte.** `CORTESIA` es un método de pago normal y nada obliga a que su
monto sea cero. Sumarlo al cobrado haría que un mes en el que el gimnasio regaló cuotas apareciera
como facturación. Son dos hechos distintos: lo que entró y lo que se regaló.

**Gastos = costo de profesoras.** El PDF pide "cobrado vs. gastos" y el sistema no tiene ningún modelo
de gastos. El único costo que conoce de verdad es el de las profesoras, que es además el principal de
un gimnasio así y el que esta misma fase aprende a calcular — con lo cual **cuadra por construcción**,
porque es el mismo cálculo que el reporte individual. Un libro de gastos general (alquiler, servicios)
es contabilidad, es otra fase, y hecho a medias —una tabla que nadie carga— haría que la caja mienta.

**Una advertencia que va escrita, no disimulada: cobrado es caja y costo es devengado.** Los pagos se
cuentan por cuándo entró el dinero (`createdAt`, el mismo criterio que fijó la 5A para `GET /pagos`);
el costo, por las clases de ese mes. Un alumno que paga octubre el 28 de septiembre entra en la caja
de septiembre. Es la base correcta para "¿cuánto entró este mes?", pero el margen de un mes concreto
puede verse raro si alguien cobra muy adelantado. Se documenta en el endpoint y en el README, en vez
de inventar una base mixta que nadie podría auditar.

## 6. Los otros cinco reportes: las definiciones

Lo difícil de estos reportes no son las consultas, son las definiciones. **Un porcentaje mal definido
no da error: da un número plausible y equivocado.**

**Ocupación** = reservas vivas sobre el `cupo` **del turno**, en los turnos del mes. El cupo del
turno y no el de la sala: un turno puede tener el suyo propio desde la Fase 1, y usar el de la sala
daría un porcentaje que no corresponde a ninguna clase real.

**Asistencia** = reservas con `asistio: true` sobre reservas **de turnos donde alguien pasó lista**.

> El denominador NO son todas las reservas. Si la profesora no pasó lista, eso no es "no vino nadie":
> es "no se sabe". Con el denominador ingenuo, un mes sin listas pasadas muestra 0% de asistencia y el
> admin concluye que se le está yendo la gente. `mis-clases.service.ts` ya tiene exactamente esta
> distinción (`listaPasada`); se reutiliza en vez de reinventarla.

**Cobranza** = perfiles al día sobre perfiles con pack, usando el `estaAlDia` de la 5A. Una sola
verdad sobre quién está al día, no dos.

**Cancelación** = canceladas sobre totales, **separando RECUPERABLE de DEFINITIVA**. Mezclarlas
esconde lo único accionable: la recuperable es alguien que reprograma, la definitiva es alguien que se
está yendo.

**Evolución trimestral** son las mismas cuatro métricas de los tres meses anteriores. No es un reporte
nuevo: es el mismo cálculo llamado cuatro veces, y por eso vive en la misma función.

**Composición de alumnos** = cuántos perfiles activos hay por cada pack y qué porcentaje del total es
cada uno, más el consumo de clases de cada alumno en el mes — derivado de sus reservas vivas, como
desde la Fase 1, nunca de un contador guardado.

**Turnos libres** = turnos futuros con `cupo` mayor que sus reservas vivas, dentro de los próximos
`mesesAdelante` meses. **Por defecto 3, con un tope de 12**: sin tope, un parámetro grande recorre la
tabla entera de turnos y el reporte se convierte en una forma cómoda de tirar la base.

**Pagos pendientes** = perfiles con pack que no están al día, con lo que más cancelan. El saldo
pendiente es **estimado** y el campo se llama así — es el precio del pack del alumno, no una deuda
calculada, porque el sistema no lleva cuenta corriente.

## 7. Los endpoints

| Método | Ruta | Rol |
|---|---|---|
| GET | `/stats/caja?anio=&mes=` — **sin `salaId`**, ver abajo | `ADMIN_SALON` |
| GET | `/liquidacion/:profesorId?anio=&mes=` — **ya existe**, se le suman los importes | `ADMIN_SALON` |
| GET | `/stats/operativo?mes=&anio=&salaId=` | `ADMIN_OPERATIVO` |
| GET | `/stats/turnos-libres?salaId=&mesesAdelante=` | `ADMIN_OPERATIVO` |
| GET | `/stats/pagos-pendientes?salaId=` | `ADMIN_OPERATIVO` |
| GET | `/stats/composicion-alumnos?mes=&anio=` | `ADMIN_OPERATIVO` |
| GET | `/stats/asistencia?desde=&hasta=&perfilId=` | `ADMIN_OPERATIVO` |

**Los reportes de dinero piden `ADMIN_SALON`.** Mismo criterio que fijó la 5A para los pagos:
registrar un cobro es operativo, mirar el margen del salón y lo que se le paga a cada profesora no lo
es.

⚠️ **La liquidación NO estrena endpoint.** El PDF pide `/stats/liquidacion/:profesorId`, pero la Fase 4
ya dejó `GET /liquidacion/:profesorId?anio=&mes=`, con su módulo entero —`liquidacion.datos.ts` arma la
entrada desde la base, el service llama a la función pura—, ya con rol `ADMIN_SALON` y con siete
aserciones de e2e cubriéndolo. Crear uno nuevo bajo `/stats/` duplicaría la carga de datos y dejaría
dos endpoints que responden lo mismo con distinta forma.

Lo que se hace es **sumarle los importes a la respuesta que ya devuelve**. Es literalmente lo que la
Fase 4 anticipó: *"la tarifa viaja ya resuelta para que allí sólo haya que multiplicar"*. Los tests de
horas que ya existen siguen cubriendo las horas, y lo nuevo sólo agrega campos.

Un mes futuro devuelve ceros, no un error: preguntar por un mes que todavía no pasó es legítimo.

## 8. El caché

Clave `stats:<tenant>:v<version>:<reporte>:<params>`, TTL de 5 minutos, y un contador por gimnasio que
se incrementa en las escrituras que tocan dinero, reservas o asistencia.

**Por qué un contador de versión y no invalidación dirigida.** Con una lista de claves a borrar, el
día que alguien agregue un reporte nuevo se olvida de sumarlo a la lista y ese reporte queda
permanentemente desactualizado. Con el contador, un `INCR` deja huérfanas todas las claves viejas de
golpe: **un reporte nuevo queda invalidado correctamente sin que nadie lo recuerde.** Invalida de más
—un pago tira también el caché de ocupación, que no cambió— y a esta escala eso no cuesta nada.

**Las dos defensas fallan hacia el mismo lado:** el peor caso de olvidarse un `INCR` es llegar tarde
cinco minutos, no quedar mal para siempre. El TTL es la red del contador, y el contador es la
precisión que el TTL no da.

La invalidación va **explícita**, con un `invalidar(tenantId)` llamado desde los servicios que
escriben. Una línea visible en cada sitio, en vez de un interceptor que lo haga por magia y que nadie
encuentre cuando falle. Los sitios son cinco: registrar y anular un pago, crear y cancelar una
reserva, y pasar lista. Esa lista va en el plan, pero **no es una lista que haya que mantener**: es el
punto entero del contador de versión que olvidarse de uno cueste cinco minutos de atraso y no un
reporte permanentemente equivocado.

**El problema que esto resuelve** es una llamada de soporte concreta: "cargué el cobro y la caja no lo
muestra". A los cinco minutos ya nadie se acuerda de que había un caché, y el panel queda marcado como
poco confiable para siempre.

## 9. Tests

La función pura, con tabla de casos: el redondeo de los cincuenta minutos, **dos tarifas distintas en
el mismo mes** (que es donde agrupar o no agrupar da números distintos), las tres banderas, y la
tarifa nula.

Los e2e cubren lo que el checklist exige que **cuadre**: la caja contra la suma de `Pago`, y la
liquidación contra horarios y turnos reales.

### 9.1 Mutaciones nombradas

Son las que no rompen nada por sí solas, que es el motivo de nombrarlas desde ahora:

- Redondear por franja en vez de por tarifa → cae el caso de **tres franjas iguales**.
  ⚠️ **NO** el de las dos tarifas distintas: 50 min a 1000 más 50 min a 2000 dan 250000 agrupando y
  sin agrupar, así que ese test es insensible a la mutación. Esta línea decía lo contrario y estaba
  mal; lo encontró la revisión corriendo la mutación en vez de creerle a la spec.
- Meter las cortesías en el cobrado → cae el e2e de la caja.
- Contar todas las reservas en el denominador de asistencia → cae el caso del mes sin listas pasadas.
- Pagar las contratadas, o las cerradas → cae la tabla de casos.
- Quitar el `INCR` de la invalidación → cae el test de que la caja refleja un pago recién cargado.
- Mezclar RECUPERABLE con DEFINITIVA en cancelación → cae el caso que las separa.

## 10. Checklist de aceptación

- [ ] Los números de `/stats/caja` cuadran exactamente contra la suma de `Pago` del período.
- [ ] `/stats/liquidacion/:profesorId` calcula horas contratadas, dictadas y cerradas, y el monto en
      pesos de cada grupo, pagando sólo las dictadas.
- [ ] El costo de profesoras de `/stats/caja` coincide con la suma de las liquidaciones individuales.
- [ ] Las queries están cacheadas y no recalculan dentro del TTL.
- [ ] Un pago recién registrado aparece en la caja **inmediatamente**, sin esperar al TTL.
- [ ] Un mes sin listas pasadas no reporta 0% de asistencia.
- [ ] Los reportes de dinero rechazan a `ADMIN_OPERATIVO`.

## 11. Deuda que esta fase anota y no implementa

- **Cumpleaños próximos** (§2): necesita `Perfil.fechaNacimiento` y capturarla en tres formularios.
- **Un libro de gastos** (§5): es contabilidad y es otra fase.
- **El panel visual** (§2): necesita que exista un frontend de admin, que hoy no existe.
- **`VacacionAlumno.devuelveClase`**, que la Fase 5B reetiquetó a la 6: sigue inerte. Con el conteo
  derivado de la Fase 1, no generar la reserva ya equivale a no gastar la clase, así que la columna
  sigue sin tener trabajo que hacer. **Se reetiqueta a la 6B o se borra**: una columna almacenada que
  no hace nada es el error de `Sala.exclusiva`, y ya lleva tres fases de mudanza.
