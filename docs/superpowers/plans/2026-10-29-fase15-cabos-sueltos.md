# Fase 15 — Cabos sueltos

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans`, tarea por tarea. Los pasos llevan casillas (`- [ ]`).

**Objetivo:** los **tres endpoints de negocio que quedan sin pantalla**. Al cerrar, el cruce da **cero
de negocio sin pantalla**.

**Arquitectura:** una ruta nueva en la API (`GET /mi-liquidacion`, el perfil sale del token); la
vista de la liquidación extraída a un componente compartido entre Análisis y el área de la
profesora; una página `/admin/turnos/nuevo`; y un formulario de edición en el bloque de días fijos.

**Spec:** `docs/superpowers/specs/2026-10-29-fase15-cabos-sueltos.md`

---

## Reglas que gobiernan todo este plan

⚠️ **No hacés commits.** Nunca `git add`, `git commit`, `git push`, `git stash`, `git checkout` ni
`git reset`. `git status`, `git diff` y `git show` sí. Los pasos «Commit» de la plantilla **no
existen** en este plan: los commits los hace Cesar.

⚠️ **Nunca `pnpm lint`.** El script lleva `--fix`. Para formato, `pnpm exec prettier --check` **desde
la raíz del repo** (desde `apps/web` no se encuentra), y `--write` sólo sobre archivos tuyos.
`apps/web` **no tiene eslint**; `apps/api` sí: `pnpm --filter @boxadmin/api exec eslint <archivos>`,
**sin `--fix`**.

⚠️ **Nunca `taskkill` ni `Stop-Process` por NOMBRE de proceso.** Hay una sesión viva de Claude Code en
la máquina. Por PID concreto y sólo los que levantaste vos.

⚠️ **`apps/api` se toca SÓLO en la Task 1, y sólo en lo que esa tarea nombra.** `packages/shared`
**no se toca**. Si otra pantalla parece necesitar un endpoint, **pará y reportalo**.

⚠️ **Nada de strings con barra invertida por heredoc.** Usá la herramienta de edición.

⚠️ El `tsc` lleva **`noUncheckedIndexedAccess`**. **`vitest run "ruta/[id]"` sólo funciona desde
PowerShell**, y el filtro es subcadena.

⚠️ **`docker compose up` pelado está prohibido.** Para los e2e:
`docker compose up -d postgres postgres-test redis`. Si el daemon no responde, Docker Desktop se
apagó solo: `Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe"` y esperá.

⚠️ **El `build` no es opcional.** **Next 15 prohíbe que un `page.tsx` exporte nada que no sea el
`default`**; el error habla de `OmitWithTag` y no se parece a la causa.

**Comandos:**

```bash
pnpm --filter @boxadmin/web exec vitest run <archivo>
pnpm --filter @boxadmin/web exec tsc --noEmit
pnpm --filter @boxadmin/web test
pnpm --filter @boxadmin/web build
pnpm --filter @boxadmin/api exec jest <archivo>
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
pnpm --filter @boxadmin/api test:e2e
```

**Punto de partida (medido al cerrar la Fase 14):** `apps/web` **1882 / 86**; `apps/api` **1339 /
67**; e2e **218 / 13**; `packages/shared` 103 / 4. **Medilo de nuevo antes de empezar** y anotá lo
que dé: si no coincide, el árbol no es el que este plan supone.

⚠️ **Antes de nada: `grep -rn "MUTACION TEMPORAL" apps`.** Tiene que dar cero. Una mutación olvidada
de otra sesión se ve como veinte rojos que parecen un bug.

### Lo que esta fase hereda

`componentes/tabla.tsx`, `componentes/formulario.tsx` (`Campo`), `componentes/ui.tsx` (`Aviso`,
`Boton`), `admin/usuarios/[id]/errores.ts`, `src/test/andamiaje-de-hooks.tsx`,
`src/test/consulta-ajena.ts`, y el barrido `src/hooks/mutaciones-sin-gctime.spec.ts` (**`gcTime: 0`
en toda mutación**).

**El guardián global de consola** (`src/test/espia-de-consola.ts`, llamado desde `vitest.setup.ts`):
**dieciocho canales** más el **vigésimo** (`URL.createObjectURL`, abierto y cerrado en la Fase 14 —
el 18 y el 19 son nombres de ejes, no de canales), dos ejes y el alfabeto de centinelas (base64,
%-codificado, mayúsculas y la forma localizada). Cada spec amplía el registro con
`vigilarEstosDatos({...})`. **El guardián llama a `cleanup()` él mismo**: no lo llames vos en un
`afterEach` antes que él.

⚠️ **Esta fase siembra importes, tarifas y nombres de profesoras en una pantalla nueva que ve una
profesora.** Los centinelas importan tanto como en la Fase 14.

