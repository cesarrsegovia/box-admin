# Fase 7 — El panel del admin: armazón y Personas

**Fecha:** 2026-10-06
**Estado:** aprobado, pendiente de plan

## 1. Por qué existe esta fase

La 6A entregó siete reportes de estadísticas y la 6B la configuración del check-in y de la web
pública. Ninguna de las dos tiene pantalla. **No existe ninguna pantalla de admin en el proyecto**: la
PWA de la 3B es sólo del alumno.

Hoy, para dar de alta a un alumno hay que hacer un `curl`. Esta fase es la primera vez que el sistema
se puede usar sin un desarrollador delante.

## 2. Lo que esta fase NO es

El panel completo son **69 endpoints de admin repartidos en 20 módulos**, con dos roles distintos.
Agrupados por tema dan cinco áreas:

| Área             | Módulos                                                                       | Endpoints |
| ---------------- | ----------------------------------------------------------------------------- | --------- |
| Operación diaria | calendario, turnos, reservas, salas, horarios-profesor, vacaciones, ausencias | ~23       |
| **Personas**     | **usuarios, invitaciones, rutinas**                                           | **16**    |
| Dinero           | pagos, packs, comprobantes, liquidación                                       | ~9        |
| Análisis         | stats                                                                         | 6         |
| Configuración    | web-salón, check-in QR, email, jobs                                           | ~15       |

Las cinco juntas serían la fase más grande del proyecto por bastante, y arrastrarían el riesgo que ya
mostró la 6B: **cuanto más ancha la fase, más tarde aparecen los bugs que sólo se ven al usar la cosa de
verdad** — allí dos funciones centrales no habían funcionado nunca y 1290 tests estaban en verde.

Esta fase entrega **el armazón y el área de Personas**. Las otras cuatro áreas son fases posteriores y
heredan el armazón sin volver a discutirlo.

Se eligió Personas y no otra porque es la que convierte el sistema en usable —hoy el alta exige un
`curl`—, es chica, y **ejercita la frontera entre los dos roles de admin**: quince de sus dieciséis
endpoints piden `ADMIN_OPERATIVO` y uno, `reset-password`, pide `ADMIN_SALON`. Un área de sólo lectura
no habría puesto a prueba el armazón.

## 3. Decisiones cerradas con Cesar

1. **Empezamos por el armazón más Personas.**
2. **El panel vive en `apps/web`**, en un grupo de rutas `(admin)` dentro de `[slug]`. No una app
   aparte: duplicar el BFF, la sesión, el cortafuegos y el cliente HTTP son cuatro piezas de seguridad
   con dos implementaciones que hay que mantener iguales, y que con el tiempo se separan.
3. **Un solo login para todos**, con el destino decidido por el rol. Dos formularios de login son dos
   sitios donde equivocarse con el freno de intentos, los mensajes de error y el manejo del token.
4. **La puerta vieja del área de alumno se cierra en esta fase.** Hoy el layout de `(alumno)` sólo
   comprueba que la sesión sea de ese gimnasio, sin mirar el rol: un admin con sesión válida entra al
   área del alumno. No es un agujero de datos —la API responde según el rol— pero es una regla más
   floja conviviendo con la nueva, y el archivo se toca igual.
5. **Escritorio primero, degradando a teléfono.** Es al revés que la PWA del alumno, y está bien que lo
   sea: un listado de gente con rol, estado, pack y pago al día no entra cómodo en 360 píxeles, y
   comparar veinte alumnos de un vistazo es justo para lo que sirve un listado.
6. **La contraseña temporal tiene pantalla propia con confirmación explícita.** Ver §6.
7. **Rutas propias para cada pantalla**, no un cajón lateral. Ver §5.

## 4. El armazón

### 4.1 Rutas

```
apps/web/src/app/[slug]/
  (alumno)/      calendario, mi-pack, perfil, comprobantes
  (publico)/     login, registro
  (admin)/       ← nuevo
     layout.tsx          la puerta + el armazón
     page.tsx            inicio
     usuarios/
        page.tsx         listado con filtros
        nuevo/page.tsx   alta (alumno o profesor)
        [id]/page.tsx    la ficha
     invitaciones/
        page.tsx         listado + alta + edición
  checkin/       la pantalla del QR
  page.tsx       la landing pública
```

