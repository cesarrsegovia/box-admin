# Fase 8 — La publicación del mes

**Fecha:** 2026-10-08
**Estado:** aprobado, pendiente de plan

## 1. Por qué existe esta fase

La Fase 7 entregó el armazón del panel y el área de Personas. Esta sigue por **Operación diaria**, y
dentro de ella por lo único que no es un ABM: **el flujo que genera el mes**.

Hoy publicar un mes exige un `curl`. Es la acción que mueve el gimnasio: crea los turnos y las reservas
de todo un salón para todo un mes.

## 2. Lo que esta fase NO es

**Operación diaria son 28 endpoints en siete módulos**, no los 23 que estimé antes de contarlos:

| Módulo            | Endpoints |
| ----------------- | --------- |
| **calendario**    | **4**     |
| turnos            | 6         |
| salas             | 5         |
| horarios-profesor | 4         |
| reservas          | 3         |
| vacaciones        | 3         |
| ausencias         | 3         |

Esta fase entrega **sólo el calendario**. Son cuatro endpoints —de los que la pantalla usa tres— pero es
la pantalla más difícil del proyecto hasta ahora: un flujo con un trabajo en segundo plano y una acción
que escribe para todo el salón de una vez.

Las otras dos tandas —turnos y reservas por un lado, la configuración operativa por otro— son fases
posteriores.

## 3. Decisiones cerradas con Cesar

1. **Se empieza por la publicación del mes, sola.** Entrega por sí misma y es lo que hoy obliga a un
   `curl`.
2. **Una sola pantalla con el estado en la URL**, no un asistente con pasos. Ver §4.
3. **El trabajo se sigue en pantalla pero no la bloquea.**
4. **Resumen y conflictos arriba; las listas completas, plegadas.**

## 4. Por qué no hay asistente

`previsualizar` es **de sólo lectura y síncrono a propósito** — el comentario del servicio lo dice: «no
hay razón para mandar a una cola una operación de sólo lectura que el admin está esperando en
pantalla». Y su resultado es **función pura de `(salaId, anio, mes)`**.

Entonces **no existe estado de asistente que se pueda perder**. Poniendo los tres parámetros en la URL,
recargar, compartir el enlace o volver con el botón de atrás dan exactamente lo mismo, sin una sola
línea de máquina de estados.

Inventar pasos con memoria sería crear una segunda fuente de verdad para algo que el servidor ya sabe:
el mes conoce su propio estado, y el plan se deriva de la sala y el mes.

Se descartaron: tres rutas con un paso cada una (habría que custodiar un estado que la API no necesita,
y resolver qué pasa si alguien entra directo al último paso), y un diálogo (mete la acción más
consecuente del sistema en una capa flotante).

## 5. La pantalla

Ruta nueva: `apps/web/src/app/[slug]/admin/calendario/page.tsx`, más su entrada en
`ENLACES_DEL_PANEL` con mínimo `ADMIN_OPERATIVO`.

### 5.1 El estado, en la URL

`?salaId=...&anio=2026&mes=11`. Nada en `useState`, por el mismo motivo que los filtros del listado de
personas.

- Sin `salaId` o sin mes: sólo los dos selectores.
- Con los tres: `POST .../previsualizar` y `GET .../` en paralelo.

⚠️ **El selector no ofrece meses pasados.** No es una restricción inventada: `exigirMesGenerable` los
rechaza con 400 («No se puede generar un mes que ya pasó»), porque regenerar un mes pasado crearía
reservas para clases que ya ocurrieron. Ofrecerlos sería un 400 garantizado.

### 5.2 Qué se ve, y en qué orden

1. **Los selectores**, siempre.
2. **El estado del mes**: `BORRADOR` o `HABILITADO`, con `publicadoPor` y `publicadoEn`. Es lo primero
   que el admin necesita saber, antes que cualquier plan.
3. **El resumen** (`turnos`, `reservas`, `conflictos`, `exclusiones`) y **los conflictos**, agrupados por
   tipo: `CUPO_LLENO`, `FUERA_DE_PACK`, `SALA_SIN_CUPO_BASE`. Si no hay ninguno, se dice.
4. **Las exclusiones, aparte y marcadas como informativas**: `AUSENCIA_SALA` y `VACACION_ALUMNO`.
5. **Las listas completas, plegadas**: `turnosACrear` y `reservasACrear`.
6. **El botón de publicar.**

⚠️ **Los conflictos y las exclusiones no se mezclan.** El contrato las separa a propósito y explica por
qué: «un mes con tres alumnos de vacaciones produciría decenas de "conflictos" que nadie tiene que
resolver y que esconderían los dos que sí». Un conflicto exige una decisión humana; una exclusión es una
fecha que no genera reserva porque alguien cargó un dato a propósito.

### 5.3 Publicar

⚠️ **Sólo se dibuja si el rol alcanza `ADMIN_SALON`**, y **no existe en el DOM** para quien no llega —
no escondido con CSS. Es la única acción del módulo con ese nivel, y el comentario del controlador dice
por qué: «publicar crea reservas para todo el salón de golpe: es gestión, no operación diaria».

**Republicar un mes ya habilitado es seguro**, y la pantalla lo explica en vez de advertir. El
planificador es **incremental**: lee lo que ya existe y completa lo que falta. Verificado en el worker,
no supuesto — «los que YA tienen profesora no se tocan: tener profesora significa que alguien lo
decidió, y republicar el mes no puede deshacerlo».

