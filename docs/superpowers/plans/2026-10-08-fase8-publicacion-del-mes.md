# Fase 8 — La publicación del mes

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans`, tarea por tarea. Los pasos llevan casillas (`- [ ]`).

**Objetivo:** la pantalla que genera el mes de un salón — previsualizar, revisar conflictos, publicar y
seguir el trabajo hasta que termina. Hoy eso exige un `curl`.

**Arquitectura:** una sola pantalla en `/{slug}/admin/calendario`, con `salaId`, `anio` y `mes` en la
URL. No hay asistente con memoria porque `previsualizar` es **de sólo lectura y función pura de esos
tres parámetros**: el servidor ya tiene todo el estado. **No se toca ni un endpoint de la API.**

**Herramientas:** Next 15.5 App Router, React 19, Tailwind 4, TanStack Query v5, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-10-08-fase8-publicacion-del-mes.md`

---

## Reglas que gobiernan todo este plan

⚠️ **No hacés commits.** Nunca `git add`, `git commit`, `git push`, `git stash`, `git checkout` ni
`git reset`. `git status`, `git diff` y `git show` sí. Los commits los hace Cesar. Donde otros planes
pondrían un paso de commit, aquí hay uno de verificación.

⚠️ **Nunca `pnpm lint`.** Lleva `--fix` y reformatea código commiteado. Usá `pnpm exec prettier
--check`, y `--write` **sólo** sobre archivos que vos mismo creaste o tocaste.

⚠️ **Nunca `taskkill` ni `Stop-Process` por NOMBRE de proceso.** Hay una sesión viva de Claude Code en
la máquina. Por PID concreto y sólo los que levantaste vos.

⚠️ **No se toca `apps/api` ni `packages/shared`.** Si una pantalla parece necesitar un endpoint,
**pará y reportalo**.

⚠️ **`docker compose up` pelado está prohibido** (el servicio `api` le roba los trabajos a Redis).
**`prisma migrate reset` y `docker compose down -v` necesitan permiso explícito.**

⚠️ **Nada de strings con barra invertida por heredoc**: el heredoc del Bash tool se los come aun con el
delimitador entre comillas, y el test falla por eso y no por el código. Usá la herramienta de edición.

**Comandos:**

```bash
pnpm --filter @boxadmin/web test                                  # toda la suite
pnpm --filter @boxadmin/web exec vitest run <archivo> [<archivo>] # subcadena, NO regex
pnpm --filter @boxadmin/web exec tsc --noEmit
pnpm --filter @boxadmin/web build
```

**Punto de partida:** 676 tests en 36 archivos, verdes. `tsc` limpio. No rompas ninguno.

### Lo que esta fase hereda de la 7

No lo reinventes:

- **`useRolDeQuienMira()`** en `admin/rol-del-panel.tsx` — el rol de quien mira, sin una petición más.
  Devuelve `null` sin proveedor, y eso significa «no alcanza para nada».
- **`useSalas()`** en `hooks/use-catalogos.ts`.
- **`componentes/tabla.tsx`** (tabla en escritorio, tarjetas en teléfono) y **`componentes/confirmar.tsx`**.
- **`admin/usuarios/[id]/errores.ts`** — desenvuelve el array `message` de Nest y reparte por campo.
- **Dos tapones globales** enganchados en `vitest.setup.ts`: el espía de `console.*` y `vigilarElTitulo()`.
  Corren en todos los specs sin que haya que pedirlos.
- El patrón de hooks: claves centralizadas y **`gcTime: 0` en toda mutación**. Hay un test que **lee el
  archivo fuente** de `use-usuarios.ts` para que una mutación nueva nazca cubierta; si creás mutaciones
  en un archivo nuevo, considerá si conviene el mismo centinela.

### La mutación abierta

Cada tarea termina con una. En las fases 6B y 7 se pidió dieciséis veces y encontró algo real **las
dieciséis**. La familia es siempre **agregar algo que no debería estar, sin quitar nada**; lo que cambia
es **dónde nadie estaba mirando**:

| Dónde apareció                               | El eje que nadie auditaba                                     |
| -------------------------------------------- | ------------------------------------------------------------- |
| un componente de cliente                     | lo que viaja en el payload RSC                                |
| un `router.push`                             | cuántas veces se llama, no con qué                            |
| una lista blanca de enlaces                  | comprobada con un solo rol                                    |
| un atributo del DOM                          | el token, que no era campo de `/auth/me`                      |
| la caché de consultas y la de **mutaciones** | lo que queda guardado, no lo que se pide                      |
| una cabecera de **respuesta**                | no llevaba el prefijo que la auditoría filtraba               |
| `localStorage`                               | sobrevive al logout y al cambio de turno                      |
| el service worker                            | **las cabeceras**: ningún test construía peticiones con ellas |
| `console.*` y `document.title`               | lo que la pantalla dice **fuera del documento**               |

En esta pantalla hay un dato que invita: el plan trae **listas completas de turnos y reservas con los
`perfilId` de los alumnos**, y la pantalla sólo necesita contarlos y mostrarlos plegados.

### Sobre la densidad de este plan

Las Tasks 1 y 2 traen el código completo, porque son las piezas nuevas o delicadas: la regla de los
meses y el sondeo que tiene que parar.

Las Tasks 3, 4 y 5 traen **el código de los tests y la tabla de mutaciones, pero no el de la
implementación**. Es deliberado: repiten patrones ya fijados —los filtros en la URL del listado de
personas, los bloques de la ficha, el reparto de errores de `errores.ts`— y bajo TDD el test es la
especificación. **Si al implementarlas aparece una decisión que los tests no determinan, paralo y
preguntá en vez de inventar un patrón nuevo.**

Y una advertencia que la Fase 7 dejó por escrito: cuando los tests se escriben desde una especificación
detallada, **la implementación que sale de esa misma especificación los pasa a la primera**, así que el
rojo inicial sólo prueba que el archivo no existía. **La confianza la da la tabla de mutaciones, no el
ciclo rojo-verde.**

---

## Estructura de archivos

```
apps/web/src/
  hooks/
    use-calendario-admin.ts          CREAR
    use-calendario-admin.spec.tsx    CREAR
  app/[slug]/admin/
    navegacion-admin.ts              TOCAR   una linea: el enlace nuevo
    calendario/
      meses.ts                       CREAR   que meses se ofrecen (puro)
      meses.spec.ts                  CREAR
      page.tsx                       CREAR   la pantalla
      page.spec.tsx                  CREAR
      selectores.tsx                 CREAR   sala + mes, escriben la URL
      estado-del-mes.tsx             CREAR   borrador/habilitado + el trabajo
      resumen-y-conflictos.tsx       CREAR
      listas-del-plan.tsx            CREAR   exclusiones + las dos listas plegadas
```

---

## Task 1: Los meses que se pueden ofrecer

**Files:** Crear `apps/web/src/app/[slug]/admin/calendario/meses.ts` · `.spec.ts`

La API rechaza los meses pasados con 400 (`exigirMesGenerable`: «No se puede generar un mes que ya
pasó»), porque regenerar un mes pasado crearía reservas para clases que ya ocurrieron. Ofrecerlos sería
un 400 garantizado.

- [ ] **Step 1: El test que falla**

```ts
import { describe, expect, it } from 'vitest';
import { mesesOfrecidos, type MesOfrecido } from './meses';

const NOVIEMBRE_2026 = new Date(Date.UTC(2026, 10, 15));

describe('mesesOfrecidos', () => {
  it('empieza por el mes actual', () => {
    expect(mesesOfrecidos(NOVIEMBRE_2026)[0]).toEqual({ anio: 2026, mes: 11 });
  });

  it('NO ofrece meses pasados', () => {
    const pasados = mesesOfrecidos(NOVIEMBRE_2026).filter(
      (m) => m.anio * 12 + m.mes < 2026 * 12 + 11,
    );
    expect(pasados).toEqual([]);
  });

  it('cruza el fin de anio', () => {
    const desdeDiciembre = mesesOfrecidos(new Date(Date.UTC(2026, 11, 1)));
    expect(desdeDiciembre.slice(0, 3)).toEqual([
      { anio: 2026, mes: 12 },
      { anio: 2027, mes: 1 },
      { anio: 2027, mes: 2 },
    ]);
  });

  // El ultimo dia del mes sigue siendo el mes actual: la API lo compara por
  // mes, no por dia, asi que ofrecerlo es correcto.
  it('el ultimo dia del mes todavia ofrece ese mes', () => {
    expect(mesesOfrecidos(new Date(Date.UTC(2026, 10, 30)))[0]).toEqual({ anio: 2026, mes: 11 });
  });

  it('ofrece una cantidad fija y conocida', () => {
    expect(mesesOfrecidos(NOVIEMBRE_2026)).toHaveLength(12);
  });
});
```

