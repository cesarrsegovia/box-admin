# Fase 13 — El área del profesor

**Fecha:** 2026-10-22
**Estado:** aprobado, pendiente de plan

## 1. Por qué existe esta fase

Son **tres endpoints**, y es la fase más chica del proyecto. También es la única en la que **una
pantalla que falta deja mintiendo a una que ya está entregada.**

### Hoy nadie puede marcar una ausencia

`POST /mis-clases/:turnoId/asistencia` es **el único sitio de todo el sistema que escribe
`asistio: false`** (`mis-clases.service.ts:158-168`). El check-in por QR escribe `asistio: true` y
nunca otra cosa (`checkin.service.ts:220,266`).

O sea que **hoy no hay un solo alumno marcado ausente en ningún gimnasio**. El reporte de asistencia
de la Fase 11 cuenta presentes y ausentes: los ausentes sólo pueden ser cero, todo el que se chequeó
aparece al 100% y el resto aparece como «no se le pasó lista». **El dato que le falta sólo se puede
cargar por `curl` con el token de una profesora.**

### Y una profesora que inicia sesión no llega a ningún lado

`destinoPorRol` sólo distingue `ADMIN_OPERATIVO` de todo lo demás, y manda al calendario del alumno.
El layout de `(alumno)` exige `rol === 'ALUMNO'`, así que una profesora que entra con su contraseña
aterriza en **«Esta no es tu area»**. Es un rol entero sin ningún sitio adonde ir desde la Fase 4.

| Método | Ruta | Rol | Devuelve |
| --- | --- | --- | --- |
| GET | `/mis-clases?desde=&hasta=` | `PROFESOR` | `ClaseDelProfesor[]` |
| GET | `/mis-clases/:turnoId/alumnos` | `PROFESOR` | `AlumnoEnClase[]` |
| POST | `/mis-clases/:turnoId/asistencia` | `PROFESOR` | — |

**No agrega ni modifica un solo endpoint.**

## 2. Decisión cerrada con Cesar

**`ClaseDelProfesor.listaPasada` no se usa.** Es `reservas.some(asistio !== null)`, y el check-in por
QR escribe `asistio`, así que **un solo alumno que escanea el QR hace que la clase figure como «lista
pasada»** aunque la profesora no la haya tocado.

El servicio del alumno ya separa esas dos cosas —`yaMarcada` mira la fila de `Asistencia`,
`listaPasada` mira `Reserva.asistio`— y su comentario explica por qué van separadas. **El contrato de
la profesora las fusiona**, y para ella la fusión es justamente la que miente.

**La agenda dice qué falta de verdad**: por cada clase, cuántos de los anotados tienen estado y
cuántos no — «faltan 7 de 9». Sale de `GET /mis-clases/:id/alumnos`, así que **cuesta una petición
por clase**: aceptable en la agenda de un día, caro en un rango largo. Ver §6.

Es más caro y es lo único que no miente, **y encima es más útil que un sí/no**.

## 3. Pasar lista es un reemplazo total, y eso es peligroso

`PasarListaDto` lleva **`presentes: string[]`** y nada más. El servicio marca `asistio: true` a los
que están y **`asistio: false` a todos los demás** de la clase.

⚠️ **Tres consecuencias que la pantalla tiene que tratar, no heredar:**

1. **Pasar lista puede pisar un check-in real.** Si alguien se chequeó por QR y la profesora abre la
   pantalla y tilda sólo a los que ve, **ese alumno queda ausente** aunque vino y lo registró.
   **La pantalla llega con los que ya tienen `asistio: true` ya tildados.** No es una comodidad: es
   lo que impide que el flujo natural destruya un dato verdadero.
2. **Una lista vacía marca ausente a toda la clase**, y es un camino que el servicio contempla a
   propósito. Es legítimo —puede no haber venido nadie— pero no puede ser el resultado de un clic
   distraído.
3. **Volver a pasar lista reescribe todo.** No hay forma de corregir a una sola persona: se manda la
   lista entera otra vez.

### Lo que el servidor ya impide, y la pantalla no repite

- **No se pasa lista de una clase que no empezó**: «Esa clase todavia no empezo». **Hacia atrás no hay
  límite**, y está razonado: «una profesora que se olvido tres semanas puede ponerse al dia».
- **Un id sin reserva activa se rechaza** nombrando los intrusos, con su motivo escrito: «Sin esta
  comprobacion, un id equivocado marcaria ausente a media clase en silencio».

## 4. Lo que la profesora ve de sus alumnos, y lo que no

`AlumnoEnClase` es **deliberadamente escueto**: `perfilId`, `nombreCompleto` y `asistio`. El contrato
lo dice por escrito — ni teléfono ni ficha médica, porque desde la Fase 1 `fichaMedica` sólo la ve
`ADMIN_SALON` o la propia persona, **y esta fase no abre esa puerta**.

