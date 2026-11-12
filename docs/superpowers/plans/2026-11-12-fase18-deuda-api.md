# Fase 18 — Deuda de la API

> **Para quien ejecute esto:** SUB-SKILL OBLIGATORIA: usar `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans`, tarea por tarea. Los pasos llevan casillas (`- [ ]`).

**Objetivo:** que la API recorte los textos libres que recibe y que la búsqueda del perfil de quien
llama exista una sola vez. Ninguna función nueva; ningún contrato cambia.

**Arquitectura:** un decorador `@Recortado()` (un `@Transform` de class-transformer) sobre 23 campos
de 21 DTO, que el `ValidationPipe` global (`transform: true`) aplica antes de validar; y una función
`idDelPerfilDelActor(cliente, actor, siNoTiene)` en `common/` que 7 servicios llaman con su propio
mensaje de 404.

**Spec:** `docs/superpowers/specs/2026-11-12-fase18-deuda-api.md`

---

## Reglas que gobiernan todo este plan

⚠️ **No hacés commits.** Nunca `git add`, `git commit`, `git push`, `git stash`, `git checkout`,
`git reset` **ni `git mv`**. `git status`, `git diff` y `git show` sí. Los commits los hace Cesar.

⚠️ **Nunca `pnpm lint`** (en `apps/api` el script lleva `--fix`). Si querés eslint, sin `--fix`:
`pnpm --filter @boxadmin/api exec eslint <archivos>`.

⚠️ **Prettier en `apps/api/src`:** esa carpeta **nunca pasó `prettier --check` entera** (hay un commit de
formato pendiente que hará Cesar). Corré `node D:/Dev/box-admin/node_modules/prettier/bin/prettier.cjs
--check` **sólo sobre los archivos que tocás**. Si uno ya fallaba en `HEAD` (comprobalo con
`git show HEAD:<ruta> | node …/prettier.cjs --stdin-filepath <ruta> --check`), **no lo reformatees
entero**: dejalo como está y anotalo en el reporte. Los archivos **nuevos** sí tienen que pasar.

⚠️ **Nunca `taskkill` ni `Stop-Process` por NOMBRE de proceso.** Hay una sesión viva de Claude Code en
la máquina. Por PID concreto y sólo los que levantaste vos.

⚠️ **`docker compose up` pelado está prohibido.** Para los e2e: `docker compose up -d postgres
postgres-test redis` desde la raíz. No los bajes al terminar.

⚠️ **Sólo `apps/api`.** `apps/web` y `packages/shared` **no se tocan**. Si algo parece necesitarlo,
**pará y reportalo**.

⚠️ **Nada de strings con barra invertida por heredoc.** Usá la herramienta de edición. **No uses
`sed -i` sobre archivos CRLF** (quita los CR); respetá el fin de línea de cada archivo.

⚠️ **Los mensajes de 404 y los textos de validación no cambian ni una letra**: hay specs y e2e que los
comparan.

**Comandos** (desde la raíz):

```bash
pnpm --filter @boxadmin/api exec jest <ruta-o-patron>
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
pnpm --filter @boxadmin/api test:e2e
```

**Punto de partida (medido al cerrar la Fase 15; las fases 16 y 17 no tocaron la API):**
api **1343 / 68**, e2e **221 / 13**. **Medilo de nuevo antes de empezar** y anotá lo que dé.

⚠️ **Antes de nada: `grep -rn "MUTACION TEMPORAL" apps`.** Tiene que dar cero.

### La mutación abierta

Cada tarea termina con una: **cambiar algo que no debería cambiar**, marcado `// MUTACION TEMPORAL`.
Correr la suite de la tarea. **Si pasa en verde, o se cierra el agujero —con un test que se vea rojo— o
se reporta.** Después, quitarla y volver a verde.

### Las cinco formas de que un test no pueda fallar

1. **Autorreferencial** — comparar la salida contra la misma función que la produce.
2. **Premisa destruida** — el código bajo prueba borra el borde que el test venía a ejercitar.
3. **Montado en el caso ciego** — fijar algo en el único escenario donde la distinción no existe (p. ej.
   probar el recorte con un texto que no tiene espacios).