- [ ] **Step 2: Verificar que falla**

`pnpm --filter @boxadmin/web exec vitest run meses` → FAIL, no resuelve el import.

- [ ] **Step 3: La implementación**

```ts
/**
 * Los meses que la pantalla puede ofrecer.
 *
 * El pasado queda fuera porque la API lo rechaza con 400: regenerar un mes que
 * ya paso crearia reservas para clases que ya ocurrieron. Ofrecerlo seria un
 * 400 garantizado, y un selector que ofrece lo que el servidor no acepta es una
 * forma de mentir.
 *
 * El reloj entra por parametro para poder probarlo sin congelar el global.
 */
export interface MesOfrecido {
  anio: number;
  mes: number;
}

/** Un ano por delante: mas que eso es planificar sobre rutinas que van a cambiar. */
const CUANTOS = 12;

export function mesesOfrecidos(ahora: Date): MesOfrecido[] {
  const salida: MesOfrecido[] = [];
  const base = ahora.getUTCFullYear() * 12 + ahora.getUTCMonth();

  for (let i = 0; i < CUANTOS; i++) {
    const corrido = base + i;
    salida.push({ anio: Math.floor(corrido / 12), mes: (corrido % 12) + 1 });
  }

  return salida;
}
```

- [ ] **Step 4: Verificar que pasa** → PASS, 5 tests.

- [ ] **Step 5: Mutaciones**

| Mutación                                              | Debe caer                                               |
| ----------------------------------------------------- | ------------------------------------------------------- |
| `base` arranca un mes antes (`getUTCMonth() - 1`)     | «NO ofrece meses pasados» y «empieza por el mes actual» |
| `(corrido % 12)` sin el `+ 1`                         | «cruza el fin de anio»                                  |
| `Math.floor(corrido / 12)` → `ahora.getUTCFullYear()` | «cruza el fin de anio»                                  |

- [ ] **Step 6: La mutación abierta.** Ver el encabezado del plan.

---

## Task 2: El hook

**Files:** Crear `apps/web/src/hooks/use-calendario-admin.ts` · `use-calendario-admin.spec.tsx`

- [ ] **Step 1: La implementación**

