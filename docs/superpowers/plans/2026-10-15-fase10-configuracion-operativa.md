# Fase 10 — La configuración operativa

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans`, tarea por tarea. Los pasos llevan casillas (`- [ ]`).

**Objetivo:** cierra **Operación diaria**. Las pantallas que mantienen **los datos de los que se
alimenta el calendario** que la Fase 8 publica: salas, horarios de profesor, ausencias y vacaciones.

**Arquitectura:** tres pantallas nuevas en el panel más un bloque en la ficha de la persona, con el
estado en la URL. **No se toca ni un endpoint de la API** — son 15 que ya existen.

**Spec:** `docs/superpowers/specs/2026-10-15-fase10-configuracion-operativa.md`

---

## Reglas que gobiernan todo este plan

⚠️ **No hacés commits.** Nunca `git add`, `git commit`, `git push`, `git stash`, `git checkout` ni
`git reset`. `git status`, `git diff` y `git show` sí.

⚠️ **Nunca `pnpm lint`.** El script lleva `--fix`. Para comprobar, `pnpm exec eslint "src/**/*.ts"`
**sin** `--fix`, que ahora está limpio y conviene que siga así. Para formato, `pnpm exec prettier
--check`, y `--write` sólo sobre archivos tuyos.

⚠️ **Nunca `taskkill` ni `Stop-Process` por NOMBRE de proceso.** Hay una sesión viva de Claude Code en
la máquina. Por PID concreto y sólo los que levantaste vos.

⚠️ **No se toca `apps/api` ni `packages/shared`.** Si una pantalla parece necesitar un endpoint, **pará
y reportalo**.

⚠️ **Nada de strings con barra invertida por heredoc.** Usá la herramienta de edición.

⚠️ El `tsc` del repo lleva **`noUncheckedIndexedAccess`**, y `apps/web` **no tiene eslint**.

⚠️ **`vitest run "ruta/[id]"` sólo funciona desde PowerShell**: por Bash los corchetes se comen el
patrón.

**Comandos:**

```bash
pnpm --filter @boxadmin/web exec vitest run <archivo>   # subcadena, NO regex
pnpm --filter @boxadmin/web exec tsc --noEmit
pnpm --filter @boxadmin/web test
pnpm --filter @boxadmin/web build
```

**Punto de partida:** `apps/web` 971 tests / 49 suites. `apps/api` 1320 / 66, **sin tocar**.

### Lo que esta fase hereda

No lo reinventes: `componentes/tabla.tsx`, `componentes/confirmar.tsx`,
`admin/usuarios/[id]/errores.ts` (`repartirPorCampo`, `mensajeDeFallo`), `useRolDeQuienMira()`,
`useSalas()` y `usePacks()` de `use-catalogos.ts`, `useUsuarios()`, `lib/destino-de-login.ts`, y
`src/test/consulta-ajena.ts`.

**Tres tapones globales** corren solos en `vitest.setup.ts` contra un registro común: `console.*`,
`document.title` y `window.name`. Cada spec amplía los centinelas con `vigilarEstosDatos({...})`.

**El `gcTime: 0` lo exige un barrido** sobre `src/hooks/*.ts`: una mutación nueva en cualquier archivo
de hooks nace cubierta, y el barrido falla nombrando archivo y hook.

### La mutación abierta

Cada tarea termina con una. Van **veintiséis de veintiséis**. La familia es siempre **agregar algo que
no debería estar, sin quitar nada**; lo que cambia es **dónde nadie estaba mirando**:

| Dónde apareció                              | El eje                                              |
| ------------------------------------------- | --------------------------------------------------- |
| un componente de cliente                    | el payload RSC                                      |
| un `router.push`                            | cuántas veces, no con qué                           |
| dos cachés distintas                        | tapar una deja la otra                              |
| `localStorage`, las galletas, `window.name` | **el último no está atado al origen**               |
| el service worker                           | las cabeceras de la petición                        |
| una cabecera de respuesta                   | no llevaba el prefijo que la auditoría filtraba     |
| `console.*` y `document.title`              | lo que se dice **fuera del documento**              |
| un `logger.debug`                           | la defensa estaba atada a **qué método** del Logger |
| el argumento recibido                       | que la función sea pura en lo que **recibe**        |
| un `useEffect`                              | navegar **al montar**                               |
| la History API                              | por detrás del router doblado                       |
| un `prefetchQuery`                          | lo que se pide **después de escribir**              |

### Y las cuatro formas de que un test no pueda fallar

1. **Autorreferencial** — comparar la salida contra la misma función que la produce.
2. **Premisa destruida** — el código bajo prueba borra el borde que el test venía a ejercitar.
3. **Montado en el caso ciego** — fijar algo en el único escenario donde la distinción no existe.
4. **Verde por casualidad ortográfica** — una defensa que depende de que nadie toque una palabra.

### Sobre la densidad

La Task 1 trae el código completo. Las Tasks 2 a 5 traen **los tests y la tabla de mutaciones, no la
implementación**: repiten patrones ya fijados. **Si aparece una decisión que los tests no determinan,
paralo y preguntá.**

Y la advertencia de la Fase 7: cuando los tests salen de una especificación detallada, **la
implementación que sale de esa misma especificación los pasa a la primera**. El rojo inicial sólo prueba
que el archivo no existía. **La confianza la da la tabla de mutaciones.**

---

## Estructura de archivos

```
apps/web/src/
  hooks/
    use-salas-admin.ts · .spec.tsx      CREAR
    use-horarios.ts    · .spec.tsx      CREAR
    use-ausencias.ts   · .spec.tsx      CREAR
    use-vacaciones.ts  · .spec.tsx      CREAR
  app/[slug]/admin/
    navegacion-admin.ts                 TOCAR   tres lineas
    salas/
      page.tsx · page.spec.tsx          CREAR
      [id]/page.tsx · page.spec.tsx     CREAR   la ficha con sus 8 ajustes
      ajuste-heredable.tsx              CREAR   el control de tres estados
    horarios/
      page.tsx · page.spec.tsx          CREAR
      formulario.tsx                    CREAR
    ausencias/
      page.tsx · page.spec.tsx          CREAR
    usuarios/[id]/
      bloque-vacaciones.tsx             CREAR
      page.tsx · page.spec.tsx          TOCAR   enchufar el bloque
```

---

## Task 1: Los cuatro hooks

**Files:** crear `hooks/use-salas-admin.ts`, `use-horarios.ts`, `use-ausencias.ts`,
`use-vacaciones.ts`, cada uno con su `.spec.tsx`

### Los endpoints, verificados

| Método | Ruta                                     | Rol               | Devuelve                       |
| ------ | ---------------------------------------- | ----------------- | ------------------------------ |
| POST   | `/salas`                                 | `ADMIN_SALON`     | `SalaPublica`                  |
| GET    | `/salas`, `/salas/:id`                   | —                 | `SalaPublica[]`, `SalaPublica` |
| PATCH  | `/salas/:id`                             | `ADMIN_SALON`     | `SalaPublica`                  |
| DELETE | `/salas/:id`                             | `ADMIN_SALON`     | `SalaPublica` (baja lógica)    |
| POST   | `/horarios-profesor`                     | `ADMIN_OPERATIVO` | `HorarioProfesorPublico`       |
| GET    | `/horarios-profesor?profesorId=&salaId=` | `ADMIN_OPERATIVO` | `[]`                           |
| PATCH  | `/horarios-profesor/:id`                 | `ADMIN_OPERATIVO` | uno                            |
| DELETE | `/horarios-profesor/:id`                 | `ADMIN_OPERATIVO` | **void, 204**                  |
| POST   | `/ausencias`                             | `ADMIN_SALON`     | `AusenciaPublica`              |
| GET    | `/ausencias?salaId=&desde=&hasta=`       | —                 | `[]`                           |
| DELETE | `/ausencias/:id`                         | `ADMIN_SALON`     | `AusenciaPublica`              |
| POST   | `/vacaciones`                            | `ADMIN_OPERATIVO` | `VacacionPublica`              |
| GET    | `/vacaciones?perfilId=`                  | `ADMIN_OPERATIVO` | `[]`                           |
| DELETE | `/vacaciones/:id`                        | `ADMIN_OPERATIVO` | `VacacionPublica`              |

⚠️ **Confirmá las rutas base en los controllers antes de escribir.** Yo escribí
`/horarios-profesor` deduciéndolo del nombre del módulo y **no lo verifiqué**.

- [ ] **Step 1: La forma, con `use-horarios.ts` como molde**

```ts
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HorarioProfesorPublico } from '@boxadmin/shared';
import { type ErrorDeApi, pedir } from '@/lib/cliente';

export interface FiltrosDeHorarios {
  profesorId?: string;
  salaId?: string;
}

export const clavesDeHorarios = {
  lista: (f: FiltrosDeHorarios) => ['horarios', f] as const,
};

/** Solo los filtros con valor: una cadena vacia no es "sin filtro" para la API. */
export function queryDeHorarios(f: FiltrosDeHorarios): string {
  const partes = new URLSearchParams();
  if (f.profesorId !== undefined && f.profesorId !== '') partes.set('profesorId', f.profesorId);
  if (f.salaId !== undefined && f.salaId !== '') partes.set('salaId', f.salaId);

  const texto = partes.toString();
  return texto === '' ? '' : `?${texto}`;
}