La pantalla no pide nada más y no enlaza a ninguna ficha: **no hay ficha de alumno que una profesora
pueda abrir**, y ofrecerla sería ofrecer un 403.

## 5. El área nueva

Hace falta un grupo de rutas propio, con su layout, como ya existen `(alumno)` y `admin`. El de
`(alumno)` es el molde: comprueba la sesión, resuelve el rol, y si no es el suyo dibuja «Esta no es
tu area» con una salida hacia donde esa persona sí tiene algo.

⚠️ **Y hay que arreglar `destinoPorRol`**, que es lo que hoy deja a la profesora en la nada. Con una
pantalla propia, el login tiene que llevarla ahí.

**Pensada para un teléfono.** Quien pasa lista está de pie en la sala, con el teléfono en la mano y
nueve personas esperando. El layout de `(alumno)` ya es `max-w-md`; éste va igual.

## 6. El costo de decir la verdad

Pedir los alumnos de cada clase para saber cuántos quedan sin marcar es **una petición por clase**.
Eso obliga a una decisión de alcance que el plan tiene que cerrar: **qué rango abre la agenda por
defecto.**

El día de hoy son dos o tres clases y el costo es despreciable. Una semana son quince. **El plan
decide el rango por defecto y qué pasa cuando el rango elegido trae muchas clases** — y la respuesta
honesta puede ser no pedir el detalle más allá de cierto número y decirlo, en vez de pedirlo igual.

**Lo que no es aceptable es mostrar un sí/no que puede ser falso**, que es lo que §2 descarta.

## 7. Lo que se reusa

La tabla, `useRolDeQuienMira()`, el reparto de errores por campo, el andamiaje de hooks, el helper del
`volverA`, y los **trece canales globales** de `vitest.setup.ts` más los **dos ejes** —el rato libre y
los eventos de salida de la pestaña— contra un registro común que cada spec amplía con
`vigilarEstosDatos({...})`.

⚠️ **Esta fase siembra nombres de alumnos y quién vino y quién no**, que es un dato sobre personas que
no están en la sala para defenderse. Los centinelas importan.

Y dos cosas aprendidas en la Fase 12 que aquí aplican directo:

- **Un `<input>` o un `<textarea>` controlado de React escribe su valor en el atributo del marcado**
  (React sincroniza `defaultValue`, que *es* el atributo). Si algo de esta pantalla tiene un campo con
  un dato sensible, hay que saberlo.
- **No instalar dobles locales de nada que vigile el tapón global.** El de la Fase 9 dejaba 24 de 25
  tests en verde con una fuga delante.

## 8. Cómo se prueba

- **Una profesora que entra llega a su área**, y un alumno y un admin **no**.
- **La agenda no dice «lista pasada»**, y dice cuántos quedan sin marcar — con una clase donde alguien
  se chequeó por QR y nadie pasó lista, que es el caso que motiva la fase.
- **Los que ya tienen `asistio: true` llegan tildados**, con una clase sembrada mitad y mitad.
- **Guardar manda `presentes` con los tildados y nada más**, y **una sola vez**.
- **Marcar ausente a toda la clase se puede, pero no por accidente.**
- **Una clase que no empezó muestra el motivo de la API**, no una regla repetida en el cliente.
- **Un rango invertido muestra el motivo de la API.**
- **Una clase sin anotados se distingue de un fallo al leer.**
- **Ni el teléfono ni la ficha médica aparecen en ningún sitio**, afirmado sobre el marcado.

### La mutación abierta

Cada tarea lleva una. Van **cuarenta y cuatro de cuarenta y cuatro**. La familia es siempre **agregar
algo que no debería estar, sin quitar nada**, y lo que cambia es **dónde nadie estaba mirando**.

Las brújulas que vienen funcionando: una API que jsdom no implementa; algo que **desactiva o aplaza**
una defensa en vez de esquivarla; el **hueco entre dos defensas**; y —abierto y reportado— **los
atributos de los descendientes del `<body>`** y **un contexto de navegación anidado**.

Y las **cinco formas de que un test no pueda fallar**: autorreferencial; con la premisa destruida;
montado en el caso ciego; verde por casualidad ortográfica; y **con el fixture hablando el idioma del
código en vez del contrato** — **incoherente en lo derivado, posible en todo lo demás**.

## 9. Fuera de alcance

- **Cualquier cambio en `apps/api`.** Los tres endpoints están hechos, y arreglar `listaPasada` en el
  contrato —que es lo correcto de fondo— queda anotado.
- **Que la profesora vea su liquidación.** `GET /liquidacion/:profesorId` pide `ADMIN_SALON`: hoy una
  profesora **no puede ver lo que va a cobrar**, y abrirlo es una decisión de negocio, no de pantalla.
- **Editar la asistencia de una sola persona**: el endpoint es reemplazo total.
- **Que la profesora vea la ficha de un alumno**, que no existe para su rol.
