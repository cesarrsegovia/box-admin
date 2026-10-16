# Fase 10 — La configuración operativa

**Fecha:** 2026-10-15
**Estado:** aprobado, pendiente de plan

## 1. Por qué existe esta fase

Cierra **Operación diaria**. Las fases 8 y 9 entregaron la publicación del mes y el manejo de los
turnos que genera; ésta entrega **los datos de los que ese calendario se alimenta**.

Hoy, para dar de alta una sala, asignarle horario a una profesora o cargar un feriado, hace falta un
`curl`. Y sin eso, el asistente de la Fase 8 publica meses sobre datos que nadie puede mantener.

| Entidad                  | Qué alimenta                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------- |
| **Salas**                | Dónde ocurre todo. Su `cupoBase` decide cuántos entran.                             |
| **Horarios de profesor** | **Qué profesora se asigna sola al publicar un mes**, y la tarifa de la liquidación. |
| **Vacaciones**           | Exclusiones del plan, por alumno.                                                   |
| **Ausencias**            | Exclusiones del plan, por sala o por todo el salón.                                 |

**No agrega ni modifica un solo endpoint de la API.** Son 15 endpoints que ya existen, 12 con rol.

## 2. Decisiones cerradas con Cesar

1. **Tres pantallas y un bloque**, no cuatro pantallas. Las vacaciones son **de una persona**, así que
   viven en su ficha, al lado de los días fijos: «qué días viene» y «cuándo no viene» juntos. Es la
   misma decisión que las rutinas en la Fase 7, y por el mismo motivo — listar todas las vacaciones del
   gimnasio no es una tarea que nadie haga.
2. **Los campos muertos no se dibujan.** Ver §5.

## 3. La división de roles no la inventamos

| Pantalla                 | Escribir pide     |
| ------------------------ | ----------------- |
| Salas                    | **`ADMIN_SALON`** |
| Ausencias                | **`ADMIN_SALON`** |
| Horarios                 | `ADMIN_OPERATIVO` |
| Vacaciones (en la ficha) | `ADMIN_OPERATIVO` |

Ya está así en la API, y tiene sentido: **cerrar el salón un día y cambiar el cupo de una sala son
decisiones del dueño**, no de recepción.

⚠️ Los botones de escritura de salas y ausencias **no existen en el marcado** para un
`ADMIN_OPERATIVO` — no escondidos con CSS, como el de publicar el mes y el de resetear contraseñas. Y
sin proveedor de rol tampoco se dibujan: falla cerrada.

Las lecturas son más abiertas: `GET /salas`, `GET /salas/:id` y `GET /ausencias` no llevan `@Roles`.

## 4. Los horarios son el corazón

Es la pantalla que decide **qué profesora se asigna sola al publicar un mes**, y la que alimenta la
liquidación con su `tarifaPorHora`.

### Tres choques, tres motivos

La API los distingue a propósito, y la pantalla también:

| Situación                                      | Mensaje                                                                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Otra profesora en esa sala, ese día y esa hora | «Ya hay otra profesora asignada a esa sala en ese dia y hora. Un turno tiene una sola profesora, asi que dos horarios que se pisan no se pueden resolver.» |
| La misma profesora, otra sala, misma hora      | «Esa profesora ya esta asignada a otra sala a esa hora, y no puede estar en dos salas a la vez.»                                                           |
| Mismo horario, misma sala, misma profesora     | «Esa profesora ya tiene ese horario en esa sala»                                                                                                           |

⚠️ **Un mensaje genérico para los tres es lo que hace que el admin no sepa qué cambiar.** Y la pantalla
no se limita a mostrarlos: al elegir día y franja **enseña qué hay ya ahí**, para que el choque se evite
mirando en vez de chocando.

### La tarifa es dinero

`tarifaPorHora` viaja como **cadena con dos decimales, nunca como número**: un float binario no
representa 1500.10 exactamente. Misma regla que el precio de los packs desde la Fase 1.

Y **`null` significa «usa la tarifa general del gimnasio»**, que es un valor legítimo y **distinto de
cero**. Vaciar el campo no es poner cero.

### Validaciones de rango

`horaFin debe ser posterior a horaInicio` y `hasta no puede ser anterior a desde`, las dos del servidor
y mostradas tal cual. La segunda aparece también en vacaciones.

## 5. Dos campos muertos que no se dibujan

**`Sala.exclusiva`** aparece en **un solo sitio de todo el código**: el mapeo (`salas.service.ts:19`).
Ninguna regla lo lee.

**`Ausencia.recuperable`** aparece en **dos**: el mapeo y la escritura con `?? true`. El planificador no
lo mira.

Los dos se guardan, se devuelven, y no hacen nada. Dibujarlos sería un control que no cambia nada — el
mismo patrón que sacamos en la Fase 6A con `/stats/caja?salaId=`, que validaba una sala y devolvía los
números de todas, y que llamamos **«una mentira con código 200»**.

⚠️ **`recuperable` es el peor de los dos, porque el nombre promete algo concreto**: un admin que marque
una ausencia como recuperable va a creer que a los alumnos se les devuelve la clase. Ofrecerlo con una
advertencia tampoco sirve: una advertencia permanente se vuelve invisible a las dos semanas.

