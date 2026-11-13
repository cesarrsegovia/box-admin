# Fase 20 — La deuda vieja

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans`, tarea por tarea. Los pasos llevan casillas (`- [ ]`).

**Objetivo:** cerrar los 11 puntos abiertos de la lista «Vieja, y sigue en pie» de la Fase 13.

**Arquitectura:** cambios chicos y separados. Unos en la web (un spec de hook, una invalidación, un
filtro); otros en la API: textos, quitar campos con una migración, un contrato de stats con motivo, una
tabla de marcas por persona para los jobs diarios, una segunda clave de cifrado con un comando de
re-cifrado. Y un ajuste del `docker-compose.yml`.

**Spec:** `docs/superpowers/specs/2026-11-13-fase20-deuda-vieja.md`

---

## Reglas que gobiernan todo este plan

⚠️ **No hacés commits.** Nunca `git add`, `git commit`, `git push`, `git stash`, `git checkout`,
`git reset` **ni `git mv`**. `git status`, `git diff` y `git show` sí. Los commits los hace Cesar.

⚠️ **Nunca `pnpm lint`** (el script lleva `--fix`). Si querés eslint, sin `--fix`.

⚠️ **Prettier:** `node D:/Dev/box-admin/node_modules/prettier/bin/prettier.cjs --check <archivos>`
**sólo sobre lo que tocás**. `--write` sólo sobre archivos tuyos. `apps/api/src` **nunca pasó `--check`
entero**: si un archivo de la API ya fallaba en `HEAD`
(`git show HEAD:<ruta> | node …/prettier.cjs --stdin-filepath <ruta> --check`), no lo reformatees:
anotalo. `PROGRESO.md` ya falla en tablas viejas (~2497–3086): no las toques.

⚠️ **Nunca `taskkill` ni `Stop-Process` por NOMBRE de proceso.** Hay una sesión viva de Claude Code en
la máquina. Por PID concreto y sólo los que levantaste vos.

⚠️ **`docker compose up` pelado está prohibido.** Para la base y los e2e: `docker compose up -d
postgres postgres-test redis` desde la raíz. **Sólo la T8** levanta además el servicio `api`, con el
comando que dice esa tarea, y lo para al terminar (`docker compose stop api`).

⚠️ **Nada de strings con barra invertida por heredoc.** Usá la herramienta de edición. **No uses
`sed -i` sobre archivos CRLF**; respetá el fin de línea de cada archivo.

⚠️ **`apps/api/dist/` es salida de compilación**: no se edita ni se cuenta en los grep.

⚠️ **Vitest y las rutas con corchetes o paréntesis** (`[slug]`, `(alumno)`): sólo desde PowerShell y
con filtro por subcadena.

**Comandos** (desde la raíz):

```bash
pnpm --filter @boxadmin/web exec vitest run <filtro>
pnpm --filter @boxadmin/web test
pnpm --filter @boxadmin/web exec tsc --noEmit
pnpm --filter @boxadmin/web build
pnpm --filter @boxadmin/api exec jest <ruta-o-patron>
pnpm --filter @boxadmin/api test
pnpm --filter @boxadmin/api test:reloj        # filtrar con --testPathPattern, no con un patrón suelto
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test:e2e
pnpm --filter @boxadmin/api build
pnpm --filter @boxadmin/api db:migrate        # prisma migrate dev contra .env (puerto 5434)
pnpm --filter @boxadmin/api db:test:deploy    # aplica las migraciones a la base de test
```

**Punto de partida (Fase 19, commit `215cb01`):** web **2100 / 101**, api **1435 / 71**, e2e
**223 / 13**. **Medí de nuevo lo que toque tu tarea** antes de empezar.

⚠️ **Antes de nada: `grep -rn "MUTACION TEMPORAL" apps --exclude-dir=dist`.** Tiene que dar cero.

### La mutación abierta

Cada tarea termina con al menos una: **cambiar algo que no debería cambiar**, marcado
`// MUTACION TEMPORAL`. Correr la suite de la tarea. **Si pasa en verde, o se cierra el agujero —con un
test que se vea rojo— o se reporta.** Después, quitarla y volver a verde.

### Las cinco formas de que un test no pueda fallar

