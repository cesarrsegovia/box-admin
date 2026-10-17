# Fase 11 — Análisis

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans`, tarea por tarea. Los pasos llevan casillas (`- [ ]`).

**Objetivo:** darle cara a los seis reportes de la 6A, que llevan **cuatro fases sin tocar** y cuya
única forma de lectura hoy es un `curl`.

**Arquitectura:** una pantalla de Análisis con el mes en la URL, una pantalla de asistencia con rango
libre, y **dos reportes que NO van en Análisis** sino donde se usan. **No se toca ni un endpoint.**

**Spec:** `docs/superpowers/specs/2026-10-17-fase11-analisis.md`

---

## Reglas que gobiernan todo este plan

⚠️ **No hacés commits.** Nunca `git add`, `git commit`, `git push`, `git stash`, `git checkout` ni
`git reset`. `git status`, `git diff` y `git show` sí.

⚠️ **Nunca `pnpm lint`.** El script lleva `--fix`. Para formato, `pnpm exec prettier --check`, y
`--write` sólo sobre archivos tuyos. `apps/web` **no tiene eslint**.

⚠️ **Nunca `taskkill` ni `Stop-Process` por NOMBRE de proceso.** Hay una sesión viva de Claude Code en
la máquina. Por PID concreto y sólo los que levantaste vos.

⚠️ **No se toca `apps/api` ni `packages/shared`.** Si una pantalla parece necesitar un endpoint, **pará
y reportalo**.

⚠️ **Nada de strings con barra invertida por heredoc.** Usá la herramienta de edición.

⚠️ El `tsc` del repo lleva **`noUncheckedIndexedAccess`**.

⚠️ **`vitest run "ruta/[id]"` sólo funciona desde PowerShell**: por Bash los corchetes se comen el
patrón. Y el filtro de vitest es **subcadena, no regex**.

**Comandos:**

```bash
pnpm --filter @boxadmin/web exec vitest run <archivo>   # subcadena, NO regex
pnpm --filter @boxadmin/web exec tsc --noEmit
pnpm --filter @boxadmin/web test
pnpm --filter @boxadmin/web build
```

⚠️ **El `build` no es opcional y no lo cubre el `tsc`.** La Fase 10 estuvo a punto de cerrarse con el
build roto: Next 15 prohíbe que un `page.tsx` exporte nada que no sea el `default`, y ni `tsc --noEmit`
ni los tests lo ven. El error habla de `OmitWithTag` y «not assignable to `never`» y **no se parece a
la causa**. Los ayudantes de una pantalla van en un archivo hermano (`filtros.ts`), como ya hacen
`turnos/`, `horarios/` y `ausencias/`.

**Punto de partida:** `apps/web` 1266 tests / 57 suites. `apps/api` 1339 / 67 y 218 e2e, **sin tocar**.

### Lo que esta fase hereda

No lo reinventes: `componentes/tabla.tsx`, `componentes/confirmar.tsx`,
`admin/usuarios/[id]/errores.ts`, `useRolDeQuienMira()`, `useSalas()`, `useUsuarios()`,
`src/test/andamiaje-de-hooks.tsx` (`montar`, `dobleDeFetch`, `llamada`, `cacheDeConsultas`),
`src/test/consulta-ajena.ts`, y el helper del `volverA` que conserva el query.

**Cinco canales globales** corren solos en `vitest.setup.ts` contra un registro común: `console.*`,
`document.title`, `window.name`, **`document.head`** y **los tres almacenes del navegador**
(`localStorage`, `sessionStorage` y las galletas). Cada spec amplía los centinelas con
`vigilarEstosDatos({...})`.

⚠️ **Esta fase siembra más datos sensibles que ninguna**: importes, márgenes, lo que cuesta cada
profesora y quién no pagó. **Ampliá los centinelas con todo lo que siembres.**

**El barrido del `gcTime: 0` sólo mira mutaciones.** Esta fase es de **lectura pura** y no agrega
ninguna, así que no te va a decir nada: no lo confundas con cobertura.

### La mutación abierta

Cada tarea termina con una. Van **treinta y dos de treinta y dos**. La familia es siempre **agregar
algo que no debería estar, sin quitar nada**; lo que cambia es **dónde nadie estaba mirando**:

| Dónde apareció | El eje |
| --- | --- |
| un componente de cliente | el payload RSC |
| un `router.push` | cuántas veces, no con qué |
| dos cachés distintas | tapar una deja la otra |
| `localStorage`, las galletas, `window.name` | **el último no está atado al origen** |
| el service worker | las cabeceras de la petición |
| una cabecera de respuesta | no llevaba el prefijo que la auditoría filtraba |
| `console.*` y `document.title` | lo que se dice **fuera del documento** |
| un `logger.debug` | la defensa estaba atada a **qué método** del Logger |
| el argumento recibido | que la función sea pura en lo que **recibe** |
| un `useEffect` | navegar **al montar** |
| la History API | por detrás del router doblado |
| un `prefetchQuery` | lo que se pide **después de escribir** |
| un `retry: 2` en un POST | **el camino de error**: los conteos corrían sobre un 200 |
| una consulta de más | **una lectura** no cambia un nodo ni manda un cuerpo |
| un `fetch` pelado | la lista blanca espiaba **`pedir`**, no la red |
| un `setInterval` | **el reloj**: ningún test adelantaba el tiempo |
| un `<meta>` | **`document.head`**: React 19 lo sube solo y todo el repo mira el `body` |
| `detalle: { ...dto }` | **lo que se escribe en la auditoría**, que el admin lee por otra ruta |

### Y las cinco formas de que un test no pueda fallar

1. **Autorreferencial** — comparar la salida contra la misma función que la produce.
2. **Premisa destruida** — el código bajo prueba borra el borde que el test venía a ejercitar.
3. **Montado en el caso ciego** — fijar algo en el único escenario donde la distinción no existe.
4. **Verde por casualidad ortográfica** — una defensa que depende de que nadie toque una palabra.
5. **El fixture habla el idioma del código y no el del contrato** — por el lado de la **entrada**.

⚠️ **La quinta es el riesgo principal de esta fase, y hay que decirlo en cada tarea.** Estos seis
contratos están llenos de **campos derivados**: `porcentaje` contra `numerador/denominador`, `margen`
contra sus sumandos, `texto` contra `centavos`. **Un fixture coherente los vuelve indistinguibles**: si
sembrás `{ numerador: 3, denominador: 4, porcentaje: 75 }`, ningún test puede decir cuál de los dos
pinta la pantalla.

**La regla de toda la fase: sembrar fracciones y porcentajes que NO concuerden.** Con
`{ numerador: 3, denominador: 4, porcentaje: 99 }` el test sí distingue, y la pantalla tiene que pintar
el 99 — porque el servidor es quien calcula, no la pantalla. Un fixture incoherente **no es un fixture
sucio: es el único que prueba algo.**

⚠️ **Pero el fixture tiene que seguir siendo POSIBLE.** La T1 se tropezó con esto: sembró «pedí 24
meses y me devolvió 1» y pasaban los 30 tests, cuando la API **nunca** puede contestar eso. Es la
quinta trampa por el otro lado — un fixture que no habla **ni** el idioma del código **ni** el del
contrato. Los dos topes reales, que no estaban en este plan y hay que respetarlos:

| Constante | Valor | Dónde |
| --- | --- | --- |
| `MAX_MESES_ADELANTE` | **12** | `stats.service.ts:70` |
| `MAX_DIAS_DE_RANGO` | **366** | `stats.service.ts:79` |

O sea: pedir 24 meses devuelve **12**, y un rango de más de 366 días vuelve recortado a 366 contando
el primer día. **Sembrá recortes reales**: distinguen argumento de respuesta igual de bien y además
pueden ocurrir.

### Sobre la densidad

La Task 1 trae el código completo. Las Tasks 2 a 6 traen **los tests y la tabla de mutaciones, no la
implementación**. **Si aparece una decisión que los tests no determinan, paralo y preguntá.**

Y la advertencia de la Fase 7: cuando los tests salen de una especificación detallada, **la
implementación que sale de esa misma especificación los pasa a la primera**. El rojo inicial sólo
prueba que el archivo no existía. **La confianza la da la tabla de mutaciones.**

---

## Estructura de archivos

```
apps/web/src/
  hooks/
    use-stats.ts · .spec.tsx            CREAR   los seis, lectura pura
  app/[slug]/admin/
    navegacion-admin.ts                 TOCAR   una linea
    analisis/
      page.tsx · page.spec.tsx          CREAR   el mes: operativo, caja y composicion
      filtros.ts                        CREAR   el mes en la URL (hermano, NO exportado del page)
      porcentaje.tsx                    CREAR   el control que no aplana denominador 0
      asistencia/
        page.tsx · page.spec.tsx        CREAR   rango libre + perfilId
        filtros.ts                      CREAR
    usuarios/
      page.tsx · page.spec.tsx          TOCAR   pagos pendientes, donde se usa
    turnos/[id]/
      bloque-anotados.tsx · .spec.tsx   TOCAR   turnos libres, donde se usa