**Los dos quedan como deuda anotada, con su medición.** Existen en la base y en el contrato; el día que
alguien implemente la regla, el control se agrega.

Hay un test que fija que **no se dibujan**: sin él, el próximo que lea `SalaPublica` los va a agregar
«porque faltaban».

## 6. Los nulos de una sala no son «apagado»

Cuatro de los ocho ajustes de una sala —`cupoBase`, `minMinutosCancelar`, `minMinutosAnotarse` y
`listaEsperaHabilitada`— tienen `null` con un significado propio: **«hereda del gimnasio»**.

Y la herencia **es real**, no una promesa: `minMinutosCancelar` se lee del tenant en
`disponibilidad.service.ts:112`.

O sea que son **controles de tres estados**, no interruptores: heredar, o un valor propio que puede ser
cero. Un control de dos estados obligaría a elegir entre mentir —«apagado» cuando en realidad hereda— o
perder la herencia al guardar. Es la misma forma que el selector de tres estados que la Fase 9 necesitó
para `soloLibres`, donde vacío y `false` eran dos peticiones distintas.

⚠️ **A verificar antes de construir:** que se pueda **volver a heredar** mandando `null` explícito.
`@IsOptional()` de class-validator deja pasar el null, y el servicio hace `data: { ...dto }`, así que
debería funcionar — **pero no lo doy por cierto**. Si no se pudiera, el control de tres estados no tiene
tercer estado y hay que decirlo en pantalla en vez de fingirlo.

El formulario manda **sólo lo que cambió**, como todas las fichas del panel, para no pisar una herencia
sin querer.

## 7. Dar de baja una sala puede estar bloqueado

La API cuenta los turnos de hoy en adelante y devuelve 409 con el número: «La sala tiene N turno(s) de
hoy en adelante. Borralos o reasignalos antes de darla de baja.»

La pantalla lo dice **antes** del clic y maneja igual el 409, por si alguien publica un mes en el medio.

⚠️ **Hay dos puertas a la misma baja**: el `DELETE` y un `PATCH` con `activa: false`. Las dos pasan por
la misma protección, así que el interruptor de «activa» en la ficha **también** puede devolver ese 409.

## 8. Las ausencias cierran una sala o todo el salón

`salaId: null` significa **todo el salón**. Es un caso distinto de «no elegí sala todavía», y la
pantalla tiene que hacerlo explícito en vez de dejarlo como un desplegable vacío.

Una ausencia puede ser de todo el día o de una franja (`todoElDia`, con `horaInicio`/`horaFin` sólo si
es `false`).

## 9. Lo que se reusa

El reparto de errores por campo (`admin/usuarios/[id]/errores.ts`), la tabla, el diálogo de
confirmación, `useRolDeQuienMira()`, `useUsuarios({ tipo: 'profesor' })`, `useSalas()`, el helper del
`volverA` que conserva el query, y los tres tapones globales de `vitest.setup.ts` —consola, título de la
pestaña y `window.name`— que ya corren en todos los specs contra un registro común.

## 10. Cómo se prueba

- **Los tres choques de horario se distinguen**, cada uno con su mensaje.
- **El nulo de un ajuste se distingue del cero**, y guardar un campo **no pisa los otros tres**.
- **La tarifa viaja como cadena con dos decimales**, y vacía significa heredar, no cero.
- **Los botones de escritura de salas y ausencias no existen en el marcado** para un `ADMIN_OPERATIVO`,
  afirmado **sobre el marcado** — `*ByRole` consulta el árbol de accesibilidad, que ya excluye lo que
  lleva `hidden`.
- **Dar de baja una sala con turnos** lo dice antes y maneja el 409. Y el interruptor de «activa»
  también.
- **El bloque de vacaciones se monta con DOS sembradas**: con una sola, «borra la suya» y «borra la
  primera» son indistinguibles.
- **Ni `exclusiva` ni `recuperable` se dibujan.**
- **Una ausencia de todo el salón se distingue de una sin sala elegida.**

### La mutación abierta

Cada tarea lleva una. Van **veintiséis de veintiséis**. La familia es siempre **agregar algo que no
debería estar, sin quitar nada**, y lo que cambia es **dónde nadie estaba mirando**: el payload RSC, dos
cachés distintas, `localStorage`, las galletas, un atributo del DOM, dos clases de cabecera, `console.*`,
el título de la pestaña, `window.name`, el argumento recibido, la navegación al montar, la History API,
el alcance de una invalidación, lo que una acción pide después de escribir, y un log de depuración.

Y las **cuatro formas de que un test exista y no pueda fallar**: autorreferencial, con la premisa
destruida por el código que prueba, montado en el caso ciego, y verde por casualidad ortográfica.

## 11. Fuera de alcance

- **Implementar las reglas de `exclusiva` y `recuperable`.** Son de negocio y necesitan decidirse, no
  programarse a ciegas.
- **La configuración del gimnasio** (los valores que las salas heredan): es otra pantalla y pertenece al
  área de Configuración.
- **Pantallas de profesor**, que siguen sin existir.
- **Cualquier cambio en `apps/api`.**