1. **Autorreferencial** — comparar la salida contra la misma función que la produce.
2. **Premisa destruida** — el código bajo prueba borra el borde que el test venía a ejercitar.
3. **Montado en el caso ciego** — fijar algo en el único escenario donde la distinción no existe.
4. **Verde por casualidad ortográfica** — un `toContain` que pasa con texto de más.
5. **El fixture habla el idioma del código y no el del contrato.**

### Si algo no cuadra

Si lo que medís contradice el plan (un archivo que no existe, un uso que el plan no vio, un contrato
con otra forma), **pará y reportalo** con lo medido. No improvises un diseño distinto.

---

## Estructura de archivos

```
apps/web/src/
  hooks/use-rutinas.spec.tsx                                CREAR  (T1)
  hooks/use-acciones-de-turno.ts · .spec.tsx                TOCAR  (T1)
  app/[slug]/admin/turnos/[id]/bloque-anotados.tsx · .spec  TOCAR  «Reasignar» (T1)
  app/[slug]/admin/analisis/…                               TOCAR  pendientes con motivo (T4)
  app/[slug]/admin/configuracion/web/page.tsx · .spec       TOCAR  editor del plan destacado (T7)
  … salas, ausencias                                        TOCAR  si nombran los campos muertos (T3)
apps/api/
  src/reservas/reservas.service.ts, src/rutinas/rutinas.service.ts,
  src/usuarios/usuarios.service.ts                          TOCAR  textos del 403 (T2)
  src/mis-clases/mis-clases.service.ts · .spec              TOCAR  sin listaPasada (T2)
  prisma/schema.prisma + migración nueva                    TOCAR  campos muertos (T3), AvisoDiario (T5)
  src/salas/…, src/ausencias/…, generacion-mes, seed        TOCAR  campos muertos (T3)
  src/stats/stats.service.ts · .spec                        TOCAR  (T4)
  src/jobs/notificaciones/{recordatorio-pago,vencimiento-pack}.processor.ts, colas.ts  TOCAR  (T5)
  src/comunicacion/cifrado.ts · .spec, config-email.service.ts, validar-entorno  TOCAR  (T6)
  src/scripts/rotar-cifrado.ts (o donde vivan los scripts)  CREAR  (T6)
  package.json                                              TOCAR  script cifrado:rotar (T6)
  test/*.e2e-spec.ts                                        TOCAR  los que comparen lo que cambia
packages/shared/src/
  nucleo.contracts.ts, recurrencia.contracts.ts,
  profesor.contracts.ts, stats.*                            TOCAR  (T2, T3, T4)
docker-compose.yml (y Dockerfile.dev si hace falta)         TOCAR  (T8)
README.md · docs/superpowers/plans/PROGRESO.md              TOCAR  (T9)
```

---

## Tarea 1: web chico — `use-rutinas`, `/mi-pack` y «Reasignar»

**Files:** `apps/web/src/hooks/use-rutinas.spec.tsx` (crear), `hooks/use-acciones-de-turno.ts` y su
spec, `app/[slug]/admin/turnos/[id]/bloque-anotados.tsx` y su spec.

### 1a. El spec de `use-rutinas`

- [ ] **Paso 1:** leé `hooks/use-rutinas.ts` y un spec de hook que use `@/test/andamiaje-de-hooks`
  (p. ej. `hooks/use-vacaciones.spec.tsx`). Escribí `hooks/use-rutinas.spec.tsx` con, por cada una de
  las tres mutaciones (crear, editar, borrar): el método, la ruta y el cuerpo exactos, con la ruta y los
  campos **escritos a mano** desde el controller de la API (`apps/api/src/rutinas/*.controller.ts`), no
  copiados del hook (forma 5); y que tras el éxito se invalida `['rutinas', perfilId]` (espiar
  `cliente.invalidateQueries`) **y ninguna otra clave**. Si la lectura (`useRutinas`) tiene ruta, un
  test de su ruta también.
- [ ] **Paso 2:** como el código ya existe, los tests nacen verdes. **Mutación abierta** para cada
  afirmación de invalidación: cambiar la clave invalidada en el hook (`['rutinas']` sin `perfilId`, u
  otra). Esperado: rojo. Quitarla.

### 1b. La lista de espera no invalida `/mi-pack`

- [ ] **Paso 1, rojo:** en `hooks/use-acciones-de-turno.spec.tsx` (mirá cómo prueba hoy `refrescar`),
  un test por mutación de lista de espera (entrar y salir): tras el éxito **no** se invalida la clave de
  `miPack()`, y **sí** las de turnos disponibles y mis clases. Y uno que fije que reservar y cancelar
  **sí** la invalidan. Run → FAIL los de lista de espera.
