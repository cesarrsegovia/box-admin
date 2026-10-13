# Fase 9 — Turnos y reservas

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans`, tarea por tarea. Los pasos llevan casillas (`- [ ]`).

**Objetivo:** las pantallas que permiten **tocar** el mes que la Fase 8 genera — ver un turno, editarlo,
poner una suplencia, anotar a alguien, cancelarle y reasignarle la reserva. Es lo que recepción hace
todo el día y hoy exige un `curl`.

**Arquitectura:** dos pantallas en `/{slug}/admin/turnos`, con el estado en la URL. **Más un endpoint de
lectura nuevo en la API**, que es la única vez en tres fases que se toca `apps/api`.

**Spec:** `docs/superpowers/specs/2026-10-10-fase9-turnos-y-reservas.md`

---

## Reglas que gobiernan todo este plan

⚠️ **No hacés commits.** Nunca `git add`, `git commit`, `git push`, `git stash`, `git checkout` ni
`git reset`. `git status`, `git diff` y `git show` sí. Los commits los hace Cesar.

⚠️ **Nunca `pnpm lint`.** Lleva `--fix` y reformatea código commiteado. Usá `pnpm exec prettier
--check`, y `--write` **sólo** sobre archivos que vos mismo creaste o tocaste.

⚠️ **Nunca `taskkill` ni `Stop-Process` por NOMBRE de proceso.** Hay una sesión viva de Claude Code en
la máquina. Por PID concreto y sólo los que levantaste vos.

⚠️ **`docker compose up` pelado está prohibido** (el servicio `api` le roba los trabajos a Redis). Sólo
`docker compose up -d postgres postgres-test redis`, o `docker start` de los que existan.
**`prisma migrate reset` y `docker compose down -v` necesitan permiso explícito.**

⚠️ **Nada de strings con barra invertida por heredoc**: el heredoc del Bash tool se los come aun con el
delimitador entre comillas. Usá la herramienta de edición.

⚠️ El `tsc` del repo lleva **`noUncheckedIndexedAccess`**. Y `apps/web` **no tiene eslint**.

### Lo único que se toca de la API

**El endpoint de la Task 1, y nada más.** Si cualquier otra tarea parece necesitar un endpoint, **pará
y reportalo**: es señal de que está inventando una capacidad en vez de usar la que hay.

**Comandos:**

```bash
pnpm --filter @boxadmin/api test                       # unitarios de la API
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/shared build                   # OBLIGATORIO tras tocar shared
pnpm api:test:e2e                                      # DESDE LA RAIZ (dotenv, Postgres 5433)
pnpm --filter @boxadmin/web test
pnpm --filter @boxadmin/web exec vitest run <archivo>  # subcadena, NO regex
pnpm --filter @boxadmin/web exec tsc --noEmit
pnpm --filter @boxadmin/web build
```

**Punto de partida:** `apps/web` 802/41, `apps/api` 1291/65, e2e 204/12, shared 103/4. Todo verde.

### La mutación abierta

Cada tarea termina con una. Van **veinte de veinte** en tres fases. La familia es siempre **agregar algo
que no debería estar, sin quitar nada**; lo que cambia es **dónde nadie estaba mirando**:

| Dónde apareció                           | El eje que nadie auditaba                                     |
| ---------------------------------------- | ------------------------------------------------------------- |
| un componente de cliente                 | lo que viaja en el payload RSC                                |
| un `router.push`                         | cuántas veces se llama, no con qué                            |
| una lista blanca de enlaces              | comprobada con un solo rol                                    |
| la caché de consultas y la de mutaciones | **dos almacenes**: tapar uno deja el otro                     |
| `localStorage`                           | sobrevive al logout y al cambio de turno                      |
| el service worker                        | **las cabeceras**: ningún test construía peticiones con ellas |
| `console.*` y `document.title`           | lo que la pantalla dice **fuera del documento**               |
| un argumento recibido                    | que la función sea pura en lo que **recibe**                  |
| un `useEffect`                           | navegar **al montar**, no al cambiar algo                     |
| un atributo del DOM                      | los tests miraban texto, roles, recuentos y rutas             |

### Y las cuatro formas de que un test no pueda fallar

Mirálas en lo que escribas; las cuatro aparecieron en código de estas fases:

1. **Autorreferencial** — comparar el DOM contra la misma función que lo alimenta. _Una lista blanca
   derivada del sitio que audita no es una lista blanca._
2. **Premisa destruida** — el código bajo prueba borra el borde que el test venía a ejercitar, y el test
   sigue verde con un nombre que ya no describe nada.
3. **Montado en el caso ciego** — fijar algo en el único escenario donde la distinción no existe.
4. **Verde por casualidad ortográfica** — una defensa que necesita un comentario rogando que nadie toque
   una palabra ya falló.

### Sobre la densidad de este plan

Las Tasks 1 y 2 traen el código completo: el endpoint nuevo y los hooks. Las Tasks 3 a 5 traen **el
código de los tests y la tabla de mutaciones, pero no el de la implementación** — repiten patrones ya
fijados (filtros en la URL, bloques con su propia mutación, reparto de errores por campo). **Si aparece
una decisión que los tests no determinan, paralo y preguntá en vez de inventar un patrón nuevo.**

Y la advertencia que la Fase 7 dejó por escrito: cuando los tests se escriben desde una especificación
detallada, **la implementación que sale de esa misma especificación los pasa a la primera**. El rojo
inicial sólo prueba que el archivo no existía. **La confianza la da la tabla de mutaciones.**

---

## Estructura de archivos

```
packages/shared/src/
  nucleo.contracts.ts              TOCAR   + ReservaEnTurno
