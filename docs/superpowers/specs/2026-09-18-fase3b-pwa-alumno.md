# Fase 3B — La PWA del alumno

**Fecha:** 2026-09-18
**Estado:** aprobado
**Fuente:** `docs/BoxAdmin_Fase3_SelfServiceAlumno.pdf` (parte de frontend)
**Base:** Fase 3A completa — ver `docs/superpowers/specs/2026-09-17-fase3a-self-service-alumno.md`

---

## 1. Objetivo

La segunda mitad de la Fase 3: la aplicación que el alumno usa de verdad. Un Next.js instalable como
PWA, en `apps/web`, contra la API que la 3A dejó implementada y cubierta por 127 e2e.

**Criterio de éxito:** un alumno de prueba, desde el navegador y sin tocar `curl`, se auto-registra
con una clave de invitación, ve su calendario, reserva una clase suelta, cancela otra, se anota en
lista de espera y sube un comprobante. Instala la aplicación en su teléfono y, sin conexión, sigue
viendo el calendario que ya había cargado.

---

## 2. Decisiones cerradas

Siete decisiones consultadas y aprobadas antes de escribir este documento. Las dos primeras
contradicen al PDF, y por buenas razones.

### D1 — Serwist en lugar de `next-pwa`

El PDF prescribe `pnpm add next-pwa`. **Esa librería está muerta:** `next-pwa@5.6.0` se publicó por
última vez el **23 de agosto de 2022**, es decir, antes de que el App Router se estabilizara (Next
13.4, mayo de 2023). El propio PDF pide `create-next-app --app`, así que su propia receta es
internamente incompatible.

Se usa **`@serwist/next`** (9.5.12, modificado en julio de 2026), que es el sucesor directo: el
mantenedor que heredó `next-pwa` lo reescribió como Serwist. El concepto del PDF —Workbox bajo un
plugin de Next— se conserva intacto; solo cambia el paquete.

### D2 — Next 15, no 16

Next 16 está publicado y cumpliríamos su requisito de Node (>=20.9; tenemos 20.19.5). Se elige la
**15.5.25** porque es donde Serwist está rodado y documentado. El `peerDependencies` de Serwist dice
`next: ">=14.0.0"`, pero un rango permisivo no es prueba de que se haya probado contra la 16, y si
chocaran, el fallo aparecería en la tarea del service worker: la más difícil de depurar de la fase.

### D3 — Tokens en cookies `httpOnly`, con Next de intermediario

El JavaScript de la página **nunca ve el token**. Como la API los devuelve en el cuerpo de la
respuesta, hace falta una capa de Next (Route Handlers) que los recoja y los convierta en cookie.

La alternativa habitual —`localStorage`— deja que cualquier XSS se lleve la sesión. Aquí hay fichas
médicas y comprobantes de pago; el backend entero se construyó fail-closed y no tiene sentido abrir
esa puerta en el último tramo.

### D4 — El gimnasio va en la ruta: `/[slug]/...`

Es lo que dibuja el árbol de directorios del PDF. Funciona en cualquier hosting sin DNS comodín ni
certificado wildcard, y en desarrollo funciona tal cual en `localhost`. El subdominio que menciona el
objetivo del PDF (`<slug>.boxadmin.app`) queda para cuando haya hosting decidido: es un middleware de
reescritura por encima de estas mismas rutas, no un rediseño.

### D5 — `GET /mi-pack` se añade a la API

**Esto tapa un agujero.** La pantalla `mi-pack` debe mostrar "resumen de clases disponibles/usadas",
pero ningún endpoint de la 3A expone el consumo: vive dentro de `advertenciasDePack`, privado.

Calcularlo en el cliente daría un número equivocado, porque el consumo cuenta también las reservas
canceladas como `DEFINITIVA` y se mide sobre la ventana del pack, no sobre el rango que el alumno
tenga abierto en pantalla. Un contador que miente sobre cuántas clases te quedan es peor que no
tenerlo.

El endpoint reutiliza `topeDelPack` y `ventanaDeConteo`, que ya existen desde la Fase 1.

### D6 — Offline: leer sí, escribir no

Sin conexión, el alumno ve el calendario que ya había cargado, con un aviso de cuándo se cargó.
Reservar y cancelar fallan con un mensaje claro.

Se descartó encolar las escrituras con Background Sync: el cupo puede agotarse mientras la petición
espera, así que el alumno se enteraría de que no tenía plaza mucho después de creer que sí. Y Safari
no lo soporta, que es justo el navegador de la mitad de los teléfonos.

### D7 — Tailwind y componentes propios

Lo que dice el PDF y nada más. Seis pantallas no justifican un sistema de componentes entero; los
que hagan falta —botón, tarjeta, aviso, campo de formulario— caben en un archivo corto y sin
dependencias que mantener.

---

## 3. Arquitectura

### 3.1 El paquete compartido, cobrando intereses

`apps/web` consume **`@boxadmin/shared`**, y ahí se cobra la decisión de la 3A de poner las piezas
puras en ese paquete:

- `calcularDisponibilidad` y `puedeCancelar` corren en el navegador, así que una pantalla puede
  apagar un botón sin preguntarle al servidor.
- Los contratos (`TurnoDisponible`, `MiClase`, `Disponibilidad`, `ComprobantePublico`...) son **los
  mismos tipos** que devuelve la API. No hay dos definiciones que se separen con el tiempo.

Ninguno de esos módulos importa nada de Node, así que van al bundle sin adaptaciones. Next los
transpila con `transpilePackages: ['@boxadmin/shared']`.

### 3.2 El BFF

```
navegador  ──►  Next (Route Handlers)  ──►  API Nest
           ◄──  cookies httpOnly      ◄──   JSON con tokens
```

| Ruta de Next | Qué hace |
|---|---|
| `POST /api/auth/login` | Llama a `/auth/login`, guarda `bx_access`, `bx_refresh` y `bx_slug` en cookies `httpOnly`, devuelve solo el usuario |
| `POST /api/auth/auto-registro` | Igual, contra `/auth/auto-registro` |
| `POST /api/auth/logout` | Revoca en la API y borra las cookies |
| `ALL /api/bx/[...ruta]` | **Proxy genérico**: reenvía a la API con el `Authorization` de la cookie |

El proxy genérico es lo que evita escribir un handler por endpoint.

**Riesgo que hay que cerrar explícitamente: no puede convertirse en un SSRF.** Solo compone rutas
sobre la `API_URL` configurada; rechaza rutas absolutas, esquemas y `..`. Va con test propio.

**Refresh:** ante un 401 de la API, el proxy intenta el refresh una vez, reintenta la petición
original y, si vuelve a fallar, borra las cookies y devuelve 401. El cliente lo traduce en un
redirect al login.

Cookies: `httpOnly`, `sameSite: 'lax'`, `secure` en producción, `path: '/'`. **Las tres son
`httpOnly`, incluida `bx_slug`**: la lee el layout en el servidor, así que el cliente no la necesita,
y una cookie menos legible desde JavaScript es una menos que manipular.

### 3.3 Un gimnasio por cookie

Las cookies son del dominio, pero los tokens son de un gimnasio concreto. Si alguien se loguea en
`/gym-a/` y luego abre `/gym-b/calendario`, la cookie sigue siendo la de A y la API respondería con
datos de A bajo la URL de B.

Por eso se guarda `bx_slug` junto a los tokens. El layout del área de alumno compara el slug de la
URL con el de la cookie y, si no coinciden, redirige al login de ese gimnasio.

### 3.4 CORS: la excepción al mismo origen

Con el BFF, el navegador solo habla con Next. **Salvo en un sitio:** el `PUT` del comprobante va
directo del navegador al almacén, que es exactamente para lo que existen las URLs firmadas.

En desarrollo ese almacén es la API de Nest (`:3000`) y el frontend vive en `:3001`, así que es una
petición cross-origin — y `main.ts` **no tiene CORS habilitado**. El navegador la bloquearía.

Se habilita CORS **acotado a las rutas del almacén local** (`/archivos-locales`), con el origen del
frontend tomado de una variable de entorno. En producción con S3, la política CORS equivalente es del
bucket y queda fuera del código.

---

## 4. Pantallas

| Ruta | Grupo | Qué hace |
|---|---|---|
| `/[slug]/login` | público | Entrar |
| `/[slug]/registro` | público | Auto-registro con clave de invitación |
| `/[slug]/calendario` | alumno | Vista semanal: reservar, cancelar, lista de espera |
| `/[slug]/mi-pack` | alumno | Consumo, vigencia, si está al día |
| `/[slug]/comprobantes` | alumno | Subir y ver estado |
| `/[slug]/perfil` | alumno | Datos y cerrar sesión |

El grupo de alumno vive bajo un layout que exige sesión y slug coincidente.

### 4.1 El calendario habla el idioma de la API

Cada `disponibilidad.estado` pinta el turno de una forma, y cada `motivo` da un texto concreto:

| Estado / motivo | Qué ve el alumno |
|---|---|
| `LIBRE` + `puedeReservar` | Botón "Reservar" activo |
| `LISTA_ESPERA` | Botón "Anotarme en lista de espera" |
| `LLENO` | "Completo", sin acción |
| `SOLO_CUPOS_LIBERADOS` | "Solo plazas liberadas; todavía no se liberó ninguna" |
| `VENTANA_CERRADA` | "Ya pasó el plazo para anotarse" |
| `YA_RESERVADO` | Marca de reservado, con opción de cancelar si la ventana lo permite |

Los turnos con motivo `MES_NO_PUBLICADO`, `SALA_NO_VISIBLE` o `SIN_ACCESO_A_SALA` no llegan: la API
ya los omite del listado.

### 4.2 Actualizaciones optimistas

Reservar y cancelar actualizan la interfaz **antes** de que responda el servidor, y revierten si la
API rechaza. El PDF lo pide por su nombre, señalando que es donde TurnoFit se siente pesado.