- [ ] **Paso 2:** partir `refrescar` en dos (p. ej. `refrescarAgenda` sin `miPack` y `refrescar` con),
  con un comentario: «entrar o salir de la lista de espera no gasta clases del pack». Run → PASS.
- [ ] **Paso 3, mutación:** volver a usar `refrescar` en «entrar a la lista de espera». Esperado: rojo.

### 1c. «Reasignar» sin pasados y con llenos deshabilitados

- [ ] **Paso 1, medir:** en `bloque-anotados.tsx` (~460–520) mirá qué trae `useTurnos({ salaId })`
  (fecha, hora de inicio, cupo, ocupación) y cómo se arma cada opción. Mirá cómo el spec dobla esa
  lectura.
- [ ] **Paso 2, rojo:** con fechas **relativas a un `ahora` fijo del test** (nunca fechas sueltas que
  caduquen; ver la regla del reloj de la Fase 19):
  - un turno que **ya empezó** (fecha de hoy y hora pasada, o fecha anterior) **no aparece**;
  - un turno **lleno** aparece **deshabilitado** y con «(lleno)» en su texto;
  - un turno futuro con lugar aparece habilitado.
  Si el componente lee la hora con `new Date()`, el spec usa los relojes falsos como ya lo hagan otros
  specs de la web (`src/test/relojes-falsos.ts`); si no, inyectá `ahora` por prop con valor por defecto.
- [ ] **Paso 3:** el filtro y el `disabled`, con un comentario corto de por qué los llenos se ven.
- [ ] **Paso 4, mutación:** comparar contra el **día** y no contra la hora (deja pasar un turno de hoy
  que ya empezó). Esperado: rojo.

- [ ] **Cierre de la T1:** `pnpm --filter @boxadmin/web test`, `tsc --noEmit`, prettier sobre lo tocado.

---

## Tarea 2: el texto del 403 de anotar y fuera `listaPasada`

### 2a. Las tres frases sin ruta de API

- [ ] **Paso 1, medir:** `grep -rn "PATCH /usuarios" apps/api/src apps/api/test apps/web/src
  --exclude-dir=dist`. Están en `reservas.service.ts` ~170, `rutinas.service.ts` ~209 y
  `usuarios.service.ts` ~480 (`SIN_SALAS`), y en los specs/e2e que las comparan.
- [ ] **Paso 2, rojo:** en el spec de cada servicio, afirmar la frase **nueva entera** (`toThrow` con el
  texto literal o el mensaje exacto del `ForbiddenException`):
  - reservas: «Esta persona no tiene acceso a la sala de este turno. Asignásela desde su ficha, en
    Salas.»
  - rutinas: la misma idea con su sujeto (leé la frase de hoy y cambiá **sólo** la parte de la ruta por
    «desde su ficha, en Salas»);
  - usuarios (`SIN_SALAS`): ídem.
  Y en cada uno, `not.toContain('PATCH')`.
- [ ] **Paso 3:** cambiar las tres frases. Actualizar los e2e que las comparen (sólo el texto).
- [ ] **Paso 4:** en la web, `bloque-anotados.tsx` ~94 pinta ese 403 tal cual: con la frase nueva no
  hace falta traducirlo. Agregá en su spec un test que monte ese 403 **con la frase nueva** y afirme que
  se lee entera (y no «Forbidden»).

### 2b. Fuera `listaPasada` del contrato de mis-clases

⚠️ **`checkin/eleccion-de-reserva.ts` tiene OTRO `listaPasada`** (interno del check-in, con su propia
lógica en ~110–121). **Ése no se toca.** Sólo se quita el campo del contrato de mis-clases.

- [ ] **Paso 1, medir:** `grep -rn "listaPasada" apps packages --exclude-dir=dist`. Clasificá: contrato
  `packages/shared/src/profesor.contracts.ts` ~45, `mis-clases.service.ts` ~97 y su spec, el e2e de
  profesor, y la web (`(profesor)/mis-clases/page.tsx` ~25 lo menciona en un comentario).
- [ ] **Paso 2:** quitarlo del contrato y del servicio; quitar los tests que lo afirmaban; en el e2e y
  en el spec del servicio, **una afirmación de que la respuesta ya no lo trae**
  (`expect(clase).not.toHaveProperty('listaPasada')`). Ajustar el comentario de la web.
