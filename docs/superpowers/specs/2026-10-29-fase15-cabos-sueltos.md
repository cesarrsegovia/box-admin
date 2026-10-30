# Fase 15 — Cabos sueltos

**Fecha:** 2026-10-29
**Estado:** aprobado, pendiente de plan

## 1. Por qué existe esta fase

El cruce de cierre de la Fase 14 contó **103 rutas: 94 con pantalla y 9 sin**. Seis no la necesitan
(archivos locales, conflictos, alta de gimnasio, la ruta de prueba de la Fase 0). **Tres son de
negocio**, y el inventario viejo no las vio porque contaba literales, no pantallas:

| Endpoint                       | Qué falta                        | Toca la API        |
| ------------------------------ | -------------------------------- | ------------------ |
| `POST /turnos`                 | Crear un turno a mano            | No                 |
| `PATCH /rutinas/:id`           | Editar un día fijo de un alumno  | No                 |
| `GET /liquidacion/:profesorId` | Que **la profesora** vea lo suyo | **Sí: ruta nueva** |

Con esta fase el cruce tiene que dar **cero endpoints de negocio sin pantalla**.

## 2. Decisiones cerradas con Cesar

1. **Las tres cosas en una sola fase.**
2. **La profesora tiene un endpoint propio, `GET /mi-liquidacion`**, en vez de abrir el de admin. El
   perfil sale del token, así que **no hay URL con la que pedir la de otra**.
3. **Editar una rutina rige desde el próximo mes publicado.** Las reservas ya generadas no se
   mueven, y la pantalla lo dice.
4. **Crear un turno es una página**, `/admin/turnos/nuevo`, como `/admin/usuarios/nuevo`.

## 3. Crear un turno a mano

**Sólo web.** `POST /turnos` no cambia: `@Roles('ADMIN_OPERATIVO')`, y el `ADMIN_SALON` llega por
jerarquía (`rolAlcanza` es numérica: 40 ≥ 30).

- En `/admin/turnos`, un enlace «Nuevo turno». Sin puerta propia: el panel entero ya exige
  `ADMIN_OPERATIVO` (`admin/layout.tsx`).
- Campos de `CrearTurnoDto`: sala (**sólo activas**), nombre (≤ 80), fecha, hora de inicio, hora de
  fin, cupo (entero ≥ 1).
- **Profesora, opcional.** El select arranca en «La del horario semanal», que **no manda
  `profesorId`**: el servicio la resuelve del patrón. Si se elige una, viaja su **`perfilId`**, no
  el id de usuario (la misma trampa que en la liquidación).
- Al guardar se navega al detalle del turno creado.
- Los errores de la API se muestran tal cual: horas incoherentes, sala de baja (400), profesora sin
  acceso a la sala. El botón se bloquea mientras la petición está en vuelo.

⚠️ El motor de publicación **sólo rellena huecos**: un turno manual no lo pisa nunca. No hay nada que
hacer en la pantalla por eso, pero conviene saberlo para no inventar un aviso falso.

## 4. Editar una rutina

**Sólo web.** `useActualizarRutina` existe desde antes y nadie lo usa.

- Va en el **bloque de días fijos de la ficha del alumno**, junto a «Dar de baja», en cada rutina
  activa.
- Se editan **nombre, día, horario y vigencia** (`desde` / `hasta`). **La sala no**: el DTO no la
  acepta.
- Viaja **sólo lo que cambió**. El servicio rellena lo que falta con lo existente para validar.
- **Aviso fijo en el formulario:** «El cambio rige para los meses que se publiquen de ahora en
  adelante. Las reservas ya generadas no se mueven.»

### Por qué el aviso es obligatorio y no decorativo

Las reservas con `origen: 'RUTINA'` las crea la **publicación del mes**
(`jobs/generacion-mes/publicacion.service.ts`). `PATCH /rutinas/:id` sólo actualiza la fila de la
rutina. Pasar a un alumno de lunes 18:00 a martes 19:00 **deja sus reservas del mes publicado en el
lunes**. Sin el aviso, la pantalla mentiría por omisión. Mover reservas ya generadas queda **fuera de
alcance** (§8).

