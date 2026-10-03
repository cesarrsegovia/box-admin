# Fase 6B — Check-in por QR y web pública

**Fuente:** `docs/BoxAdmin_Fase6_AnaliticaWebCheckin.pdf`
**Fecha:** 2026-10-02
**Mitad anterior:** `docs/superpowers/specs/2026-10-01-fase6a-analitica.md`

## 1. Qué entra

La Fase 6 se partió en dos porque la analítica era lo único que tocaba dinero real de personas y
merecía su propio ciclo. Esta mitad trae las dos superficies:

- **Check-in por QR**: el alumno escanea y queda presente.
- **Web pública del salón**: una landing editable, sin sesión, indexable.

Y una pieza compartida que ninguna de las dos puede evitar: **la zona horaria del despliegue**.

Esta fase **sí** agrega tablas, a diferencia de la 6A. Cinco.

## 2. La zona horaria: por qué aparece aquí y no antes

El sistema nunca tuvo husos. `instanteDelTurno(fecha, hora)` construye el instante **en UTC**, así que
una clase de las `"18:00"` es `18:00 UTC` — las 15:00 en Argentina.

Eso ya ocurre hoy, en `mis-clases.service.ts:136`, donde se compara el instante del turno contra el
reloj para decidir si ya se puede pasar lista. **Ahí el error es permisivo**: la profesora puede pasar
lista tres horas antes. La Fase 6A se topó con lo mismo al decidir qué es un turno "futuro" y lo
esquivó cortando por día en vez de por hora, dejando anotado que *"el error queda en la dirección
inofensiva"*.

**El check-in no puede esquivarlo.** Su ventana es de quince minutos: la de una clase de las 18:00
sería `[17:45, 18:15]` UTC, o sea `[14:45, 15:15]` en Argentina. El alumno que llega a su clase está
tres horas fuera. El error pasa de permisivo a **bloqueante**, y el check-in no funcionaría.

### 2.1 La decisión

**Una zona para todo el despliegue**, en una variable `ZONA_HORARIA`, validada al arrancar contra las
zonas IANA que conoce el runtime. Una zona mal escrita tiene que matar el proceso, no fallar en el
primer check-in de un lunes a la mañana.

**El límite, y es lo importante: las fechas siguen en UTC; sólo los relojes de pared llevan zona.**

Un turno del 5 de octubre es del 5 de octubre en todas partes, y toda la aritmética de meses, rangos,
vencimientos y períodos de pago que seis fases construyeron sigue intacta. Lo único que cambia es
**comparar una hora del día contra el reloj**, que hoy ocurre en exactamente dos sitios:

1. La ventana del check-in (esta fase).
2. El patrón del cron de los jobs diarios (deuda abierta desde la 5B: `0 9 * * *` se interpreta en la
   zona del worker, y en un contenedor UTC son las 6 de la mañana en Argentina).

**Una sola decisión cierra las dos.** Si aparece un tercer sitio que la necesite, es una conversación,
no un `import`.

Lo que **no** entra: una zona por gimnasio (`Tenant.zonaHoraria`). Es lo correcto para un SaaS real,
toca el cálculo de fechas de todas las fases anteriores, y es una fase en sí mismo. Queda como deuda.

## 3. Los modelos, con las correcciones al PDF

Cinco tablas. Las tres correcciones no son estilo: son el patrón con el que este proyecto impide los
cruces entre gimnasios **en la base** y no en el código, porque el código se olvida.

**`Asistencia`** — el PDF propone `reservaId String @unique` y una FK simple. Va con **FK compuesta**
`(tenantId, reservaId)` contra `Reserva(tenantId, id)` y `@@unique([tenantId, reservaId])`. Y `origen`
es un **enum** `QR | MANUAL`, no un string: igual que `MetodoPago` y `OrigenReserva`.

**`WebSalonConfig`** — pierde el `slug` (ver §5). Su `planDestacadoId` va con FK compuesta contra
`Pack`.

**`Testimonio` y `PreguntaFrecuente`** — llevan `@@unique([tenantId, id])`, que es lo que permite que
algo los referencie sin poder cruzar de gimnasio.

**`ConfigCheckInQR`** — `tenantId` como PK, `minutosAntes` y `minutosDespues`, los dos con default 15.
Un gimnasio **sin fila** usa esos quince minutos: la ausencia de configuración no puede ser un check-in
roto. Lo mismo vale para `WebSalonConfig`: sin fila, la web está apagada y el endpoint público da 404.

**Los cinco se clasifican en `MODELOS_CON_TENANT`.** Sin eso la extensión de aislamiento los rechaza
al primer query, que es el comportamiento correcto: falla cerrada.

## 4. `Asistencia` no compite con `Reserva.asistio`

La Fase 4 agregó `Reserva.asistio Boolean?`, que escribe la profesora al pasar lista y que los
reportes de la 6A ya leen. El PDF propone una tabla con `reservaId @unique`, o sea **dos verdades para
el mismo hecho** — exactamente lo que este proyecto rechaza desde la Fase 1.