- [ ] **Paso 3:** `tsc` de api, web y shared limpio (un uso olvidado aparece ahí).

- [ ] **Mutación de la T2:** dejar «PATCH /usuarios/:id/salas» en la frase de rutinas. Esperado: rojo.
- [ ] **Cierre de la T2:** api `test`, web `test`, `tsc` de los dos, e2e.

---

## Tarea 3: quitar los campos muertos

Los campos: `Sala.exclusiva`; `Ausencia.recuperable`; y la franja de `Ausencia`: `todoElDia`,
`horaInicio`, `horaFin`. Una ausencia queda **siempre de días enteros**, que es lo que ya hace el motor
(`generacion-mes.service.ts` ~202 excluye el día entero).

- [ ] **Paso 1, medir:** `grep -rn "exclusiva\|recuperable\|todoElDia\|horaInicio\|horaFin" apps
  packages --exclude-dir=dist --exclude-dir=node_modules`. **Ojo:** `horaInicio`/`horaFin` también son
  campos de `Turno` y de otros modelos: **sólo se quitan los de `Ausencia`**. Hacé la lista de cada
  archivo y qué uso es: esquema, DTO, contrato, servicio, seed, web (la web los oculta a propósito en
  `ausencias/page.tsx` ~46–81 y `salas/[id]/page.tsx` ~27), tests, e2e.
- [ ] **Paso 2, medir que la web no los manda:** en los hooks de salas y ausencias, ¿algún cuerpo de
  POST/PATCH los incluye? Si alguno sí, quitarlo es parte de esta tarea (si no, al pasar el
  `ValidationPipe` con `forbidNonWhitelisted`, daría 400).
- [ ] **Paso 3, rojo:** e2e en `nucleo.e2e-spec.ts` (salas) y en el e2e que cubra ausencias:
  - crear una sala con `exclusiva: true` da **400** (el `forbidNonWhitelisted` lo rechaza);
  - crear una ausencia con `recuperable` o con `horaInicio` da **400**;
  - la respuesta de una sala y la de una ausencia **no traen** esos campos.
  En el spec de la web de ausencias y salas: los cuerpos que se mandan **no** los llevan (si hoy algún
  test afirma que van, se cambia).
- [ ] **Paso 4:** quitar de `schema.prisma` (y reescribir el comentario de `model Ausencia` ~617–639:
  «siempre días enteros; una franja horaria se quitó en la Fase 20 porque nadie la aplicaba»), de los
  DTO, de los contratos de `packages/shared`, de los servicios, del seed y de la web.
- [ ] **Paso 5, migración:** con la base levantada, `pnpm --filter @boxadmin/api db:migrate --name
  fase20_quitar_campos_muertos` (si el `--name` no pasa por el script, corré `prisma migrate dev` con el
  mismo `dotenv` que usa el script). Revisá el SQL generado: **sólo** `DROP COLUMN` de esas cinco
  columnas (y del `CHECK` o índice que las use, si hay). Después `db:test:deploy` y `db:generate`.
- [ ] **Paso 6:** api `test`, `tsc` de api/web/shared, web `test`, e2e. Todo verde.
- [ ] **Paso 7, mutación:** volver a poner `exclusiva` en el DTO de crear sala (sin columna). Esperado:
  rojo en el e2e del 400. Quitarla.

---

## Tarea 4: `centavos` con motivo

- [ ] **Paso 1, medir:** en `apps/api/src/stats/stats.service.ts` (~95–125, `pendientesDe`) qué es
  `PerfilConPack` y de dónde sale `precioPack === null`: ¿pack sin precio («a consultar»), alumno sin
  pack, pack dado de baja? Puede que hoy los tres colapsen antes de llegar ahí; **medilo en la consulta
  que arma `PerfilConPack`**. Buscá dónde se suma el pendiente estimado y qué contrato de
  `packages/shared` lo lleva hasta la web (`grep -rn "pendiente" packages/shared/src`), y qué pantalla
  de `admin/analisis/` lo muestra (probablemente `caja.tsx`).