```ts
'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import type { MesCalendarioPublico, PlanDeMes, PublicacionEncolada } from '@boxadmin/shared';
import { type ErrorDeApi, pedir } from '@/lib/cliente';

export interface MesElegido {
  salaId: string;
  anio: number;
  mes: number;
}

/** `/calendario/:salaId/:anio/:mes` */
function base({ salaId, anio, mes }: MesElegido): string {
  return `/calendario/${salaId}/${anio}/${mes}`;
}

export const clavesDelCalendario = {
  plan: (m: MesElegido) => ['plan-del-mes', m.salaId, m.anio, m.mes] as const,
  mes: (m: MesElegido) => ['mes-calendario', m.salaId, m.anio, m.mes] as const,
};

/**
 * La previsualizacion.
 *
 * Es un POST que no escribe: el servicio lo dice —«es sincrono a proposito: no
 * hay razon para mandar a una cola una operacion de solo lectura que el admin
 * esta esperando en pantalla»— y por eso se consume con `useQuery` y no con
 * `useMutation`. Es funcion pura de (sala, anio, mes), que es lo que permite
 * que esta pantalla no tenga estado propio.
 */
export function usePlanDelMes(elegido: MesElegido | null) {
  return useQuery({
    queryKey: elegido === null ? ['plan-del-mes', 'nada'] : clavesDelCalendario.plan(elegido),
    queryFn: () =>
      pedir<PlanDeMes>(`${base(elegido as MesElegido)}/previsualizar`, { metodo: 'POST' }),
    enabled: elegido !== null,
  });
}

/**
 * Cuanto se espera entre consultas mientras el trabajo corre.
 *
 * Segundos y no decimas: esto no es una barra de progreso, es saber si el
 * trabajo termino.
 */
export const ESPERA_DEL_SONDEO = 3000;

/** Los dos estados en los que el trabajo ya no se mueve. */
export const ESTADOS_FINALES = ['terminado', 'fallido'] as const;

export function useMesDelCalendario(elegido: MesElegido | null) {
  return useQuery({
    queryKey: elegido === null ? ['mes-calendario', 'nada'] : clavesDelCalendario.mes(elegido),
    queryFn: () => pedir<MesCalendarioPublico>(base(elegido as MesElegido)),
    enabled: elegido !== null,
    /**
     * SE DEJA DE CONSULTAR cuando el trabajo termino o fallo. Un sondeo que no
     * para es una peticion cada tres segundos para siempre en la maquina del
     * mostrador.
     *
     * `publicacion` puede venir `null` Y existe el estado `sin_job`: son dos
     * formas de decir "no hay trabajo", y las dos tienen que parar el sondeo.
     */
    refetchInterval: (consulta) => {
      const estado = consulta.state.data?.publicacion?.estado;
      if (estado === undefined) return false;
      if (estado === 'sin_job') return false;
      return (ESTADOS_FINALES as readonly string[]).includes(estado) ? false : ESPERA_DEL_SONDEO;
    },
  });
}

export function usePublicarMes(elegido: MesElegido) {
  return useMutation<PublicacionEncolada, ErrorDeApi, void>({
    mutationFn: () => pedir<PublicacionEncolada>(`${base(elegido)}/publicar`, { metodo: 'POST' }),
    // Como en todas las mutaciones del panel: la respuesta no se queda cinco
    // minutos en el QueryClient de toda la aplicacion.
    gcTime: 0,
  });
}
```

- [ ] **Step 2: Los tests**

Con un doble de `pedir` y un `QueryClientProvider` de prueba; mirá `use-usuarios.spec.tsx` para el
andamiaje. Lo que no puede faltar:

```tsx
it('la previsualizacion va por POST a la ruta exacta', async () => {
  // POST y no GET: el endpoint es POST aunque no escriba.
  expect(pedirEspia).toHaveBeenCalledWith('/calendario/s1/2026/11/previsualizar', {
    metodo: 'POST',
  });
});

it('sin mes elegido no sale ninguna peticion', () => {
  montar(null);
  expect(pedirEspia).not.toHaveBeenCalled();
});

it('el sondeo PARA cuando el trabajo termino', async () => {
  // Con `terminado`, `refetchInterval` tiene que devolver false.
});

it('el sondeo PARA cuando el trabajo fallo', async () => {});

it('el sondeo PARA cuando publicacion viene null', async () => {
  // El contrato lo declara `EstadoPublicacion | null`.
});

it('el sondeo PARA con el estado sin_job', async () => {
  // La otra forma de decir lo mismo. Las dos tienen que parar.
});

it('el sondeo SIGUE mientras esta en cola o procesando', async () => {
  // Los dos casos, y el intervalo es el declarado, no un numero suelto.
});

it('publicar va por POST a /publicar y una sola vez', async () => {
  expect(pedirEspia).toHaveBeenCalledTimes(1);
});

it('la mutacion de publicar lleva gcTime 0', () => {
  // Que la respuesta no se quede en el QueryClient de toda la app.
});
```

- [ ] **Step 3: Verificar** → `vitest run use-calendario-admin`, `tsc --noEmit`, `prettier --check`.

- [ ] **Step 4: Mutaciones**