apps/api/src/reservas/
  reservas.controller.ts           TOCAR   + GET
  reservas.service.ts              TOCAR   + listarDeTurno
  reservas.service.spec.ts         TOCAR
apps/api/test/
  reservas-de-turno.e2e-spec.ts    CREAR
apps/web/src/
  hooks/
    use-turnos.ts                  CREAR
    use-turnos.spec.tsx            CREAR
  app/[slug]/admin/
    navegacion-admin.ts            TOCAR   una linea
    turnos/
      page.tsx · page.spec.tsx     CREAR   el listado
      filtros.tsx                  CREAR
      [id]/
        page.tsx · page.spec.tsx   CREAR   la ficha
        datos.tsx                  CREAR
        profesora.tsx              CREAR
        anotados.tsx               CREAR
        cancelar.tsx               CREAR
        reasignar.tsx              CREAR
```

---

## Task 1: El endpoint que falta

**Files:** tocar `packages/shared/src/nucleo.contracts.ts`, `apps/api/src/reservas/reservas.controller.ts`,
`reservas.service.ts`, `reservas.service.spec.ts`; crear `apps/api/test/reservas-de-turno.e2e-spec.ts`

**Por qué existe:** hoy el admin puede crear, cancelar y reasignar una reserva, pero **no tiene de dónde
sacar el id** salvo de la respuesta del POST que él mismo hizo. Dos endpoints que existen y nadie puede
usar.

- [ ] **Step 1: El contrato**

En `packages/shared/src/nucleo.contracts.ts`, después de `ReservaCreada`:

```ts
/**
 * Una reserva tal y como la ve el admin en la ficha de un turno.
 *
 * NO es `AlumnoEnClase` (el de la pantalla del profesor), que tiene `perfilId`,
 * `nombreCompleto` y `asistio` y **no trae el id de la reserva**. Ese id es
 * justamente lo que el admin necesita para cancelar o reasignar: sin el, los
 * dos endpoints que ya existen no se pueden usar.
 *
 * Lleva el nombre resuelto porque un listado de ids no se puede operar: el
 * admin tiene que saber a quien esta cancelando.
 */