4. **Verde por casualidad ortográfica** — un `toContain` que pasa con texto de más.
5. **El fixture habla el idioma del código y no el del contrato.**

---

## Estructura de archivos

```
apps/api/src/
  common/
    decorators/recortado.decorator.ts          CREAR   (T1)
    decorators/recortado.decorator.spec.ts     CREAR   (T1)
    decorators/recortado-en-los-dto.spec.ts    CREAR   los 23 campos contra el pipe real (T1)
    perfil-del-actor.ts · .spec.ts             CREAR   (T2)
  … 21 DTO (tabla de la T1)                    TOCAR   @Recortado() (T1)
  checkin/checkin.service.ts                   TOCAR   (T2)
  comprobantes/comprobantes.service.ts         TOCAR   (T2)
  liquidacion/liquidacion.datos.ts             TOCAR   (T2)
  lista-espera/lista-espera.service.ts         TOCAR   (T2)
  mi-calendario/mi-calendario.service.ts       TOCAR   (T2)
  mi-calendario/mi-pack.service.ts             TOCAR   sólo un comentario (T2)
  mis-clases/mis-clases.service.ts             TOCAR   (T2)
  push/push.service.ts                         TOCAR   (T2)
apps/api/test/nucleo.e2e-spec.ts               TOCAR   un e2e (T1)
README.md · docs/superpowers/plans/PROGRESO.md TOCAR   (T3)
```

---

## Task 1: `@Recortado()` en los textos libres

**Files:**

- Create: `apps/api/src/common/decorators/recortado.decorator.ts`
- Create: `apps/api/src/common/decorators/recortado.decorator.spec.ts`
- Create: `apps/api/src/common/decorators/recortado-en-los-dto.spec.ts`
- Modify: los 21 DTO de la tabla del Step 5
- Modify: `apps/api/test/nucleo.e2e-spec.ts` (describe `'checklist 1: crear y configurar una sala'`, ~89)

- [ ] **Step 1: Medir el punto de partida**

```bash
grep -rn "MUTACION TEMPORAL" apps
pnpm --filter @boxadmin/api test
docker compose up -d postgres postgres-test redis
pnpm --filter @boxadmin/api test:e2e
```

Esperado: grep vacío; **1343 / 68** y **221 / 13** en verde. Anotá lo que dé.

- [ ] **Step 2: El spec del decorador (rojo)**

`apps/api/src/common/decorators/recortado.decorator.spec.ts`:

```ts
import { plainToInstance } from 'class-transformer';
import { Recortado } from './recortado.decorator';

class ConUnTexto {
  @Recortado()
  texto?: unknown;
}

function recortar(texto: unknown): unknown {
  return plainToInstance(ConUnTexto, { texto }).texto;
}

describe('Recortado', () => {
  it('saca los espacios de los dos bordes, y SOLO de los bordes', () => {
    expect(recortar('  Box 2  ')).toBe('Box 2');
  });

  it('tambien tabs y saltos de linea, que un pegado trae', () => {
    expect(recortar('\tFuncional\n')).toBe('Funcional');
  });

  it('solo espacios queda vacio: el @IsNotEmpty de al lado lo rechaza', () => {
    expect(recortar('   ')).toBe('');
  });

  /**
   * LO QUE NO ES TEXTO PASA TAL CUAL. Un `123` tiene que seguir llegando a
   * `@IsString()` como numero para que de su 400; convertirlo, o tirarlo,
   * cambiaria el error que ve quien llama.
   */
  it.each([
    ['un numero', 123],
    ['null', null],
    ['undefined', undefined],
    ['un objeto', { a: 1 }],
  ])('%s no se toca', (_caso, valor) => {
    expect(recortar(valor)).toEqual(valor);
  });
});
```

⚠️ El `'\tFuncional\n'` del test lleva barras invertidas: escribí el archivo con la herramienta de
escritura, **no por heredoc**.

Run: `pnpm --filter @boxadmin/api exec jest src/common/decorators/recortado.decorator.spec.ts`
Esperado: FAIL (no existe el módulo).

- [ ] **Step 3: El decorador (verde)**

`apps/api/src/common/decorators/recortado.decorator.ts`:

```ts
import { Transform } from 'class-transformer';

/**
 * RECORTA LOS ESPACIOS DE LOS BORDES de un texto libre antes de validarlo.
 *
 * Corre dentro del `ValidationPipe` global (`transform: true`, en `main.ts` y
 * en `test/helpers.ts`): class-transformer arma el DTO —y aplica esto— ANTES de
 * que class-validator lo mire. Por eso un nombre de solo espacios llega vacio
 * y el `@IsNotEmpty()` de al lado da el mismo 400 que a un nombre vacio.
 *
 * Solo para texto que alguien escribe y otro lee: nombres, notas, motivos. No
 * para claves, emails, ids, fechas ni el HTML de una plantilla, donde un
 * espacio puede ser parte del dato.
 *
 * Lo que no es un string pasa tal cual, para que su validador de tipo siga
 * dando el error de siempre.
 */
export function Recortado(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );
}
```

Run el mismo comando. Esperado: PASS.

- [ ] **Step 4: Los 23 campos contra el pipe real (rojo)**

`apps/api/src/common/decorators/recortado-en-los-dto.spec.ts`. Las opciones del pipe son **las de
`main.ts`** (comprobalo: `whitelist`, `forbidNonWhitelisted`, `transform`).

```ts
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateTenantDto } from '../../auth/dto/create-tenant.dto';
import { CrearSalaDto } from '../../salas/dto/crear-sala.dto';
// … un import por cada DTO de la tabla del Step 5

/**
 * LOS 23 CAMPOS DE TEXTO LIBRE CONTRA EL PIPE DE VERDAD.
 *
 * Un `@Recortado()` olvidado en un DTO no rompe nada que se vea: el nombre
 * se guarda con sus espacios y despues no se encuentra al buscarlo. Por eso
 * hay una fila por campo y no una muestra.
 *
 * Las opciones estan copiadas de `app.useGlobalPipes(...)` en
 * `apps/api/src/main.ts`.
 */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

async function porElPipe(metatype: new () => object, cuerpo: Record<string, unknown>) {
  return (await pipe.transform(cuerpo, { type: 'body', metatype })) as Record<string, unknown>;
}

interface Campo {
  dto: new () => object;
  campo: string;
  /** Un cuerpo VALIDO sin el campo, para que el unico motivo de un 400 sea el campo. */
  base: Record<string, unknown>;
  /** Lleva `@IsNotEmpty()` (o equivalente): solo espacios tiene que dar 400. */
  obligatorio: boolean;
}

const CAMPOS: Campo[] = [
  { dto: CreateTenantDto, campo: 'nombre', base: {/* … */}, obligatorio: true },
  { dto: CrearSalaDto, campo: 'nombre', base: {}, obligatorio: true },
  // … una fila por campo de la tabla del Step 5: 23 filas
];

describe('@Recortado en los DTO', () => {
  it('son los 23 campos de la tabla, ni uno menos', () => {
    expect(CAMPOS).toHaveLength(23);
  });

  describe.each(CAMPOS.map((c) => [`${c.dto.name}.${c.campo}`, c] as const))('%s', (_nombre, c) => {
    it('llega sin los espacios de los bordes', async () => {
      const dto = await porElPipe(c.dto, { ...c.base, [c.campo]: '  Box 2  ' });

      expect(dto[c.campo]).toBe('Box 2');
    });

    if (c.obligatorio) {
      it('solo espacios da el 400 de un vacio', async () => {
        await expect(porElPipe(c.dto, { ...c.base, [c.campo]: '   ' })).rejects.toBeInstanceOf(
          BadRequestException,
        );
      });
    } else {
      it('solo espacios llega vacio, no con sus espacios', async () => {
        const dto = await porElPipe(c.dto, { ...c.base, [c.campo]: '   ' });

        expect(dto[c.campo]).toBe('');
      });
    }
  });
});
```

**Cómo llenar cada fila:** leé el DTO. `base` es el cuerpo **válido** más chico **sin el campo**
(los obligatorios con valores que el DTO acepta: un `@IsUUID` lleva un UUID, un `@IsDateString` una
fecha, un `@IsEnum` un valor del enum). `obligatorio: true` si el campo lleva `@IsNotEmpty()` o
`@MinLength(1)` y **no** `@IsOptional()`; si es opcional o no rechaza el vacío, `false`. Para
asegurarte de que `base` es válido, **antes de agregar el decorador** cada fila con un valor sin
espacios (`'Box 2'`) tiene que pasar el pipe: si no pasa, el `base` está mal, no el DTO.

