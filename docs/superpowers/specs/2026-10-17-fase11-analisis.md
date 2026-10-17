# Fase 11 — Análisis

**Fecha:** 2026-10-17
**Estado:** aprobado, pendiente de plan

## 1. Por qué existe esta fase

Los reportes de la 6A **llevan cuatro fases sin cara**. Son seis endpoints terminados, probados y
cacheados, y **la única forma de leerlos hoy es un `curl`**. Es lo más viejo sin tocar del proyecto.

No es una fase de números nuevos: es la fase en la que los números que ya se calculan **se pueden
leer sin mentir**. Y ahí está casi todo el trabajo, porque estos contratos están llenos de
distinciones que un panel mal hecho borra.

| Endpoint | Rol | Qué contesta |
| --- | --- | --- |
| `GET /stats/caja` | **`ADMIN_SALON`** | Qué entró, qué se bonificó, qué cuestan las profesoras, cuál es el margen |
| `GET /stats/operativo` | `ADMIN_OPERATIVO` | Ocupación, asistencia, cobranza y las dos cancelaciones, del mes y del trimestre |
| `GET /stats/composicion-alumnos` | `ADMIN_OPERATIVO` | Cuántos alumnos hay en cada pack y cuántas clases tomó cada uno |
| `GET /stats/asistencia` | `ADMIN_OPERATIVO` | Quién viene y quién no, en un rango libre |
| `GET /stats/pagos-pendientes` | `ADMIN_OPERATIVO` | A quién hay que llamar |
| `GET /stats/turnos-libres` | `ADMIN_OPERATIVO` | Dónde queda lugar |

**No agrega ni modifica un solo endpoint.**

## 2. Decisiones cerradas con Cesar

### 2.1. Dos de los seis no son reportes: son herramientas, y van donde se usan

**`pagos-pendientes` y `turnos-libres` no se leen, se trabajan.** Uno contesta «a quién llamo» y el
otro «dónde meto a este alumno los martes». Son preguntas que surgen **en medio de otra tarea**, no
preguntas que alguien se siente a hacerle a un panel.

Una lista de a quién llamar enterrada en una sección de reportes **no la llama nadie**: recepción no
entra ahí. Así que van donde surge la necesidad, y **Análisis queda con los cuatro que de verdad se
leen**: caja, operativo, composición y asistencia.

Es la misma decisión que las vacaciones en la Fase 10 —que viven en la ficha de la persona y no en
una pantalla propia— y por el mismo motivo.

⚠️ **Dónde exactamente va cada una es trabajo del plan**, no de esta spec, y pide mirar las pantallas
que ya existen antes de decidir. Lo que esta spec fija es que **no van en Análisis**.

### 2.2. Sin librería de gráficos

Cinco porcentajes y tres meses de historia se dibujan con `div`s y Tailwind. Cero dependencias
nuevas, los tests siguen afirmando sobre marcado propio y no sobre SVG generado por un tercero, y
—lo que más importa en esta fase— **el numerador y el denominador se pueden escribir al lado del
porcentaje**, que es justo lo que una librería de gráficos empuja a esconder.

Si algún día hace falta algo de verdad complejo, se agrega entonces.

## 3. El problema central: estos contratos distinguen cosas que un panel borra

Esta es la fase entera. Los seis contratos están escritos para no mentir, y **cada una de esas
distinciones se pierde si la pantalla la aplana**.

### 3.1. `denominador: 0` no es `0%`

`Porcentaje` manda **siempre** el numerador y el denominador, y lo dice por escrito:

> Sin ellos, un 0% y un "no hay datos" se ven igual, y son cosas distintas: `denominador: 0` significa
> que la pregunta no se puede contestar, no que la respuesta sea cero.

El campo `porcentaje` es `number | null`, y **el `null` es el caso que importa**. Un mes sin turnos
con una ocupación pintada como **0%** le dice al dueño que nadie vino; la verdad es que no hubo nada
a lo que venir.