Los grupos entre paréntesis no afectan la URL. El panel queda en `/{slug}/admin/...`.

### 4.2 La puerta

`(admin)/layout.tsx` corre **en el servidor**, lee las cookies httpOnly y resuelve el rol con
`GET /auth/me`, que ya existe y no exige ningún rol.

⚠️ **El rol se pregunta a la API, no se deduce del token en el front.** El JWT lo lleva, pero
decodificarlo sin verificar la firma para decidir qué se dibuja es apoyarse en un dato que el cliente
podría haber tocado. `/auth/me` es el único que verifica.

Rechaza en tres casos, **pero no de la misma manera**:

| Caso                                         | Qué hace                                                |
| -------------------------------------------- | ------------------------------------------------------- |
| Sin sesión                                   | Al login, con `volverA` apuntando a donde iba.          |
| Sesión de otro gimnasio (`sesionValidaPara`) | Al login, igual.                                        |
| **Rol que no alcanza `ADMIN_OPERATIVO`**     | **Una pantalla de «no tenés permiso»**, no un redirect. |

⚠️ **El tercer caso no puede ir al login, y no es una preferencia: es un bucle infinito.** Un alumno
que abra `/gym/admin` sería mandado al login con `volverA=/gym/admin`; ese destino pasa la lista blanca
de `rutaDeRetornoSegura` porque es del mismo gimnasio; al entrar vuelve al panel; el panel lo rebota al
login otra vez. Volver a autenticarse no cambia el rol, así que el bucle no tiene salida.

La pantalla dice **qué rol hace falta** y ofrece volver al calendario y cerrar sesión.

⚠️ **La jerarquía de roles no se reimplementa.** `rolAlcanza(rol, minimo)` vive en
`packages/shared/src/roles.ts` y es la misma que usa el guard de la API. Los roles son jerárquicos
(`SUPERADMIN` 50 > `ADMIN_SALON` 40 > `ADMIN_OPERATIVO` 30), así que «admin operativo» significa «al
menos admin operativo».

### 4.3 El esqueleto visual

Barra lateral en escritorio, cajón en teléfono. Lleva el nombre del gimnasio, quién sos y salir.

**La navegación se dibuja desde el rol**: una lista declarativa donde cada enlace indica el mínimo que
pide, filtrada con `rolAlcanza`. Cuando llegue el área de Dinero, agregar su entrada es una línea en esa
lista y no un `if` nuevo escondido en un componente.

### 4.4 Tres cambios en lo que ya existe

1. **El service worker deja de cachear el panel**, y el manifest **se queda donde está**.

   Esta decisión se corrigió al mirar el código. La idea original era bajar el manifest del layout raíz
   al área del alumno, y es **falsa por dos motivos**:

   - **Rompería la PWA.** `apps/web/e2e/instalabilidad.spec.ts` hace `page.goto('/')` y exige que exista
     el `link[rel="manifest"]` y que el service worker se registre. El manifest vive en el layout raíz
     precisamente para cubrir la raíz.
   - **El manifest nunca fue el problema.** Es una etiqueta `<link>`. Lo que cachearía las pantallas del
     panel es `defaultCache` de Serwist, que guarda la carcasa — **HTML incluido**.

   Y ahí está el riesgo real, que es más serio que el que yo había escrito: **el HTML de un listado con
   nombres, emails y teléfonos quedando en la `CacheStorage` del navegador de la computadora compartida
   del mostrador**, legible después por cualquiera que se siente ahí.

   Entonces: una regla en `src/app/sw.ts` que **excluya del cacheo cualquier navegación bajo
   `/<slug>/admin`**, antes de `defaultCache`, porque la primera regla que casa es la que manda. La
   única regla de datos que existe hoy (`/api/bx/mi-calendario`) no se toca.

   El título del layout raíz («Tus clases, en tu bolsillo») sí se corrige, pero con el `metadata` propio
   del layout del panel, que es el mecanismo de Next para eso.

2. **El layout de `(alumno)` pasa a exigir el rol.**
3. **El login redirige según el rol**: admin al panel, el resto al calendario, que es lo que hace hoy.
   El `volverA` validado sigue mandando cuando viene.

   ⚠️ **El profesor no tiene a dónde ir.** Sus tres endpoints existen en la API desde la Fase 4, pero
   **no hay ninguna pantalla de profesor en el front**: hoy cae en el calendario del alumno como todo
   el mundo. Esta fase no lo cambia. Se anota como deuda, no se resuelve de paso.