El rollback no es opcional: reservar puede fallar por cupo, por ventana o por pack, y una interfaz
que se quedara mostrando una reserva que no existe sería peor que una lenta.

---

## 5. `GET /mi-pack`

| Método | Ruta | Rol mínimo |
|---|---|---|
| GET | `/mi-pack` | `ALUMNO` |

```ts
interface MiPackPublico {
  pack: PackPublico | null;
  /** Tope de clases del periodo. null = sin pack o ilimitado. */
  tope: number | null;
  consumidas: number;
  restantes: number | null;
  /** La ventana sobre la que se cuenta. YYYY-MM-DD. */
  ventanaDesde: string | null;
  ventanaHasta: string | null;
  clasesExtra: number;
  cancelacionesUsadas: number;
  cancelacionesPermitidas: number | null;
  pagoAlDia: boolean;
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
}
```

Reutiliza `topeDelPack` y `ventanaDeConteo` de `apps/api/src/reservas/ventana-pack.ts`. El consumo se
cuenta como en la Fase 1: reservas activas **más** las canceladas como `DEFINITIVA`, dentro de la
ventana del pack.

---

## 6. Service worker

**Precache:** la carcasa de la aplicación (HTML, CSS, JS del build).

**Runtime:** una sola regla, `NetworkFirst` con timeout corto, sobre `/api/bx/mi-calendario`. Es lo
que el PDF quiere offline y no hay razón para cachear más.

**Todo lo demás es network-only.** Sin red, reservar falla con un mensaje claro en vez de fingir que
funcionó (D6).

**Desactivado en desarrollo**, como indica el PDF: un service worker cacheando mientras se programa
es una fuente inagotable de confusión sobre qué versión se está viendo.

**El aviso de datos viejos** sale de `dataUpdatedAt` de React Query: cuando `navigator.onLine` es
falso, el calendario muestra de cuándo son los datos. Un calendario viejo sin fecha es peor que no
tenerlo.

**Manifest:** nombre, colores e iconos de 192 y 512 px. Los iconos **se generan en la fase**, con un
script que rasteriza un SVG y deja los PNG en `public/`. No es un detalle cosmético: un manifest que
apunta a iconos inexistentes **no hace la aplicación instalable**, y Chrome no lo dice en voz alta —
simplemente no ofrece instalar. Por eso el test de instalabilidad comprueba que los archivos existen
y se sirven, no solo que el manifest los mencione.

---

## 7. Pruebas

**Vitest + Testing Library** para lógica de cliente y componentes: la traducción de estado y motivo a
texto, el formulario de registro, el rollback optimista, y el proxy del BFF (incluida su defensa
contra SSRF).

**Playwright** solo donde hace falta un navegador de verdad, porque jsdom no registra service
workers:

1. La aplicación es **instalable**: manifest servido, iconos existentes, service worker registrado.
2. **Offline**: con la red cortada, el calendario ya cargado sigue viéndose, y reservar avisa de que
   no hay conexión.
3. El **ciclo completo** del alumno contra la API real: registro, reserva, cancelación, lista de
   espera y subida de comprobante.

Playwright necesita **tres cosas levantadas a la vez**: Postgres y Redis, la API de Nest y el build de
producción del frontend — el service worker no existe en desarrollo (D6), así que probarlo contra
`next dev` no probaría nada. Lo orquesta la propia configuración de Playwright con `webServer`, y el
alumno de prueba se prepara llamando a la API, no escribiendo en la base.

⚠️ Esa API que Playwright levanta **comparte Redis con los e2e de la 3A**. Es la misma trampa
documentada en el README, ahora con un actor más: no se pueden correr los dos a la vez.

**Del lado del backend**, `GET /mi-pack` lleva sus unitarios y su e2e, como todo lo demás.

---

## 8. Checklist de aceptación

Del PDF, la parte que es frontend:

1. Un alumno se auto-registra desde el navegador con una clave de invitación, eligiendo pack.
2. Ve su calendario y reserva o cancela una clase suelta respetando las ventanas.
3. Un turno lleno ofrece la lista de espera en vez de un error genérico.
4. Sube un comprobante y lo ve en estado "pendiente".
5. `mi-pack` muestra el consumo real del periodo.
6. La PWA es **instalable** (manifest y service worker) y funciona offline para "mi calendario" ya
   cacheada.
7. Un alumno logueado en un gimnasio no ve datos de otro al cambiar el slug de la URL.
8. Tests: Vitest para componentes y lógica, Playwright para instalabilidad, offline y el ciclo
   completo.

---

## 9. Fuera de alcance

- **`next-pwa`**, sustituido por Serwist. Ver D1.
- **El subdominio por gimnasio**; queda un middleware de reescritura sobre estas mismas rutas.
- **Escrituras offline** con Background Sync. Ver D6.
- **Cualquier pantalla de administración**: esta aplicación es solo del alumno. El admin sigue usando
  la API directamente hasta que se decida darle interfaz.
- **Notificaciones push**: llegan en la Fase 5, con el módulo de notificaciones. El hook del backend
  ya está preparado e inerte desde la 3A.
