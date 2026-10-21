# Fase 12 — La configuración del gimnasio

**Fecha:** 2026-10-19
**Estado:** aprobado, pendiente de plan

## 1. Por qué existe esta fase

Son **14 endpoints**, todos `ADMIN_SALON`, que hoy sólo se operan por `curl`. Y uno de ellos cierra
una promesa que ya está en producción: **la ficha de la sala de la Fase 10 dice «Hereda del
gimnasio» en tres ajustes, y no hay dónde mirar qué dice el gimnasio.**

| Área | Endpoints | Qué configura |
| --- | --- | --- |
| **La web pública** | 6 | Lo que ve quien todavía no es alumno |
| **El email** | 4 | Las credenciales SMTP y los textos que salen firmados con el nombre del gimnasio |
| **El check-in por QR** | 3 | La ventana alrededor del inicio del turno, y el QR |
| **La cola de trabajos** | 1 | Comprobar que la API alcanza Redis |

**No agrega ni modifica un solo endpoint.**

## 2. Decisiones cerradas con Cesar

1. **Tres pantallas bajo un índice** (`/admin/configuracion`) **más el botón de health-check en el
   propio índice** —ver la errata 3 al final—, no una página con secciones. La web
   pública sola son 6 endpoints con dos listas anidadas: es una pantalla por derecho propio. Y
   mezclar la identidad visual del gimnasio con credenciales SMTP hace que el guardar de una se
   parezca al de la otra.
2. **Las plantillas se previsualizan en un `<iframe sandbox>`** sin permisos, con los marcadores
   rellenados con datos de ejemplo. Es lo único que deja ver cómo llega el email de verdad, y el
   aislamiento evita que el HTML escrito por un admin corra en la sesión de otro.
3. **El botón de health-check se dibuja, nombrado por lo que prueba.** Ver §7.

## 3. El rol es uniforme, y eso simplifica la puerta

**Los 14 endpoints piden `ADMIN_SALON`.** Al revés que la Fase 11 —donde sólo la caja lo pedía y
había que esconder un bloque dentro de una pantalla— acá la puerta es **del área entera**.

⚠️ Para un `ADMIN_OPERATIVO`, **la entrada de Configuración no existe en el marcado** de la
navegación, y el índice y las tres pantallas **tampoco piden nada**: el gate va antes de los hooks, no con un
`enabled: false`. Es el patrón de horarios de la Fase 10. Y **sin proveedor de rol tampoco**: falla
cerrada.

## 4. La clave SMTP no se puede conservar, y la pantalla lo dice

`ConfiguracionSmtpPublica` **no lleva la contraseña, ni cifrada ni enmascarada**, y el contrato
explica por qué: *«una máscara sigue confirmando su longitud»*. Sólo viaja `tieneClave: boolean`.

Pero el DTO de escritura declara **`clave!: string`, obligatoria**. O sea:

⚠️ **No existe «dejá el campo vacío para conservar la que hay».** Cambiar el puerto obliga a volver a
escribir la contraseña entera. **Es una limitación real de la API, y la pantalla la explica en vez de
fingirla**: un campo con puntitos de relleno que al guardar manda vacío sería exactamente la clase de
mentira que esta fase existe para no cometer.

Es la misma familia que los tres límites que las pantallas ya explican desde la Fase 7 (no se puede
vaciar el `packId` de un alumno, ni sus vigencias, ni quitar un límite ya puesto a una invitación).

### Y guardar puede fallar por el servidor de correo

`guardarSmtp` **verifica la conexión ANTES de guardar**, y hay un test que fija ese orden. Un servidor
mal configurado devuelve un error de SMTP de verdad, no un error de formulario. Ese mensaje **ya pasa
por `motivoSeguro`, que redacta la contraseña** antes de que salga de la API.

La pantalla lo muestra tal cual. **Y no lo reescribe «para que se entienda mejor»**: el texto que
devuelve un servidor SMTP es la única pista de qué está mal.

## 5. Una plantilla por defecto no es una plantilla tuya

`PlantillaPublica.esPorDefecto` dice si lo que se está viendo es **la del código** o la que el
gimnasio escribió. Las cinco (`CONFIRMACION`, `CANCELACION`, `RECORDATORIO_PAGO`, `LISTA_ESPERA`,
`VENCIMIENTO_PACK`) siempre devuelven algo: un gimnasio nuevo funciona sin configurar nada.

⚠️ **Pintar una plantilla por defecto sin decirlo hace creer al admin que él la escribió**, y que
cambiarla es editar «su» texto cuando en realidad es crear el primero. Se distingue, con su test.

### Los marcadores son el borde afilado de la fase