| Mutación                                               | Debe caer                                      |
| ------------------------------------------------------ | ---------------------------------------------- |
| `refetchInterval` devuelve siempre `ESPERA_DEL_SONDEO` | los cuatro tests de «el sondeo PARA»           |
| Quitar la rama de `estado === undefined`               | «el sondeo PARA cuando publicacion viene null» |
| Quitar la rama de `'sin_job'`                          | «el sondeo PARA con el estado sin_job»         |
| `enabled: true` fijo                                   | «sin mes elegido no sale ninguna peticion»     |
| Quitar `gcTime: 0`                                     | «la mutacion de publicar lleva gcTime 0»       |
| `previsualizar` con `metodo: 'GET'`                    | «va por POST a la ruta exacta»                 |

- [ ] **Step 5: La mutación abierta.**

---

## Task 3: Los selectores y el estado en la URL

**Files:** Crear `calendario/selectores.tsx`; crear `calendario/page.tsx` (esqueleto) y `page.spec.tsx`;
tocar `navegacion-admin.ts`

- [ ] **Step 1: El enlace**

En `ENLACES_DEL_PANEL`, **una línea**, antes de Personas:

```ts
  { ruta: 'calendario', texto: 'Calendario', minimo: 'ADMIN_OPERATIVO' },
```

⚠️ Hay un test en `armazon.spec.tsx` que fija **el conjunto entero** de enlaces y otro que lo barre
**por los tres roles** que entran al panel. Los dos van a caer: actualizalos, y comprobá que siguen
cayendo si agregás un enlace de más.

- [ ] **Step 2: Los tests de la pantalla**

```tsx
it('sin sala ni mes, solo se ven los selectores', () => {
  montar({ busqueda: '' });
  expect(pedirEspia).not.toHaveBeenCalled();
  expect(screen.queryByText(/resumen/i)).toBeNull();
});

it('elegir una sala la escribe en la URL', async () => {
  montar({ busqueda: '' });
  await elegir('Sala', 'Sala Pilates');
  expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/calendario?salaId=s1');
});

it('elegir un mes lo escribe SIN perder la sala', async () => {
  montar({ busqueda: '?salaId=s1' });
  await elegir('Mes', 'noviembre 2026');
  expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/calendario?salaId=s1&anio=2026&mes=11');
});

it('lee sala y mes DE la URL y pide el plan', () => {
  montar({ busqueda: '?salaId=s1&anio=2026&mes=11' });
  expect(pedirEspia).toHaveBeenCalledWith('/calendario/s1/2026/11/previsualizar', {
    metodo: 'POST',
  });
});

it('el selector ofrece ESTOS meses y solo estos', () => {
  montar({ busqueda: '', ahora: new Date(Date.UTC(2026, 10, 15)) });
  expect(opcionesDe('Mes')).toEqual(mesesOfrecidos(new Date(Date.UTC(2026, 10, 15))).map(etiqueta));
});

it('un mes imposible en la URL no se manda a la API', () => {
  // `?mes=13` o `?anio=abc`: sin esto es un 400 y una pantalla en blanco.
  montar({ busqueda: '?salaId=s1&anio=2026&mes=13' });
  expect(pedirEspia).not.toHaveBeenCalledWith(expect.stringContaining('/13/'));
});

it('salen ESTAS peticiones y ninguna mas', () => {
  montar({ busqueda: '?salaId=s1&anio=2026&mes=11' });
  expect(rutasPedidas()).toEqual([
    '/calendario/s1/2026/11',
    '/calendario/s1/2026/11/previsualizar',
    '/salas',
  ]);
});
```

⚠️ **Ese último es la lista blanca** y existe para que no se cuele `GET .../conflictos`, que devuelve
exactamente `plan.conflictos` —un dato que la previsualización ya trae— y que abriría la puerta a que
las dos respuestas discrepen.

- [ ] **Step 3: Implementar**, **Step 4: verificar**, **Step 5: mutaciones**

| Mutación                                      | Debe caer                                     |
| --------------------------------------------- | --------------------------------------------- |
| Los selectores en `useState` en vez de la URL | «elegir una sala la escribe en la URL»        |
| Elegir mes pisa la sala                       | «elegir un mes lo escribe SIN perder la sala» |
| Pedir también `/conflictos`                   | «salen ESTAS peticiones y ninguna mas»        |
| No validar el mes de la URL                   | «un mes imposible no se manda»                |
| Ofrecer un mes pasado                         | «ofrece ESTOS meses y solo estos»             |