## 6. Seguir el trabajo

`POST .../publicar` devuelve **202** con `PublicacionEncolada { jobId, ... }`. El mes queda en
`BORRADOR`: **quien lo pasa a `HABILITADO` es el worker**, cuando termina de escribir.

La pantalla consulta `GET .../` y lee `publicacion.estado`, de cinco valores: `sin_job`, `en_cola`,
`procesando`, `terminado`, `fallido`.

⚠️ **`publicacion` puede venir `null`** —el contrato lo declara `EstadoPublicacion | null`— **y además
existe el estado `sin_job`**. Son dos formas de decir «este mes no tiene ningún trabajo»: la pantalla
tiene que tratar las dos igual y no romperse con ninguna. Un mes nunca publicado trae además `id: null`.

El intervalo del sondeo lo fija el plan, pero el orden de magnitud son **segundos, no décimas**: esto no
es una barra de progreso, es saber si el trabajo terminó.

Tres reglas:

1. **Se deja de consultar cuando termina o falla.** Un sondeo que no para es una petición cada pocos
   segundos para siempre en la máquina del mostrador.
2. **El estado vive en el servidor, no en la pantalla.** Irse y volver, o recargar, muestra el estado
   real. Eso es lo que hace segura la decisión de no bloquear: no hay nada que perder al irse.
3. **`fallido` muestra el `error` del contrato**, no un «algo salió mal», y deja volver a publicar —
   reintentar sobre un mes a medio escribir lo completa, por lo mismo del §5.3.

## 7. Errores

| Caso          | Respuesta                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| **401**       | Al login, conservando la ruta.                                                                                   |
| **403**       | Se dice qué rol hace falta. Es el caso real de un `ADMIN_OPERATIVO` que llega legítimamente y no puede publicar. |
| **400**       | El mensaje de la API tal cual: para un mes pasado, es exactamente lo que hay que mostrar.                        |
| **Red caída** | Distinguida del rechazo y reintentable sin recargar.                                                             |

## 8. Lo que se reusa, y lo que no se pide

Un hook nuevo, `use-calendario-admin.ts`, con el patrón ya fijado: claves centralizadas y **`gcTime: 0`**
en la mutación (hay un test que lee el archivo de hooks para que una mutación nueva nazca cubierta).
`useSalas()` ya existe en `use-catalogos.ts`.

⚠️ **No se usa `GET .../conflictos`.** Devuelve exactamente `plan.conflictos`, que ya viene dentro de la
previsualización: pedirlo sería una segunda petición para un dato que ya está, y abriría la puerta a que
las dos respuestas discrepen. De los cuatro endpoints del módulo, la pantalla usa tres.

## 9. Cómo se prueba

Vitest, con los dos tapones globales que ya corren en los 36 archivos (el espía de `console.*` y el de
`document.title`).

- **El botón de publicar no existe en el DOM** para un `ADMIN_OPERATIVO`, afirmado **sobre el marcado**.
  `queryByRole` consulta el árbol de accesibilidad, que ya excluye lo que lleva `hidden`: la lección que
  costó la Fase 7.
- **El conjunto de meses ofrecidos se fija entero**, y no incluye pasados.
- **Los conflictos no quedan enterrados**: con un plan que trae conflictos y exclusiones, los conflictos
  se ven sin desplegar nada.
- **El sondeo para** en `terminado` y en `fallido`, comprobando **cuántas peticiones** salieron y no sólo
  que se llamó.
- **`fallido` muestra el error de la API** y deja reintentar.
- **El estado se lee del servidor**: dos montajes seguidos sin tocar nada muestran lo mismo.
- Los cuatro errores del §7.
- **Lista blanca de las peticiones que salen**, para que no se cuele `conflictos` ni nada de más.

### La mutación abierta

Cada tarea lleva una: la que al implementador le parezca que su código no sobreviviría y que ningún test
cubre. En las fases 6B y 7 se pidió dieciséis veces y encontró algo real **las dieciséis**.

La familia es siempre la misma —**agregar algo que no debería estar, sin quitar nada**— y lo que cambia
es **dónde nadie estaba mirando**: el payload RSC, dos cachés distintas, `localStorage`, un atributo del
DOM, una cabecera de respuesta, las cabeceras de la petición, `console.*`, el título de la pestaña.

En esta pantalla hay un dato que invita: el plan trae **listas completas de turnos y reservas con los
`perfilId` de los alumnos**, y la pantalla sólo necesita contarlos y mostrarlos plegados.

## 10. Fuera de alcance

- Turnos y reservas (9 endpoints) y la configuración operativa (15): fases posteriores.
- **Editar el plan antes de publicar.** La API no lo admite: el plan se deriva de los datos, y la forma
  de cambiarlo es cambiar las rutinas, los horarios o las ausencias.
- **Despublicar o vaciar un mes.** No existe endpoint.
- **Publicar varias salas de una vez.** La ruta es por sala; agrupar sería inventar una operación que la
  API no tiene.
- **Cualquier cambio en `apps/api`.** Si una pantalla parece necesitar un endpoint, es señal de que está
  inventando una capacidad en vez de usar la que hay.