### La mutación abierta

Cada tarea termina con una. La familia es siempre **agregar algo que no debería estar, sin quitar
nada**, marcada con un comentario `// MUTACION TEMPORAL` para poder encontrarla si la sesión se
corta. **Si pasa en verde, o se cierra el agujero —con un test que se vea rojo— o se reporta.**

⚠️ **Cinco están abiertas y reportadas, así que NO valen como hallazgo nuevo**: `navigator.clipboard`;
un contexto de navegación anidado; los atributos de los descendientes del `<body>`; partir el dato en
trozos; y el `.value` que escriba la limpieza de un `useEffect`.

### Las cinco formas de que un test no pueda fallar

1. **Autorreferencial** — comparar la salida contra la misma función que la produce.
2. **Premisa destruida** — el código bajo prueba borra el borde que el test venía a ejercitar.
3. **Montado en el caso ciego** — fijar algo en el único escenario donde la distinción no existe.
4. **Verde por casualidad ortográfica** — `not.toContain('0%')` **pasa sobre un `100%`**.
5. **El fixture habla el idioma del código y no el del contrato** — **incoherente en lo derivado,
   posible en todo lo demás**.

Para afirmar que algo **NO** se dice, **montá dos veces** y compará el resto **por igualdad**. Para
un test de conteo, **sembrá números distintos entre sí**.

---

## Estructura de archivos

```
apps/api/src/liquidacion/
  liquidacion.datos.ts                     TOCAR   perfilDeLaProfesora(actor)
  liquidacion.service.ts                   TOCAR   deLaProfesora(actor, anio, mes)
  liquidacion.service.spec.ts              CREAR
  mi-liquidacion.controller.ts             CREAR   GET /mi-liquidacion
  liquidacion.module.ts                    TOCAR   registrar el controller
apps/api/test/
  profesor.e2e-spec.ts                     TOCAR   tres e2e

apps/web/src/
  lib/mes.ts                               CREAR   (el contenido de analisis/filtros.ts, movido)
  componentes/
    liquidacion-leida.tsx                  CREAR   la vista, extraida
  hooks/
    use-dinero.ts · .spec.tsx              TOCAR   useMiLiquidacion
    use-turnos.ts · .spec.tsx              TOCAR   useCrearTurno
  app/[slug]/
    admin/analisis/
      filtros.ts                           TOCAR   re-exporta lib/mes
      liquidacion.tsx                      TOCAR   usa el componente; conserva el aviso con enlace
    (profesor)/
      layout.tsx · layout.spec.tsx         TOCAR   la navegacion
      navegacion-profesora.tsx · .spec.tsx CREAR
      mi-liquidacion/page.tsx · .spec.tsx  CREAR
    admin/turnos/
      page.tsx · page.spec.tsx             TOCAR   enlace «Nuevo turno»
      nuevo/page.tsx · page.spec.tsx       CREAR
    admin/usuarios/[id]/
      editar-rutina.tsx · .spec.tsx        CREAR
      bloque-dias-fijos.tsx                TOCAR   boton «Editar»
      page.spec.tsx                        TOCAR   el boton abre el formulario
```

---

## Task 1: `GET /mi-liquidacion` en la API

**Files:** ver la estructura, bloque `apps/api`.

- [ ] **Step 1: Verificá el terreno.** Leé `liquidacion.controller.ts`, `liquidacion.service.ts`,
      `liquidacion.datos.ts` y `mis-clases/mis-clases.service.ts` (`perfilDelActor`, línea ~55). El
      patrón a copiar es ese: **el perfil sale de `actor.sub`, nunca de la URL ni del cuerpo**.

⚠️ `LiquidacionDatos.cargar` ya exige que el perfil sea de un usuario con `rol === 'PROFESOR'` y
contesta 404 si no. **No lo dupliques**: la ruta nueva resuelve el `perfilId` del actor y llama a
`delMes` con él, y esa comprobación sigue valiendo.

- [ ] **Step 2: El test unitario, en rojo.** `apps/api/src/liquidacion/liquidacion.service.spec.ts`
      (no existe; seguí el estilo de `calcular-liquidacion.spec.ts` y mockeá `LiquidacionDatos`):

```ts
describe('LiquidacionService.deLaProfesora', () => {
  it('pide la liquidacion del perfil DEL ACTOR', async () => {
    // datos.perfilDeLaProfesora resuelve 'perfil-de-fati' para actor.sub = 'usuario-fati'
    // => datos.cargar se llama con (actor, 'perfil-de-fati', 2099, 9)
  });

  it('un usuario sin perfil recibe 404 y NO se carga nada', async () => {
    // perfilDeLaProfesora lanza NotFoundException => cargar no se llama
  });

  it('valida anio y mes ANTES de buscar el perfil', async () => {
    // mes 13 => BadRequestException, y perfilDeLaProfesora no se llama
  });
});
```