- [ ] **Step 6: La mutación abierta.**

---

## Task 4: El estado del mes, el resumen y los conflictos

**Files:** Crear `calendario/estado-del-mes.tsx` y `calendario/resumen-y-conflictos.tsx`

- [ ] **Step 1: Lo que no puede faltar**

```tsx
it('dice si el mes esta en BORRADOR o HABILITADO, con quien y cuando', () => {});

it('un mes sin fila (id null) lo dice y no finge un estado', () => {
  // `id: null` = nunca se publico. No es "borrador" ni "habilitado".
});

it('muestra los cuatro numeros del resumen', () => {});

it('LOS CONFLICTOS SE VEN SIN DESPLEGAR NADA', () => {
  // La razon de ser de esta pantalla: un conflicto exige una decision humana.
  montar({ plan: planCon({ conflictos: 2, exclusiones: 40 }) });
  expect(screen.getByText(/cupo lleno/i)).toBeVisible();
});

it('agrupa los conflictos por tipo, y estan los tres tipos', () => {
  // CUPO_LLENO, FUERA_DE_PACK, SALA_SIN_CUPO_BASE.
  expect(tiposDeConflictoMostrados()).toEqual([
    'CUPO_LLENO',
    'FUERA_DE_PACK',
    'SALA_SIN_CUPO_BASE',
  ]);
});

it('sin conflictos LO DICE, no deja el hueco', () => {
  montar({ plan: planCon({ conflictos: 0 }) });
  expect(screen.getByText(/ningun conflicto/i)).toBeInTheDocument();
});

it('los conflictos NO se mezclan con las exclusiones', () => {
  // El contrato las separa a proposito: «un mes con tres alumnos de vacaciones
  // produciria decenas de conflictos que esconderian los dos que si».
});
```

- [ ] **Step 2: Implementar**, **Step 3: verificar**, **Step 4: mutaciones**

| Mutación                                            | Debe caer                           |
| --------------------------------------------------- | ----------------------------------- |
| Pintar exclusiones dentro de la lista de conflictos | «NO se mezclan»                     |
| Los conflictos arrancan plegados                    | «SE VEN SIN DESPLEGAR NADA»         |
| `id: null` se pinta como BORRADOR                   | «un mes sin fila lo dice»           |
| Un conflicto de más en la lista de tipos            | «agrupa por tipo, y estan los tres» |

- [ ] **Step 5: La mutación abierta.**

---

## Task 5: Publicar y seguir el trabajo

**Files:** Crear `calendario/listas-del-plan.tsx`; completar `page.tsx` y su spec

- [ ] **Step 1: Lo que no puede faltar**

```tsx
it('el boton de publicar NO EXISTE EN EL MARCADO para un ADMIN_OPERATIVO', () => {
  // Sobre el marcado y no con queryByRole: `*ByRole` consulta el arbol de
  // accesibilidad, que ya excluye lo que lleva `hidden`. Es la leccion que
  // costo la Fase 7.
  montar({ rol: 'ADMIN_OPERATIVO' });
  expect(document.body.innerHTML).not.toMatch(/publicar/i);
});

it('un ADMIN_SALON si lo ve', () => {});

it('sin proveedor de rol tampoco se dibuja', () => {
  // Falla cerrada: un reordenamiento del layout que deje la pantalla fuera del
  // armazon no puede ABRIR la accion mas consecuente del sistema.
});

it('publicar manda UNA sola peticion', async () => {
  expect(pedirEspia).toHaveBeenCalledTimes(1);
});

it('mientras el trabajo corre se dice, y se sigue consultando', async () => {});

it('cuando termina se deja de consultar', async () => {
  // Contar peticiones, no mirar que se llamo.
});

it('FALLIDO muestra el error de la API, no "algo salio mal"', async () => {
  montar({ mes: mesCon({ estado: 'fallido', error: 'La sala no tiene cupo base' }) });
  expect(screen.getByText(/la sala no tiene cupo base/i)).toBeInTheDocument();
});

it('fallido deja volver a publicar', async () => {
  // Reintentar sobre un mes a medio escribir lo completa: el planificador es
  // incremental.
});

it('un mes HABILITADO explica que republicar no deshace nada', () => {
  // No una advertencia: una explicacion. El planificador nunca le quita la
  // profesora a un turno que ya la tiene.
});

it('un 403 al publicar dice QUE ROL hace falta', async () => {});

it('un 400 muestra el mensaje de la API', async () => {
  // Para un mes pasado es exactamente lo que hay que mostrar.
});

it('una caida de red se distingue del rechazo y se puede reintentar', async () => {});

it('las listas de turnos y reservas arrancan PLEGADAS', () => {});

it('el estado se lee del servidor: dos montajes seguidos muestran lo mismo', () => {});
```

