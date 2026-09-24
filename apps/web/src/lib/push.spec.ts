import { describe, expect, it } from 'vitest';
import {
  claveAplicacionDesdeBase64,
  contenidoDeNotificacion,
  destinoDeNotificacion,
  serializar,
} from './push';

/** Lo minimo de `PushSubscription` que usa `serializar`. */
function suscripcionFalsa(json: unknown, endpoint = 'https://push.example/abc'): PushSubscription {
  return { endpoint, toJSON: () => json } as unknown as PushSubscription;
}

describe('claveAplicacionDesdeBase64', () => {
  it('traduce el alfabeto base64url: `-` es `+` y `_` es `/`', () => {
    // 0xFB 0xFF 0xBE en base64 es "+/++", y en base64url "-_--".
    const conBase64url = claveAplicacionDesdeBase64('-_--');

    expect([...conBase64url]).toEqual([0xfb, 0xff, 0xbe]);
  });

  it('rellena el padding que base64url no lleva', () => {
    // "TQ" sin relleno no es base64 valido; con "==" decodifica a 0x4d.
    expect([...claveAplicacionDesdeBase64('TQ')]).toEqual([0x4d]);
    expect([...claveAplicacionDesdeBase64('TWE')]).toEqual([0x4d, 0x61]);
    expect([...claveAplicacionDesdeBase64('TWFu')]).toEqual([0x4d, 0x61, 0x6e]);
  });

  it('no añade relleno cuando la longitud ya es multiplo de cuatro', () => {
    expect([...claveAplicacionDesdeBase64('TWFu')]).toHaveLength(3);
  });

  it('devuelve bytes, no caracteres: una clave VAPID real son 65 bytes', () => {
    // Una clave P-256 sin comprimir: 0x04 y dos coordenadas de 32 bytes.
    const bytes = new Uint8Array(65);
    bytes[0] = 0x04;
    for (let i = 1; i < 65; i += 1) bytes[i] = i;
    const base64url = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const vuelta = claveAplicacionDesdeBase64(base64url);

    expect(vuelta).toBeInstanceOf(Uint8Array);
    expect([...vuelta]).toEqual([...bytes]);
  });
});

describe('serializar', () => {
  it('saca las dos claves que la API necesita', () => {
    const salida = serializar(
      suscripcionFalsa({
        endpoint: 'https://push.example/abc',
        keys: { p256dh: 'clave-publica', auth: 'secreto' },
      }),
    );

    expect(salida).toEqual({
      endpoint: 'https://push.example/abc',
      p256dh: 'clave-publica',
      auth: 'secreto',
    });
  });

  it('si el JSON no trae endpoint usa el de la propia suscripcion', () => {
    const salida = serializar(suscripcionFalsa({ keys: { p256dh: 'p', auth: 'a' } }));

    expect(salida.endpoint).toBe('https://push.example/abc');
  });

  it('sin claves devuelve cadenas vacias, que la API rechaza con un 400', () => {
    // Preferible a mandar `undefined`, que el JSON se come y convierte el 400
    // en un "endpoint requerido" que despista.
    const salida = serializar(suscripcionFalsa({ endpoint: 'https://push.example/abc' }));

    expect(salida).toEqual({ endpoint: 'https://push.example/abc', p256dh: '', auth: '' });
  });
});

describe('contenidoDeNotificacion', () => {
  it('saca titulo, cuerpo y url del JSON que mando la API', () => {
    expect(
      contenidoDeNotificacion(
        JSON.stringify({ titulo: 'Reserva confirmada', cuerpo: 'Hola Ana', url: '/calendario' }),
      ),
    ).toEqual({ titulo: 'Reserva confirmada', cuerpo: 'Hola Ana', url: '/calendario' });
  });

  it('NO escapa el titulo: llega sin escapar a proposito y se muestra como texto', () => {
    // El asunto de la plantilla no se escapa en la API (escaparlo estropeaba
    // "O'Brien & Ana" en la bandeja de entrada) y aqui tampoco: quien lo pinte
    // en el DOM tiene que hacerlo como TEXTO, nunca como HTML.
    const { titulo } = contenidoDeNotificacion(JSON.stringify({ titulo: "O'Brien & Ana" }));

    expect(titulo).toBe("O'Brien & Ana");
  });

  it('un cuerpo que no es JSON no revienta el service worker', () => {
    expect(contenidoDeNotificacion('esto no es json')).toEqual({
      titulo: 'BoxAdmin',
      cuerpo: '',
      url: '/',
    });
  });

  it('un JSON valido que no es un objeto tampoco', () => {
    expect(contenidoDeNotificacion('null').titulo).toBe('BoxAdmin');
    expect(contenidoDeNotificacion('3').titulo).toBe('BoxAdmin');
    expect(contenidoDeNotificacion('"hola"').titulo).toBe('BoxAdmin');
  });

  it('sin cuerpo ninguno, una notificacion con la marca y nada mas', () => {
    expect(contenidoDeNotificacion(undefined)).toEqual({
      titulo: 'BoxAdmin',
      cuerpo: '',
      url: '/',
    });
  });

  it('ignora los campos que no son cadenas en vez de pintarlos', () => {
    // `String({})` seria "[object Object]" en la pantalla del alumno.
    expect(contenidoDeNotificacion(JSON.stringify({ titulo: {}, cuerpo: 7, url: [] }))).toEqual({
      titulo: 'BoxAdmin',
      cuerpo: '',
      url: '/',
    });
  });
});

describe('destinoDeNotificacion: la ruta viene completa y no se toca', () => {
  it('una ruta con su gimnasio se abre TAL CUAL', () => {
    // Lo que manda la API: el `urlPush` de los processors ya lleva el slug. Este
    // es el unico test que veria un bug que antepusiera algo delante.
    expect(destinoDeNotificacion('/mi-gym/mi-pack')).toBe('/mi-gym/mi-pack');
    expect(destinoDeNotificacion('/mi-gym/calendario')).toBe('/mi-gym/calendario');
  });

  it('una ruta mas profunda tampoco se toca', () => {
    expect(destinoDeNotificacion('/mi-gym/calendario/2026-09')).toBe('/mi-gym/calendario/2026-09');
  });

  it('una ruta sin gimnasio se abre tal cual y NO se le inventa uno', () => {
    // Un 404 honesto. Adivinar el gimnasio desde una pestaña abierta llevaria a
    // un socio de dos gimnasios a la pantalla del OTRO: plausible y equivocada,
    // que es peor que el 404 porque no se nota.
    expect(destinoDeNotificacion('/calendario')).toBe('/calendario');
  });
});

describe('destinoDeNotificacion: nunca fuera de la aplicacion', () => {
  it('nunca sale del origen de la aplicacion', () => {
    expect(destinoDeNotificacion('https://otro-sitio.test/robo')).toBe('/');
    // `//otro-sitio.test` es una URL relativa al PROTOCOLO: otro origen.
    expect(destinoDeNotificacion('//otro-sitio.test/robo')).toBe('/');
    // Varios navegadores normalizan la barra invertida a barra normal.
    expect(destinoDeNotificacion('/\\otro-sitio.test/robo')).toBe('/');
    expect(destinoDeNotificacion('javascript:alert(1)')).toBe('/');
  });

  it('sin destino, la raiz', () => {
    expect(destinoDeNotificacion('/')).toBe('/');
    expect(destinoDeNotificacion(undefined)).toBe('/');
  });
});