⚠️ **El primer test tiene que distinguir el id del usuario del id del perfil**: usá valores
distintos (`'usuario-fati'` y `'perfil-de-fati'`). Con el mismo valor en los dos, mandar `actor.sub`
como `profesorId` pasaría en verde (forma 5).

- [ ] **Step 3: Implementar.**

En `liquidacion.datos.ts`:

```ts
  /**
   * El perfil de quien pide. Es la puerta de `GET /mi-liquidacion`: el id sale
   * del token y no de la URL, asi que no hay forma de pedir la de otra. Mismo
   * patron que `MisClasesService.perfilDelActor`.
   *
   * Un usuario sin perfil —un admin, que pasa el guard por jerarquia— recibe
   * 404: no tiene liquidacion propia.
   */
  async perfilDeLaProfesora(actor: JwtPayload): Promise<string> {
    const perfil = await this.prisma.db.perfil.findFirst({
      where: { usuarioId: actor.sub },
      select: { id: true },
    });
    if (!perfil) {
      throw new NotFoundException('Este usuario no tiene perfil de profesora.');
    }
    return perfil.id;
  }
```

En `liquidacion.service.ts`, sacá la validación de `anio`/`mes` a un método privado
`exigirMesValido(anio, mes)` que llamen los dos, y agregá:

```ts
  async deLaProfesora(
    actor: JwtPayload,
    anio: number,
    mes: number,
  ): Promise<LiquidacionProfesor> {
    this.exigirMesValido(anio, mes);
    const perfilId = await this.datos.perfilDeLaProfesora(actor);
    return calcularLiquidacion(await this.datos.cargar(actor, perfilId, anio, mes));
  }
```

`apps/api/src/liquidacion/mi-liquidacion.controller.ts`:

```ts
import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import type { JwtPayload, LiquidacionProfesor } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { LiquidacionService } from './liquidacion.service';

/**
 * La liquidacion vista por la propia profesora.
 *
 * Un controller aparte y no una ruta mas en `LiquidacionController`: aquel es
 * ADMIN_SALON porque «ensena tarifas» de cualquiera, y este es PROFESOR y
 * ensena SOLO las suyas. Sin id en la ruta: el perfil sale del token.
 */
@Controller('mi-liquidacion')
export class MiLiquidacionController {
  constructor(private readonly liquidacion: LiquidacionService) {}

  @Roles('PROFESOR')
  @Get()
  delMes(
    @CurrentUser() actor: JwtPayload,
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number,
  ): Promise<LiquidacionProfesor> {
    return this.liquidacion.deLaProfesora(actor, anio, mes);
  }
}
```

Y registralo en `controllers` de `liquidacion.module.ts`. **Un archivo, un `@Controller`**: el cruce
de cierre ya se tropezó dos veces con archivos que tenían varios.

- [ ] **Step 4: Unitarias en verde**, y la suite entera de la API: **1339 + 3**.

- [ ] **Step 5: Los e2e, en `test/profesor.e2e-spec.ts`**, junto a «la liquidacion la ve
      ADMIN_SALON, no un profesor» (línea ~603). Usan el `montar` y el `darHorario` que ya hay:

```ts
it('la profesora ve SU liquidacion, sin id en la ruta', async () => {
  const e = await montar('p15-mi-liquidacion');
  await darHorario(e, e.fati.perfilId);
  await darRutinaYPublicar(e);

  const propia = await request(servidor)
    .get('/mi-liquidacion')
    .query({ anio: ANIO, mes: MES })
    .set(auth(e.fati.token))
    .expect(200);

  // La MISMA que ve el admin, campo por campo: la ruta nueva no recalcula.
  const delAdmin = await request(servidor)
    .get(`/liquidacion/${e.fati.perfilId}`)
    .query({ anio: ANIO, mes: MES })
    .set(auth(e.gym.adminToken))
    .expect(200);

  expect(propia.body).toEqual(delAdmin.body);
  expect(propia.body.profesorNombre).toBe('Fati Gomez');
});

it('con el token de Ana sale la de Ana, aunque se le cuelgue un id', async () => {
  // Ana NO tiene horario: su liquidacion son ceros. Fati si.
  // GET /mi-liquidacion/<perfil de fati> con el token de Ana => 404 (la ruta no existe)
  // GET /mi-liquidacion?profesorId=<perfil de fati> con el token de Ana => 200 y
  //   minutosContratados === 0 y profesorNombre === 'Ana Ruiz'
});

it('un alumno recibe 403, y un admin no tiene liquidacion propia', async () => {
  // token del alumno => 403
  // token del admin (gym.adminToken) => MEDILO: el spec espera 404 por no tener perfil
});
```