```

⚠️ **Dónde van exactamente los dos últimos lo decide la Task 5 y la Task 6 mirando el código**, no esta
tabla. Lo que la spec fija es que **no van en Análisis**; los archivos de arriba son la hipótesis, y si
al mirarlo resulta que hay un sitio mejor, **ése es el hallazgo y hay que contarlo.**

---

## Task 1: Los seis hooks

**Files:** crear `apps/web/src/hooks/use-stats.ts` · `use-stats.spec.tsx`

**Son seis consultas y ninguna mutación.** No hay invalidación, no hay `gcTime: 0`, no hay nada que
escribir. Lo que sí hay es **seis formas distintas de armar un query**, y ahí está todo el riesgo.

- [ ] **Step 1: El molde**

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  CajaDelMes,
  ComposicionAlumnos,
  Operativo,
  PagoPendiente,
  ReporteAsistencia,
  ReporteTurnosLibres,
} from '@boxadmin/shared';
import { pedir } from '@/lib/cliente';

/** Los tres reportes que se piden por mes calendario. */
export interface Mes {
  anio: number;
  mes: number;
}

export interface RangoDeAsistencia {
  desde: string;
  hasta: string;
  perfilId?: string;
}

export const clavesDeStats = {
  caja: (m: Mes) => ['stats', 'caja', m] as const,
  operativo: (m: Mes, salaId?: string) => ['stats', 'operativo', m, salaId ?? null] as const,
  composicion: (m: Mes) => ['stats', 'composicion', m] as const,
  asistencia: (r: RangoDeAsistencia) => ['stats', 'asistencia', r] as const,
  pagosPendientes: () => ['stats', 'pagos-pendientes'] as const,
  turnosLibres: (salaId?: string, mesesAdelante?: number) =>
    ['stats', 'turnos-libres', salaId ?? null, mesesAdelante ?? null] as const,
};

/**
 * El mes SIEMPRE viaja: `ConsultaMensualDto` exige `anio` y `mes`, no son
 * opcionales. Esto NO es el patron de los filtros de las fases 9 y 10, donde
 * una cadena vacia se omitia.
 */
function queryDeMes(m: Mes): string {
  return `?anio=${m.anio}&mes=${m.mes}`;
}

export function useCaja(m: Mes) {
  return useQuery({
    queryKey: clavesDeStats.caja(m),
    queryFn: () => pedir<CajaDelMes>(`/stats/caja${queryDeMes(m)}`),
  });
}

export function useOperativo(m: Mes, salaId?: string) {
  return useQuery({
    queryKey: clavesDeStats.operativo(m, salaId),
    queryFn: () =>
      pedir<Operativo>(
        `/stats/operativo${queryDeMes(m)}${salaId !== undefined && salaId !== '' ? `&salaId=${salaId}` : ''}`,
      ),
  });
}

export function useComposicionAlumnos(m: Mes) {
  return useQuery({
    queryKey: clavesDeStats.composicion(m),
    queryFn: () => pedir<ComposicionAlumnos>(`/stats/composicion-alumnos${queryDeMes(m)}`),
  });
}

export function useAsistencia(r: RangoDeAsistencia) {
  return useQuery({
    queryKey: clavesDeStats.asistencia(r),
    queryFn: () => pedir<ReporteAsistencia>(`/stats/asistencia${queryDeAsistencia(r)}`),
  });
}

export function usePagosPendientes() {
  return useQuery({
    queryKey: clavesDeStats.pagosPendientes(),
    queryFn: () => pedir<PagoPendiente[]>('/stats/pagos-pendientes'),
  });
}

export function useTurnosLibres(salaId?: string, mesesAdelante?: number) {
  return useQuery({
    queryKey: clavesDeStats.turnosLibres(salaId, mesesAdelante),
    queryFn: () => pedir<ReporteTurnosLibres>(`/stats/turnos-libres${queryDeTurnosLibres(salaId, mesesAdelante)}`),
  });
}
```