Las plantillas son **Handlebars**, no sustitución simple: aceptan `{{#if x}}`. Y
`DatosDePlantilla = Record<string, string>`, o sea que **los marcadores válidos de cada tipo no están
declarados en ningún sitio**: son los que cada emisor pasa.

⚠️ **Y Handlebars renderiza un marcador que no existe como cadena vacía, no literal.** Un
`{{clase}}` en la plantilla de recordatorio de pago —que sólo recibe `alumno` y `gimnasio`— no sale
como `{{clase}}`: **sale como un hueco**. «Te esperamos en » y nada. El admin no se entera nunca; el
que lo sufre es un alumno.

**La pantalla lista los marcadores de la plantilla POR DEFECTO de ese tipo**, que es la única fuente
real que hay en el repo y que está garantizada a funcionar — las defaults rinden bien por
construcción. Puede quedarse corta si un emisor pasa más datos de los que su default usa, pero
**nunca promete uno que no llega**. Inventar una lista a mano sería una segunda fuente de verdad que
se desincroniza en silencio, que es justo lo que esta fase no debe hacer.

Y si el texto usa un marcador que no está en esa lista, **se avisa sin bloquear**: la lista
under-reporta a propósito, así que un bloqueo convertiría su conservadurismo en un impedimento.

### Lo que la API ya valida

`guardarPlantilla` **devuelve 400 antes de escribir** si la plantilla está mal formada (un `{{#if}}`
sin cerrar). El mensaje es del servidor y se muestra tal cual.

## 6. La web pública tiene un interruptor con consecuencias que no se ven

`ConfiguracionWebSalon` es **deliberadamente más ancha** que lo que sale sin sesión: acá sí viajan las
banderas apagadas —«el admin tiene que poder verlas apagadas para encenderlas»— y los ids de los
testimonios y las preguntas.

⚠️ **`mostrarTurnosLibres` lleva un aviso escrito en el propio contrato**: *«OJO: publica la agenda
del gimnasio y cuán vacía está.»* Es un interruptor que **sí funciona** —al revés que los tres campos
muertos de la Fase 10— y por eso se dibuja; lo que hace falta es que **diga la consecuencia al lado**,
no en una ayuda escondida. Un gimnasio con la agenda vacía está publicando que está vacío.

**`activa` es el interruptor maestro**: apagarlo tira abajo el sitio público. Lleva confirmación, y la
confirmación dice qué deja de verse, no «¿estás seguro?».

Los testimonios y las preguntas son **dos listas con alta y borrado propios** (`POST`/`DELETE`), no
campos del formulario: se guardan solos y no dependen del `PUT` general.

## 7. El health-check prueba menos de lo que su nombre promete

`POST /jobs/health-check` encola un ping y devuelve `{ jobId }`. **No hay endpoint para leer el
resultado**: el procesador escribe una línea en el registro del servidor, que el admin no ve.

**Se dibuja igual, y se llama por lo que prueba.** Si Redis está caído el POST falla, así que encolar
**sí** demuestra algo real: que la API alcanza la cola. El mensaje de éxito dice eso **y aclara que no
confirma que el job se haya procesado**.

Es la diferencia con `exclusiva`, `recuperable` y la franja horaria: aquéllos no hacían **nada**. Éste
hace algo verdadero y más chico que su nombre, así que la respuesta no es esconderlo sino **nombrarlo
bien**.

## 8. El check-in no distingue «sin configurar» de «quince y quince»

`ConfigCheckInService.ver()` devuelve `CONFIG_CHECKIN_POR_DEFECTO` cuando no hay fila, y el contrato
dice por qué: *«la ausencia de configuración no puede ser un check-in roto»*.

O sea que **desde la respuesta no se puede saber si alguien eligió 15 y 15 o si nunca tocó nada**. A
diferencia de los nulos de la Fase 10, acá **el comportamiento es idéntico en los dos casos**, así que
no hay nada que mentir — pero la pantalla **tampoco afirma cuál de los dos es**. Dice qué ventana rige
hoy, que es lo único que sabe.

El QR se sirve por `GET /config/checkin-qr/imagen`, que devuelve la imagen. `pedir` va contra
`/api/bx` con `credentials: 'same-origin'`, así que **un `<img src>` al mismo proxy lleva la cookie
sola**: no hace falta bajarlo como blob.

## 9. Lo que se reusa

La tabla, el diálogo de confirmación, `useRolDeQuienMira()`, el reparto de errores por campo, el
andamiaje de hooks, y los **diez canales globales** de `vitest.setup.ts` —consola, `document.title`,
`window.name`, `document.head`, los tres almacenes, `performance.mark`/`measure`, el `src` de una
imagen, las salidas laterales, CacheStorage y el service worker— más el montaje de
`requestIdleCallback`.

