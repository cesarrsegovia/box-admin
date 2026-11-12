# Fase 18 — Deuda de la API

**Fecha:** 2026-11-12
**Estado:** ejecutada

## 1. Por qué existe esta fase

La Fase 17 cerró la deuda de la web. Esta toma la de **`apps/api`**: los textos libres llegan sin
recortar y la búsqueda del perfil de quien llama está copiada en 8 servicios. **`packages/shared` y
`apps/web` no se tocan.**

## 2. Decisiones cerradas con Cesar

1. **`Importe` contra la cadena pelada se cierra por diseño**, no se unifica (§6).
2. El recorte es **un decorador** aplicado campo por campo, no un pipe global.
3. Los opcionales **sólo se recortan**: `"   "` llega como `""`, no como `null`.
4. La búsqueda del perfil se comparte **conservando el mensaje de 404 de cada servicio**.

## 3. Lo que se midió al diseñar

- **Ningún DTO recorta**: no hay un solo `@Transform` en `apps/api/src`.
- El `ValidationPipe` lleva `transform: true` en `main.ts` y en `test/helpers.ts` (e2e): un
  `@Transform` de class-transformer corre **antes** de las validaciones.
- Los obligatorios ya llevan `@IsNotEmpty()`: recortados, « » queda vacío y da el 400 de siempre.
- La búsqueda del perfil por `actor.sub` está en 8 servicios con **8 mensajes distintos**; dos reciben
  un cliente de transacción (`mi-calendario`, `mis-clases`) y uno trae el pack incluido (`mi-pack`).

## 4. `@Recortado()` en los textos libres

`apps/api/src/common/decorators/recortado.decorator.ts` exporta **`Recortado()`**: un `@Transform` que
devuelve `value.trim()` si `value` es un string y `value` tal cual en cualquier otro caso (así un `123`
o un `null` siguen llegando a `@IsString()`/`@IsOptional()` como antes).

Se aplica a estos 23 campos:

| DTO (`apps/api/src/…`)                                               | Campo(s)                |
| -------------------------------------------------------------------- | ----------------------- |
| `auth/dto/create-tenant.dto.ts`                                      | `nombre`                |
| `salas/dto/crear-sala.dto.ts`, `actualizar-sala`                     | `nombre`                |
| `packs/dto/crear-pack.dto.ts`, `actualizar-pack`                     | `nombre`                |
| `turnos/dto/crear-turno.dto.ts`, `actualizar-turno`                  | `nombre`                |
| `rutinas/dto/crear-rutina.dto.ts`, `actualizar-…`                    | `nombre`                |
| `invitaciones/dto/crear-invitacion.dto.ts`, `act…`                   | `nombre`                |
| `web-salon/dto/crear-testimonio.dto.ts`                              | `nombre`, `texto`       |
| `web-salon/dto/crear-faq.dto.ts`                                     | `pregunta`, `respuesta` |
| `web-salon/dto/guardar-web-salon.dto.ts`                             | `tagline`               |
| `comunicacion/dto/guardar-plantilla.dto.ts`                          | `asunto`                |
| `pagos/dto/crear-pago.dto.ts`, `estado-pago.dto.ts`                  | `nota`                  |
| `comprobantes/dto/aprobar-comprobante.dto.ts`, `revisar-comprobante` | `nota`                  |
| `ausencias/dto/crear-ausencia.dto.ts`                                | `motivo`                |
| `vacaciones/dto/crear-vacacion.dto.ts`                               | `motivo`                |

- **Fuera, a propósito:** contraseñas y claves, emails, ids, fechas, colores, URLs y el **cuerpo HTML
  de las plantillas**, donde un espacio puede ser parte del dato. Si el plan encuentra otro texto
  libre que se vea en pantalla y no esté en la tabla, entra.
- Un `@Recortado()` va **encima** de las validaciones del campo, para que se lea primero.
- Los obligatorios no cambian de validación: `@IsNotEmpty()` ya rechaza el vacío recortado.

## 5. Una sola búsqueda del perfil

`apps/api/src/common/perfil-del-actor.ts` exporta
**`idDelPerfilDelActor(cliente, actor, siNoTiene): Promise<string>`**:

- `cliente`: un cliente de Prisma, el normal (`this.prisma.db`) o el de una transacción
  (`ClientePrismaTx`), para que sirva dentro de `$transaction`;
- `actor`: el `JwtPayload`; busca `perfil.findFirst({ where: { usuarioId: actor.sub }, select: { id: true } })`;
- `siNoTiene`: el texto del `NotFoundException` si no hay perfil.

La usan **7 servicios**, cada uno con **su mensaje de hoy, letra por letra**: `checkin`, `comprobantes`,
`liquidacion.datos`, `lista-espera`, `mi-calendario`, `mis-clases` y `push`. Los métodos privados
`perfilDelActor`/`perfilDeLaProfesora` desaparecen o quedan como una línea que la llama; los que
devolvían `{ id }` **conservan su nombre y su firma `{ id }`** y sólo cambia el cuerpo, que envuelve el
id que devuelve la función (así los llamadores no se tocan).

**`mi-pack` queda fuera** (trae el perfil con `include: { pack: true }`), con un comentario que diga
por qué.

## 6. `Importe` contra la cadena pelada: por diseño

La regla, que se escribe en el README y en PROGRESO:

- Lo que **se guarda** como `Decimal` (el precio de un pack, el monto de un pago) viaja como **texto
  con dos decimales** (`"12500.00"`): es el valor tal como está en la base.
- Lo que la API **calcula** (la liquidación, la caja) viaja como **`Importe`, `{ centavos, texto }`**:
  el entero es la verdad de la cuenta y el texto acompaña.
- **Ninguna pantalla hace cuentas con el texto**: se muestra o se reenvía a la API (medido en la
  Fase 18). Si alguna vez hiciera falta sumar precios o montos en el cliente, ése es el día de
  pasarlos a `Importe`.

## 7. Cómo se prueba

- TDD; cada test nuevo se ve rojo antes de verde.
- **El decorador:** un spec propio (recorta un string; deja pasar número, `null`, `undefined`).
- **Los DTO:** un test por DTO de la tabla, con el `ValidationPipe` real
  (`whitelist`, `forbidNonWhitelisted`, `transform`): el texto con espacios llega recortado y, en los
  obligatorios, « » da 400.
- **e2e:** crear una sala con « Box 2 » y leerla como «Box 2».
- **La búsqueda del perfil:** la función con un Prisma doble (devuelve el id; con `null` lanza 404
  con el texto recibido; consulta el cliente que se le pasa). Los specs de los 7 servicios pasan **sin
  tocar sus afirmaciones** (los mensajes no cambian).
- **Una mutación abierta por tarea**, marcada `MUTACION TEMPORAL`.
- Cierre: `tsc`, tests de api, e2e (con `docker compose up -d postgres postgres-test redis`),
  `prettier --check` sobre lo tocado y `grep MUTACION TEMPORAL` en cero.

## 8. Tareas

1. `@Recortado()` y los 23 campos (§4).
2. `idDelPerfilDelActor` en los 7 servicios (§5).
3. Cierre: verificación, README, PROGRESO (con la regla de §6).

## 9. Fuera de alcance

- Unificar `monto`/`precio` a `Importe` (§6).
- Pasar a `null` los opcionales vacíos.
- `mi-pack`.
- La deuda de la web de la Fase 17 (escrituras con `pedir` directo, lecturas internas con
  «Unauthorized», el 403 de invitaciones) y la lista de la Fase 13.