**`Reserva.asistio` sigue siendo la única verdad. `Asistencia` es la evidencia.** El check-in pone
`asistio = true` **y** crea la fila, en la misma transacción. La fila guarda lo que la columna no
puede: cómo se marcó, desde qué IP y dispositivo, y a qué hora exacta.

Así que la fila existe sólo cuando alguien pasó por el check-in. La profesora que pasa lista escribe
`asistio` sin dejar fila, y eso es correcto: no hubo check-in que registrar.

## 5. Un solo slug

El PDF propone `WebSalonConfig.slug @unique`, pero `Tenant.slug` ya existe, ya es único, y **todas** las
rutas de la PWA son `/[slug]/...`. Dos slugs para el mismo gimnasio es pedir que algún día no
coincidan.

`/public/salon/:slug` resuelve por `Tenant.slug`, y la landing vive en `/[slug]` de la PWA — el índice
de ese segmento está libre. Queda: `…/mi-gimnasio` es la web pública y `…/mi-gimnasio/login` la entrada
de los alumnos.

## 6. El check-in

### 6.1 Qué garantiza, y qué no

**Comodidad, no prueba de presencia.** El QR es estático, firmado, impreso y pegado en la pared; sirve
para que el alumno se registre solo en vez de que la profesora pase lista.

Eso significa que **se puede fotografiar y usar desde casa**, y es una decisión tomada: hoy la
asistencia no factura nada. El día que se use para cobrar, hace falta un QR que rote en una pantalla, y
eso es otro diseño.

La ventana horaria acota *cuándo*, no *dónde*.

### 6.2 La firma, y por qué no es redundante aunque lo parezca

El QR es una URL fija: `<origen>/<slug>/checkin?f=<firma>`, con la firma HMAC del `tenantId`.

La amenaza que el checklist del PDF nombra —usar el QR de otro gimnasio— **ya está cerrada sin la
firma**: el alumno tiene que estar autenticado, su JWT lleva su gimnasio, y no tiene reservas en las
clases de otro. Así que la verificación de la firma es defensa en profundidad.

Se implementa igual, y la razón va escrita: **si algún día el check-in se usa desde un kiosco sin
sesión, la firma pasa de redundante a ser lo único que queda.** Quitarla por redundante hoy es quitar
la única pieza que sobreviviría a ese cambio.

### 6.3 El flujo

`POST /checkin` pide JWT de alumno y hace, en orden:

1. **Verifica la firma** y comprueba que el gimnasio del QR es el del alumno.
2. **Busca la reserva viva** cuya ventana `[inicio − minutosAntes, inicio + minutosDespues]`,
   **calculada en la zona del gimnasio**, contenga el instante actual. Si hay varias, la más cercana.
3. **Rechaza con motivos distinguibles**: *no tenés reserva en este turno*, *estás fuera de la
   ventana*, *ya marcaste*. Son datos del propio alumno, así que decirle cuál de las tres no filtra
   nada y le ahorra una llamada a recepción.
4. En **una transacción**: `asistio = true` y la fila de `Asistencia`.

El `@@unique([tenantId, reservaId])` hace que el doble check-in sea un 409 **en la base**. La
comprobación explícita da el mensaje legible; el índice da la garantía. No sobra ninguna de las dos:
entre la comprobación y la escritura hay una ventana, y el índice es lo que la cierra.

## 7. La web pública

### 7.1 El único endpoint sin sesión que lee datos de un gimnasio

`GET /public/salon/:slug`, con `@Public()`.

**La disciplina del `runUnscoped`: envuelve una sola consulta**, la que resuelve el slug a un tenant.
Todo lo demás va dentro de `runWithTenant`. Es el patrón que `auth.service.ts` ya usa para el login, y
la regla es que esa ventana sea de una línea y se vea.

### 7.2 Un slug inexistente y una web apagada dan el mismo 404

Distinguirlos convierte el endpoint en un **directorio de gimnasios**: cualquiera prueba nombres y
averigua cuáles existen. Mismo cuerpo, mismo código, en los dos casos.

### 7.3 Las banderas se honran omitiendo el dato

Si el servidor manda los precios con `mostrarPrecios: false` y deja que el cliente los esconda, **los
precios ya viajaron**: están en el HTML, en la caché del navegador y en el primer "ver código fuente".

Cada bandera apagada significa que ese dato **no sale del servidor**. Y sólo se exponen los packs
`activo: true`.

### 7.4 La imagen no puede venir del almacén

El almacén de la Fase 3A sirve archivos con **URL firmada y vencimiento**, que es correcto para un
comprobante privado y veneno para una landing: el enlace muere, la página queda indexada con un 403 y
nadie se entera.

`imagenPrincipalUrl` es una URL externa que el gimnasio pega, **validada como `https`**.

### 7.5 Qué devuelve, exactamente

Sólo lo que el gimnasio eligió publicar: nombre, colores, título, tagline, descripción, imagen, las
tres redes, y —cada uno sólo si su bandera está encendida— los packs activos con su precio, los
testimonios, las preguntas frecuentes y los turnos con lugar.