### 4.5 Lo que se reusa sin tocar

El proxy `/api/bx/[...ruta]`, `lib/sesion.ts`, `lib/cliente.ts` (`pedir()` y `ErrorDeApi`, que desde la
6B conserva el cuerpo del error), `lib/api-url.ts` como cortafuegos, y el proveedor de TanStack Query.
**Estas cinco son las que no queremos duplicadas.**

## 5. Las pantallas

### 5.1 Listado de usuarios

Tabla en escritorio, tarjetas en teléfono. Los cuatro filtros que la API ya acepta —`tipo`, `salaId`,
`activo`, `autoRegistrado`— **viajan en la URL**, no en estado del componente: un filtro en la URL se
comparte y sobrevive al botón de atrás; en estado se pierde al navegar y nadie entiende por qué.

**Límite conocido:** `GET /usuarios` no tiene paginación y devuelve la lista entera. Se trae completa y
se filtra arriba. No se inventa paginación en el cliente, que daría la ilusión de una capacidad que la
API no tiene.

### 5.2 La ficha de la persona

Todo lo de una persona en un sitio: datos editables, salas, estado de pago, **sus días fijos**, dar de
baja, resetear la clave.

Cada bloque es su propio componente con su propia mutación. La ficha se carga con `GET /usuarios/:id` y
escribe por **cinco endpoints distintos** —`PATCH :id`, `PATCH :id/salas`, `PATCH :id/estado-pago`,
`POST :id/reset-password`, `DELETE :id`— más los cuatro de rutinas. Mezclarlos en un formulario único
convertiría nueve fallos posibles en un único «algo salió mal».

⚠️ **El bloque de resetear la clave sólo se dibuja si el rol alcanza `ADMIN_SALON`.** Es la única
acción del área con ese nivel. No basta esconderlo con CSS: no tiene que existir en el DOM.

**Sobre las rutinas.** Una `Rutina` no es un plan de entrenamiento: es una **reserva recurrente**
(perfil, sala, día de la semana, horario, nombre del turno) del motor de la Fase 2. Por eso vive dentro
de la ficha de la persona —«¿qué días viene Ana?»— y no como sección propia: listar todas las rutinas
del gimnasio no es una tarea que nadie haga, y una sección aparte se solaparía con el área de Operación
diaria, que es otra fase.

### 5.3 El alta

Un formulario que cambia según sea alumno o profesor (`POST /usuarios/alumnos` y
`POST /usuarios/profesores`), y después **una pantalla con ruta propia** para la contraseña temporal.

### 5.4 Invitaciones

Listar, crear y editar. Es chico y entra en una pantalla sola, sin ficha aparte.

### 5.5 Lo compartido

Tabla responsiva, formulario con errores, diálogo de confirmación y estado vacío. Las cuatro las van a
usar las otras áreas, así que se escriben pensando en eso **pero sin inventarles capacidades que hoy
nadie pide**.

## 6. La contraseña temporal

`POST /usuarios/alumnos` devuelve `AltaUsuarioRespuesta`, que incluye `passwordTemporal`. **Se muestra
una vez y no se puede releer.** Y quien puede resetearla es `ADMIN_SALON`, no `ADMIN_OPERATIVO`.

O sea: **el operativo que da de alta a un alumno y pierde esa contraseña no puede repararlo solo.**
Tiene que ir a pedírselo al dueño.

Por eso la pantalla:

- tiene **ruta propia**, para que recargar no la haga desaparecer en silencio;
- muestra la clave grande, con botón de copiar;
- **no deja seguir sin marcar «ya la anoté»**. Nada de un cartel que se desvanece ni un diálogo que se
  cierra al hacer clic afuera;
- **la clave no viaja en la URL** ni queda en el historial.

Es incómoda a propósito: el costo de perderla lo paga otra persona.

Se descartaron dos alternativas: mandarla por email (la infraestructura existe desde la 5B, pero es un
cambio en la API, no en el panel, y hay que decidir qué pasa si el alumno no tiene email o el envío
falla) y darle el permiso de reset al operativo (una línea en la API, pero es una decisión de seguridad
tomada por conveniencia de una pantalla: resetear la clave de cualquiera es exactamente el poder que se
le quiso negar).

