# Fase 20 — La deuda vieja

**Fecha:** 2026-11-13
**Estado:** ejecutada (2026-11-13; ver el bloque de la Fase 20 en `PROGRESO.md`)

> **Lo que se midió distinto al ejecutar:**
>
> - **§6:** `sin-pack` es sólo para un pack que ya no está en el catálogo. Un pack dado de baja conserva
>   su precio, así que hoy `sin-pack` es casi inalcanzable. El número de los que quedan fuera es
>   `CajaDelMes.sinPrecio`. Morosos sigue mostrando 0, con su aviso.
> - **§7:** las filas viejas de `AvisoDiario` se dejan (no hay limpieza).
> - **§8:** el único campo cifrado es `ConfiguracionSMTP.claveCifrada`. **Rotar la clave invalida los
>   QR de check-in impresos**, porque `checkin/firma-qr.ts` firma con un HMAC sobre
>   `APP_ENCRYPTION_KEY` y no acepta la anterior.
> - **§9:** la API daba 500 con `planDestacadoId: null`; ahora `null` quita el destacado. La landing
>   ya ocultaba un destacado dado de baja, porque sólo lee los packs activos.
> - **§4, el contenedor `api`:** se eligió que el `command` instale (offline) y genere Prisma antes de
>   arrancar, no volúmenes con nombre.

## 1. Por qué existe esta fase

La lista «Vieja, y sigue en pie» de PROGRESO (~4020) se escribió en la Fase 13 y no se volvió a mirar.
Se auditó contra el código el 2026-11-13: de 12 puntos, **8 siguen abiertos, 3 a medias y 1 cerrado**
(la liquidación de la profesora, que tiene su propio endpoint). Esta fase cierra los 11 que quedan.

## 2. Decisiones cerradas con Cesar

1. **Los tres campos muertos se quitan:** `Sala.exclusiva`, `Ausencia.recuperable` y la franja horaria
   de una ausencia (`todoElDia`, `horaInicio`, `horaFin`). Una ausencia es siempre de días enteros, que
   es lo que el motor ya hace.
2. **`listaPasada` se quita** del contrato de mis-clases.
3. **`centavos: 0` se desambigua** con `null` y un motivo.
4. Entran también: **recordatorios marcados por persona**, **rotación de la clave de cifrado** y el
   **editor del plan destacado**.
5. Lo que no necesitaba decisión entra igual (§4).

## 3. Lo que se midió al diseñar

| #  | Punto                                       | Dónde                                                                                       |
| -- | ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1  | `use-rutinas.ts` sin spec propio            | las 3 mutaciones se prueban por pantalla; nadie prueba que `['rutinas', perfilId]` se invalide |
| 2  | Sobre-invalidación de `/mi-pack`            | `use-acciones-de-turno.ts:71-77`: entrar y salir de la lista de espera también invalidan `miPack()` |
| 3  | El 403 de anotar nombra una ruta de API     | `reservas.service.ts:170-173` («…Asignasela con PATCH /usuarios/:id/salas.»); la misma frase en `rutinas.service.ts:209` y `usuarios.service.ts:480` |
| 4  | Recordatorios idempotentes por gimnasio     | `recordatorio-pago.processor.ts:206-212`; un corte pierde el gimnasio en curso y un fallo de `updateData` aborta los que faltan |
| 5  | Sin rotación de la clave de cifrado         | `comunicacion/cifrado.ts`: `descifrar` sólo conoce una clave                                |
| 6  | El contenedor `api` del compose             | `@nestjs/throttler` ya está en el lockfile; los volúmenes anónimos de `node_modules` (`docker-compose.yml:63-66`) conservan el viejo |
| 7  | Tres campos muertos                         | se guardan y devuelven; nadie los lee (`salas.service.ts`, `ausencias.service.ts`, `generacion-mes.service.ts:202`) |
| 8  | «Reasignar» ofrece turnos pasados y llenos  | `bloque-anotados.tsx:464-516`                                                               |
| 9  | `centavos: 0` significa tres cosas          | `stats.service.ts:120`                                                                      |
| 10 | `planDestacadoId` sin editor                | el PUT ya no lo borra (`configuracion/web/page.tsx`), pero no se puede elegir               |
| 11 | `listaPasada` miente                        | `mis-clases.service.ts:97`: un check-in por QR alcanza; la web ya no lo usa                 |

## 4. Lo que no necesitaba decisión

- **`use-rutinas`:** un `hooks/use-rutinas.spec.tsx` con `@/test/andamiaje-de-hooks`: método, ruta y
  cuerpo de las tres mutaciones, y que cada una invalida `['rutinas', perfilId]` y nada más.
- **`/mi-pack`:** anotarse y salirse de la lista de espera no gastan clases: no invalidan `miPack()`.
  Reservar y cancelar sí.
- **El 403 de anotar:** las tres frases dejan de nombrar la ruta. Texto: «Esta persona no tiene acceso
  a la sala de este turno. Asignásela desde su ficha, en Salas.» (y su variante en rutinas y en el alta).
  Los e2e que comparan la frase se actualizan.