**Nada más.** Ni un email, ni un id de perfil, ni el nombre de una profesora, ni cuántos alumnos tiene
el gimnasio. Lo que no está en esa lista no sale.

⚠️ `mostrarTurnosLibres` publica **la agenda del gimnasio y cuán vacía está**. Es una decisión de
negocio que cada gimnasio toma con su bandera, y por eso viene apagada por defecto; conviene que el
admin entienda qué está encendiendo.

### 7.6 Todo el texto del admin es texto, nunca HTML

Esta es la primera vez en el proyecto que contenido escrito por un usuario se renderiza en una página
pública sin sesión: título, tagline, descripción, testimonios y preguntas frecuentes.

React escapa por defecto, así que basta con que nadie use `dangerouslySetInnerHTML`. Va escrito porque
es la misma trampa que la 5B ya anotó para el título del push, y porque aquí el daño sería **XSS
almacenado en el sitio público del gimnasio**.

## 8. Los endpoints

| Método | Ruta | Rol |
| --- | --- | --- |
| PUT | `/config/web-salon` | `ADMIN_SALON` |
| POST | `/config/web-salon/testimonios` | `ADMIN_SALON` |
| DELETE | `/config/web-salon/testimonios/:id` | `ADMIN_SALON` |
| POST | `/config/web-salon/faq` | `ADMIN_SALON` |
| DELETE | `/config/web-salon/faq/:id` | `ADMIN_SALON` |
| GET | `/public/salon/:slug` | **público** |
| GET / PUT | `/config/checkin-qr` | `ADMIN_SALON` |
| GET | `/config/checkin-qr/imagen` | `ADMIN_SALON` |
| POST | `/checkin` | `ALUMNO` |

## 9. Tests y mutaciones nombradas

Son las que no rompen nada por sí solas, que es el motivo de nombrarlas desde ahora:

- **Calcular la ventana del check-in en UTC** en vez de en la zona del gimnasio → cae el caso de la
  clase de las 18:00. **Esta es la más importante: es el bug que esta fase existe para evitar.**
- Devolver **403 en vez de 404** con la web apagada → cae el caso de que no se distingue de un slug
  inexistente.
- **Mandar el dato con `mostrar: false`** en vez de omitirlo → cae el caso de que el cuerpo **no
  contiene** el precio.
- Incluir **packs inactivos**.
- **Ensanchar el `runUnscoped`** más allá de la resolución del slug → cae el caso de que las consultas
  de contenido corren con contexto de gimnasio.
- **No verificar la firma**; **aceptar un segundo check-in**; **aceptar uno fuera de ventana**.

Y una comprobación que no es una mutación: que el cuerpo de `/public/salon/:slug` **no contenga** el
email de nadie, ni un id de perfil, ni nada que no sea el contenido que el gimnasio eligió publicar.
**Un endpoint público se audita por lo que no manda.**

## 10. Checklist de aceptación

- [ ] El check-in acepta a la hora de la clase **en la zona del gimnasio**, no en UTC.
- [ ] Rechaza fuera de ventana, sin reserva, y el segundo intento.
- [ ] `asistio` y la fila de `Asistencia` se escriben en la misma transacción, o ninguna de las dos.
- [ ] La web pública se ve sin login, respeta cada bandera **omitiendo** el dato, y sólo expone packs
      activos.
- [ ] Un slug inexistente y una web apagada son indistinguibles desde afuera.
- [ ] El QR de un gimnasio no sirve en otro.
- [ ] El `runUnscoped` del endpoint público envuelve exactamente una consulta.

## 11. Deuda que esta fase anota y no implementa

- **Una zona por gimnasio.** Esta fase resuelve el despliegue entero con una sola.
- **El QR rotativo**, para cuando la asistencia tenga que probar presencia y no sólo registrarla.
- **El panel de admin**, que sigue sin existir.
  La configuración de la web y del check-in se opera por API, igual que los siete reportes de la 6A.

## 12. `VacacionAlumno.devuelveClase` se borra

**Decidido con Cesar: las clases perdidas no se devuelven.** El campo no tiene trabajo que hacer, y
lleva cuatro fases de mudanza —el schema lo dejaba "para cuando exista facturación o créditos (Fase
5)", la 5B lo reetiquetó a la 6, la 6A lo volvió a mover—. Ya acumula más mudanzas que
`Sala.exclusiva`, que es el error que se cita cada vez que aparece.

Se borra entero: la columna, el campo de `CrearVacacionDto`, el del contrato compartido y lo que lo
mapea en `vacaciones.service.ts`. Con su migración.

⚠️ **Es un cambio de contrato visible**: el campo desaparece de las respuestas, y mandarlo pasa a dar
400 por `forbidNonWhitelisted`. Hay que actualizar los tests que lo afirman en vez de ablandarlos.

Lo que **no** se borra es `Perfil.clasesExtra`, que es el mecanismo real para darle una clase a alguien
y está vivo: `ventana-pack.ts` hace `base + clasesExtra` para calcular cuántas puede reservar. Si algún
día hay que devolver clases, el mecanismo ya existe y lo que haría falta es decidir quién lo
incrementa.