⚠️ Si `'Box 2'` no es un valor válido para algún campo (un `@MaxLength` menor, un patrón), usá otro
texto con espacios en los bordes y anotalo en un comentario de esa fila.

Run: `pnpm --filter @boxadmin/api exec jest src/common/decorators/recortado-en-los-dto.spec.ts`
Esperado: **FAIL en las 23 filas** del «llega sin los espacios» (llega `'  Box 2  '`) y en los
opcionales del «solo espacios llega vacío» (llega `'   '`). Los «da el 400» de los obligatorios
**pueden** pasar ya (un `@IsNotEmpty` de class-validator rechaza `'   '`? comprobalo y anotá qué
viste: si ya pasan, el test sigue valiendo para que nadie le quite el `@IsNotEmpty`, pero no es el
rojo de esta tarea).

- [ ] **Step 5: `@Recortado()` en los 21 DTO (verde)**

En cada campo, `@Recortado()` **encima** de los demás decoradores, e
`import { Recortado } from '<ruta relativa>/common/decorators/recortado.decorator';`:

```ts
@Recortado()
@IsString()
@IsNotEmpty()
@MaxLength(80)
nombre!: string;
```

| DTO (`apps/api/src/…`)                          | Campo(s)                |
| ----------------------------------------------- | ----------------------- |
| `auth/dto/create-tenant.dto.ts`                 | `nombre`                |
| `salas/dto/crear-sala.dto.ts`                   | `nombre`                |
| `salas/dto/actualizar-sala.dto.ts`              | `nombre`                |
| `packs/dto/crear-pack.dto.ts`                   | `nombre`                |
| `packs/dto/actualizar-pack.dto.ts`              | `nombre`                |
| `turnos/dto/crear-turno.dto.ts`                 | `nombre`                |
| `turnos/dto/actualizar-turno.dto.ts`            | `nombre`                |
| `rutinas/dto/crear-rutina.dto.ts`               | `nombre`                |
| `rutinas/dto/actualizar-rutina.dto.ts`          | `nombre`                |
| `invitaciones/dto/crear-invitacion.dto.ts`      | `nombre`                |
| `invitaciones/dto/actualizar-invitacion.dto.ts` | `nombre`                |
| `web-salon/dto/crear-testimonio.dto.ts`         | `nombre`, `texto`       |
| `web-salon/dto/crear-faq.dto.ts`                | `pregunta`, `respuesta` |
| `web-salon/dto/guardar-web-salon.dto.ts`        | `tagline`               |
| `comunicacion/dto/guardar-plantilla.dto.ts`     | `asunto`                |
| `pagos/dto/crear-pago.dto.ts`                   | `nota`                  |
| `pagos/dto/estado-pago.dto.ts`                  | `nota`                  |
| `comprobantes/dto/aprobar-comprobante.dto.ts`   | `nota`                  |
| `comprobantes/dto/revisar-comprobante.dto.ts`   | `nota`                  |
| `ausencias/dto/crear-ausencia.dto.ts`           | `motivo`                |
| `vacaciones/dto/crear-vacacion.dto.ts`          | `motivo`                |

(Son 21 archivos y 23 campos.) Si un DTO **hereda** de otro (`PartialType`, `extends`), el decorador
va en la clase **donde está declarado el campo**; comprobá que la hija lo hereda (la fila del spec lo
dice).

**Antes de cerrar la lista**, buscá otro texto libre que se vea en pantalla y no esté:

```bash
grep -rnE "^\s+\w+[?!]?: string( \| null)?;" apps/api/src --include=*.dto.ts
```

Mirá cada campo `string` que no sea clave, email, id, fecha, hora, color, URL, slug, enum ni el cuerpo
HTML de una plantilla. Si aparece uno (p. ej. otro nombre, una dirección, un título), **entra**: su
`@Recortado()` y su fila en el spec (y el `toHaveLength` sube). Reportá cuáles agregaste y cuáles
descartaste con su motivo.

Run el comando del Step 4. Esperado: PASS.