> ⚠️ **Errata 1, corregida al cerrar la fase (2026-10-21).** Eran diez **al escribir esta spec**; al
> cerrar son **trece canales y dos ejes**. Los tres canales que sumó esta fase: **IndexedDB** (el
> once), **los atributos del `<html>` y del `<body>`** (el doce) y **la URL del documento** (el
> trece). Los dos ejes —que no abren una puerta nueva, **mueven el momento** en que se mira— son
> **`montarElRatoLibre()`** (el catorce, de la Fase 11) y **los eventos de salida de la pestaña**
> (el quince, `src/test/salida-de-la-pestana.ts`, de esta fase).

⚠️ **Esta fase siembra la credencial de un servidor de correo.** Los centinelas importan más que en
ninguna otra: la clave SMTP, el usuario, el host y los textos de las plantillas.

## 10. Cómo se prueba

- **La clave SMTP nunca viaja de vuelta**, y la pantalla **no finge** que se conserva.
- **Un error del servidor de correo se muestra tal cual**, y no se reescribe.
- **Una plantilla por defecto se distingue de una propia.**
- **Los marcadores que se listan son los de la default de ese tipo**, y usar uno de fuera **avisa sin
  bloquear**. Con una plantilla que use `{{clase}}` en `RECORDATORIO_PAGO`, que es el caso real.
- **La previsualización no ejecuta nada**: el `iframe` va con `sandbox` sin permisos, y hay un test
  que lo fija **sobre el marcado** — no basta con que «se vea bien».
- **`mostrarTurnosLibres` dice su consecuencia al lado**, no en una ayuda escondida.
- **Apagar la web pública confirma diciendo qué deja de verse.**
- **Un `ADMIN_OPERATIVO` no tiene Configuración en el marcado y las pantallas no piden nada.**
- **Al montar sale esta lista de peticiones y ninguna más.**
- **Una respuesta vacía se distingue de un fallo al leer**, en las tres pantallas.

### La mutación abierta

Cada tarea lleva una. Van **treinta y ocho de treinta y ocho**. La familia es siempre **agregar algo
que no debería estar, sin quitar nada**, y lo que cambia es **dónde nadie estaba mirando**.

Dos lecciones que dejó la Fase 11 y que aquí pesan más, porque hay una credencial en pantalla:

1. **Una API que jsdom no implementa es un sitio donde nadie mira por construcción.** El `?.` que
   escribe alguien con cuidado convierte la ausencia del entorno de test en un silencio.
2. **No todo es un canal.** `requestIdleCallback` no era una puerta de salida sino **un reloj que
   apagaba los otros nueve**.

Y las **cinco formas de que un test no pueda fallar**: autorreferencial; con la premisa destruida;
montado en el caso ciego; verde por casualidad ortográfica; y **con el fixture hablando el idioma del
código en vez del contrato** — **incoherente en lo derivado, posible en todo lo demás**.

## 11. Fuera de alcance

- **Cualquier cambio en `apps/api`.** Los 14 endpoints están hechos.
- **Un endpoint que lea el resultado del health-check**, que es lo que haría falta para que ese botón
  cumpliera lo que su nombre promete. Queda anotado.
- **Subir imágenes** para la web pública: `imagenPrincipalUrl` es una URL, y de dónde sale es otra
  conversación.
- **Un editor visual de HTML** para las plantillas. Es un campo de texto con previsualización.
- **Las pantallas del profesor**, que siguen sin existir.

## 12. Erratas corregidas al cerrar la fase (2026-10-21)

Tres cosas que esta spec afirmaba y que al cerrar la Fase 12 resultaron falsas. **Se corrigieron
arriba, en su sitio, y se dejan listadas aquí para que nadie las vuelva a copiar de una versión
vieja.**

1. ⚠️ **«Diez canales globales» → trece canales y dos ejes.** La cuenta era la del día que se
   escribió. Esta fase sumó **IndexedDB** (el once), **los atributos del `<html>` y del `<body>`**
   (el doce) y **la URL del documento** (el trece), más el eje **quince** (los eventos de salida de
   la pestaña); el catorce es `montarElRatoLibre()`, de la Fase 11. Corregido en el §9.
2. ⚠️ **«Siete lecturas y siete escrituras» → cinco y nueve.** Es del plan y lo midió la T1. Los 14
   endpoints estaban bien; el reparto, no. Importa porque **cada escritura es un `gcTime: 0` y una
   decisión de invalidación**, y dos de las nueve no tienen nada que invalidar.
3. ⚠️ **«Cuatro pantallas» → tres pantallas más el botón de health-check en el índice.** La cola de
   trabajos es **un botón**, y encolar un ping es una acción de operación, no una configuración:
   **una página entera para un botón es peor que la alternativa**. Corregido en el §2, el §3 y el
   §10.