`queryDeAsistencia` y `queryDeTurnosLibres` los escribís vos con el patrón de `queryDeHorarios`
(`use-horarios.ts`): **sólo los que tienen valor**, y `desde`/`hasta` son obligatorios.

⚠️ **`/stats/pagos-pendientes` no lleva ningún parámetro, y eso es a propósito.** El DTO está vacío
pero existe, para que el `ValidationPipe` devuelva 400 ante un `?salaId=` en vez de ignorarlo en
silencio. **No le agregues filtros al hook.**

⚠️ **`caja` y `composicion-alumnos` comparten `ConsultaMensualDto` y por eso rechazan `salaId`.** El
`operativo` y `turnos-libres` sí lo aceptan, porque un `Turno` tiene sala propia. **No uniformes esto:
la asimetría es una decisión de la 6A y está documentada en el service.**

- [ ] **Step 2: Lo que no puede faltar**

```tsx
it('cada reporte pide SU ruta, con metodo GET', () => {});
it('el mes viaja siempre, tambien cuando es enero', () => {
  // `?anio=2026&mes=1`, no `mes=01` ni un mes omitido por ser falsy. El 1 no
  // es un problema, pero `mes: 0` no existe y `anio: 0` tampoco: si alguna
  // rama usa `||`, esto no lo caza. Ver la mutacion.
});
it('un salaId vacio NO se manda, uno con valor SI', () => {});
it('pagos-pendientes se pide SIN ningun parametro', () => {});
it('desde y hasta viajan siempre en asistencia; el perfilId solo si esta', () => {});
it('cada reporte tiene su propia clave de cache', () => {
  // Dos reportes bajo la misma clave se pisan y el segundo muestra el primero.
  // Afirmá sobre las seis claves, no sobre una.
});
it('cambiar de mes es otra clave, no la misma consulta', () => {});
```