⚠️ **Lo del admin, medilo.** El spec dice 404 porque el admin pasa el guard por jerarquía (40 ≥ 20) y
no tiene perfil. **Si `crearGimnasio` le da perfil al admin**, la respuesta será otra (el 404 de
`cargar` por rol, que dice «No hay ninguna profesora con ese id»): en ese caso **también es 404**,
pero escribí en el test cuál de los dos es y por qué. Si sale **cualquier cosa que no sea 404**,
**pará y reportalo**.

⚠️ El escenario necesita el token del alumno: `crearAlumnoPorInvitacion` devuelve `token`, pero el
`Escenario` de este archivo sólo guarda `alumnoPerfilId`. **Agregá `alumnoToken`** al `Escenario` y
al `montar`, sin tocar los tests que ya lo usan.

- [ ] **Step 6: Verificar:** `tsc`, eslint sobre los archivos tocados, `test`, `test:e2e` (**218 +
      3**).

- [ ] **Step 7: Mutaciones.**

| Mutación                                                     | Debe caer                                  |
| ------------------------------------------------------------ | ------------------------------------------ |
| `deLaProfesora` manda `actor.sub` como `profesorId`          | «pide la liquidacion del perfil DEL ACTOR» |
| La validación de mes va después de buscar el perfil          | «valida anio y mes ANTES»                  |
| `@Roles('ALUMNO')` en vez de `PROFESOR`                      | el e2e del alumno                          |
| El controller lee `@Query('profesorId')` y, si viene, lo usa | «con el token de Ana sale la de Ana»       |

- [ ] **Step 8: La mutación abierta.** Sugerencia de eje: algo que la ruta **agregue** a la
      respuesta sin quitar nada (el `usuarioId`, el email) — ¿lo atrapa el `toEqual` contra la del
      admin? Si la del admin también lo trae, no: pensá qué test lo vería.

---

## Task 2: Extraer la vista de la liquidación

**Objetivo:** el área de la profesora va a pintar lo mismo que Análisis menos el enlace a Horarios.
**Nada de lo que ve el admin puede cambiar: los 25 tests de `liquidacion.spec.tsx` pasan SIN
TOCARLOS.**

- [ ] **Step 1: Mover los meses a `lib`.** El área de la profesora no puede importar de
      `app/[slug]/admin/...` (hoy ningún archivo cruza áreas así, y no vamos a estrenar la
      costumbre). Creá `apps/web/src/lib/mes.ts` con **el contenido entero** de
      `admin/analisis/filtros.ts` —docblocks incluidos— y dejá `filtros.ts` así:

```ts
/**
 * Los meses viven en `@/lib/mes` desde la Fase 15, cuando el area de la
 * profesora tambien los necesito. Esto queda para que Analisis siga
 * importando de `./filtros` sin tocar sus pantallas.
 */
export * from '@/lib/mes';
```

Corré la suite de `analisis`: **tiene que dar exactamente lo mismo que antes**.

- [ ] **Step 2: Crear `apps/web/src/componentes/liquidacion-leida.tsx`** (`'use client'`) y mover
      ahí, **sin cambiarles una línea**: `Situacion`, `situacionDe`, `TEXTO_DE_LA_SITUACION`,
      `TextoDeLaSituacion`, `TarifaDeLaFranja`, `COLUMNAS_DE_LAS_FRANJAS`, `claveDeLaFranja`,
      `CifraDeLiquidacion`, `Horas` y `LiquidacionLeida`. `textoDelMes` se importa de `@/lib/mes`.

**El único cambio es la firma de `LiquidacionLeida`**: deja de recibir `slug` y recibe el aviso como
una función.

```tsx
export function LiquidacionLeida({
  liquidacion,
  avisoSinTarifa,
}: {
  liquidacion: LiquidacionProfesor;
  /**
   * Lo que se dice cuando hay minutos sin tarifa. Es LA UNICA diferencia
   * entre el admin —que puede ir a configurarla— y la profesora —que no—.
   * Se llama solo con minutos > 0: la condicion es de aqui y no de quien
   * llama, para que ninguna de las dos pantallas pueda olvidarla.
   */
  avisoSinTarifa: (minutos: number) => ReactNode;
}) {
```

y dentro de la cifra `aPagar`:

```tsx
{
  importes.minutosSinTarifa > 0 && avisoSinTarifa(importes.minutosSinTarifa);
}
```

En `admin/analisis/liquidacion.tsx` **se queda** `AvisoSinTarifa` (con su enlace) y la llamada pasa
a ser:

```tsx
<LiquidacionLeida
  liquidacion={liquidacion}
  avisoSinTarifa={(minutos) => <AvisoSinTarifa minutos={minutos} slug={slug} />}
/>
```