- **«Reasignar»:** los turnos que ya empezaron **no se ofrecen**; los llenos **se ven deshabilitados**,
  con «(lleno)», para que quien está en el mostrador sepa que existen.
- **El contenedor `api`:** el compose deja de reutilizar `node_modules` viejos (volúmenes con nombre
  que se renuevan al cambiar el lockfile, o el comando de arranque instala antes). Se comprueba
  **arrancándolo**: `docker compose up -d --build -V api` levanta y contesta `/health` (o la ruta que
  exista); después `docker compose stop api`.

## 5. Quitar lo que no hace nada

- **Campos muertos:** fuera del esquema (una migración Prisma que borra las columnas), de los DTO, de
  los contratos de `packages/shared`, de los servicios, del seed y de la web. Como el `ValidationPipe`
  lleva `forbidNonWhitelisted`, **un cliente que todavía los mande recibe 400**: se mide que la web no
  los manda. El docblock de `Ausencia` en el esquema pasa a decir «siempre días enteros».
- **`listaPasada`:** fuera del contrato y del servicio; los tests que lo afirmaban se van con él.

## 6. `centavos` con motivo

`PendienteDeAlumno` pasa de `{ perfilId, centavos }` a:

```ts
type PendienteDeAlumno =
  | { perfilId: string; centavos: number }              // precio conocido; 0 es «cuesta 0»
  | { perfilId: string; centavos: null; motivo: 'a-consultar' | 'sin-pack' };
```

- `a-consultar`: el pack existe y no tiene precio. `sin-pack`: el alumno no tiene pack o el pack se dio
  de baja. El plan mide cuál de los dos da hoy `precioPack === null`.
- El total estimado suma sólo los conocidos y la respuesta dice **cuántos quedaron fuera** (para que la
  pantalla pueda decir «más N a consultar»). La pantalla de análisis lo muestra.

## 7. Recordatorios marcados por persona

- Una tabla `AvisoDiario` (`tenantId`, `perfilId`, `tipo`, `dia @db.Date`) con
  **`@@unique([tenantId, tipo, perfilId, dia])`**. Antes de mandar cada aviso se **inserta** la marca;
  si choca con la clave única, esa persona ya recibió el aviso hoy y se salta.
- Se aplica a los jobs diarios que hoy marcan por gimnasio (`recordatorio-pago` y, si el plan mide que
  usa la misma marca, `vencimiento-pack`).
- Así un corte pierde **a lo sumo un aviso** (el de la persona marcada y no enviada), y un fallo al
  marcar a una persona **ya no aborta** el resto: se registra y se sigue con la siguiente. La marca por
  gimnasio en el payload se va. El docblock largo se reescribe con el intercambio nuevo.
- Las filas viejas se pueden borrar: el plan decide si basta con dejarlas (una por persona y día) o si
  hace falta una limpieza.

## 8. Rotar la clave de cifrado

- Entorno: `APP_ENCRYPTION_KEY` (la actual) y **`APP_ENCRYPTION_KEY_ANTERIOR`**, opcional, con la misma
  validación.
- `cifrar` usa siempre la actual. `descifrar` prueba la actual y, si GCM la rechaza y hay anterior,
  prueba la anterior. El formato `v1:…` no cambia.
- Un comando `pnpm --filter @boxadmin/api cifrado:rotar` recorre los secretos guardados (las
  contraseñas SMTP y cualquier otro campo cifrado que el plan encuentre), los descifra con la que
  sirva y los vuelve a cifrar con la actual. Idempotente; informa cuántos rotó y cuántos fallaron.
- El README explica el procedimiento: poner la nueva como actual y la vieja como anterior, desplegar,
  correr el comando, quitar la anterior.

## 9. El editor del plan destacado

En Configuración → Web, un selector con los packs activos y «Ninguno», que guarda `planDestacadoId`.
Si el pack destacado se da de baja, la landing deja de mostrarlo (el plan mide qué hace hoy) y el
selector lo muestra como «(dado de baja)» hasta que se elija otro.

## 10. Cómo se prueba

- TDD; cada test nuevo se ve rojo antes de verde. Una mutación abierta por tarea, `MUTACION TEMPORAL`.
- La migración se prueba con los e2e (`docker compose up -d postgres postgres-test redis`).
- Cierre: web y api (`test`, `test:reloj`, `tsc`), e2e, `build` de web y api, `prettier --check` sobre
  lo tocado y `grep MUTACION TEMPORAL` en cero.

## 11. Tareas

1. Web chico: spec de `use-rutinas`, la invalidación de `/mi-pack`, «Reasignar».
2. El texto del 403 de anotar y quitar `listaPasada`.
3. Quitar los campos muertos (con migración).
4. `centavos` con motivo.
5. Recordatorios por persona.
6. Rotar la clave de cifrado.
7. El editor del plan destacado.
8. El contenedor `api` del compose.
9. Cierre: verificación, README, PROGRESO.

## 12. Fuera de alcance

- Implementar ausencias por franja horaria (se quitan; si vuelven, vuelven con su lógica).
- La deuda de la infraestructura de tests de la Fase 19 (`href`/`data-*`, el símbolo de user-event, la
  carrera de los `router.push`).
- Recortar los nombres ya guardados con espacios (Fase 18).