**Los cinco porcentajes del operativo llevan su fracción a la vista**, no sólo el número grande.

### 3.2. La asistencia sólo cuenta lo que se pasó lista

El denominador de `asistencia` son **las reservas de turnos donde se pasó lista**, no las reservas.

O sea: **una profesora que no pasa lista no produce alumnos ausentes, produce alumnos invisibles.**
Sus clases no entran en el denominador y el porcentaje del gimnasio se calcula sin ellas. Un panel
que muestre «asistencia 94%» sin decir sobre qué, invita a tomar una decisión sobre un alumno con un
número que a lo mejor cubre tres clases de las doce que tomó.

`AsistenciaDeAlumno.porcentaje` es `null` **si no se le pasó lista ni una vez en el rango**, y ese
caso tiene que leerse como lo que es.

### 3.3. El margen mezcla dos bases, y el contrato lo avisa

> `cobrado` es CAJA —se cuenta por `Pago.createdAt`, cuando entró el dinero— y `costoProfesoras` es
> DEVENGADO —las clases de ese mes—.

Un alumno que paga octubre el 28 de septiembre **entra en la caja de septiembre**. Es la base
correcta para «cuánto entró este mes», pero **el margen de un mes concreto puede verse raro** si
alguien cobra muy adelantado, y comparar dos meses sin saber esto lleva a conclusiones falsas.

La pantalla lo dice. No en una nota al pie: **al lado del margen**.

### 3.4. Una cortesía no es facturación

`cobrado` **excluye** las cortesías y `bonificado` las junta aparte, porque «una cortesía es un método
de pago normal y nada obliga a que su monto sea cero». Sumarlas haría que un mes en el que el
gimnasio regaló cuotas apareciera como facturación.

Los dos números se muestran, y se muestra que son dos cosas.

### 3.5. `pendienteEstimado` no es una deuda

El contrato se llama así a propósito: **el sistema no lleva cuenta corriente.** Es lo que costaría
ponerse al día con un pack, no un saldo calculado.

⚠️ **Llamarlo «deuda» en pantalla sería una mentira con consecuencias**: alguien se la va a leer por
teléfono a un alumno.

### 3.6. Dos respuestas vuelven recortadas, y lo dicen

`ReporteTurnosLibres.mesesAdelante` **no es el eco del parámetro: es el número ya recortado.** Pedir
24 devuelve 12. El `hasta` de `ReporteAsistencia` vuelve igual.

La pantalla muestra **lo que se miró de verdad**, no lo que se pidió. Sin eso, quien pidió dos años
lee una lista corta como «no hay más turnos» en vez de «no miramos más allá».

### 3.7. El dinero no pasa por un float

`Importe` trae `centavos` (entero, la verdad) y `texto` (dos decimales, para mostrar). **No existe un
campo con el importe en pesos como número, y es deliberado.** Cualquier cuenta que la pantalla haga
—una suma, un porcentaje sobre el total— se hace con `centavos`.

## 4. El rol parte la sección en dos

**La caja pide `ADMIN_SALON` y los otros tres `ADMIN_OPERATIVO`.** No lo inventamos: es el criterio de
la 5A, y el controller lo explica — registrar un cobro es operativo, mirar el margen del salón no.

⚠️ Para un `ADMIN_OPERATIVO`, la caja **no existe en el marcado**: no escondida con CSS, como el botón
de publicar el mes y el de resetear contraseñas. Y **sin proveedor de rol tampoco se dibuja**: falla
cerrada. Se afirma **sobre el marcado**, porque `*ByRole` consulta el árbol de accesibilidad, que ya
excluye lo que lleva `hidden`, y un `queryByRole` en null no distingue «no está» de «está oculto».

La entrada de Análisis en la navegación la ve `ADMIN_OPERATIVO`; lo que cambia es qué hay dentro.

## 5. Los números pueden tener hasta cinco minutos