- [ ] **Step 3: Verificar.** `liquidacion.spec.tsx` **25 de 25 sin tocar el archivo** (comprobalo con
      `git diff --stat` sobre él: cero líneas), `page.spec.tsx` de Análisis igual, `tsc`, `build`.

- [ ] **Step 4: Mutaciones.**

| Mutación                                                       | Debe caer                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| La condición `> 0` se mueve a quien llama y se olvida en admin | el test de «sin minutos sin tarifa no hay aviso» del spec de liquidación |
| `LiquidacionLeida` pinta un aviso propio además del recibido   | el que fija el texto exacto del aviso                                    |

Si alguna **no cae**, el hueco es del spec viejo: cerralo **ahí**, con un test que se vea rojo.

- [ ] **Step 5: La mutación abierta.** Es una extracción: el eje natural es algo que **el componente
      compartido** agregue y que sólo se vea desde una de las dos pantallas.

---

## Task 3: La profesora ve su liquidación

**Files:** `hooks/use-dinero.ts · .spec.tsx`; `(profesor)/navegacion-profesora.tsx · .spec.tsx`;
`(profesor)/layout.tsx · layout.spec.tsx`; `(profesor)/mi-liquidacion/page.tsx · page.spec.tsx`.

- [ ] **Step 1: El hook, test primero.** En `use-dinero.spec.tsx`:

```tsx
it('mi liquidacion pide /mi-liquidacion con el mes y SIN id', async () => {
  // espera la ruta exacta '/api/bx/mi-liquidacion?anio=2026&mes=10'
});
it('mi liquidacion de dos meses tiene claves distintas, y distintas de la del admin', () => {
  // clavesDeDinero.miLiquidacion({2026,10}) !== ...({2026,11})
  // y ninguna empieza por 'liquidacion': invalidar la del admin no la toca
});
```

Implementación en `use-dinero.ts`, junto a `useLiquidacion`:

```ts
  miLiquidacion: (m: Mes) => ['mi-liquidacion', m.anio, m.mes] as const,
```

```ts
/**
 * La liquidacion de quien mira. **PROFESOR**: el perfil sale del token, asi
 * que aqui no viaja id ninguno —ni hay nada que codificar, a diferencia de
 * `useLiquidacion`—.
 */
export function useMiLiquidacion(m: Mes) {
  return useQuery({
    queryKey: clavesDeDinero.miLiquidacion(m),
    queryFn: () => pedir<LiquidacionProfesor>(`/mi-liquidacion${queryDeLiquidacion(m)}`),
  });
}
```

- [ ] **Step 2: La navegación.** `(profesor)/navegacion-profesora.tsx` copia **la forma** de
      `componentes/navegacion.tsx` (barra inferior fija, `aria-current="page"` en la activa) con dos
      secciones:

```tsx
const SECCIONES = [
  { ruta: 'mis-clases', texto: 'Mis clases' },
  { ruta: 'mi-liquidacion', texto: 'Mi liquidación' },
] as const;
```

⚠️ **`mis-clases/[turnoId]` cuenta como «Mis clases»**: la activa se decide con `startsWith` del
`href` más `/`, o igualdad, **no** con igualdad sola. El alumno usa igualdad porque no tiene
subrutas; la profesora sí. Test: «dentro de una clase, la activa sigue siendo Mis clases».

En `layout.tsx`, en la rama de la profesora:

```tsx
<div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-slate-50">
  <main className="flex-1 p-4 pb-20">{children}</main>
  <NavegacionProfesora slug={slug} />
</div>
```

⚠️ **`layout.spec.tsx` afirma que `main` envuelve la página «y NADA MAS»** (línea ~366). La barra va
**fuera** del `<main>`, así que ese test tiene que seguir verde sin tocarlo. Mockeá la navegación
como hace `(alumno)/layout.spec.tsx` (línea ~49) y agregá un test: «a la profesora se le da la
navegación; a quien no es profesora, no».

- [ ] **Step 3: La página, test primero.** `(profesor)/mi-liquidacion/page.spec.tsx`. Fixture
      **incoherente en lo derivado**, como en `liquidacion.spec.tsx`: `aPagar` que no sea la suma, horas
      que no salgan de los minutos. `vigilarEstosDatos` con nombre, importes y tarifa.