- [ ] **Step 3: Implementar**, **Step 4: verificar**, **Step 5: mutaciones**

| Mutación | Debe caer |
| --- | --- |
| `queryDeMes` usa `\|\|` en vez de mandar siempre | «el mes viaja siempre» |
| El `salaId` vacío se manda igual | «un salaId vacío NO se manda» |
| `pagos-pendientes` con un `?salaId=` | «se pide SIN ningún parámetro» |
| Dos reportes bajo la misma clave | «cada reporte tiene su propia clave» |
| La clave ignora el mes | «cambiar de mes es otra clave» |

- [ ] **Step 6: La mutación abierta.**

---

## Task 2: Análisis — el operativo

**Files:** crear `admin/analisis/page.tsx` · `page.spec.tsx` · `filtros.ts` · `porcentaje.tsx`; tocar
`navegacion-admin.ts` y `armazon.spec.tsx`

**Es la tarea que decide si esta fase sirve o miente.** Cinco porcentajes y tres meses de historia.

### Su entrada en la navegación

Una línea en `ENLACES_DEL_PANEL`, con `minimo: 'ADMIN_OPERATIVO'`.

⚠️ **Caen tests de `armazon.spec.tsx`.** Actualizalos y comprobá que siguen teniendo dientes agregando
un enlace de más. El que barre los tres roles **está atado a una lista escrita a mano desde la Fase 8**,
porque comparado contra `enlacesPara(rol)` era **autorreferencial**. **No lo vuelvas a derivar de la
función que audita.**