## 5. La profesora ve su liquidación

### API — la única ruta nueva de la fase

`GET /mi-liquidacion?anio=&mes=`, en el módulo de liquidación:

- `@Roles('PROFESOR')`.
- **El perfil sale del token** (`perfil.usuarioId = actor.sub`), el mismo patrón que
  `MisClasesService.perfilDelActor` y `/mi-calendario`. Ningún id en la URL ni en el cuerpo.
- Reusa `LiquidacionService.delMes` sin cambiarlo. Mismas validaciones de `anio` y `mes`.
- **Un admin pasa el guard por jerarquía y recibe 404**, porque no tiene perfil. Es lo mismo que pasa
  en `mis-clases`, y es correcto.
- `GET /liquidacion/:profesorId` **no se toca**: sigue siendo `ADMIN_SALON`.
- **`packages/shared` no cambia**: el tipo `LiquidacionProfesor` ya existe.

Pruebas: unitarias del controller/servicio y **e2e** que demuestren tres cosas: la profesora ve la
suya; no existe forma de pedir la de otra (la ruta no acepta id); un `ALUMNO` recibe 403.

### Web

- Página `/(profesor)/mi-liquidacion`. Mes actual por defecto, con **el mismo selector de mes que Análisis** (los últimos doce
  meses), que ya existe y está probado. Los helpers de mes pasan de `admin/analisis/filtros.ts` a
  `lib/mes.ts`, porque el área de la profesora no importa de la del admin.
- El layout de la profesora hoy tiene **una sola entrada** (`/mis-clases`). Se agrega una navegación
  mínima con dos enlaces: «Mis clases» y «Mi liquidación».
- **`LiquidacionLeida` se extrae** de `admin/analisis/liquidacion.tsx` a un componente compartido.
  **La única diferencia entre las dos pantallas es el aviso de minutos sin tarifa**:
  - admin: «Configurar la tarifa en Horarios», con el enlace de hoy;
  - profesora: «avisale a la administración», **sin enlace** a una pantalla que no puede abrir.
- La extracción no puede cambiar nada de lo que ve el admin: **los 25 tests de
  `liquidacion.spec.tsx` pasan sin tocarlos.**

## 6. Cómo se prueba

Lo de siempre, sin excepciones:

- TDD; cada test nuevo se ve rojo antes de verde.
- El guardián global de consola (`espia-de-consola.ts`, dieciocho canales más el 20) vigila cada
  spec. Los datos sensibles nuevos —importes, tarifas, nombres— se declaran con `vigilarEstosDatos`.
- **Una mutación abierta por tarea**, marcada `MUTACION TEMPORAL`. Si pasa en verde, se cierra el
  agujero o se reporta.
- Para lo que **no** se dice (el enlace a Horarios en la pantalla de la profesora), se monta dos
  veces y se compara.
- Cierre: `tsc`, `build`, tests de web y api, e2e, `prettier --check` sobre lo tocado, y **el cruce
  de endpoints rehecho: 104 rutas, cero de negocio sin pantalla**.

## 7. Tareas

1. API `GET /mi-liquidacion`, con unitarias y e2e.
2. Extraer `LiquidacionLeida` a un componente compartido, con el aviso sin tarifa como variante.
3. Página `/(profesor)/mi-liquidacion` y navegación de la profesora.
4. `/admin/turnos/nuevo` y el enlace desde el listado.
5. Editar una rutina en el bloque de días fijos.
6. Cierre: verificación, cruce, README, PROGRESO.

## 8. Fuera de alcance

- **Mover las reservas ya generadas cuando se edita una rutina.** Es lógica nueva en la API (cupos
  llenos, lista de espera, avisos) y es una fase por sí misma.
- Cambiar la sala de una rutina.
- La deuda `Importe` contra cadena pelada en `packages/shared`.