## 7. Datos y errores

**La puerta en el servidor, los datos en el cliente.** El layout resuelve sesión y rol antes de pintar
nada. Los listados y las mutaciones van por TanStack Query contra `/api/bx`, como las pantallas del
alumno (`use-comprobantes`, `use-acciones-de-turno`): el patrón de invalidar tras mutar ya está
resuelto y no se inventa una tercera forma de traer datos.

Cinco errores con cinco respuestas, porque juntarlos en «algo salió mal» es lo que obliga a llamar por
teléfono:

| Caso                | Respuesta                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **401**             | Al login con el `volverA` apuntando a donde estaba. No es un error que el admin tenga que entender.                                                                      |
| **403**             | Se dice **qué rol hace falta**. No debería pasar, porque la navegación ya se filtra, pero si pasa es la pista que convierte un reclamo en una conversación con el dueño. |
| **409 / 422**       | Los mensajes van **al campo que los causó**. Un «el email ya existe» flotando sobre un formulario de nueve campos no dice cuál.                                          |
| **5xx / red caída** | Se distingue del rechazo y la acción se reintenta sin recargar.                                                                                                          |

**Las advertencias no son errores y no se pueden perder.** El alta devuelve `advertencias:
Advertencia[]` junto con el usuario creado: el alta salió bien _y_ hay algo que mirar. Van en la
pantalla de la contraseña, que es la que ya obliga a detenerse — un cartel que se desvanece a los tres
segundos sobre una pantalla donde el admin está copiando una clave no lo lee nadie.

**Las acciones destructivas confirman nombrando a quién afectan** («dar de baja a Ana Pérez»), no un
«¿estás seguro?» genérico. La baja y el reset son las dos que la llevan.

## 8. Cómo se prueba

Vitest en `apps/web`, siguiendo lo que ya hay.

- **La puerta, en sus cuatro casos**: sin sesión, sesión de otro gimnasio, rol insuficiente, rol que
  alcanza. Es la pieza cuyo fallo expone todo lo demás.
- **La navegación se dibuja desde el rol**, fijando el conjunto de enlaces **entero** — no «aparece
  Usuarios», sino _éstos y sólo éstos_.
- **El bloque de resetear no existe en el DOM** para un `ADMIN_OPERATIVO`.
- **La pantalla de la clave no se puede saltear**, y la clave no queda en la URL ni en el historial.
- **Los filtros viajan por la URL** y sobreviven a recargar.
- Los cinco errores, cada uno con su respuesta.
- Las advertencias del alta se muestran.

### La regla que trae la 6B

**Cada tarea lleva una mutación abierta**: la que al implementador le parezca que su código no
sobreviviría y que ningún test cubre. En la 6B se pidió seis veces y encontró algo real **las seis**, y
las seis fueron de la misma familia: **agregar algo que no debería estar, sin quitar nada de lo que
sí** — un campo de más en un contrato, un dato de más dentro de un string legítimo, una frase de más en
la pantalla equivocada, un contador de más en una portada, el `tenantId` dentro del PNG de un QR.

Ningún test de presencia ve eso. Por eso **las comparaciones son de totales**, no de presencias: el
conjunto entero de enlaces, el conjunto entero de columnas, el cuerpo entero de una respuesta.

Y la otra lección de la 6B, que allí costó dos funciones que nunca habían funcionado: **un doble escrito
a mano no puede contradecir a quien lo escribió.** Sabe lo que el autor creía que pasaba, no lo que
pasa. Donde el riesgo sea que la pieza real se comporte distinto del doble, hace falta ejercitarla de
verdad.

## 9. Fuera de alcance

- Las otras cuatro áreas del panel.
- Paginación y búsqueda por texto en el listado: la API no las tiene, e inventarlas en el cliente daría
  la ilusión de una capacidad que no existe.
- Mandar la contraseña temporal por email (§6).
- Cambiar qué rol puede resetear contraseñas (§6).
- Cualquier endpoint nuevo en la API. **Esta fase no agrega ni toca un endpoint.** Si una pantalla
  parece necesitar uno, es señal de que está inventando una capacidad en vez de usar la que hay, y hay
  que pararse a mirarlo.
