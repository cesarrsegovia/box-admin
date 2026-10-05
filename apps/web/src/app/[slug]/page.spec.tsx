import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { SalonPublico } from '@boxadmin/shared';
import PaginaDeSalon, { generateMetadata } from './page';

/**
 * `notFound` de Next corta la ejecucion lanzando. Se imita: si no lanzara, la
 * pagina seguiria y renderizaria una landing con `undefined` por todas partes,
 * y el test pasaria sin enterarse.
 */
const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/navigation', () => ({ notFound }));

const API = 'https://api.interna.test';

function salon(cambios: Partial<SalonPublico> = {}): SalonPublico {
  return {
    nombre: 'Box Caballito',
    colorPrimario: '#101010',
    colorSecundario: '#f0f0f0',
    tituloPrincipal: null,
    tagline: null,
    sobreElSalon: null,
    imagenPrincipalUrl: null,
    whatsapp: null,
    instagram: null,
    linkExtra: null,
    ...cambios,
  };
}

/** Un salon con las cuatro secciones opcionales y el pie completo. */
function salonCompleto(): SalonPublico {
  return salon({
    tituloPrincipal: 'Entrena con nosotros',
    tagline: 'Funcional y pilates en Caballito',
    sobreElSalon: 'Abrimos en 2015 con dos profesoras.',
    imagenPrincipalUrl: 'https://cdn.ejemplo.com/portada.jpg',
    whatsapp: '+54 9 11 1234-5678',
    instagram: '@boxcaballito',
    linkExtra: 'https://boxcaballito.ejemplo.com/horarios',
    packs: [
      { nombre: 'Mensual libre', precio: '8500.00', destacado: true },
      { nombre: 'Dos por semana', precio: '6200.00', destacado: false },
      { nombre: 'Clase suelta', precio: null, destacado: false },
    ],
    turnosLibres: [
      { fecha: '2026-10-05', horaInicio: '18:00', clase: 'Funcional', salaNombre: 'Sala 1' },
    ],
    testimonios: [{ nombre: 'Ana', texto: 'Cambie de vida.' }],
    preguntas: [{ pregunta: '¿Hay que reservar?', respuesta: 'Si, desde la app.' }],
  });
}