- [ ] **Step 6: El e2e (rojo → verde)**

En `apps/api/test/nucleo.e2e-spec.ts`, dentro de `describe('checklist 1: crear y configurar una
sala', …)`:

```ts
/**
 * EL NOMBRE SE GUARDA RECORTADO, de punta a punta: el pipe global de la app
 * de test es el de `main.ts`, y lo que vuelve al listar es lo que quedo en la
 * base, no lo que se mando.
 */
it('el nombre se guarda sin los espacios de los bordes', async () => {
  await request(servidor)
    .post('/salas')
    .set(auth(gym.adminToken))
    .send({ nombre: '  Box 2  ' })
    .expect(201);

  const lista = await request(servidor).get('/salas').set(auth(gym.adminToken)).expect(200);

  expect(lista.body.map((sala: { nombre: string }) => sala.nombre)).toEqual(['Box 2']);
});

it('un nombre de solo espacios da 400 y no crea nada', async () => {
  await request(servidor)
    .post('/salas')
    .set(auth(gym.adminToken))
    .send({ nombre: '   ' })
    .expect(400);

  const lista = await request(servidor).get('/salas').set(auth(gym.adminToken)).expect(200);

  expect(lista.body).toEqual([]);
});
```

Para verlo rojo **sin deshacer el Step 5**: quitá un momento el `@Recortado()` de `crear-sala.dto.ts`
(`// MUTACION TEMPORAL` no hace falta: lo volvés a poner en el acto), corré
`pnpm --filter @boxadmin/api test:e2e -- nucleo` y comprobá que el primero da rojo (`'  Box 2  '`) y el
segundo también (201 en vez de 400). Volvé a ponerlo y corré de nuevo: verde.

⚠️ Si `crearGimnasio` crea salas por su cuenta, el `toEqual(['Box 2'])` y el `toEqual([])` no
valen: filtrá la lista por las salas creadas en el test y anotalo.

- [ ] **Step 7: tsc, suite y e2e**

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
pnpm --filter @boxadmin/api test:e2e
```

Esperado: tsc limpio; api con **2 suites más** que en el Step 1, verde; e2e con **2 tests más**,
verde. **Ningún test que ya existía cambia**: si alguno se rompe porque esperaba un texto con
espacios, **pará y reportá**.

- [ ] **Step 8: Mutación abierta**

Cambiá el decorador por `value.trimStart()` (`// MUTACION TEMPORAL`). Corré los dos specs del
decorador: **tiene que dar rojo** al menos «saca los espacios de los dos bordes» y las 23 filas de
«llega sin los espacios». Deshacé.

Segunda: quitá el `@Recortado()` de **un** DTO de los opcionales (p. ej. `crear-vacacion.dto.ts`)
con `// MUTACION TEMPORAL` en su lugar. Corré `recortado-en-los-dto.spec.ts`: **tienen que dar rojo
sus dos filas**. Deshacé y volvé a verde.

- [ ] **Step 9: Formato**

`prettier --check` sobre los archivos nuevos (tienen que pasar) y sobre los tocados (ver la regla de
prettier arriba).

---

## Task 2: Una sola búsqueda del perfil

**Files:**

- Create: `apps/api/src/common/perfil-del-actor.ts`, `apps/api/src/common/perfil-del-actor.spec.ts`
- Modify: los 7 servicios de la tabla del Step 3, y un comentario en `mi-calendario/mi-pack.service.ts`

- [ ] **Step 1: El spec de la función (rojo)**