export interface ReservaEnTurno {
  id: string;
  perfilId: string;
  nombreCompleto: string;
  origen: OrigenReserva;
  esPrueba: boolean;
  pagoRealizado: boolean;
  /** `null` = todavia no se paso lista. */
  asistio: boolean | null;
  /** ISO 8601, o `null` si sigue activa. */
  canceladaEn: string | null;
  cancelacionTipo: TipoCancelacion | null;
}
```

⚠️ **Tras tocar `shared` hay que reconstruirlo**: `pnpm --filter @boxadmin/shared build`. Los demás
paquetes resuelven los tipos desde `dist/`, no desde `src/`.

- [ ] **Step 2: Los tests que fallan**

En `reservas.service.spec.ts`, siguiendo el estilo de los que ya hay:

```ts
describe('listarDeTurno', () => {
  it('devuelve las reservas del turno con el nombre resuelto', async () => {});

  it('devuelve TAMBIEN las canceladas', async () => {
    // Un solo endpoint sirve a los dos usos; la pantalla las separa. Ver quien
    // cancelo recuperable es contexto que el admin quiere.
  });

  it('las claves de cada fila son EXACTAMENTE las del contrato', async () => {
    // Lista blanca: el mapeo es a mano, campo por campo, y este test lo fija.
    // Un `select` es una promesa sobre la CONSULTA y el mapeo una sobre la
    // RESPUESTA; solo la segunda sobrevive a que alguien ensanche el select.
    expect(Object.keys(fila).sort()).toEqual([
      'asistio',
      'canceladaEn',
      'cancelacionTipo',
      'esPrueba',
      'id',
      'nombreCompleto',
      'origen',
      'pagoRealizado',
      'perfilId',
    ]);
  });

  it('NO devuelve el tenantId ni el turnoId', async () => {});

  it('ordena por nombre', async () => {});

  it('un turno inexistente da 404 y no una lista vacia', async () => {
    // Una lista vacia y "ese turno no existe" son cosas distintas, y el admin
    // que se equivoco de enlace tiene que poder distinguirlas.
  });

  it('un turno sin reservas da una lista vacia', async () => {});
});
```

- [ ] **Step 3: El servicio**

En `reservas.service.ts`. Modelalo sobre `listaDeAlumnos` de `mis-clases.service.ts:223`, que ya hace
esta consulta — pero **sin** su filtro `canceladaEn: null` y **sin** su `exigirTurnoPropio`, que es
justamente lo que impide que un admin lo use.

```ts
async listarDeTurno(turnoId: string): Promise<ReservaEnTurno[]> {
  // `findFirst` y no `findUnique`: la extension de aislamiento rechaza las
  // operaciones de where unico (UnsafeUniqueOperationError) porque no hay
  // donde inyectarle el filtro de tenant.
  const turno = await this.prisma.db.turno.findFirst({ where: { id: turnoId } });
  if (!turno) throw new NotFoundException('Turno inexistente');

  const reservas = await this.prisma.db.reserva.findMany({
    where: { turnoId },
    include: { perfil: { include: { usuario: { select: { nombreCompleto: true } } } } },
    orderBy: { perfil: { usuario: { nombreCompleto: 'asc' } } },
  });

  // Mapeo a mano, campo por campo. Nada de spread de la fila.
  return reservas.map((reserva) => ({
    id: reserva.id,
    perfilId: reserva.perfilId,
    nombreCompleto: reserva.perfil.usuario.nombreCompleto,
    origen: reserva.origen,
    esPrueba: reserva.esPrueba,
    pagoRealizado: reserva.pagoRealizado,
    asistio: reserva.asistio,
    canceladaEn: reserva.canceladaEn?.toISOString() ?? null,
    cancelacionTipo: reserva.cancelacionTipo,
  }));
}
```

Ajustá los tipos a los que use el repo (`ClientePrismaTx`, los `as unknown as` que haga falta) mirando
cómo lo resuelve `listaDeAlumnos`.

- [ ] **Step 4: El controlador**

En `ReservasDeTurnoController`, al lado del `@Post()` que ya existe:

```ts
  @Roles('ADMIN_OPERATIVO')
  @Get()
  listar(@Param('turnoId') turnoId: string): Promise<ReservaEnTurno[]> {
    return this.reservas.listarDeTurno(turnoId);
  }