export function useHorarios(filtros: FiltrosDeHorarios) {
  return useQuery({
    queryKey: clavesDeHorarios.lista(filtros),
    queryFn: () => pedir<HorarioProfesorPublico[]>(`/horarios-profesor${queryDeHorarios(filtros)}`),
  });
}

function useInvalidarHorarios() {
  const cliente = useQueryClient();
  return () => void cliente.invalidateQueries({ queryKey: ['horarios'] });
}

export function useCrearHorario() {
  const invalidar = useInvalidarHorarios();
  return useMutation<HorarioProfesorPublico, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) =>
      pedir<HorarioProfesorPublico>('/horarios-profesor', { metodo: 'POST', cuerpo: datos }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

export function useActualizarHorario(id: string) {
  const invalidar = useInvalidarHorarios();
  return useMutation<HorarioProfesorPublico, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) =>
      pedir<HorarioProfesorPublico>(`/horarios-profesor/${id}`, { metodo: 'PATCH', cuerpo: datos }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

export function useBorrarHorario(id: string) {
  const invalidar = useInvalidarHorarios();
  return useMutation<null, ErrorDeApi, void>({
    mutationFn: () => pedir<null>(`/horarios-profesor/${id}`, { metodo: 'DELETE' }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}
```

Los otros tres siguen el mismo molde. **Salas invalida además la clave de `useSalas()`** de
`use-catalogos.ts`, porque esa lista la consumen media docena de pantallas — buscá su clave y usala, no
inventes una.

- [ ] **Step 2: Los tests**

Lo que no puede faltar en los cuatro:

- Ruta **y** método exactos de cada llamada.
- Los filtros con valor vacío **no se mandan**; los que tienen valor, sí.
- **Cada escritura es UNA sola petición** — contá las llamadas.
- **Tras escribir no se toca lo que no es suyo**: usá `src/test/consulta-ajena.ts`, que deja una
  consulta ajena activa en el mismo cliente. Un unitario de hook monta el hook **solo**, y con un único
  consumidor una invalidación global y una dirigida **son indistinguibles**.
- **Salas invalida también el catálogo** de `useSalas()`, y hay un test que lo fija.
- **`tarifaPorHora` viaja como cadena.** Un test con `'1500.00'` que comprueba que el cuerpo lleva la
  cadena y no un número.

- [ ] **Step 3: Verificar** (`vitest`, `tsc`, `prettier --check`, y el barrido del `gcTime`).

- [ ] **Step 4: Las mutaciones**

| Mutación                         | Debe caer                         |
| -------------------------------- | --------------------------------- |
| Un filtro vacío se manda igual   | el test del filtro vacío          |
| `invalidateQueries()` sin filtro | el centinela de la consulta ajena |
| Salas no invalida el catálogo    | el test del catálogo              |
| La tarifa se manda como número   | el test de la cadena              |
| Quitar un `gcTime: 0`            | el barrido                        |

- [ ] **Step 5: La mutación abierta.**

---

## Task 2: Salas

**Files:** crear `admin/salas/page.tsx` · `page.spec.tsx`, `salas/[id]/page.tsx` · `page.spec.tsx`,
`salas/ajuste-heredable.tsx`; tocar `navegacion-admin.ts`

- [ ] **Step 1: Verificá el tercer estado ANTES de construir**

La spec dice que mandar `null` explícito debería restaurar la herencia, porque `@IsOptional()` deja
pasar el null y el servicio hace `data: { ...dto }`. **No lo des por cierto.** Comprobalo contra el DTO
y el servicio, y si no se pudiera, **pará y avisá**: el control de tres estados se queda sin tercer
estado y hay que decirlo en pantalla en vez de fingirlo.

### Su entrada en la navegación

Cada una de las tres pantallas agrega **su propia** línea a `ENLACES_DEL_PANEL`, en su tarea y no todas
de golpe: así la navegación nunca apunta a una ruta que todavía no existe.

⚠️ **Caen tests de `armazon.spec.tsx` cada vez.** Actualizalos y comprobá que siguen teniendo dientes
agregando un enlace de más. Ojo con el que barre los tres roles: **está atado a una lista escrita a
mano desde la Fase 8**, porque comparado contra `enlacesPara(rol)` era **autorreferencial** — agregar
una entrada movía los dos lados a la vez y el test seguía verde. No lo vuelvas a derivar de la función
que audita.

- [ ] **Step 2: Lo que no puede faltar**

```tsx
it('muestra ESTAS columnas y solo estas', () => {});
it('una sala de baja se distingue de una activa', () => {});

// --- Los ocho ajustes ---
it('NO dibuja el campo exclusiva', () => {
  // Campo muerto: aparece en UN solo sitio del codigo, el mapeo. Ninguna regla
  // lo lee. Afirmá sobre el MARCADO, no con queryByRole.
});

it('heredar, un valor propio y CERO son tres cosas distintas', () => {
  // `null` = hereda del gimnasio, y la herencia es real (minMinutosCancelar se
  // lee del tenant). Un control de dos estados obligaria a mentir.
});

it('guardar un ajuste NO pisa la herencia de los otros tres', async () => {
  // Manda solo lo que cambio.
  expect(cuerpoEnviado()).toEqual({ cupoBase: 12 });
});

it('volver a heredar manda null EXPLICITO, no omite la clave', async () => {
  expect(cuerpoEnviado()).toEqual({ cupoBase: null });
});

// --- El rol ---
it('un ADMIN_OPERATIVO no ve NINGUN boton de escritura, en el marcado', () => {});
it('un ADMIN_SALON si los ve', () => {});
it('sin proveedor de rol tampoco se dibujan', () => {});

// --- La baja ---
it('dar de baja dice ANTES si hay turnos futuros', () => {});
it('y maneja el 409 igual, por si publican un mes en el medio', async () => {});
it('el interruptor de ACTIVA tambien puede devolver ese 409', async () => {
  // Hay dos puertas a la misma baja: el DELETE y un PATCH con activa:false.
  // Las dos pasan por la misma proteccion.
});
```

- [ ] **Step 3: Implementar**, **Step 4: verificar**, **Step 5: mutaciones**

| Mutación                                  | Debe caer                               |
| ----------------------------------------- | --------------------------------------- |
| Dibujar `exclusiva`                       | «NO dibuja el campo exclusiva»          |
| Heredar y cero son el mismo estado        | «son tres cosas distintas»              |
| Volver a heredar omite la clave           | «manda null EXPLICITO»                  |
| Mandar el formulario entero               | «NO pisa la herencia de los otros tres» |
| `rolAlcanza(rol,'ADMIN_OPERATIVO')`       | «no ve NINGUN boton de escritura»       |
| El interruptor de activa no maneja el 409 | ese test                                |

- [ ] **Step 6: La mutación abierta.**

---

## Task 3: Horarios de profesor

**Files:** crear `admin/horarios/page.tsx` · `page.spec.tsx` · `formulario.tsx`

**El corazón de la fase**: decide qué profesora se asigna sola al publicar un mes, y alimenta la
liquidación con su tarifa.

### Su entrada en la navegación

Cada una de las tres pantallas agrega **su propia** línea a `ENLACES_DEL_PANEL`, en su tarea y no todas
de golpe: así la navegación nunca apunta a una ruta que todavía no existe.

⚠️ **Caen tests de `armazon.spec.tsx` cada vez.** Actualizalos y comprobá que siguen teniendo dientes
agregando un enlace de más. Ojo con el que barre los tres roles: **está atado a una lista escrita a
mano desde la Fase 8**, porque comparado contra `enlacesPara(rol)` era **autorreferencial** — agregar
una entrada movía los dos lados a la vez y el test seguía verde. No lo vuelvas a derivar de la función
que audita.

- [ ] **Step 1: Lo que no puede faltar**

```tsx
it('los filtros de profesora y sala viajan en la URL', async () => {});

it('LOS TRES CHOQUES SE DISTINGUEN', async () => {
  // Un mensaje generico para los tres es lo que hace que el admin no sepa que
  // cambiar. Los tres, con su texto:
  //  - otra profesora en esa sala: «un turno tiene una sola profesora»
  //  - la misma profesora en otra sala: «no puede estar en dos salas a la vez»
  //  - el mismo horario repetido
});

it('al elegir dia y franja se ve QUE HAY YA en esa franja', () => {
  // Para que el choque se evite mirando, no chocando.
});

// --- La tarifa ---
it('la tarifa viaja como CADENA con dos decimales', async () => {
  expect(cuerpoEnviado().tarifaPorHora).toBe('1500.00');
});
it('vacia significa HEREDAR la del gimnasio, no cero', async () => {});
it('un valor con mas de dos decimales no llega al servidor', async () => {
  // El DTO lo rechaza con un patron; avisar aca ahorra el viaje.
});

// --- Las vigencias ---
it('hasta vacio significa INDEFINIDO', () => {});
it('hasta anterior a desde muestra el motivo de la API', async () => {});

// --- Editar ---
it('al editar NO se ofrece cambiar la profesora ni la sala', () => {
  // El DTO las excluye: mover un horario dejaria los turnos ya etiquetados
  // colgando de un patron que ya no existe. Afirmá sobre el MARCADO.
});

it('borrar un horario confirma NOMBRANDO a la profesora, el dia y la hora', async () => {});
it('borra el DE ESA FILA, con dos sembrados', async () => {});
```

- [ ] **Step 2: Implementar**, **Step 3: verificar**, **Step 4: mutaciones**

| Mutación                                  | Debe caer                        |
| ----------------------------------------- | -------------------------------- |
| Un mensaje genérico para los tres choques | «LOS TRES CHOQUES SE DISTINGUEN» |
| La tarifa se manda como número            | el test de la cadena             |
| Vacía se manda como `'0'`                 | «vacia significa HEREDAR»        |
| Ofrecer cambiar la sala al editar         | ese test                         |
| Borrar manda el id de la primera fila     | «borra el DE ESA FILA»           |

- [ ] **Step 5: La mutación abierta.** Es la pantalla con la tarifa de las profesoras: hay dinero y hay
      nombres.

---

## Task 4: Ausencias

**Files:** crear `admin/ausencias/page.tsx` · `page.spec.tsx`

### Su entrada en la navegación

Cada una de las tres pantallas agrega **su propia** línea a `ENLACES_DEL_PANEL`, en su tarea y no todas
de golpe: así la navegación nunca apunta a una ruta que todavía no existe.

⚠️ **Caen tests de `armazon.spec.tsx` cada vez.** Actualizalos y comprobá que siguen teniendo dientes
agregando un enlace de más. Ojo con el que barre los tres roles: **está atado a una lista escrita a
mano desde la Fase 8**, porque comparado contra `enlacesPara(rol)` era **autorreferencial** — agregar
una entrada movía los dos lados a la vez y el test seguía verde. No lo vuelvas a derivar de la función
que audita.

- [ ] **Step 1: Lo que no puede faltar**

```tsx
it('una ausencia de TODO EL SALON se distingue de una sin sala elegida', () => {
  // `salaId: null` significa todo el salon. Es un caso distinto de "no elegi
  // sala todavia", y dejarlo como un desplegable vacio los confunde.
});

it('NO dibuja el campo recuperable', () => {
  // Campo muerto: aparece en DOS sitios, el mapeo y la escritura con `?? true`.
  // El planificador no lo lee. Y es peor que `exclusiva` porque el nombre
  // promete algo concreto sobre las clases de los alumnos.
});

it('todo el dia y una franja son excluyentes', () => {
  // `horaInicio`/`horaFin` solo si `todoElDia` es false.
});

it('los filtros de sala y rango viajan en la URL', async () => {});
it('un ADMIN_OPERATIVO no ve los botones de escritura, en el marcado', () => {});
it('borrar confirma nombrando el motivo y las fechas', async () => {});
it('borra la DE ESA FILA, con dos sembradas', async () => {});
```

- [ ] **Step 2: Implementar**, **Step 3: verificar**, **Step 4: mutaciones**

| Mutación                                  | Debe caer                        |
| ----------------------------------------- | -------------------------------- |
| Dibujar `recuperable`                     | «NO dibuja el campo recuperable» |
| Todo el salón se pinta como sala vacía    | ese test                         |
| Las horas se mandan con `todoElDia: true` | «son excluyentes»                |
| `rolAlcanza(rol,'ADMIN_OPERATIVO')`       | el test del rol                  |

- [ ] **Step 5: La mutación abierta.**

---

## Task 5: Las vacaciones, en la ficha de la persona

**Files:** crear `admin/usuarios/[id]/bloque-vacaciones.tsx`; tocar `usuarios/[id]/page.tsx` y su spec

Van **en la ficha y no en una pantalla propia**, al lado de los días fijos: «qué días viene» y «cuándo
no viene» juntos. Misma decisión que las rutinas en la Fase 7.

- [ ] **Step 1: Lo que no puede faltar**

```tsx
it('lista SOLO las de esa persona', () => {
  expect(pedirEspia).toHaveBeenCalledWith('/vacaciones?perfilId=p1');
});
it('crear manda el perfilId de la ficha, no el id del usuario', async () => {});
it('hasta anterior a desde muestra el motivo de la API', async () => {});
it('borra la DE ESA FILA, con dos sembradas', async () => {});
it('las fechas pasadas se distinguen de las que vienen', () => {});

it('AL MONTAR salen ESTAS peticiones y ninguna mas', () => {
  // La ficha ya pide el turno, sus reservas y el catalogo de personas. Esta
  // suma una. Ordenadas y SIN deduplicar.
});
```

⚠️ **El spec de la ficha ya tiene listas blancas de peticiones**: van a cambiar. Actualizalas a
propósito, no las borres.

- [ ] **Step 2: Implementar**, **Step 3: verificar**, **Step 4: mutaciones**

| Mutación                      | Debe caer                       |
| ----------------------------- | ------------------------------- |
| Listar sin `perfilId`         | «lista SOLO las de esa persona» |
| Mandar el `id` del usuario    | ese test                        |
| Borrar la primera de la lista | «borra la DE ESA FILA»          |
| Una petición de más al montar | la lista blanca                 |

- [ ] **Step 5: La mutación abierta.**

---

## Task 6: Verificación final, README y tracker

- [ ] **Step 1: Todo verde**

```bash
cd /d/Dev/box-admin/apps/web && pnpm exec tsc --noEmit && pnpm test && pnpm build
cd ../api && pnpm exec tsc --noEmit && pnpm exec jest --silent && pnpm exec eslint "src/**/*.ts"
```

⚠️ `apps/api` tiene que seguir en **1320 / 66** y el linter en cero: esta fase no toca la API.

⚠️ **Para Playwright** hace falta la API corriendo y **el contenedor `api` del compose está roto**
(le falta `@nestjs/throttler`). Levantala en el host y bajala **por PID concreto**. El freno de auth es
de **5 intentos por minuto**: dos corridas seguidas dan 429 y **parece un fallo del código**. Dejá
pasar la ventana **sin tocar `/auth/login`** — un bucle de espera que consulte ese endpoint renueva el
freno que espera.

- [ ] **Step 2: El checklist a mano**

- Entrar como `ADMIN_OPERATIVO` y comprobar que en salas y ausencias **no hay ningún botón de
  escritura**.
- Poner un cupo propio a una sala, guardarlo, **volver a heredar**, y comprobar que el valor del
  gimnasio manda otra vez.
- Provocar los tres choques de horario y leer los tres mensajes.
- Intentar dar de baja una sala con turnos futuros, por el botón **y** por el interruptor de activa.
- Comprobar que no hay entradas del panel en `Cache Storage`.

- [ ] **Step 3: README y tracker**

Sección «La configuración operativa — Fase 10» en `README.md`, **antes de `## Tests`**. ⚠️ Anclá a una
línea entera (`\n## Tests\n`) y a la **última** aparición: `## Tests` es subcadena de un `### Tests`
anterior.

Y el bloque de la Fase 10 en `docs/superpowers/plans/PROGRESO.md`, con el formato de los anteriores:
tareas, decisiones, **los errores de este plan que encontraste**, trampas nuevas, estado final y deuda.

**Anotá en la deuda los dos campos muertos** (`Sala.exclusiva` y `Ausencia.recuperable`) con su
medición: dónde aparecen y quién no los lee.

---

## Lo que esta fase NO hace

- **Implementar las reglas de `exclusiva` y `recuperable`.** Son de negocio y necesitan decidirse.
- **La configuración del gimnasio** —los valores que las salas heredan—: es del área de Configuración.
- **Pantallas de profesor**, que siguen sin existir.
- **Cualquier cambio en `apps/api`.**