`apps/api/src/common/perfil-del-actor.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { idDelPerfilDelActor } from './perfil-del-actor';

const ACTOR = { sub: 'usuario-7' } as JwtPayload;
const SIN_PERFIL = 'Este usuario no tiene perfil de alumno, asi que no tiene calendario propio.';

function unCliente(perfil: { id: string } | null) {
  return { perfil: { findFirst: jest.fn().mockResolvedValue(perfil) } };
}

describe('idDelPerfilDelActor', () => {
  it('devuelve el id del perfil de quien llama', async () => {
    const cliente = unCliente({ id: 'perfil-3' });

    await expect(idDelPerfilDelActor(cliente as never, ACTOR, SIN_PERFIL)).resolves.toBe(
      'perfil-3',
    );
  });

  /**
   * EL PERFIL SALE DEL TOKEN, NUNCA DE LA PETICION. Se mira la consulta
   * entera: un `where` con otra clave, o sin `select`, traeria otro perfil o
   * el perfil entero.
   */
  it('lo busca por el usuario del token, y trae solo el id', async () => {
    const cliente = unCliente({ id: 'perfil-3' });

    await idDelPerfilDelActor(cliente as never, ACTOR, SIN_PERFIL);

    expect(cliente.perfil.findFirst).toHaveBeenCalledWith({
      where: { usuarioId: 'usuario-7' },
      select: { id: true },
    });
  });

  it('sin perfil, un 404 con el texto que le pasaron, letra por letra', async () => {
    const intento = idDelPerfilDelActor(unCliente(null) as never, ACTOR, SIN_PERFIL);

    await expect(intento).rejects.toBeInstanceOf(NotFoundException);
    await expect(intento).rejects.toThrow(new NotFoundException(SIN_PERFIL));
  });

  /** Dentro de una transaccion, la consulta va por el cliente de la transaccion. */
  it('usa el cliente que recibe y ningun otro', async () => {
    const deLaTransaccion = unCliente({ id: 'perfil-tx' });

    await expect(idDelPerfilDelActor(deLaTransaccion as never, ACTOR, SIN_PERFIL)).resolves.toBe(
      'perfil-tx',
    );
    expect(deLaTransaccion.perfil.findFirst).toHaveBeenCalledTimes(1);
  });
});
```

⚠️ `rejects.toThrow(new NotFoundException(texto))` compara el **mensaje**; comprobá que con un texto
distinto da rojo (cambiá un momento `SIN_PERFIL` en la llamada).

Run: `pnpm --filter @boxadmin/api exec jest src/common/perfil-del-actor.spec.ts`
Esperado: FAIL (no existe el módulo).

- [ ] **Step 2: La función (verde)**

`apps/api/src/common/perfil-del-actor.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import type { ClientePrismaTx } from '../prisma/prisma.service';

/**
 * EL PERFIL DE QUIEN LLAMA, sacado del token y nunca de la peticion.
 *
 * Es la puerta de las rutas «mias» —mi calendario, mis clases, mi
 * liquidacion, mis comprobantes, mi lista de espera, mi push, mi check-in—:
 * todas operan sobre EL perfil de quien llama, nunca sobre un `perfilId` del
 * cuerpo o de la URL.
 *
 * `siNoTiene` es el texto del 404, y lo pone cada servicio: un admin sin
 * perfil que pide «mis clases» no tiene que leer lo mismo que uno que pide
 * «mi calendario».
 *
 * `cliente` es el de Prisma o el de una transaccion: dentro de un
 * `$transaction`, el perfil se lee con el mismo cliente que el resto.
 *
 * `MiPackService` no la usa: trae el perfil CON su pack, y una funcion que
 * aceptara un `include` dejaria de ser esta.
 */
export async function idDelPerfilDelActor(
  cliente: ClientePrismaTx,
  actor: JwtPayload,
  siNoTiene: string,
): Promise<string> {
  const perfil = await cliente.perfil.findFirst({
    where: { usuarioId: actor.sub },
    select: { id: true },
  });
  if (perfil === null) throw new NotFoundException(siNoTiene);

  return perfil.id;
}
```

Si `this.prisma.db` no es asignable a `ClientePrismaTx` (mirá cómo lo resuelven
`mi-calendario.service.ts` y `mis-clases.service.ts`, que ya lo pasan por defecto), usá el mismo tipo
que ellos.

Run el mismo comando. Esperado: PASS.

- [ ] **Step 3: Los 7 servicios**

En cada uno, el método que hoy busca el perfil **queda con la misma firma y el mismo nombre** (sus
llamadores y sus specs no cambian) y su cuerpo pasa a ser una llamada. Los textos se copian **del
archivo**, no de esta tabla:

| Servicio (`apps/api/src/…`)              | Método                                | Hoy devuelve | Texto del 404 (verificalo en el archivo)                                        |
| ---------------------------------------- | ------------------------------------- | ------------ | ------------------------------------------------------------------------------- |
| `checkin/checkin.service.ts`             | `perfilDelActor` (privado)            | `{ id }`     | «Este usuario no tiene perfil de alumno, asi que no tiene reservas que marcar.» |
| `comprobantes/comprobantes.service.ts`   | `perfilDelActor` (privado)            | `{ id }`     | «Este usuario no tiene perfil de alumno»                                        |
| `liquidacion/liquidacion.datos.ts`       | `perfilDeLaProfesora` (público)       | `string`     | «Este usuario no tiene perfil de profesora.»                                    |
| `lista-espera/lista-espera.service.ts`   | `perfilDelActor` (privado)            | `{ id }`     | «Este usuario no tiene perfil de alumno»                                        |
| `mi-calendario/mi-calendario.service.ts` | `perfilDelActor` (público, `cliente`) | `{ id }`     | «Este usuario no tiene perfil de alumno, asi que no tiene calendario propio.»   |
| `mis-clases/mis-clases.service.ts`       | `perfilDelActor` (`cliente`)          | `{ id }`     | «Este usuario no tiene perfil de profesora, asi que no tiene clases propias.»   |
| `push/push.service.ts`                   | `perfilDelActor` (privado)            | `{ id }`     | «Este usuario no tiene perfil»                                                  |

Los que devuelven `{ id }`:

```ts
private async perfilDelActor(actor: JwtPayload): Promise<{ id: string }> {
  return { id: await idDelPerfilDelActor(this.prisma.db, actor, '<el texto de hoy>') };
}
```

Los que reciben `cliente`:

```ts
async perfilDelActor(
  actor: JwtPayload,
  cliente: ClientePrismaTx = this.prisma.db,
): Promise<{ id: string }> {
  return { id: await idDelPerfilDelActor(cliente, actor, '<el texto de hoy>') };
}
```

`liquidacion.datos.ts`:

```ts
async perfilDeLaProfesora(actor: JwtPayload): Promise<string> {
  return idDelPerfilDelActor(this.prisma.db, actor, 'Este usuario no tiene perfil de profesora.');
}
```

**Los docblocks de esos métodos se quedan** (explican por qué cada ruta usa el perfil del token);
si alguno decía «el patron de `MisClasesService.perfilDelActor`», cambialo por «`idDelPerfilDelActor`
(`common/perfil-del-actor.ts`)». Sacá los imports que queden sin uso (`NotFoundException` sólo si ya
nadie lo usa en el archivo: comprobalo con grep).

Si un servicio **comprueba el perfil de otra forma** (más campos en el `select`, un `where` con más
condiciones), **no lo fuerces**: dejalo como está, con un comentario de por qué, y reportalo.

En `mi-calendario/mi-pack.service.ts`, encima del `findFirst` de `deActor`, un comentario:

```ts
// No usa `idDelPerfilDelActor` (`common/perfil-del-actor.ts`): necesita el
// perfil CON su pack para calcular el tope, y esa funcion trae solo el id.
```

- [ ] **Step 4: Ninguna copia más**

```bash
grep -rn "usuarioId: actor.sub" apps/api/src --include=*.ts | grep -v spec
```

Esperado: **dos** líneas: `common/perfil-del-actor.ts` y `mi-calendario/mi-pack.service.ts`. Si
aparece otra, es un servicio que el spec no contó: aplicale el Step 3 y reportalo.

- [ ] **Step 5: tsc, suite y e2e**

```bash
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
pnpm --filter @boxadmin/api test:e2e
```

Esperado: tsc limpio; api **una suite más** que al terminar la Task 1, verde; e2e igual que al
terminar la Task 1. **Ningún spec de servicio cambia una afirmación**: si alguno se rompe, el cambio
no fue un movimiento; **pará y reportá**.

- [ ] **Step 6: Mutación abierta**

En `perfil-del-actor.ts`, cambiá el `throw` por
`throw new NotFoundException('Este usuario no tiene perfil'); // MUTACION TEMPORAL` (un texto fijo).
Corré la suite de api: **tienen que dar rojo** el spec de la función y **al menos un spec de servicio**
que compare su mensaje (los que hoy hacen `findFirst.mockResolvedValue(null)`: `comprobantes`,
`lista-espera`, `mi-calendario`). Si **ningún** spec de servicio da rojo, los mensajes sólo los vigila
el e2e: corré `test:e2e` y anotá cuáles dieron rojo. Deshacé y volvé a verde.