```

- [ ] **Step 5: El inventario de rutas públicas NO cambia**

⚠️ `common/guards/rutas-publicas.spec.ts` enumera las rutas que **no piden JWT**. Ésta pide rol, así que
**no entra**. Lo que hay que comprobar es que ese test **siga igual** después de agregar el endpoint: el
inventario es bidireccional y cazaría un `@Public()` puesto por error como una pública que sobra.

Corré ese spec y confirmá que pasa sin tocarlo. Si cambia, algo salió mal.

- [ ] **Step 6: El e2e**

Crear `apps/api/test/reservas-de-turno.e2e-spec.ts`, siguiendo los doce que ya existen.

⚠️ **El e2e es el que prueba que el endpoint existe de verdad.** La Fase 6B dejó la regla: _un doble
escrito a mano sólo sabe lo que su autor creía_ — allí dos funciones centrales resultaron no haber
funcionado nunca con 1290 unitarios en verde.

Casos: un `ADMIN_OPERATIVO` ve las reservas con el nombre; **un `ALUMNO` recibe 403**; el turno de otro
gimnasio da 404 (aislamiento); y el cuerpo trae **exactamente** las claves del contrato.

⚠️ Antes de correr, **comprobá que no hay procesos node huérfanos**: un jest superviviente de una
corrida cortada vuelve los e2e intermitentes y parece un bug del código. Listalos con su PID y su línea
de comandos; **matá sólo los que hayas lanzado vos**, por PID.

- [ ] **Step 7: Verificar**

```bash
pnpm --filter @boxadmin/shared build
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
pnpm api:test:e2e
pnpm exec prettier --check <tus archivos>
```

`apps/api` tiene que ir de 1291 a 1291+N, y los e2e de 204 a 204+M. **Ningún test preexistente puede
caer.**

- [ ] **Step 8: Las mutaciones**

| Mutación                                     | Debe caer                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| Filtrar `canceladaEn: null`                  | «devuelve TAMBIEN las canceladas»                                         |
| Devolver la fila con spread en vez de mapear | «las claves son EXACTAMENTE las del contrato» y «NO devuelve el tenantId» |
| Quitar el 404 y devolver `[]`                | «un turno inexistente da 404»                                             |
| Quitar `@Roles('ADMIN_OPERATIVO')`           | el e2e del 403 del alumno                                                 |
| `findFirst` → `findUnique`                   | debería reventar con `UnsafeUniqueOperationError`: confirmalo             |
| Quitar el `orderBy`                          | «ordena por nombre»                                                       |

- [ ] **Step 9: La mutación abierta.** Ver el encabezado. Pista: es un endpoint que devuelve datos de
      personas, y el eje de «un campo de más» ya está cubierto por la lista blanca — buscá otro.

---

## Task 2: Los hooks

**Files:** crear `apps/web/src/hooks/use-turnos.ts` · `use-turnos.spec.tsx`

- [ ] **Step 1: La implementación**

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ReservaCreada,
  ReservaEnTurno,
  ReservaPublica,
  TipoCancelacion,
  TurnoPublico,
} from '@boxadmin/shared';
import { type ErrorDeApi, pedir } from '@/lib/cliente';

export interface FiltrosDeTurnos {
  desde?: string;
  hasta?: string;
  salaId?: string;
  soloLibres?: boolean;
  profesorId?: string;
}

export const clavesDeTurnos = {
  lista: (f: FiltrosDeTurnos) => ['turnos', f] as const,
  uno: (id: string) => ['turno', id] as const,
  reservas: (turnoId: string) => ['reservas-de-turno', turnoId] as const,
};

/**
 * Solo los filtros con valor. Mandar `soloLibres=` vacio no es lo mismo que no
 * mandarlo: el `ParseBoolPipe` de la API lo rechazaria con un 400.
 */
export function queryDeTurnos(f: FiltrosDeTurnos): string {
  const partes = new URLSearchParams();
  if (f.desde !== undefined && f.desde !== '') partes.set('desde', f.desde);
  if (f.hasta !== undefined && f.hasta !== '') partes.set('hasta', f.hasta);
  if (f.salaId !== undefined && f.salaId !== '') partes.set('salaId', f.salaId);
  if (f.soloLibres !== undefined) partes.set('soloLibres', String(f.soloLibres));
  if (f.profesorId !== undefined && f.profesorId !== '') partes.set('profesorId', f.profesorId);

  const texto = partes.toString();
  return texto === '' ? '' : `?${texto}`;
}

export function useTurnos(filtros: FiltrosDeTurnos) {
  return useQuery({
    queryKey: clavesDeTurnos.lista(filtros),
    queryFn: () => pedir<TurnoPublico[]>(`/turnos${queryDeTurnos(filtros)}`),
  });
}

export function useTurno(id: string) {
  return useQuery({
    queryKey: clavesDeTurnos.uno(id),
    queryFn: () => pedir<TurnoPublico>(`/turnos/${id}`),
  });
}

export function useReservasDelTurno(turnoId: string) {
  return useQuery({
    queryKey: clavesDeTurnos.reservas(turnoId),
    queryFn: () => pedir<ReservaEnTurno[]>(`/turnos/${turnoId}/reservas`),
  });
}

/**
 * Tras cualquier escritura hay que invalidar el turno Y sus reservas Y la
 * lista: el cupo ocupado cambia en los tres sitios.
 */
function useInvalidar(turnoId: string) {
  const cliente = useQueryClient();

  return () => {
    void cliente.invalidateQueries({ queryKey: clavesDeTurnos.uno(turnoId) });
    void cliente.invalidateQueries({ queryKey: clavesDeTurnos.reservas(turnoId) });
    void cliente.invalidateQueries({ queryKey: ['turnos'] });
  };
}

export function useActualizarTurno(id: string) {
  const invalidar = useInvalidar(id);
  return useMutation<TurnoPublico, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) => pedir<TurnoPublico>(`/turnos/${id}`, { metodo: 'PATCH', cuerpo: datos }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

export function useAsignarProfesor(id: string) {
  const invalidar = useInvalidar(id);
  return useMutation<TurnoPublico, ErrorDeApi, string | null>({
    mutationFn: (profesorId) =>
      pedir<TurnoPublico>(`/turnos/${id}/profesor`, { metodo: 'PATCH', cuerpo: { profesorId } }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

export function useBorrarTurno(id: string) {
  const cliente = useQueryClient();
  return useMutation<null, ErrorDeApi, void>({
    mutationFn: () => pedir<null>(`/turnos/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['turnos'] }),
    gcTime: 0,
  });
}