- [ ] **Paso 2, rojo (api):** en `stats.service.spec.ts`:
  - un alumno con pack **sin precio** → `{ perfilId, centavos: null, motivo: 'a-consultar' }`;
  - un alumno **sin pack** (o con el pack dado de baja, según lo medido) → `motivo: 'sin-pack'`;
  - un pack que **cuesta 0** → `{ perfilId, centavos: 0 }` sin `motivo`;
  - el total estimado suma sólo los conocidos y la respuesta trae **cuántos quedaron fuera** (el nombre
    del campo, p. ej. `sinPrecio: number`, lo decidís leyendo el contrato de hoy; uno solo, sin
    desglose).
- [ ] **Paso 3:** el tipo en `stats.service.ts` (y en `packages/shared` si viaja) como en el spec §6;
  `PerfilConPack` lleva lo necesario para distinguir. Si para distinguir «sin pack» de «pack dado de
  baja» hiciera falta otra consulta, **los dos van como `sin-pack`** (el spec lo permite) y anotalo.
- [ ] **Paso 4, web:** la pantalla que muestra el pendiente: un test que, con N alumnos sin precio,
  diga «más N a consultar» (texto exacto que elijas, con el número) además del total; y que con 0 no
  lo diga. Rojo → verde.
- [ ] **Paso 5:** api `test`, `test:reloj`, e2e de stats, web `test`, `tsc` de todos.
- [ ] **Paso 6, mutación:** devolver `0` en vez de `null` para «a consultar». Esperado: rojo.

---

## Tarea 5: recordatorios marcados por persona

- [ ] **Paso 1, medir:** leé el docblock entero de `recordatorio-pago.processor.ts` (1–80) y el de
  `vencimiento-pack.processor.ts`, y `colas.ts`. Los dos usan `gimnasiosHechos`. Anotá: dónde se marca,
  qué se manda por persona, cómo se prueban hoy (sus specs).
- [ ] **Paso 2, esquema:** en `schema.prisma`:

  ```prisma
  /// La marca de «ya avisado hoy» de los jobs diarios, UNA por persona, tipo y dia.
  /// Se inserta ANTES de mandar: si choca con la clave unica, esa persona ya recibio
  /// el aviso de hoy y se salta. Ver el docblock de recordatorio-pago.processor.ts.
  model AvisoDiario {
    id       String   @id @default(cuid())
    tenantId String
    perfilId String
    tipo     String   // 'recordatorio-pago' | 'vencimiento-pack'
    dia      DateTime @db.Date
    creadoEn DateTime @default(now())

    @@unique([tenantId, tipo, perfilId, dia])
  }
  ```

  Seguí las convenciones del esquema (relaciones con `Tenant` y con el perfil si los demás modelos las
  llevan, `onDelete`, y si los modelos con `tenantId` pasan por la extensión de tenant: **leé cómo lo
  hacen** `MarcaDeAviso` u otro modelo de marcas de la Fase 5B). Migración: `db:migrate --name
  fase20_aviso_diario`, `db:test:deploy`, `db:generate`.
- [ ] **Paso 3, rojo:** en el spec de cada processor:
  - una persona ya marcada hoy **no recibe** el aviso (el `create` lanza `P2002`) y las demás sí;
  - un fallo al marcar a UNA persona (un error que no sea `P2002`) **no aborta** el resto: las
    siguientes reciben su aviso, y el error se registra con el logger;
  - la marca se inserta **antes** de mandar (orden de llamadas);
  - el `dia` es el día del job (`ahoraISO` o `ahora`), no `new Date()` suelto.
- [ ] **Paso 4:** cambiar los dos processors: por cada destinatario, `try { create marca } catch (P2002)
  → saltar; otro error → logger y saltar }`, luego mandar. Quitar `gimnasiosHechos` de los processors y
  de `colas.ts`. **Reescribir el docblock largo**: el intercambio nuevo (un corte pierde a lo sumo el
  aviso de la persona marcada y no enviada; un fallo de marca no aborta), qué sigue igual (BullMQ
  re-encola jobs atascados sin mirar `attempts`, perder antes que duplicar), y el costo (una fila por
  persona y día).
- [ ] **Paso 5, las filas viejas:** decidí si hace falta borrar marcas viejas. Si no hace falta (una
  fila por persona avisada y día, chica), anotalo como decisión en PROGRESO (T9) con la cuenta. Si hace
  falta, no inventes otro job: reportalo.
- [ ] **Paso 6:** api `test`, `test:reloj` (+1 y +5), e2e, `tsc`.
- [ ] **Paso 7, mutación:** marcar **después** de mandar. Esperado: rojo en el test del orden.