- [ ] **Step 1: `porcentaje.tsx`, que es el corazón**

Un `Porcentaje` tiene `numerador`, `denominador` y `porcentaje: number | null`. El contrato dice por
escrito por qué viajan los tres:

> Sin ellos, un 0% y un "no hay datos" se ven igual, y son cosas distintas: `denominador: 0` significa
> que la pregunta no se puede contestar, no que la respuesta sea cero.

- [ ] **Step 2: Lo que no puede faltar**

```tsx
it('denominador CERO no se pinta como 0%', () => {
  // Es el test de la fase. Una ocupacion en 0% dice que no vino nadie; la
  // verdad puede ser que no hubo nada a lo que venir.
});
it('un 0% de verdad SI se pinta como 0%', () => {
  // La otra mitad: sin este, "nunca pinta 0%" tambien pasaria.
});
it('el numerador y el denominador estan a la vista, no solo el porcentaje', () => {});

it('la pantalla pinta el porcentaje DEL SERVIDOR, no uno recalculado', () => {
  // Sembrá { numerador: 3, denominador: 4, porcentaje: 99 }. Un fixture
  // coherente no distingue: es la quinta forma de que un test no pueda fallar.
  // El servidor es quien calcula.
});

it('el mes viaja en la URL y sobrevive al boton de atras', () => {});
it('el trimestre se pinta del mas viejo al mas nuevo', () => {
  // Lo dice el contrato. Con tres meses iguales sembrados, el orden no se
  // puede comprobar: sembrá tres distintos.
});
it('un trimestre con MENOS de tres meses no inventa huecos', () => {
  // Un gimnasio nuevo no tiene tres meses de historia.
});
it('los cinco porcentajes estan, y solo esos cinco', () => {});
it('un fallo al leer no se parece a un mes sin datos', () => {});
```

- [ ] **Step 3: Implementar**, **Step 4: verificar**, **Step 5: mutaciones**

| Mutación | Debe caer |
| --- | --- |
| `denominador: 0` se pinta como `0%` | «denominador CERO no se pinta como 0%» |
| Nunca pinta `0%` | «un 0% de verdad SÍ se pinta» |
| La pantalla recalcula `num/den` en vez de usar `porcentaje` | «pinta el porcentaje DEL SERVIDOR» |
| El trimestre se pinta al revés | «del más viejo al más nuevo» |
| El fallo al leer se dibuja como vacío | ese test |

- [ ] **Step 6: La mutación abierta.**

---

## Task 3: Análisis — la caja y la composición

**Files:** tocar `admin/analisis/page.tsx` · `page.spec.tsx`

Dos bloques más en la misma pantalla, porque **los tres comparten el selector de mes**: `caja`,
`operativo` y `composicion-alumnos` toman `anio` y `mes` y nada más.

- [ ] **Step 1: La puerta de rol**

**La caja pide `ADMIN_SALON`; todo lo demás, `ADMIN_OPERATIVO`.** Es el criterio de la 5A y lo explica
el controller: registrar un cobro es operativo, mirar el margen del salón no.

⚠️ Para un `ADMIN_OPERATIVO`, la caja **no existe en el marcado** —no escondida con CSS— **y tampoco se
pide**: el bloque entero no se monta, así que el hook no corre. Es el patrón de horarios, no el de
`enabled: false`.