```tsx
it('pide /mi-liquidacion del mes de la URL', () => {});
it('sin mes en la URL pide el de hoy', () => {});
it('pinta lo que manda el servidor, por igualdad exacta', () => {
  // data-cifra / data-importe / data-horas, como en el spec del admin
});
it('con minutos sin tarifa dice que avise a la administracion, SIN enlace', () => {
  // texto exacto del aviso y queryByRole('link') dentro de [data-sin-tarifa] === null
});
it('lo unico que cambia contra el admin es el aviso', () => {
  // MONTAR DOS VECES: la vista compartida con el aviso del admin y la pagina de la
  // profesora, quitar [data-sin-tarifa] de los dos y comparar innerHTML por igualdad.
});
it('cambiar el mes navega con anio y mes, y conserva lo demas de la URL', () => {});
it('un 401 manda al login conservando la pagina', () => {
  // destinoDeLoginDesde, igual que mis-clases
});
it('un error que no es 401 se dice, con reintentar', () => {});
```

Implementación:

- `page.tsx` exporta **sólo** el `default`. El mes sale de `mesDeLaBusqueda` (`@/lib/mes`); el
  selector es **el mismo que el de Análisis** (`mesesOfrecidos`, `valorDelMes`, `mesDelValor`,
  `textoDelMes`), con `id="mi-liquidacion-mes"` y el formulario con `aria-label="Filtros"`.
  ⚠️ El spec decía «mes anterior y siguiente»; se usa el selector de Análisis porque ya existe,
  ya está probado y ofrece los últimos doce meses. Es la misma decisión con menos código.
- `useSearchParams` obliga a una frontera de `Suspense`, como en `mis-clases/page.tsx`.
- El aviso de la profesora:

```tsx
function AvisoSinTarifaParaLaProfesora({ minutos }: { minutos: number }) {
  return (
    <p data-sin-tarifa className="text-xs font-semibold text-red-700">
      {`${minutos} minutos de este mes no tienen tarifa, así que estos importes están incompletos. Avisale a la administración.`}
    </p>
  );
}
```

- 401 → `router.push(destinoDeLoginDesde(ruta, parametros.toString(), slug))`, copiando
  `mis-clases/page.tsx` (línea ~431).

- [ ] **Step 4: Verificar.** Suite web, `tsc`, `build`.

- [ ] **Step 5: Mutaciones.**

| Mutación                                                          | Debe caer                            |
| ----------------------------------------------------------------- | ------------------------------------ |
| El aviso de la profesora lleva el enlace a Horarios               | «SIN enlace»                         |
| La página suma `aPagar` de las franjas                            | «por igualdad exacta»                |
| `useMiLiquidacion` usa la clave de `liquidacion`                  | «claves distintas»                   |
| La navegación marca activa por igualdad                           | «dentro de una clase…»               |
| La página pinta el `profesorNombre` en un `title` además del `h2` | «lo único que cambia» (dos montajes) |

- [ ] **Step 6: La mutación abierta.**

---

## Task 4: Crear un turno a mano

**Files:** `hooks/use-turnos.ts · .spec.tsx`; `admin/turnos/page.tsx · page.spec.tsx`;
`admin/turnos/nuevo/page.tsx · page.spec.tsx`.

- [ ] **Step 1: Verificá el contrato.** `apps/api/src/turnos/dto/crear-turno.dto.ts` y
      `TurnosService.crear`. `POST /turnos`, `@Roles('ADMIN_OPERATIVO')`, devuelve `TurnoPublico`.
      **El panel entero ya exige `ADMIN_OPERATIVO`** (`admin/layout.tsx`, línea ~50), así que el
      enlace no necesita una puerta propia.

- [ ] **Step 2: El hook, test primero.**

```tsx
it('crear un turno hace POST /turnos con el cuerpo tal cual', () => {});
it('sin profesora elegida, profesorId NO viaja (ni null, ni vacio)', () => {
  // el servicio distingue «ausente» (resolver del patron) de «presente»
});
it('crear invalida los listados de turnos y nada mas', () => {
  // consulta-ajena.ts: una consulta de otro recurso no se toca
});
```

```ts
export interface TurnoACrear {
  salaId: string;
  nombre: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  cupo: number;
  /** `perfilId`. Ausente = la del horario semanal. */
  profesorId?: string;
}

export function useCrearTurno() {
  const cliente = useQueryClient();

  return useMutation<TurnoPublico, ErrorDeApi, TurnoACrear>({
    mutationFn: (datos) => pedir<TurnoPublico>('/turnos', { metodo: 'POST', cuerpo: datos }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['turnos'] }),
    gcTime: 0,
  });
}
```

- [ ] **Step 3: La página, test primero.** `admin/turnos/nuevo/page.spec.tsx`. El molde es
      `admin/usuarios/nuevo/page.tsx` (`react-hook-form` + `zod` + `Campo`).