---

## Tarea 6: rotar la clave de cifrado

- [ ] **Paso 1, medir:** quién llama a `cifrar`/`descifrar` (`config-email.service.ts` y quien más
  aparezca) y de dónde sacan la clave; dónde se valida `APP_ENCRYPTION_KEY` al arrancar
  (`validar-entorno.ts`); qué columnas guardan valores cifrados (`grep -rn "cifrar(" apps/api/src`).
- [ ] **Paso 2, rojo (`cifrado.spec.ts`):**
  - `descifrar(guardado, [actual, anterior])` (o la firma que elijas, ver Paso 3) descifra un valor
    cifrado con la **anterior**;
  - con la actual sola, un valor cifrado con la anterior **lanza** (como hoy);
  - un valor cifrado con la actual se descifra sin tocar la anterior;
  - un valor manipulado lanza con las dos claves (GCM autentica: no se cuela basura).
- [ ] **Paso 3:** la API mínima. Recomendado: `descifrar(guardado, claves: readonly Buffer[])` que
  prueba en orden y relanza el último error si ninguna sirve; `cifrar` sigue recibiendo **una** clave
  (la actual). El formato `v1:…` no cambia. Actualizar a los llamadores.
- [ ] **Paso 4, entorno:** `APP_ENCRYPTION_KEY_ANTERIOR` opcional en `validar-entorno.ts`, con
  `PATRON_CLAVE_HEX`; **distinta de la actual** (si son iguales, error al arrancar: es un error de
  despliegue). Test en el spec de `validar-entorno`. Agregarla, comentada, a `.env.example` si existe.
- [ ] **Paso 5, el comando:** `apps/api/src/scripts/rotar-cifrado.ts` (o donde vivan los scripts del
  repo; si no hay ninguno, en `apps/api/src/scripts/`), con la lógica en una función pura y testeable
  (`rotar(filas, claves) → { rotadas, fallidas, nuevas }`) y un `main` fino que lee de Prisma **sin
  scope de tenant** (`runUnscoped`, como los jobs) y escribe. Idempotente: un valor que ya está con la
  actual se re-cifra igual o se salta (elegí y documentá). Informa por consola cuántas rotó y cuántas
  fallaron (sin imprimir secretos). Script `"cifrado:rotar"` en `apps/api/package.json` con el mismo
  `dotenv -e ../../.env` que los otros scripts de base, ejecutado con lo que el repo ya use para
  correr TS (`ts-node`, `tsx` o el `nest` build: **medilo**; no agregues dependencias).
  Tests de la función pura: rota las de la anterior, deja/recifra las de la actual, cuenta las que no
  descifra ninguna.
- [ ] **Paso 6:** probalo de verdad contra la base de desarrollo: guardá una contraseña SMTP (por la
  API o el seed), cambiá las claves en un `.env` **temporal** (no toques el `.env` de Cesar: usá
  variables en la línea de comando de PowerShell), corré el comando y comprobá que se lee con la nueva
  sola. Restaurá todo. Anotá lo hecho.
- [ ] **Paso 7, mutación:** que `descifrar` pruebe sólo la primera clave. Esperado: rojo.

---

## Tarea 7: el editor del plan destacado

- [ ] **Paso 1, medir:** en `admin/configuracion/web/page.tsx` el comentario ~60–71 (por qué no había
  editor) y cómo se reenvía `planDestacadoId` (~213, ~228, ~379, ~395). Qué hook lista packs
  (`usePacks` en `hooks/use-dinero.ts` o similar) y si trae los dados de baja. Qué hace la **landing**
  pública cuando el pack destacado está dado de baja (busca en `apps/api/src/web-salon/` y en la
  página pública): si hoy lo muestra igual, eso se arregla en la API (no mostrarlo) con su test.
- [ ] **Paso 2, rojo (web):**
  - el selector «Plan destacado» lista los packs **activos** y «Ninguno»;
  - elegir uno y guardar manda `planDestacadoId` con ese id; elegir «Ninguno» manda `null`;
  - si el guardado trae un `planDestacadoId` de un pack dado de baja (o que no está en la lista), el
    selector lo muestra como «<nombre> (dado de baja)» —o «(no disponible)» si no se sabe el nombre— y
    guardar sin tocarlo **lo conserva**.