- [ ] **Step 2: Lo que no puede faltar**

```tsx
it('un ADMIN_OPERATIVO no tiene la caja en el marcado', () => {});
it('y tampoco la pide: la lista de peticiones no la lleva', () => {
  // Las dos mitades. Un bloque que no se dibuja pero se pide filtra igual.
});
it('sin proveedor de rol tampoco se dibuja', () => {});
it('un ADMIN_SALON si la ve, y ve TAMBIEN lo operativo', () => {
  // `rolAlcanza` es una jerarquia, no una lista de roles exactos.
});

// --- El dinero ---
it('el margen dice que mezcla dos bases', () => {
  // `cobrado` es CAJA (por `Pago.createdAt`) y `costoProfesoras` es DEVENGADO.
  // Quien paga octubre el 28 de septiembre entra en la caja de septiembre.
});
it('lo bonificado se muestra APARTE de lo cobrado, no sumado', () => {
  // Una cortesia es un metodo de pago normal y su monto puede no ser cero.
});
it('ninguna cuenta usa `texto`', () => {
  // Sembrá un Importe cuyo `texto` y `centavos` NO concuerden: si alguna suma
  // o algun porcentaje sale del texto, este test lo dice. Es la unica forma de
  // fijar que el float no esta.
});
it('el desglose por metodo suma lo mismo que el cobrado', () => {
  // Con centavos, y sin recalcular el total con la misma funcion que lo pinta.
});

// --- La composicion ---
it('un pack sin nombre (packId null) se distingue de uno llamado "Sin pack"', () => {});
it('los porcentajes por pack salen del servidor, no se recalculan', () => {});
```

- [ ] **Step 3: Implementar**, **Step 4: verificar**, **Step 5: mutaciones**

| Mutación | Debe caer |
| --- | --- |
| `rolAlcanza(rol,'ADMIN_OPERATIVO')` para la caja | «no tiene la caja en el marcado» |
| La caja se esconde con CSS pero se pide | «y tampoco la pide» |
| Lo bonificado se suma a lo cobrado | ese test |
| Una suma hecha con `Number(importe.texto)` | «ninguna cuenta usa `texto`» |
| Los porcentajes por pack se recalculan | ese test |

- [ ] **Step 6: La mutación abierta.** Hay márgenes y hay lo que cuesta cada profesora.

---

## Task 4: La asistencia

**Files:** crear `admin/analisis/asistencia/page.tsx` · `page.spec.tsx` · `filtros.ts`

Pantalla propia y no un bloque más, **porque no se pide por mes**: lleva un rango libre y un
`perfilId` opcional. Lo dice el controller: «la conversación con un alumno sobre su asistencia no
empieza ni termina un día 1».

- [ ] **Step 1: Lo que no puede faltar**

```tsx
it('el rango y el perfilId viajan en la URL', async () => {});

it('dice sobre QUE se calcula la asistencia', () => {
  // El denominador son las reservas de turnos DONDE SE PASO LISTA, no las
  // reservas. Una profesora que no pasa lista no produce alumnos ausentes:
  // produce alumnos INVISIBLES. Un "94%" sin decir sobre que invita a tomar
  // una decision sobre alguien con un numero que cubre tres clases de doce.
});

it('un alumno SIN lista pasada no se pinta como 0% de asistencia', () => {
  // `porcentaje: null` cuando no se le paso lista ni una vez en el rango.
});
it('un 0% de verdad SI se pinta como 0%', () => {});

it('muestra el `hasta` QUE VOLVIO, no el que se pidio', () => {
  // Vuelve recortado, igual que `mesesAdelante`. Sembrá una respuesta cuyo
  // `hasta` NO sea el pedido: con los dos iguales no se distingue nada.
});

it('hasta anterior a desde muestra el motivo de la API', async () => {});
it('un rango sin alumnos se distingue de un fallo al leer', () => {});
```

