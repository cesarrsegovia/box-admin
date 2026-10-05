import { describe, expect, it } from 'vitest';
import {
  enlaceDeInstagram,
  enlaceDeWhatsapp,
  urlHttps,
  usuarioDeInstagram,
} from './enlaces-del-salon';

describe('urlHttps', () => {
  it('deja pasar una https y la devuelve normalizada', () => {
    expect(urlHttps('https://ejemplo.com/foto.jpg')).toBe('https://ejemplo.com/foto.jpg');
    expect(urlHttps('https://ejemplo.com')).toBe('https://ejemplo.com/');
    expect(urlHttps('HTTPS://Ejemplo.com/Foto.JPG')).toBe('https://ejemplo.com/Foto.JPG');
  });

  it.each([
    // El esquema es la defensa: en el `src` de una imagen de una pagina
    // publica esto es XSS almacenado en el sitio del gimnasio.
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    // Contenido mixto: el navegador lo bloquea sin decirle nada al gimnasio,
    // y la landing queda con un hueco que nadie sabe explicar.
    'http://ejemplo.com/foto.jpg',
    'ejemplo.com/foto.jpg',
    '//ejemplo.com/foto.jpg',
    'file:///etc/passwd',
    '',
    '   ',
  ])('%j no es una url usable', (entrada) => {
    expect(urlHttps(entrada)).toBeNull();
  });

  it('lo que no es una cadena tampoco', () => {
    expect(urlHttps(undefined as unknown as string)).toBeNull();
    expect(urlHttps(null as unknown as string)).toBeNull();
  });
});

describe('enlaceDeWhatsapp', () => {
  it('se queda con los digitos y arma el wa.me', () => {
    expect(enlaceDeWhatsapp('+54 9 11 1234-5678')).toBe('https://wa.me/5491112345678');
    expect(enlaceDeWhatsapp('5491112345678')).toBe('https://wa.me/5491112345678');
    expect(enlaceDeWhatsapp('(011) 1234 5678')).toBe('https://wa.me/01112345678');
  });

  it.each([
    // Queda un solo digito tras limpiar: no es un telefono.
    'javascript:alert(1)',
    'llamanos',
    '',
    '12345',
    // Mas largo que cualquier numero E.164.
    '123456789012345678901234567890',
  ])('%j no es un telefono', (entrada) => {
    expect(enlaceDeWhatsapp(entrada)).toBeNull();
  });

  it('el enlace NUNCA sale de wa.me, por raro que sea lo que escriban', () => {
    for (const entrada of ['54 evil.com 911', 'https://evil.example/?x=54911234567']) {
      const enlace = enlaceDeWhatsapp(entrada);
      if (enlace !== null) expect(new URL(enlace).host).toBe('wa.me');
    }
  });
});

describe('enlaceDeInstagram', () => {
  it('acepta el usuario, con o sin arroba', () => {
    expect(enlaceDeInstagram('migym')).toBe('https://instagram.com/migym');
    expect(enlaceDeInstagram('@mi.gym_01')).toBe('https://instagram.com/mi.gym_01');
    expect(enlaceDeInstagram('  migym  ')).toBe('https://instagram.com/migym');
  });

  it('acepta tambien la URL entera, que es lo que la mitad de la gente pega', () => {
    expect(enlaceDeInstagram('https://instagram.com/migym')).toBe('https://instagram.com/migym');
    expect(enlaceDeInstagram('https://www.instagram.com/migym/')).toBe(
      'https://www.instagram.com/migym/',
    );
  });

  it('un dominio que solo TERMINA en instagram.com no es instagram.com', () => {
    // `endsWith('instagram.com')` a secas aceptaria este.
    expect(enlaceDeInstagram('https://notinstagram.com/migym')).toBeNull();
    expect(enlaceDeInstagram('https://instagram.com.evil.example/migym')).toBeNull();
  });

  it.each([
    'javascript:alert(1)',
    'https://evil.example/migym',
    'http://instagram.com/migym',
    'mi gym',
    'mi/gym',
    '@',
    '',
    // Mas de 30 caracteres: Instagram no los admite y nosotros tampoco.
    'a'.repeat(31),
  ])('%j no es un usuario de instagram', (entrada) => {
    expect(enlaceDeInstagram(entrada)).toBeNull();
  });
});

describe('usuarioDeInstagram', () => {
  it('saca el usuario del enlace, haya escrito lo que haya escrito', () => {
    expect(usuarioDeInstagram('https://instagram.com/migym')).toBe('@migym');
    expect(usuarioDeInstagram('https://www.instagram.com/migym/')).toBe('@migym');
  });

  it('un enlace a la portada de Instagram no se enseña como "@"', () => {
    expect(usuarioDeInstagram('https://instagram.com/')).toBe('Instagram');
  });
});