function respuesta(cuerpo: unknown, estado: number): Response {
  return new Response(estado === 204 ? null : JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchFalso: ReturnType<typeof vi.fn>;

async function montar({
  slug = 'mi-gym',
  datos = salon(),
  estado = 200,
}: { slug?: string; datos?: unknown; estado?: number } = {}) {
  fetchFalso = vi.fn().mockResolvedValue(respuesta(datos, estado));
  vi.stubGlobal('fetch', fetchFalso);

  const elemento = await PaginaDeSalon({ params: Promise.resolve({ slug }) });

  return render(elemento);
}

/**
 * LA AUDITORIA DE LA AUSENCIA.
 *
 * Devuelve TODAS las secciones que el documento tiene, en orden. Un test que
 * diga "cuando la bandera esta apagada no aparece el texto Planes" es debil:
 * detecta que falte lo propio, no que sobre lo ajeno. Comparando esta lista
 * entera contra un valor esperado, una seccion de MAS tambien rompe.
 *
 * Se leen los `<section>` y no los `<h2>` a proposito: asi una seccion que
 * alguien renderice sin encabezado tampoco pasa desapercibida.
 */
function seccionesDelDocumento(): string[] {
  return Array.from(document.querySelectorAll('section')).map(
    (seccion) => seccion.querySelector('h2')?.textContent ?? '(seccion sin encabezado)',
  );
}

/** Todos los enlaces del documento, con su destino. La misma idea. */
function enlacesDelDocumento(): [string, string | null][] {
  return screen.queryAllByRole('link').map((a) => [a.textContent ?? '', a.getAttribute('href')]);
}

/**
 * El contenido de un elemento, trozo a trozo y separado por espacios.
 *
 * `textContent` pega los bloques sin nada en medio ("Cambie de vida.Ana") y
 * eso hace ilegible la comparacion entera, que es justo la que interesa.
 */
function texto(elemento: Element): string {
  const partes: string[] = [];
  const paseo = document.createTreeWalker(elemento, NodeFilter.SHOW_TEXT);

  while (paseo.nextNode()) {
    const trozo = (paseo.currentNode.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (trozo !== '') partes.push(trozo);
  }

  return partes.join(' ');
}

beforeEach(() => {
  vi.stubEnv('API_URL', API);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('Landing · la peticion', () => {
  it('va al endpoint publico de la API, no al proxy con sesion', async () => {
    await montar({ slug: 'box-caballito' });

    expect(fetchFalso).toHaveBeenCalledTimes(1);
    const [url] = fetchFalso.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe(`${API}/public/salon/box-caballito`);
    // El proxy `/api/bx` es del NAVEGADOR y lleva la sesion; ademas responde
    // 401 sin cookie, que es justo lo que le pasa a un visitante.
    expect(url).not.toContain('/api/bx');
  });

  it('NO lleva cookies ni token: la landing la ve cualquiera', async () => {
    await montar();

    const [, opciones] = fetchFalso.mock.calls[0]! as [string, RequestInit];
    expect(opciones.credentials).toBe('omit');

    // Se fija el conjunto ENTERO de cabeceras, no se busca `cookie` por su
    // nombre: una lista negra siempre va una cabecera por detras.
    const cabeceras = Object.fromEntries(new Headers(opciones.headers).entries());
    expect(cabeceras).toEqual({ accept: 'application/json' });
  });

  it('un slug con forma imposible no llega a salir a la red', async () => {
    // La misma forma que exige el controlador publico de la API. Sin esto, la
    // peticion sale igual y el 404 lo decide el otro lado.
    await expect(montar({ slug: 'MAYUSCULAS' })).rejects.toThrow(/NEXT_NOT_FOUND/);

    expect(fetchFalso).not.toHaveBeenCalled();
    expect(notFound).toHaveBeenCalled();
  });
});

describe('Landing · cuando no hay web', () => {
  it('un 404 de la API muestra el not-found de Next', async () => {
    await expect(montar({ datos: { message: 'No hay web' }, estado: 404 })).rejects.toThrow(
      /NEXT_NOT_FOUND/,
    );

    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it('un 500 NO es un not-found: es una averia', async () => {
    // Decirle "este gimnasio no existe" a quien entra mientras la API esta
    // caida es mentir, y encima lo deja indexado como inexistente.
    await expect(montar({ datos: { message: 'Boom' }, estado: 500 })).rejects.toThrow();

    expect(notFound).not.toHaveBeenCalled();
  });

  it('si la API no contesta tampoco se finge un not-found', async () => {
    fetchFalso = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchFalso);

    await expect(PaginaDeSalon({ params: Promise.resolve({ slug: 'mi-gym' }) })).rejects.toThrow();

    expect(notFound).not.toHaveBeenCalled();
  });
});

describe('Landing · la portada', () => {
  it('sin titulo propio, el encabezado es el nombre del gimnasio', async () => {
    await montar({ datos: salon({ tituloPrincipal: null }) });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Box Caballito');
  });

  it('con titulo propio, manda el titulo', async () => {
    await montar({ datos: salon({ tituloPrincipal: 'Entrena con nosotros' }) });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Entrena con nosotros');
  });

  it('sin tagline no se renderiza un parrafo vacio', async () => {
    const { container } = await montar({ datos: salon({ tagline: null }) });

    expect(container.querySelectorAll('p')).toHaveLength(0);
  });

  it('sin imagen no hay img en el documento', async () => {
    await montar({ datos: salon({ imagenPrincipalUrl: null }) });

    expect(document.querySelector('img')).toBeNull();
  });

  it('con imagen https la pinta, con el nombre del gimnasio de alt', async () => {
    await montar({ datos: salon({ imagenPrincipalUrl: 'https://cdn.ejemplo.com/portada.jpg' }) });

    expect(screen.getByRole('img', { name: 'Box Caballito' })).toHaveAttribute(
      'src',
      'https://cdn.ejemplo.com/portada.jpg',
    );
  });

  it.each(['javascript:alert(1)', 'http://cdn.ejemplo.com/p.jpg', 'no-es-una-url'])(
    'una imagen con %j no se renderiza en absoluto',
    async (url) => {
      const { container } = await montar({ datos: salon({ imagenPrincipalUrl: url }) });

      expect(document.querySelector('img')).toBeNull();
      expect(container.innerHTML).not.toContain('javascript:');
    },
  );
});

describe('Landing · las cuatro secciones opcionales', () => {
  it('sin ningun dato opcional, el documento NO TIENE NI UNA seccion', async () => {
    await montar({ datos: salon() });

    expect(seccionesDelDocumento()).toEqual([]);
  });

  it('con todo, estan las siete y EN ESTE ORDEN', async () => {
    await montar({ datos: salonCompleto() });

    expect(seccionesDelDocumento()).toEqual([
      'Sobre el salón',
      'Planes',
      'Turnos libres',
      'Testimonios',
      'Preguntas frecuentes',
      'Contacto',
    ]);
  });

  it.each([
    ['sobreElSalon', { sobreElSalon: 'Algo' }, 'Sobre el salón'],
    ['packs', { packs: [{ nombre: 'Mensual', precio: '8500.00', destacado: false }] }, 'Planes'],
    [
      'turnosLibres',
      {
        turnosLibres: [
          { fecha: '2026-10-05', horaInicio: '18:00', clase: 'Funcional', salaNombre: 'Sala 1' },
        ],
      },
      'Turnos libres',
    ],
    ['testimonios', { testimonios: [{ nombre: 'Ana', texto: 'Genial' }] }, 'Testimonios'],
    [
      'preguntas',
      { preguntas: [{ pregunta: '¿Cuanto?', respuesta: 'Depende' }] },
      'Preguntas frecuentes',
    ],
  ])(
    'con %s y nada mas, la unica seccion del documento es la suya',
    async (_campo, cambios, encabezado) => {
      await montar({ datos: salon(cambios as Partial<SalonPublico>) });

      expect(seccionesDelDocumento()).toEqual([encabezado]);
    },
  );

  it.each(['packs', 'turnosLibres', 'testimonios', 'preguntas'] as const)(
    'si %s viene VACIO tampoco se renderiza el encabezado solo',
    async (campo) => {
      await montar({ datos: salon({ [campo]: [] }) });

      // "No vino" y "vino sin nada dentro" se ven igual desde la calle: un
      // encabezado con nada debajo.
      expect(seccionesDelDocumento()).toEqual([]);
    },
  );
});

describe('Landing · los planes', () => {
  it('salen todos, con su precio, y el destacado marcado', async () => {
    await montar({ datos: salonCompleto() });

    const planes = within(screen.getByRole('region', { name: 'Planes' })).getAllByRole('listitem');

    // Se compara el contenido ENTERO de cada plan: asi una insignia de mas o
    // un precio que se cuela donde no toca rompe el test.
    expect(planes.map(texto)).toEqual([
      'Mensual libre $8500.00 Recomendado',
      'Dos por semana $6200.00',
      'Clase suelta Consultanos',
    ]);
  });

  it('sin ningun destacado, nadie lleva la insignia', async () => {
    await montar({
      datos: salon({
        packs: [
          { nombre: 'Mensual', precio: '8500.00', destacado: false },
          { nombre: 'Semanal', precio: '3000.00', destacado: false },
        ],
      }),
    });

    expect(screen.queryByText('Recomendado')).toBeNull();
  });
});

describe('Landing · turnos libres, testimonios y preguntas', () => {
  it('un turno libre dice cuando, que clase y en que sala', async () => {
    await montar({ datos: salonCompleto() });

    const turnos = within(screen.getByRole('region', { name: 'Turnos libres' })).getAllByRole(
      'listitem',
    );

    expect(turnos.map(texto)).toEqual(['05/10 · 18:00 · Funcional · Sala 1']);
  });

  it('un testimonio sale con su texto y su firma, y nada mas', async () => {
    await montar({
      datos: salon({
        testimonios: [
          { nombre: 'Ana', texto: 'Cambie de vida.' },
          { nombre: 'Beto', texto: 'Muy buen ambiente.' },
        ],
      }),
    });

    const region = screen.getByRole('region', { name: 'Testimonios' });
    expect(within(region).getAllByRole('listitem').map(texto)).toEqual([
      'Cambie de vida. Ana',
      'Muy buen ambiente. Beto',
    ]);
  });

  it('una pregunta sale con su respuesta', async () => {
    await montar({ datos: salonCompleto() });

    const region = screen.getByRole('region', { name: 'Preguntas frecuentes' });
    expect(within(region).getAllByRole('listitem').map(texto)).toEqual([
      '¿Hay que reservar? Si, desde la app.',
    ]);
  });
});

describe('Landing · el pie', () => {
  it('sin ninguna red, no hay pie', async () => {
    await montar({ datos: salon() });

    expect(seccionesDelDocumento()).toEqual([]);
    expect(enlacesDelDocumento()).toEqual([]);
  });

  it('los tres enlaces, con el destino que les corresponde', async () => {
    await montar({ datos: salonCompleto() });

    // La lista ENTERA de enlaces del documento: uno de mas tambien rompe.
    expect(enlacesDelDocumento()).toEqual([
      ['WhatsApp', 'https://wa.me/5491112345678'],
      ['@boxcaballito', 'https://instagram.com/boxcaballito'],
      ['Más información', 'https://boxcaballito.ejemplo.com/horarios'],
    ]);
  });

  it('un linkExtra que no es https no se enlaza', async () => {
    await montar({ datos: salon({ linkExtra: 'javascript:alert(1)' }) });

    expect(enlacesDelDocumento()).toEqual([]);
    expect(seccionesDelDocumento()).toEqual([]);
  });

  it('un whatsapp que no es un telefono no se enlaza', async () => {
    await montar({ datos: salon({ whatsapp: 'preguntanos!' }) });

    expect(enlacesDelDocumento()).toEqual([]);
  });

  it('con una sola red, el pie existe con ese unico enlace', async () => {
    await montar({ datos: salon({ instagram: 'boxcaballito' }) });

    expect(seccionesDelDocumento()).toEqual(['Contacto']);
    expect(enlacesDelDocumento()).toEqual([
      ['@boxcaballito', 'https://instagram.com/boxcaballito'],
    ]);
  });
});

/**
 * La primera vez en el proyecto que texto escrito por un usuario se muestra en
 * una pagina publica. El dano seria XSS ALMACENADO en el sitio del gimnasio:
 * el admin escribe el testimonio y se ejecuta en el navegador de cualquiera
 * que entre.
 */
describe('Landing · el texto del admin es TEXTO', () => {
  const PAYLOAD = '<script>alert(1)</script>';

  /** Ni un script, ni un iframe, ni una etiqueta de estilo inyectada. */
  function noHayEtiquetasEjecutables(): void {
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('style')).toBeNull();
    expect(document.querySelector('[onerror]')).toBeNull();
  }

  it('un tituloPrincipal con un script sale como texto visible', async () => {
    await montar({ datos: salon({ tituloPrincipal: PAYLOAD }) });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(PAYLOAD);
    noHayEtiquetasEjecutables();
  });

  it('un testimonio con un script sale como texto visible', async () => {
    await montar({
      datos: salon({
        testimonios: [{ nombre: `<img src=x onerror=alert(1)>`, texto: PAYLOAD }],
      }),
    });

    expect(screen.getByText(PAYLOAD)).toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    noHayEtiquetasEjecutables();
  });

  it('una pregunta y su respuesta con un script salen como texto visible', async () => {
    await montar({
      datos: salon({
        preguntas: [{ pregunta: PAYLOAD, respuesta: '<b onmouseover=alert(1)>ojo</b>' }],
      }),
    });

    expect(screen.getByText(PAYLOAD)).toBeInTheDocument();
    expect(screen.getByText('<b onmouseover=alert(1)>ojo</b>')).toBeInTheDocument();
    expect(document.querySelector('b')).toBeNull();
    noHayEtiquetasEjecutables();
  });

  it('sobreElSalon y el tagline tampoco se interpretan', async () => {
    await montar({ datos: salon({ tagline: PAYLOAD, sobreElSalon: PAYLOAD }) });

    expect(screen.getAllByText(PAYLOAD)).toHaveLength(2);
    noHayEtiquetasEjecutables();
  });
});

describe('Landing · los colores', () => {
  function variables(): { primario: string; secundario: string } {
    const raiz = document.querySelector('main');

    return {
      primario: (raiz as HTMLElement).style.getPropertyValue('--salon-primario'),
      secundario: (raiz as HTMLElement).style.getPropertyValue('--salon-secundario'),
    };
  }

  it('los colores validos llegan como variables CSS', async () => {
    await montar({ datos: salon({ colorPrimario: '#101010', colorSecundario: '#f0f0f0' }) });

    expect(variables()).toEqual({ primario: '#101010', secundario: '#f0f0f0' });
  });

  it.each([
    'red; background: url(https://evil.example/pixel.png)',
    // CON almohadilla delante: sin anclar la expresion en los dos extremos,
    // este trae su `#000000` dentro y pasa la validacion entero. Lo encontro
    // la mutacion de quitar el `^` y el `$`.
    '#000000; background: url(https://evil.example/pixel.png)',
    'javascript:alert(1)',
    '',
    'red',
  ])('un colorPrimario %j no llega al DOM', async (color) => {
    const { container } = await montar({ datos: salon({ colorPrimario: color }) });

    expect(variables().primario).toBe('#000000');
    // Y no esta en ninguna otra parte del documento: ni en otro `style`, ni
    // en un atributo, ni en una etiqueta `<style>` montada con una plantilla.
    if (color !== '') expect(container.innerHTML).not.toContain(color);
  });

  it('un colorSecundario invalido cae a su propio valor por defecto', async () => {
    await montar({ datos: salon({ colorSecundario: 'rgb(0,0,0)' }) });

    expect(variables()).toEqual({ primario: '#101010', secundario: '#ffffff' });
  });

  it('no se monta ninguna etiqueta <style>: los colores van por el atributo', async () => {
    await montar({ datos: salonCompleto() });

    expect(document.querySelector('style')).toBeNull();
  });
});

describe('Landing · el SEO', () => {
  it('el titulo de la pestaña es el del gimnasio, no "BoxAdmin"', async () => {
    fetchFalso = vi.fn().mockResolvedValue(respuesta(salon({ tagline: 'Funcional' }), 200));
    vi.stubGlobal('fetch', fetchFalso);

    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'mi-gym' }) });

    expect(meta).toEqual({ title: 'Box Caballito', description: 'Funcional' });
  });

  it('sin tagline no se inventa una descripcion', async () => {
    fetchFalso = vi.fn().mockResolvedValue(respuesta(salon({ tagline: null }), 200));
    vi.stubGlobal('fetch', fetchFalso);

    const meta = await generateMetadata({ params: Promise.resolve({ slug: 'mi-gym' }) });

    expect(meta).toEqual({ title: 'Box Caballito' });
  });

  it('un gimnasio sin web no deja metadatos a medias: es un not-found', async () => {
    fetchFalso = vi.fn().mockResolvedValue(respuesta({ message: 'no' }, 404));
    vi.stubGlobal('fetch', fetchFalso);

    await expect(generateMetadata({ params: Promise.resolve({ slug: 'mi-gym' }) })).rejects.toThrow(
      /NEXT_NOT_FOUND/,
    );
  });
});

/**
 * El PUT de la API acepta `''`: `@IsString()` sin `@IsNotEmpty()`. Un campo
 * vaciado a mano llega como cadena vacia y no como `null`, y una cadena vacia
 * se ve desde la calle igual que un dato ausente — un hueco con un encabezado
 * encima—.
 */
describe('Landing · una cadena vacia es un dato que no vino', () => {
  it.each(['', '   ', '\n'])('un sobreElSalon %j no renderiza la seccion', async (valor) => {
    await montar({ datos: salon({ sobreElSalon: valor }) });

    expect(seccionesDelDocumento()).toEqual([]);
  });

  it.each(['', '   '])('un tagline %j no renderiza un parrafo vacio', async (valor) => {
    const { container } = await montar({ datos: salon({ tagline: valor }) });

    expect(container.querySelectorAll('p')).toHaveLength(0);
  });

  it.each(['', '   '])('un tituloPrincipal %j cae al nombre del gimnasio', async (valor) => {
    await montar({ datos: salon({ tituloPrincipal: valor }) });

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Box Caballito');
  });
});

describe('Landing · el instagram pegado como URL', () => {
  it('se enseña como usuario, no como la URL entera', async () => {
    await montar({ datos: salon({ instagram: 'https://www.instagram.com/boxcaballito/' }) });

    expect(enlacesDelDocumento()).toEqual([
      ['@boxcaballito', 'https://www.instagram.com/boxcaballito/'],
    ]);
  });
});

/**
 * LA PORTADA TAMBIEN SE AUDITA ENTERA.
 *
 * Esto lo encontro la mutacion abierta de la tarea: meter en la portada un
 * dato de mas —"3 lugares libres esta semana", sacado de `turnosLibres`— y
 * SOBREVIVIR a los 307 tests. La auditoria de la ausencia cubria las
 * secciones y los enlaces, pero de la portada solo se comprobaba campo a
 * campo ("el tagline sale", "la imagen sale"), que es justo la forma debil:
 * detecta que falte lo propio, no que sobre lo ajeno.
 *
 * Es la misma familia que el `"Pilates (8 lugares libres)"` del endpoint
 * publico: AÑADIR algo sin quitar nada de lo que ya estaba.
 */
describe('Landing · la portada, entera', () => {
  function portada(): { etiquetas: string[]; texto: string } {
    const cabecera = document.querySelector('header');

    return {
      etiquetas: Array.from(cabecera?.querySelectorAll('*') ?? []).map((elemento) =>
        elemento.tagName.toLowerCase(),
      ),
      texto: texto(cabecera as Element),
    };
  }

  it('con todo cargado, la portada tiene EXACTAMENTE imagen, titulo y tagline', async () => {
    await montar({ datos: salonCompleto() });

    expect(portada()).toEqual({
      etiquetas: ['img', 'h1', 'p'],
      texto: 'Entrena con nosotros Funcional y pilates en Caballito',
    });
  });

  it('sin nada opcional, la portada es SOLO el nombre del gimnasio', async () => {
    await montar({ datos: salon() });

    expect(portada()).toEqual({ etiquetas: ['h1'], texto: 'Box Caballito' });
  });
});

/**
 * UNA FILA A LA QUE LE FALTA LO QUE LA HACE TENER SENTIDO SE DESCARTA.
 *
 * Es la misma regla que un nivel mas arriba: desde la calle, un testimonio con
 * un nombre y nada debajo se ve igual de roto que una seccion con encabezado y
 * nada debajo. Y una pregunta sin respuesta en un FAQ es peor que no tener esa
 * pregunta: parece que el gimnasio dejo algo a medias en su propia web.
 */
describe('Landing · las filas incompletas', () => {
  it('de dos testimonios con uno en blanco, sale la seccion CON UNO SOLO', async () => {
    await montar({
      datos: salon({
        testimonios: [
          { nombre: 'Ana', texto: '   ' },
          { nombre: 'Beto', texto: 'Muy buen ambiente.' },
        ],
      }),
    });

    // Ni la seccion con un hueco, ni la seccion entera caida.
    expect(seccionesDelDocumento()).toEqual(['Testimonios']);
    const region = screen.getByRole('region', { name: 'Testimonios' });
    expect(within(region).getAllByRole('listitem').map(texto)).toEqual(['Muy buen ambiente. Beto']);
  });

  it('manda el texto, no el nombre: con texto y sin nombre el testimonio SE QUEDA', async () => {
    await montar({ datos: salon({ testimonios: [{ nombre: '  ', texto: 'Cambie de vida.' }] }) });

    const region = screen.getByRole('region', { name: 'Testimonios' });
    // Un testimonio anonimo sigue sirviendo; lo que no puede quedar es la
    // firma vacia colgando debajo.
    expect(within(region).getAllByRole('listitem').map(texto)).toEqual(['Cambie de vida.']);
    expect(region.querySelectorAll('p')).toHaveLength(0);
  });

  it('si TODOS los testimonios estan en blanco, no hay seccion', async () => {
    await montar({
      datos: salon({
        testimonios: [
          { nombre: 'Ana', texto: '' },
          { nombre: 'Beto', texto: '   ' },
        ],
      }),
    });

    // Fija el orden: primero se filtra y DESPUES se decide si hay seccion.
    expect(seccionesDelDocumento()).toEqual([]);
  });

  it('en una pregunta mandan los dos campos', async () => {
    await montar({
      datos: salon({
        preguntas: [
          { pregunta: '¿Cuanto sale?', respuesta: '' },
          { pregunta: '   ', respuesta: 'Desde las 7.' },
          { pregunta: '¿Hay duchas?', respuesta: 'Si, dos.' },
        ],
      }),
    });

    expect(seccionesDelDocumento()).toEqual(['Preguntas frecuentes']);
    const region = screen.getByRole('region', { name: 'Preguntas frecuentes' });
    expect(within(region).getAllByRole('listitem').map(texto)).toEqual(['¿Hay duchas? Si, dos.']);
  });

  it('si todas las preguntas estan incompletas, no hay seccion', async () => {
    await montar({
      datos: salon({
        preguntas: [
          { pregunta: '¿Cuanto?', respuesta: '' },
          { pregunta: '', respuesta: 'Depende' },
        ],
      }),
    });

    expect(seccionesDelDocumento()).toEqual([]);
  });
});

describe('Landing · los planes y los turnos incompletos', () => {
  it('un pack sin nombre se descarta, aunque tenga precio', async () => {
    await montar({
      datos: salon({
        packs: [
          { nombre: '   ', precio: '8500.00', destacado: true },
          { nombre: 'Mensual libre', precio: '6200.00', destacado: false },
        ],
      }),
    });

    // Un plan sin nombre con la insignia de destacado le da aire de
    // intencional a lo que es un error de carga.
    expect(seccionesDelDocumento()).toEqual(['Planes']);
    const region = screen.getByRole('region', { name: 'Planes' });
    expect(within(region).getAllByRole('listitem').map(texto)).toEqual(['Mensual libre $6200.00']);
  });

  it('un pack SIN PRECIO no se descarta: "Consultanos" es una oferta valida', async () => {
    await montar({
      datos: salon({ packs: [{ nombre: 'Clase suelta', precio: null, destacado: false }] }),
    });

    const region = screen.getByRole('region', { name: 'Planes' });
    expect(within(region).getAllByRole('listitem').map(texto)).toEqual([
      'Clase suelta Consultanos',
    ]);
  });

  it('si ningun pack tiene nombre, no hay seccion', async () => {
    await montar({ datos: salon({ packs: [{ nombre: '', precio: '8500.00', destacado: true }] }) });

    expect(seccionesDelDocumento()).toEqual([]);
  });

  it.each(['fecha', 'horaInicio', 'clase', 'salaNombre'] as const)(
    'un turno libre sin %s se descarta entero',
    async (campo) => {
      await montar({
        datos: salon({
          turnosLibres: [
            {
              fecha: '2026-10-05',
              horaInicio: '18:00',
              clase: 'Funcional',
              salaNombre: 'Sala 1',
              [campo]: '  ',
            },
            {
              fecha: '2026-10-06',
              horaInicio: '19:00',
              clase: 'Pilates',
              salaNombre: 'Sala 2',
            },
          ],
        }),
      });

      // Un turno menos en la agenda no lo nota nadie; un "05/10 · 18:00 ·  ·
      // Sala 1" con el hueco a la vista, si. Y si el que falta es la fecha o
      // la hora —que no las escribe el admin— algo se rompio aguas arriba, y
      // `"/"` en la pantalla es la peor forma de enterarse.
      expect(seccionesDelDocumento()).toEqual(['Turnos libres']);
      const region = screen.getByRole('region', { name: 'Turnos libres' });
      expect(within(region).getAllByRole('listitem').map(texto)).toEqual([
        '06/10 · 19:00 · Pilates · Sala 2',
      ]);
    },
  );

  it('si todos los turnos estan incompletos, no hay seccion', async () => {
    await montar({
      datos: salon({
        turnosLibres: [
          { fecha: '', horaInicio: '18:00', clase: 'Funcional', salaNombre: 'Sala 1' },
          { fecha: '2026-10-06', horaInicio: '19:00', clase: '  ', salaNombre: 'Sala 2' },
        ],
      }),
    });

    expect(seccionesDelDocumento()).toEqual([]);
  });
});

/**
 * El recorte importa justo donde los espacios NO se colapsan.
 */
describe('Landing · los bordes del texto', () => {
  it('sobreElSalon pierde los saltos de los bordes y CONSERVA el del medio', async () => {
    await montar({
      datos: salon({ sobreElSalon: '\n\nAbrimos en 2015.\nSomos dos profesoras.\n\n' }),
    });

    const parrafo = screen.getByRole('region', { name: 'Sobre el salón' }).querySelector('p');

    // Afirmar solo sobre el recorte dejaria pasar la mutacion de "recortar
    // tambien los de adentro": el salto del medio lo puso el admin a
    // proposito y tiene que seguir ahi.
    expect(parrafo?.textContent).toBe('Abrimos en 2015.\nSomos dos profesoras.');
    // Y se tiene que VER como salto: sin esto el HTML lo colapsa a un espacio
    // y el parrafo del admin sale de corrido.
    expect(parrafo?.className).toContain('whitespace-pre-line');
  });

  it('el texto de un testimonio tambien sale recortado', async () => {
    await montar({ datos: salon({ testimonios: [{ nombre: '  Ana  ', texto: '  Genial.  ' }] }) });

    const region = screen.getByRole('region', { name: 'Testimonios' });
    expect(region.querySelector('blockquote')?.textContent).toBe('Genial.');
    expect(region.querySelector('p')?.textContent).toBe('Ana');
  });
});