- [ ] **Step 7: Formato**

`prettier --check` sobre los archivos nuevos (tienen que pasar) y sobre los tocados (ver la regla de
prettier arriba).

---

## Task 3: Cierre

**Files:**

- Modify: `README.md` (sección nueva antes de `## Tests`)
- Modify: `docs/superpowers/plans/PROGRESO.md` (bloque nuevo al final)

- [ ] **Step 1: Verificación entera**

```bash
grep -rn "MUTACION TEMPORAL" apps
grep -rn "usuarioId: actor.sub" apps/api/src --include=*.ts | grep -v spec
pnpm --filter @boxadmin/api exec tsc --noEmit
pnpm --filter @boxadmin/api test
pnpm --filter @boxadmin/api test:e2e
pnpm --filter @boxadmin/api build
git status --short apps/web packages/shared
```

Esperado: vacío; dos líneas; tsc limpio; verde (anotá las cuentas); e2e verde; build OK; **vacío**.

- [ ] **Step 2: README**

Antes de `## Tests`, una sección `## Deuda de la API — Fase 18`, en prosa corta:

- los textos libres se recortan con `@Recortado()` (`common/decorators/recortado.decorator.ts`);
  cuáles sí y cuáles no (claves, emails, ids, fechas, HTML de plantillas) y por qué; un nombre de solo
  espacios da el 400 de un vacío; los opcionales recortados quedan `""`, no `null`;
- **cómo se suma un campo nuevo**: el decorador y una fila en `recortado-en-los-dto.spec.ts`;
- el perfil de quien llama sale de `idDelPerfilDelActor` (`common/perfil-del-actor.ts`), cada servicio
  con su texto de 404; `mi-pack` no la usa y por qué;
- **la regla del dinero (`Importe` contra la cadena)**: lo que se guarda como `Decimal` (precio de un
  pack, monto de un pago) viaja como texto con dos decimales (`"12500.00"`); lo que la API calcula
  (liquidación, caja) viaja como `Importe`, `{ centavos, texto }`. Ninguna pantalla hace cuentas con el
  texto; el día que haga falta sumar precios o montos en el cliente, se pasan a `Importe`.

- [ ] **Step 3: PROGRESO**

Al final, `# Progreso Fase 18 — Deuda de la API`, con las mismas secciones que la Fase 17: los
números (antes/después de api y e2e), lo que hace cada tarea, las mutaciones (cuál, si dio rojo), la
revisión de calidad de cada tarea, trampas nuevas, **deuda anotada** (cerrada / por diseño / nueva /
sigue), lo que la fase NO hace y el checklist a mano.

En la deuda:

- **Cerrada:** el recorte de nombres en la API; la búsqueda del perfil repetida en 8 servicios (7 la
  comparten; `mi-pack` queda fuera por diseño).
- **Por diseño, ya no deuda:** `Importe` contra la cadena pelada (la regla del README).
- **Sigue (web, de la Fase 17):** las escrituras con `pedir` directo (push, check-in) que ante un 401
  muestran «Unauthorized» y no van al login; las lecturas internas de las fichas que podrían mostrar
  «Unauthorized»; el 403 sin traducir de invitaciones. **Sigue (grupo D):** la lista de la Fase 13.
- Lo nuevo que hayan encontrado las Tasks 1 y 2.

El checklist a mano:

- [ ] Crear una sala con « Box 2 » desde la pantalla (que ya recorta) **y** desde un `curl` con
      espacios: las dos quedan «Box 2».
- [ ] Un admin sin perfil que abre «Mis clases» lee el mismo 404 de siempre.

- [ ] **Step 4: Formato**

`node node_modules/prettier/bin/prettier.cjs --check README.md docs/superpowers/plans/2026-11-12-fase18-deuda-api.md docs/superpowers/specs/2026-11-12-fase18-deuda-api.md`
desde la raíz. `PROGRESO.md` ya fallaba `--check` en tablas viejas (líneas ~2497–3086, desde antes de
la Fase 17): comprobá **sólo tu bloque** y no reformatees el resto.