- [ ] **Step 2: Implementar**, **Step 3: verificar**, **Step 4: mutaciones**

| Mutación | Debe caer |
| --- | --- |
| `porcentaje: null` se pinta como `0%` | «un alumno SIN lista pasada» |
| Se pinta el `hasta` pedido en vez del devuelto | «muestra el `hasta` QUE VOLVIÓ» |
| Se borra la explicación del denominador | «dice sobre QUÉ se calcula» |
| El rango no viaja en la URL | ese test |

- [ ] **Step 5: La mutación abierta.**

---

## Task 5: Pagos pendientes, donde se usa

**Files:** los decidís vos. La hipótesis es `admin/usuarios/page.tsx` · `page.spec.tsx`.

**No va en Análisis.** Es una lista de trabajo —«a quién llamo»— y enterrada en una sección de
reportes no la mira nadie, porque recepción no entra ahí.

- [ ] **Step 1: Decidí dónde, mirando el código**

Mirá el listado de personas, la ficha, y cómo está armada la navegación. **Contá qué elegiste y por
qué antes de escribir la pantalla.** Si al mirarlo encontrás un sitio mejor que el del encabezado,
**ése es el hallazgo**: decilo.

Dos cosas que pesan en la decisión: el reporte **no acepta ningún filtro** (ni siquiera `salaId`, y el
DTO vacío existe para devolver 400 en vez de ignorarlo), y trae `perfilId`, `nombreCompleto`, `email`,
`packNombre`, `pendienteEstimado` y `cancelacionesDelMes`.

- [ ] **Step 2: Lo que no puede faltar**

```tsx
it('NO lo llama «deuda» en ningun sitio', () => {
  // `pendienteEstimado` es lo que costaria ponerse al dia con un pack. El
  // sistema NO lleva cuenta corriente. Alguien se lo va a leer por telefono a
  // un alumno. Afirmá sobre el marcado, buscando la palabra.
});
it('dice que es un estimado y de donde sale', () => {});
it('cada fila lleva a la ficha de ESA persona, con dos sembradas', () => {});
it('una lista vacia se distingue de un fallo al leer', () => {
  // «Nadie debe nada» y «no pude preguntar» no son lo mismo.
});
it('el importe no pasa por un float', () => {});
it('un alumno sin pack (packNombre null) no se pinta como sin nombre', () => {});
```

- [ ] **Step 3: Implementar**, **Step 4: verificar**, **Step 5: mutaciones**

| Mutación | Debe caer |
| --- | --- |
| Llamarlo «deuda» | «NO lo llama deuda» |
| La lista vacía se dibuja igual que el fallo | ese test |
| Todas las filas enlazan a la primera persona | «cada fila lleva a la ficha de ESA» |
| El importe se formatea desde `texto` con `Number()` | «no pasa por un float» |

- [ ] **Step 6: La mutación abierta.** Hay nombres, correos y quién no pagó.

---

## Task 6: Turnos libres, donde se usa

**Files:** los decidís vos. La hipótesis es el bloque de anotados de `turnos/[id]`.

**No va en Análisis**, por lo mismo: contesta «dónde meto a este alumno los martes», que es una
pregunta que surge **en medio de otra tarea**.

- [ ] **Step 1: Decidí dónde, mirando el código**

⚠️ **Mirá primero `bloque-anotados.tsx` y el reasignar de la Fase 9**, que ya resuelve un problema
parecido: sus destinos llevan la ocupación escrita (`18:00 · Flow (7/10)`) para que el 409 de «destino
completo» se evite mirando. **Puede que lo que haga falta no sea una pantalla nueva sino alimentar eso
con este reporte.** Si es así, decilo: menos código es mejor resultado.

- [ ] **Step 2: Lo que no puede faltar**