`CacheDeStats` guarda cada reporte **300 segundos**, y las escrituras invalidan subiendo una versión
por gimnasio. O sea que, en el camino normal, registrar un pago **sí** mueve la caja.

Lo que hay que decidir en el plan es qué hace la pantalla cuando el número **no** se mueve: si ofrece
recargar, si dice cuándo se calculó, o si no dice nada. **Prometer «en vivo» sería lo único
inaceptable.**

## 6. Lo que se reusa

La tabla, `useRolDeQuienMira()`, el reparto de errores por campo, `useSalas()`, el helper del `volverA`
que conserva el query, el andamiaje de hooks (`src/test/andamiaje-de-hooks.tsx`), y los **cinco canales
globales** de `vitest.setup.ts` —consola, `document.title`, `window.name`, `document.head` y los tres
almacenes del navegador— contra un registro común que cada spec amplía con `vigilarEstosDatos({...})`.

⚠️ **Esta fase siembra más datos sensibles que ninguna**: importes, márgenes, lo que cuesta cada
profesora, y quién no pagó. Los centinelas importan más que de costumbre.

## 7. Cómo se prueba

- **`denominador: 0` se distingue de `0%`**, en los cinco porcentajes del operativo.
- **Un alumno sin lista pasada se distingue de uno con 0% de asistencia.**
- **El margen dice que mezcla dos bases**, y las cortesías no se suman a lo cobrado.
- **`pendienteEstimado` no se llama «deuda» en ningún sitio.**
- **La pantalla muestra los meses y el `hasta` que volvieron**, no los que se pidieron. Con una
  respuesta recortada sembrada, que es el único escenario donde la distinción existe.
- **Ninguna cuenta usa `texto`**: con un importe cuyo `texto` y `centavos` no concuerden, la suma sigue
  dando bien. Es la forma de fijar que el float no está.
- **Un `ADMIN_OPERATIVO` no tiene la caja en el marcado**, y sin proveedor de rol tampoco.
- **Al montar sale esta lista de peticiones y ninguna más**, y una por rol — porque los roles aquí
  **sí** piden cosas distintas, al revés que en horarios.
- **Una respuesta vacía se distingue de un fallo al leer.** Un 404 pintado como «no hay movimientos»
  diría que el gimnasio no facturó nada.

### La mutación abierta

Cada tarea lleva una. Van **treinta y dos de treinta y dos**. La familia es siempre **agregar algo que
no debería estar, sin quitar nada**, y lo que cambia es **dónde nadie estaba mirando**.

Y las **cinco formas de que un test exista y no pueda fallar**: autorreferencial; con la premisa
destruida por el código que prueba; montado en el caso ciego; verde por casualidad ortográfica; y
—la de esta semana— **con el fixture hablando el idioma del código en vez del contrato**, que es por
el lado de la entrada y vuelve decorativa cualquier aserción que se haga encima.

⚠️ **Esa quinta es el riesgo principal de esta fase.** Seis contratos con campos derivados —
`porcentaje` contra su fracción, `margen` contra sus sumandos, `texto` contra `centavos`— y **un
fixture incoherente los vuelve a todos indistinguibles**. Si el fixture dice `{ numerador: 3,
denominador: 4, porcentaje: 99 }`, ningún test puede decir cuál de los dos pinta la pantalla.
Al revés: **sembrar fracciones y porcentajes que no concuerden es la forma de saberlo.**

## 8. Fuera de alcance

- **Cualquier cambio en `apps/api`.** Los seis endpoints están hechos.
- **Exportar a CSV o a PDF.** Nadie lo pidió.
- **Rangos comparativos propios** más allá del trimestre que el operativo ya trae.
- **Las pantallas del profesor**, que siguen sin existir.
- **Los tres campos muertos** (`Sala.exclusiva`, `Ausencia.recuperable`, la franja de una ausencia):
  son de negocio y necesitan decidirse, no programarse a ciegas.