- [ ] **Step 2: Implementar**, **Step 3: verificar**, **Step 4: mutaciones**

| Mutación                                                 | Debe caer                                |
| -------------------------------------------------------- | ---------------------------------------- |
| Esconder el botón con `hidden` en vez de no renderizarlo | «NO EXISTE EN EL MARCADO»                |
| `rolAlcanza(rol,'ADMIN_SALON')` → `'ADMIN_OPERATIVO'`    | «NO EXISTE EN EL MARCADO»                |
| Tratar `null` como «alcanza»                             | «sin proveedor de rol tampoco se dibuja» |
| El sondeo sigue tras `terminado`                         | «cuando termina se deja de consultar»    |
| `fallido` muestra un texto genérico                      | «muestra el error de la API»             |
| Las listas arrancan desplegadas                          | «arrancan PLEGADAS»                      |

- [ ] **Step 5: La mutación abierta.** Pista: el plan trae los `perfilId` de los alumnos y la pantalla
      sólo necesita contarlos.

---

## Task 6: Verificación final, README y tracker

- [ ] **Step 1: Todo verde**

```bash
cd /d/Dev/box-admin/apps/web && pnpm exec tsc --noEmit && pnpm test && pnpm build
cd /d/Dev/box-admin/apps/api && pnpm exec tsc --noEmit && pnpm exec jest --silent
```

⚠️ `apps/api` tiene que seguir en **1291 / 65**: esta fase no toca la API.

⚠️ **Para Playwright** hace falta la API corriendo y **el contenedor `api` del compose está roto** (le
falta `@nestjs/throttler`). Levantala en el host y bajala **por PID concreto**. Y ojo: el freno de auth
es de **5 intentos por minuto**, así que correr Playwright dos veces seguidas da 429 y **parece un fallo
del código sin serlo** — hay que dejar pasar la ventana sin tocar `/auth/login`.

- [ ] **Step 2: El checklist a mano**

- Entrar como `ADMIN_OPERATIVO` y comprobar que **no aparece** el botón de publicar.
- Previsualizar un mes con conflictos y comprobar que se ven sin desplegar nada.
- Publicar y mirar que el sondeo **para** cuando termina (pestaña de red del navegador).
- Irse a otra pantalla mientras corre, volver, y ver el estado real.
- Comprobar que **no hay ninguna entrada del panel** en `Cache Storage`.

- [ ] **Step 3: README y tracker**

Sección «La publicación del mes — Fase 8» en `README.md`, **antes de `## Tests`**. ⚠️ Insertala
anclando a una línea entera (`\n## Tests\n`) y a la **última** aparición: `## Tests` es subcadena de un
`### Tests` anterior, y anclar mal parte ese encabezado en dos.

Y el bloque de la Fase 8 en `docs/superpowers/plans/PROGRESO.md`, con el formato de los anteriores:
tareas, decisiones, **los errores de este plan que encontraste**, trampas nuevas, estado final y deuda.

---

## Lo que esta fase NO hace

- Turnos y reservas (9 endpoints) y la configuración operativa (15): fases posteriores.
- **Editar el plan antes de publicar.** La API no lo admite: el plan se deriva de los datos, y la forma
  de cambiarlo es cambiar las rutinas, los horarios o las ausencias.
- **Despublicar o vaciar un mes.** No existe endpoint.
- **Publicar varias salas de una vez.** La ruta es por sala.
- **Cualquier cambio en `apps/api`.**