export function useAnotar(turnoId: string) {
  const invalidar = useInvalidar(turnoId);
  return useMutation<ReservaCreada, ErrorDeApi, string>({
    mutationFn: (perfilId) =>
      pedir<ReservaCreada>(`/turnos/${turnoId}/reservas`, { metodo: 'POST', cuerpo: { perfilId } }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

/**
 * El tipo viaja en el QUERY y en minusculas (`?tipo=recuperable|definitiva`),
 * que es lo que acepta el DTO. Y NO tiene valor por defecto a proposito: una
 * DEFINITIVA le gasta la clase al alumno y una RECUPERABLE se la devuelve, asi
 * que elegir por el seria decidir en su nombre.
 */
export function useCancelar(turnoId: string) {
  const invalidar = useInvalidar(turnoId);
  return useMutation<ReservaPublica, ErrorDeApi, { id: string; tipo: TipoCancelacion }>({
    mutationFn: ({ id, tipo }) =>
      pedir<ReservaPublica>(`/reservas/${id}?tipo=${tipo.toLowerCase()}`, { metodo: 'DELETE' }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

export function useReasignar(turnoId: string) {
  const invalidar = useInvalidar(turnoId);
  return useMutation<ReservaPublica, ErrorDeApi, { id: string; destinoId: string }>({
    mutationFn: ({ id, destinoId }) =>
      pedir<ReservaPublica>(`/reservas/${id}/reasignar`, {
        metodo: 'PATCH',
        cuerpo: { turnoId: destinoId },
      }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}
```

⚠️ **Verificá contra el DTO** que `?tipo=` va en minúsculas y que `reasignar` manda `turnoId` (el
destino) en el cuerpo. No lo des por bueno porque yo lo escribí.

- [ ] **Step 2: Los tests**

Con un doble de `pedir` y un `QueryClientProvider`; mirá `use-calendario-admin.spec.tsx`. Lo que no
puede faltar:

- `queryDeTurnos`: sin filtros no manda query; **`soloLibres: false` SÍ se manda** (un `if (f.soloLibres)`
  se lo comería); una cadena vacía no se manda; los cinco juntos.
- Cada hook llama a **la ruta y el método exactos**, comprobando los dos.
- **Cancelar manda el tipo que se le pasó**, en minúsculas, en el query. Los **dos** valores.
- **Reasignar manda el turno destino en el cuerpo**, con la clave `turnoId`.
- Tras cada escritura se invalidan **las tres** claves. Una invalidación a medias se ve como «cancelé y
  el cupo sigue igual».
- **Cada escritura es UNA sola petición** — contá las llamadas: en estas fases una petición de más ya
  sobrevivió a ocho tests, porque `toHaveBeenCalledWith` nunca pregunta cuántas veces.
- **Todas las mutaciones llevan `gcTime: 0`**, con un test que **lee el archivo fuente** para que una
  mutación nueva nazca cubierta — copialo de `use-usuarios.spec.tsx`.

- [ ] **Step 3: Verificar y Step 4: mutaciones**

| Mutación                                           | Debe caer                                       |
| -------------------------------------------------- | ----------------------------------------------- |
| `f.soloLibres !== undefined` → `if (f.soloLibres)` | «`soloLibres: false` SÍ se manda»               |
| Cancelar manda siempre `recuperable`               | «manda el tipo que se le pasó», los dos valores |
| Cancelar manda el tipo en mayúsculas               | el mismo                                        |
| Reasignar manda `{ id }` en vez de `{ turnoId }`   | «manda el destino con la clave turnoId»         |
| `useInvalidar` invalida sólo el turno              | los tests de invalidación                       |
| Quitar un `gcTime: 0`                              | el test que lee el archivo                      |

- [ ] **Step 5: La mutación abierta.**

---

## Task 3: El listado de turnos

**Files:** crear `admin/turnos/page.tsx` · `page.spec.tsx` · `filtros.tsx`; tocar `navegacion-admin.ts`

- [ ] **Step 1: El enlace**

En `ENLACES_DEL_PANEL`, una línea, después de Calendario:

```ts
  { ruta: 'turnos', texto: 'Turnos', minimo: 'ADMIN_OPERATIVO' },
```

⚠️ **Caen tests de `armazon.spec.tsx`.** Actualizalos, y comprobá que siguen teniendo dientes agregando
un enlace de más. Ojo con el que barre los tres roles: **estuvo atado a una lista escrita a mano** desde
la Fase 8 justamente porque comparado contra `enlacesPara(rol)` era autorreferencial.

- [ ] **Step 2: Lo que no puede faltar**

```tsx
it('muestra ESTAS columnas y solo estas', () => {
  expect(columnasDelDocumento()).toEqual([
    'Fecha',
    'Hora',
    'Clase',
    'Sala',
    'Profesora',
    'Ocupación',
  ]);
});

it('los filtros viajan en la URL, no en estado', async () => {});
it('lee los filtros DE la URL al cargar', () => {});
it('soloLibres en false se manda igual', () => {});
it('sin resultados lo dice, y no deja una tabla vacia', () => {});
it('cada fila enlaza a SU ficha', () => {});
it('un turno sin profesora lo dice, no deja la celda vacia', () => {});
it('la ocupacion se lee de un vistazo (7/10)', () => {});
it('salen ESTAS peticiones y ninguna mas', () => {});
it('un 401 manda al login CONSERVANDO los filtros', () => {
  // El helper `destinoDeLoginDesde` ya lo resuelve. Montá CON filtros: montar
  // sin ellos es el "caso ciego" y no distingue si el query se conserva.
});
```

- [ ] **Step 3: Implementar**, **Step 4: verificar**, **Step 5: mutaciones**

| Mutación                             | Debe caer                                       |
| ------------------------------------ | ----------------------------------------------- |
| Una columna de más                   | «ESTAS columnas y solo estas»                   |
| Los filtros en `useState`            | «los filtros viajan en la URL»                  |
| `soloLibres=false` se omite          | «soloLibres en false se manda igual»            |
| Las filas enlazan todas al primer id | «cada fila enlaza a SU ficha»                   |
| El `volverA` descarta el query       | «un 401 manda al login CONSERVANDO los filtros» |

- [ ] **Step 6: La mutación abierta.**

---

## Task 4: La ficha — datos, profesora y borrar

**Files:** crear `admin/turnos/[id]/page.tsx` · `page.spec.tsx` · `datos.tsx` · `profesora.tsx`

- [ ] **Step 1: Lo que no puede faltar**

```tsx
it('manda SOLO los campos que cambiaron', async () => {});

it('bajar el cupo por debajo de los anotados muestra el motivo de la API', async () => {
  // 409: «Dejar el cupo por debajo de las reservas ya hechas obligaria a elegir
  // a quien echar, y eso no lo decide un PATCH.»
});

it('no ofrece cambiar la sala', () => {
  // `ActualizarTurnoDto` NO acepta salaId a proposito: mover un turno de sala
  // invalidaria los accesos de quienes ya reservaron. Afirmá sobre el MARCADO,
  // no con queryByRole.
});

it('quitar la profesora manda null explicito, no omite la clave', async () => {
  // `AsignarProfesorDto` acepta null como valor legitimo y lo distingue de "no
  // vino la clave": omitirla no la quita.
  expect(cuerpoEnviado()).toEqual({ profesorId: null });
});

it('asignar una profesora manda su id', async () => {});

it('BORRAR dice de entrada si hay anotados, y no se ofrece como si fuera a funcionar', () => {});

it('borrar igual maneja el 409, por si alguien se anota en el medio', async () => {});

it('borrar confirma NOMBRANDO el turno', async () => {});

it('tras borrar vuelve al listado', async () => {});
```

- [ ] **Step 2: Implementar**, **Step 3: verificar**, **Step 4: mutaciones**

| Mutación                                  | Debe caer                             |
| ----------------------------------------- | ------------------------------------- |
| Mandar el formulario entero               | «manda SOLO los campos que cambiaron» |
| Quitar la profesora omitiendo la clave    | «manda null explicito»                |
| Dibujar un campo de sala                  | «no ofrece cambiar la sala»           |
| Ofrecer borrar sin avisar de los anotados | el test de borrar                     |
| El diálogo no nombra el turno             | «confirma NOMBRANDO el turno»         |

- [ ] **Step 5: La mutación abierta.**

---

## Task 5: Los anotados

**Files:** crear `admin/turnos/[id]/anotados.tsx` · `cancelar.tsx` · `reasignar.tsx`

El corazón de la fase.

- [ ] **Step 1: Lo que no puede faltar**

```tsx
it('lista a los anotados con su nombre', () => {});

it('las canceladas van aparte y se distinguen', () => {
  // El endpoint devuelve todas; la pantalla las separa.
});

// --- Cancelar ---
it('la eleccion dice QUE LE PASA A LA CLASE, no las siglas', () => {
  // RECUPERABLE le devuelve la clase, DEFINITIVA se la consume. Es la decision
  // real y la que el admin tiene que poder explicarle al alumno.
  expect(screen.getByText(/se le devuelve la clase/i)).toBeInTheDocument();
  expect(screen.getByText(/se le consume la clase/i)).toBeInTheDocument();
});

it('NO hay un tipo elegido por defecto', () => {
  // Elegir por el admin seria decidir en nombre del alumno.
});

it('manda el tipo que se eligio', async () => {
  // Elegir "definitiva" y mandar "recuperable" es invisible en pantalla y le
  // regala una clase al gimnasio o se la roba al alumno. Los DOS valores.
});

it('cancela la reserva DE ESA FILA, con dos sembradas', async () => {
  // Con una sola, "cancela la suya" y "cancela la primera" son
  // indistinguibles: es la leccion del borrado de testimonios de la 6B.
});

// --- Anotar ---
it('manda el perfilId, NO el id del usuario', async () => {
  // El DTO lo dice: «los listados de usuarios devuelven perfilId justamente
  // para esto».
});
it('un turno completo muestra el motivo de la API con el numero', async () => {});
it('alguien que ya esta anotado muestra su motivo', async () => {});
it('las ADVERTENCIAS del alta se muestran: la reserva se creo Y hay algo que mirar', async () => {});

// --- Reasignar ---
it('el destino se elige entre turnos, acotado a la sala del turno actual', () => {});
it('manda el turno destino con la clave turnoId', async () => {});
it('un destino lleno muestra el motivo', async () => {});

// --- Los dos errores que NO se tratan como el resto del panel ---
it('el 403 de sala NO se traduce a un mensaje de rol', async () => {
  // «El usuario no tiene acceso a la sala del turno destino». El admin tiene el
  // rol de sobra; el que no tiene acceso es el alumno. Decir "necesitas ser
  // ADMIN_SALON" seria mentir.
  expect(screen.getByText(/no tiene acceso a la sala/i)).toBeInTheDocument();
  expect(screen.queryByText(/necesit/i)).toBeNull();
});

it('el 409 de concurrencia OFRECE REINTENTAR y los otros no', async () => {
  // «Otra peticion esta tocando este turno ahora mismo; reintenta en unos
  // segundos.» Los demas 409 piden OTRA accion; este pide lo mismo, mas tarde.
});

// --- La fuga ---
it('los identificadores no entran en el marcado', () => {
  // Con un centinela que NO resuelve: con todos resolviendo, "pinto el nombre"
  // y "pinto el id si no hay nombre" no se distinguen (Fase 8).
});

// --- La lista blanca de la ficha ---
it('AL MONTAR salen ESTAS peticiones y ninguna mas', () => {
  // Ordenadas y SIN deduplicar: pedir dos veces lo mismo tambien es un fallo.
  // El catalogo de turnos para reasignar NO esta aqui: ver el test de abajo.
  expect(rutasPedidas()).toEqual(['/turnos/t1', '/turnos/t1/reservas', '/usuarios']);
});

it('el catalogo de turnos para reasignar NO se pide hasta abrir el reasignar', async () => {
  // Reasignar es la accion mas rara de las cuatro; traer los turnos de la sala
  // al montar es una peticion que casi nunca se usa.
  montar({ reservas: [unaReserva()] });
  expect(rutasPedidas()).not.toContain('/turnos?salaId=s1');

  await clic('Reasignar');

  expect(rutasPedidas()).toContain('/turnos?salaId=s1');
});
```

- [ ] **Step 2: Implementar**, **Step 3: verificar**, **Step 4: mutaciones**

| Mutación                                | Debe caer                                     |
| --------------------------------------- | --------------------------------------------- |
| Un tipo de cancelación por defecto      | «NO hay un tipo elegido por defecto»          |
| Cancelar manda siempre `recuperable`    | «manda el tipo que se eligio»                 |
| Cancelar manda el id de la primera fila | «cancela la reserva DE ESA FILA»              |
| Anotar manda el `id` del usuario        | «manda el perfilId»                           |
| Descartar las `advertencias`            | el test de advertencias                       |
| El 403 se traduce a mensaje de rol      | «NO se traduce a un mensaje de rol»           |
| Ofrecer reintentar en todos los 409     | «OFRECE REINTENTAR y los otros no»            |
| `?? reserva.perfilId` como nombre       | «los identificadores no entran en el marcado» |

- [ ] **Step 5: La mutación abierta.** Es la pantalla con más datos de personas de la fase.

---

## Task 6: Verificación final, README y tracker

- [ ] **Step 1: Todo verde**

```bash
cd /d/Dev/box-admin/packages/shared && pnpm exec jest && pnpm exec tsc -p tsconfig.json --noEmit
cd ../../apps/api && pnpm exec tsc --noEmit && pnpm exec jest --silent
cd ../web && pnpm exec tsc --noEmit && pnpm test && pnpm build
cd /d/Dev/box-admin && pnpm api:test:e2e
```

⚠️ **Para Playwright** hace falta la API corriendo y **el contenedor `api` del compose está roto** (le
falta `@nestjs/throttler`). Levantala en el host y bajala **por PID concreto**. Y el freno de auth es de
**5 intentos por minuto**: correr Playwright dos veces seguidas da 429 y **parece un fallo del código
sin serlo**. Dejá pasar la ventana **sin tocar `/auth/login`** — un bucle de espera que consulte ese
endpoint renueva el freno que está esperando.

- [ ] **Step 2: El checklist a mano**

- Anotar a alguien en un turno lleno y ver el mensaje con el número.
- Cancelar eligiendo **definitiva** y comprobar en la ficha del alumno que la clase se consumió; repetir
  con **recuperable** y comprobar que no.
- Reasignar a un turno de otra sala y ver que el mensaje habla del **alumno**, no del rol.
- Intentar borrar un turno con gente y ver el número de anotados.
- Comprobar que **no hay entradas del panel** en `Cache Storage`.

- [ ] **Step 3: README y tracker**

Sección «Turnos y reservas — Fase 9» en `README.md`, **antes de `## Tests`**. ⚠️ Insertala anclando a
una línea entera (`\n## Tests\n`) y a la **última** aparición: `## Tests` es subcadena de un `### Tests`
anterior, y anclar mal parte ese encabezado en dos.

Y el bloque de la Fase 9 en `docs/superpowers/plans/PROGRESO.md`, con el formato de los anteriores:
tareas, decisiones, **los errores de este plan que encontraste**, trampas nuevas, estado final y deuda.

---

## Lo que esta fase NO hace

- **La configuración operativa** (salas, horarios, vacaciones, ausencias): 15 endpoints, fase posterior.
- **Crear un turno a mano.** `POST /turnos` existe, pero el camino normal es publicar el mes.
- **Pasar lista.** Es del profesor, con su propio rol.
- **Pantallas de profesor**, que siguen sin existir.
- **Cualquier cambio en `apps/api` más allá del endpoint de la Task 1.**