```tsx
it('ofrece SOLO las salas activas', () => {});
it('ofrece las profesoras activas por perfilId, y arranca en «La del horario semanal»', () => {
  // fixture con usuario.id !== perfilId (forma 5)
});
it('enviar sin elegir profesora no manda profesorId', () => {});
it('enviar con profesora manda SU perfilId, no su id de usuario', () => {});
it('el cupo viaja como numero', () => {});
it('fin antes que inicio no se envia, y se dice', () => {});
it('al crear navega al detalle del turno NUEVO', () => {
  // con el id que devuelve la API, no uno inventado
});
it('el error de la API se muestra tal cual', () => {
  // p. ej. 400 'No se pueden crear turnos en una sala dada de baja'
});
it('mientras se envia, el boton esta deshabilitado', () => {});
```

Implementación:

- Profesoras: `useUsuarios({ tipo: 'profesor' })`, sólo `activo`, `value={profesora.perfilId}`
  (mismo criterio que `turnos/[id]/bloque-profesora.tsx`, línea ~92 y ~114). La opción vacía dice
  **«La del horario semanal»** y su valor es `''`; al armar el cuerpo, **`''` no viaja**.
- La validación de horas copia la de `bloque-dias-fijos.tsx` (`comparaHoras`, `PATRON_HORA`).
- `cupo`: `z.coerce.number().int().min(1)`.
- `page.tsx` exporta **sólo** el `default`.

En `admin/turnos/page.tsx`, junto al `h1`, un `Link` «Nuevo turno» a `/${slug}/admin/turnos/nuevo`,
con su test en `page.spec.tsx`.

- [ ] **Step 4: Verificar**, **Step 5: mutaciones.**

| Mutación                                    | Debe caer                    |
| ------------------------------------------- | ---------------------------- |
| `profesorId: ''` viaja cuando no se elige   | «no manda profesorId»        |
| La opción lleva `usuario.id`                | «SU perfilId»                |
| Se ofrecen salas de baja                    | «SOLO las salas activas»     |
| Navega a `/admin/turnos` en vez del detalle | «al detalle del turno NUEVO» |
| `invalidateQueries()` pelado                | «y nada mas»                 |

- [ ] **Step 6: La mutación abierta.**

---

## Task 5: Editar una rutina

**Files:** `admin/usuarios/[id]/editar-rutina.tsx · .spec.tsx`; `bloque-dias-fijos.tsx`;
`admin/usuarios/[id]/page.spec.tsx`.

⚠️ **`bloque-dias-fijos.tsx` ya tiene 268 líneas** y no tiene spec propio (lo cubre `page.spec.tsx`
de la ficha). El formulario de edición va **en su archivo**, con su spec.

- [ ] **Step 1: Verificá el contrato.** `ActualizarRutinaDto` y `RutinasService.actualizar`. Lo que
      tenés que saber:
  - campos: `nombre`, `diaSemana`, `horaInicio`, `horaFin`, `desde`, `hasta`, `activa`. **No
    `salaId`.**
  - el servicio valida con lo que viene **y lo existente** (horas y vigencia).
  - ⚠️ **`hasta` no se puede borrar**: `dto.hasta ? ... : undefined` deja la fecha vieja. Una rutina
    con fin **no vuelve a ser indefinida** por este endpoint.
  - el hook `useActualizarRutina(perfilId)` y su tipo `CambiosDeRutina` ya existen.

- [ ] **Step 2: Tests primero.** `editar-rutina.spec.tsx`:

```tsx
it('arranca con los valores de la rutina', () => {});
it('manda SOLO lo que cambio', () => {
  // cambiar solo la hora de fin => cuerpo === { horaFin: '20:00' }, por igualdad
});
it('sin cambios no manda nada, y lo dice', () => {});
it('el dia viaja como numero', () => {});
it('no ofrece cambiar la sala', () => {});
it('dice que el cambio rige para los meses que se publiquen de ahora en adelante', () => {
  // texto EXACTO del aviso, presente ANTES de enviar: es para decidir, no para enterarse
});
it('vaciar el fin de una rutina que lo tenia no se envia, y explica por que', () => {
  // «Para que no tenga fin, hay que darla de baja y crear otra.»
});
it('fin antes que inicio no se envia', () => {});
it('el error de la API se muestra tal cual', () => {});
it('al guardar se cierra y avisa', () => {});
```

Aviso fijo, texto exacto:

```
El cambio rige para los meses que se publiquen de ahora en adelante. Las reservas ya generadas no se mueven.
```

- [ ] **Step 3: Implementar.** `EditarRutina({ rutina, perfilId, alTerminar })`. Cada rutina activa del
      bloque gana un botón «Editar» con `aria-label={`Editar el ${descripcionDe(rutina)}`}` (simétrico
      al de «Dar de baja»), que abre el formulario en línea debajo de esa rutina. **Una sola a la vez.**

El diff:

```ts
/** Lo que cambio, y nada mas. Un PATCH con todo seria pisar a quien edito en paralelo. */
function cambiosEntre(rutina: RutinaPublica, datos: DatosDeLaEdicion): CambiosDeRutina {
  const cambios: CambiosDeRutina = {};
  if (datos.nombre !== rutina.nombre) cambios.nombre = datos.nombre;
  const dia = Number(datos.diaSemana) as RutinaPublica['diaSemana'];
  if (dia !== rutina.diaSemana) cambios.diaSemana = dia;
  if (datos.horaInicio !== rutina.horaInicio) cambios.horaInicio = datos.horaInicio;
  if (datos.horaFin !== rutina.horaFin) cambios.horaFin = datos.horaFin;
  if (datos.desde !== rutina.desde) cambios.desde = datos.desde;
  if (datos.hasta !== '' && datos.hasta !== rutina.hasta) cambios.hasta = datos.hasta;
  return cambios;
}
```

`DiaSemana` es `0 | 1 | 2 | 3 | 4 | 5 | 6` (`packages/shared/src/recurrencia.contracts.ts:2`): el
`as` está bien porque el `<select>` sólo ofrece esos valores.

En `page.spec.tsx` de la ficha, **un** test de cableado: «el botón Editar abre el formulario de ESA
rutina» (dos rutinas en el fixture; se abre la segunda y se ve su horario, no el de la primera).

- [ ] **Step 4: Verificar**, **Step 5: mutaciones.**

| Mutación                                   | Debe caer                  |
| ------------------------------------------ | -------------------------- |
| Se manda la rutina entera                  | «SOLO lo que cambio»       |
| El día viaja como cadena                   | «el dia viaja como numero» |
| `hasta: ''` viaja                          | «vaciar el fin…»           |
| El aviso aparece recién después de guardar | «presente ANTES de enviar» |
| El botón de la primera abre la segunda     | el test de cableado        |

- [ ] **Step 6: La mutación abierta.**

---

## Task 6: Verificación final, cruce, README y tracker

- [ ] **Step 1: `grep -rn "MUTACION TEMPORAL" apps` da cero.**

- [ ] **Step 2: Todo, medido:** web (`test`, `tsc`, `build`), api (`test`, `tsc`, eslint sobre lo
      tocado), e2e, `prettier --check` sobre cada archivo tocado o creado. Anotá los números.

- [ ] **Step 3: El cruce de endpoints, rehecho.** Deben salir **104 rutas** (103 + `/mi-liquidacion`).
      Una ruta cuenta como consumida **sólo si el hook que la pide lo monta alguna pantalla**: un
      literal en un hook que nadie usa no es una pantalla — así se escaparon las tres de esta fase.
      ⚠️ Las trampas conocidas: **un archivo puede tener varios `@Controller`**, **muchas rutas se
      arman en un helper**, y **un `@Patch(':id')` dentro de un comentario** (`turnos.controller.ts`,
      línea ~50) **no es una ruta**. Resultado esperado: **las seis por diseño y cero de negocio**.
      Si queda alguna, **reportala**: no se arregla en el cierre.

- [ ] **Step 4: README.** Sección «Cabos sueltos — Fase 15» antes de `## Tests`: las tres pantallas,
      la ruta nueva y por qué no lleva id, y lo que **no** hace editar una rutina.

- [ ] **Step 5: `docs/superpowers/plans/PROGRESO.md`.** Bloque «# Progreso Fase 15 — Cabos sueltos»
      **al final, sólo agregando**: tareas, números por tarea, mutaciones (las de tabla y las
      abiertas, con lo que se cerró), el cruce, trampas nuevas y el checklist a mano:

  - [ ] Entrar como profesora: la barra muestra «Mis clases» y «Mi liquidación», y dentro de una
        clase sigue marcada «Mis clases».
  - [ ] «Mi liquidación» muestra lo mismo que el admin ve de ella en Análisis, mismo mes.
  - [ ] Con un horario sin tarifa: la profesora ve el aviso **sin** enlace; el admin, **con**.
  - [ ] Crear un turno sin elegir profesora en una franja con horario: queda con la del horario.
  - [ ] Crear un turno en una sala de baja: no se ofrece. Con una profesora sin acceso a la sala: el
        error de la API se ve.
  - [ ] Editar el horario de un día fijo con el mes ya publicado: las reservas de ese mes **no** se
        mueven; las del mes siguiente, al publicarlo, salen en el horario nuevo.

---

## Lo que esta fase NO hace

- **Mover las reservas ya generadas cuando se edita una rutina.** Lógica nueva en la API; fase propia.
- **Volver indefinida una rutina con fin.** El endpoint no lo permite; la pantalla lo explica.
- Cambiar la sala de una rutina.
- Tocar `GET /liquidacion/:profesorId` o `packages/shared`.
- La deuda `Importe` contra cadena pelada.