```tsx
it('muestra los meses QUE SE MIRARON, no los que se pidieron', () => {
  // `mesesAdelante` vuelve YA RECORTADO: pedir 24 devuelve 12. Sin esto, quien
  // pidio dos anos lee una lista corta como «no hay mas turnos» en vez de como
  // «no miramos mas alla». Sembrá pedido != devuelto: con los dos iguales no
  // se distingue nada.
});
it('un turno sin lugar no aparece', () => {});
it('cada turno dice su sala, su fecha y cuantos lugares quedan', () => {});
it('el filtro de sala viaja, y vacio NO se manda', () => {});
it('ninguna lista vacia se confunde con un fallo al leer', () => {});
```

- [ ] **Step 3: Implementar**, **Step 4: verificar**, **Step 5: mutaciones**

| Mutación | Debe caer |
| --- | --- |
| Se pinta el `mesesAdelante` pedido | «muestra los meses QUE SE MIRARON» |
| El filtro de sala vacío se manda | ese test |
| `libres` se recalcula como `cupo - reservados` | el test que lo fije — **el servidor manda** |

- [ ] **Step 4b: La mutación abierta.**

---

## Task 7: Verificación final, README y tracker

- [ ] **Step 1: Todo verde**

```bash
cd /d/Dev/box-admin/apps/web && pnpm exec tsc --noEmit && pnpm test && pnpm build
cd ../api && pnpm exec tsc --noEmit && pnpm exec jest --silent && pnpm exec eslint "src/**/*.ts"
```

⚠️ `apps/api` tiene que seguir en **1339 / 67** y el linter en cero: esta fase no toca la API. Si no da
eso, **es un hallazgo y hay que contarlo**.

⚠️ **El `build` no es opcional.** Ver la advertencia de arriba.

Los e2e de la API son **Jest + supertest** (`apps/api/test/jest-e2e.json`, 13 specs, **218 tests**),
no Playwright: arrancan Nest dentro del proceso, así que **no hay que levantar la API en el host**.
Necesitan `postgres-test`: `docker compose up -d postgres postgres-test redis` o `docker start`
de los tres contenedores. **`docker compose up` pelado está prohibido.**

- [ ] **Step 2: El checklist a mano**

Escribilo al final del bloque del tracker, que no hay navegador en el entorno:

- Entrar como `ADMIN_OPERATIVO` y comprobar que **la caja no está en el marcado** y que **no se pide**
  (pestaña de red).
- Mirar un mes sin turnos y comprobar que la ocupación **no dice 0%**.
- Mirar a un alumno al que nunca se le pasó lista y comprobar que **no dice 0% de asistencia**.
- Pedir 24 meses de turnos libres y comprobar que la pantalla **dice que miró 12**.
- Registrar un pago y comprobar que la caja se mueve (el cache se invalida por escritura; si no se
  mueve, **es un hallazgo**).

- [ ] **Step 3: README y tracker**

Sección «Análisis — Fase 11» en `README.md`, **antes de `## Tests`**. ⚠️ Anclá a una **línea entera** y
a la **última** aparición: `## Tests` es subcadena de un `### Tests` anterior.

Y el bloque de la Fase 11 en `docs/superpowers/plans/PROGRESO.md`, con el formato de los anteriores:
tareas, decisiones, **los errores de este plan que encontraste**, trampas nuevas, estado final y deuda.

**Lo que no puede faltar en el bloque:** por qué dos de los seis reportes no están en Análisis; las
distinciones que los contratos hacen y la pantalla respeta (denominador cero, el denominador de la
asistencia, las dos bases del margen, el estimado que no es deuda, las dos respuestas recortadas); y
**la regla del fixture incoherente**, que es lo más transferible que deja esta fase.

---

## Lo que esta fase NO hace

- **Cualquier cambio en `apps/api`.** Los seis endpoints están hechos.
- **Exportar a CSV o a PDF.** Nadie lo pidió.
- **Rangos comparativos propios** más allá del trimestre que el operativo ya trae.
- **Las pantallas del profesor**, que siguen sin existir.
- **Los tres campos muertos**, que son de negocio y necesitan decidirse.