- [ ] **Paso 3:** el selector, con `usePacks()`. Reescribí el comentario ~60–71.
- [ ] **Paso 4, API si hace falta:** si la landing muestra un pack dado de baja, que no lo haga; test en
  el spec del servicio y en `web-salon.e2e-spec.ts`.
- [ ] **Paso 5, mutación:** mandar `''` en vez de `null` con «Ninguno». Esperado: rojo.

---

## Tarea 8: el contenedor `api` del compose

- [ ] **Paso 1, medir:** `docker-compose.yml` (servicio `api`, ~44–66) y `Dockerfile.dev`. Los volúmenes
  anónimos `/repo/node_modules`, `/repo/apps/api/node_modules` y `/repo/packages/shared/node_modules`
  sobreviven entre arranques y tapan lo que instaló la imagen nueva.
- [ ] **Paso 2, reproducir:** `docker compose build api` y `docker compose up -d api` (sin `-V`);
  `docker compose logs api --tail 50`. Anotá si falla y con qué (¿`Cannot find module
  '@nestjs/throttler'`?). Si arranca bien, anotalo también: el punto puede estar ya cerrado por el
  lockfile, y entonces lo que queda es que no se vuelva a romper.
- [ ] **Paso 3, el arreglo:** que un cambio de dependencias no deje `node_modules` viejos. Elegí una y
  justificala en un comentario del compose:
  - el `command` del servicio corre `pnpm install --frozen-lockfile` (con el store cacheado) antes de
    arrancar; o
  - documentar `docker compose up -d --build -V api` como el arranque (el `-V` renueva los anónimos) en
    el README y en un comentario del compose.
  Preferí la primera si el arranque sigue siendo razonable (medilo).
- [ ] **Paso 4, comprobar arrancando:** `docker compose up -d --build -V api`; esperá a que loguee que
  escucha; pegale con `curl` a una ruta pública (`/health` si existe; si no, una que conteste sin
  sesión, p. ej. la de la web pública de un slug del seed) y anotá el status. Después **`docker compose
  stop api`**. Los contenedores `postgres`, `postgres-test` y `redis` quedan como estaban.
- [ ] **Paso 5:** si no hay una ruta de salud y hiciera falta una, **no la agregues**: reportalo.

---

## Tarea 9: cierre

- [ ] **Paso 1, verificación entera:**

  ```bash
  grep -rn "MUTACION TEMPORAL" apps --exclude-dir=dist     # cero
  pnpm --filter @boxadmin/web test
  pnpm --filter @boxadmin/web exec tsc --noEmit
  pnpm --filter @boxadmin/web build
  pnpm --filter @boxadmin/api test
  pnpm --filter @boxadmin/api test:reloj                  # y con RELOJ_ANIOS=5
  pnpm --filter @boxadmin/api exec tsc --noEmit
  pnpm --filter @boxadmin/api build
  pnpm --filter @boxadmin/api test:e2e
  ```

  Y `prettier --check` sobre cada archivo tocado (`git status --short`). Anotá los números.
- [ ] **Paso 2, README:** una sección `## La deuda vieja — Fase 20` después de la de la Fase 19, con:
  las ausencias son de días enteros (y qué se quitó); el motivo de `centavos: null`; las marcas por
  persona de los jobs diarios; **el procedimiento de rotación de la clave**, paso a paso; cómo se
  arranca el contenedor `api`.
- [ ] **Paso 3, PROGRESO:** un bloque `# Progreso Fase 20 — La deuda vieja` al final, con la forma del
  de la Fase 19: por tarea, números antes/después, las dos migraciones, las mutaciones y qué dieron, la
  **deuda** (cerrada / por diseño / nueva), «Lo que esta fase NO hace» y un **checklist a mano**:
  - [ ] Crear una ausencia desde el panel sigue funcionando y bloquea el día entero.
  - [ ] En Análisis → Caja, con un alumno con pack «a consultar», se lee «más 1 a consultar».
  - [ ] En «Reasignar», un turno de hoy que ya empezó no aparece; uno lleno aparece deshabilitado.
  - [ ] Elegir un plan destacado en Configuración → Web y verlo en la landing.
  - [ ] Rotar la clave en un entorno de prueba siguiendo el README.
  Y **marcar en la lista vieja de la Fase 13 (~4020) cada punto como cerrado**, con «(Fase 20)», sin
  reformatear el resto.
- [ ] **Paso 4, el spec:** **Estado: ejecutada**, y corregí lo que el plan haya medido distinto.
