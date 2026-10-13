import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutacionesDeLosHooks, soloCodigo } from './mutaciones-sin-gctime';

/**
 * EL INSTRUMENTO, PROBADO.
 *
 * El barrido de `mutaciones-sin-gctime.spec.ts` solo vale lo que valga su
 * analizador: si deja de casar, no da error, da una lista corta — y una lista
 * corta aprueba. Asi que aqui se le dan archivos de hooks de mentira y se mira
 * que encuentre lo que tiene que encontrar y que se queje de lo que no.
 */
let directorio = '';

function conArchivos(archivos: Record<string, string>): string {
  directorio = mkdtempSync(join(tmpdir(), 'hooks-de-mentira-'));
  for (const [nombre, contenido] of Object.entries(archivos)) {
    writeFileSync(join(directorio, nombre), contenido, 'utf8');
  }
  return directorio;
}

afterEach(() => {
  if (directorio !== '') rmSync(directorio, { recursive: true, force: true });
  directorio = '';
});

describe('mutacionesDeLosHooks', () => {
  it('UN ARCHIVO NUEVO CON UNA MUTACION DESNUDA CAE SOLO', () => {
    // Lo que no puede pasar: que haya que acordarse de sumarlo a una lista.
    // Este archivo no figura en ningun lado y el barrido lo encuentra igual.
    const dir = conArchivos({
      'use-recien-llegado.ts': [
        'export function useAlgoNuevo() {',
        '  return useMutation<void, Error, string>({',
        "    mutationFn: (x) => pedir(`/algo/${x}`, { metodo: 'POST' }),",
        '  });',
        '}',
      ].join('\n'),
    });

    expect(mutacionesDeLosHooks(dir)).toEqual([
      { archivo: 'use-recien-llegado.ts', hook: 'useAlgoNuevo', tapada: false },
    ]);
  });

  it('reconoce LAS DOS FORMAS de declararlas, con su nombre cada una', () => {
    // `const x = useMutation(...)` trae el nombre puesto; `return useMutation`
    // lo toma del `export function`. Sin la primera, los cuatro de
    // `use-acciones-de-turno` se llamarian todos `useAccionesDeTurno` y, en un
    // mapa por nombre, tres desaparecerian detras del cuarto.
    const dir = conArchivos({
      'use-dos-formas.ts': [
        'export function useVarias() {',
        '  const reservar = useMutation<void, Error, string>({',
        '    mutationFn: () => 1,',
        '    gcTime: 0,',
        '  });',
        '',
        '  const cancelar = useMutation<void, Error, string>({',
        '    mutationFn: () => 2,',
        '  });',
        '',
        '  return { reservar, cancelar };',
        '}',
      ].join('\n'),
    });

    expect(mutacionesDeLosHooks(dir)).toEqual([
      { archivo: 'use-dos-formas.ts', hook: 'reservar', tapada: true },
      { archivo: 'use-dos-formas.ts', hook: 'cancelar', tapada: false },
    ]);
  });

  it('un comentario que NOMBRE `gcTime: 0` no viste a nadie', () => {
    // Los hooks de verdad estan llenos de comentarios que lo explican. Un
    // analizador que mirara el texto crudo daria por tapada a una mutacion
    // desnuda que tuviera uno al lado: verde por casualidad ortografica.
    const dir = conArchivos({
      'use-con-comentario.ts': [
        'export function useComentado() {',
        '  // Todas las mutaciones de este archivo llevan gcTime: 0.',
        '  /* De verdad: gcTime: 0 en todas. */',
        '  return useMutation<void, Error, void>({',
        "    mutationFn: () => pedir('/x', { metodo: 'POST' }),",
        '  });',
        '}',
      ].join('\n'),
    });

    expect(mutacionesDeLosHooks(dir)).toEqual([
      { archivo: 'use-con-comentario.ts', hook: 'useComentado', tapada: false },
    ]);
  });

  it('el `gcTime: 0` del vecino no tapa al de al lado', () => {
    // El analizador viejo delimitaba por sangria ("hasta el `});` a dos
    // espacios"). Una mutacion declarada a otra profundidad estiraba su bloque
    // hasta el cierre de la SIGUIENTE y heredaba un `gcTime: 0` que no tenia.
    const dir = conArchivos({
      'use-vecinos.ts': [
        'export function useDesnuda() {',
        '  if (true) {',
        '    const interna = useMutation<void, Error, void>({',
        '      mutationFn: () => 1,',
        '    });',
        '    return interna;',
        '  }',
        '}',
        '',
        'export function useVestida() {',
        '  return useMutation<void, Error, void>({',
        '    mutationFn: () => 2,',
        '    gcTime: 0,',
        '  });',
        '}',
      ].join('\n'),
    });

    expect(mutacionesDeLosHooks(dir)).toEqual([
      { archivo: 'use-vecinos.ts', hook: 'interna', tapada: false },
      { archivo: 'use-vecinos.ts', hook: 'useVestida', tapada: true },
    ]);
  });

  it('NO PUEDE PASAR CON LAS MANOS VACIAS: si nombra useMutation, tiene que sacarla', () => {
    // El modo mas barato de tener un centinela que saluda a un pasillo vacio:
    // que el analizador deje de casar y devuelva una lista vacia. Eso no es un
    // archivo limpio, es un analizador roto, y tiene que doler aqui.
    const dir = conArchivos({
      // Una forma que el analizador NO sabe leer: el `useMutation` y su
      // parentesis separados por un comentario de bloque.
      'use-rara.ts': 'export function useRara() {\n  return useMutation /* hola */ ({});\n}',
    });

    expect(() => mutacionesDeLosHooks(dir)).toThrow(/use-rara\.ts/);
  });

  it('un directorio sin hooks devuelve una lista vacia sin romperse', () => {
    // La otra cara: no hay que confundir "no hay mutaciones" con "el analizador
    // fallo". El suelo que distingue las dos cosas lo pone el spec del barrido.
    expect(mutacionesDeLosHooks(conArchivos({ 'use-sin-nada.ts': 'export const a = 1;' }))).toEqual(
      [],
    );
  });

  it('ignora los specs: lo que se audita es el hook, no su prueba', () => {
    const dir = conArchivos({
      'use-x.ts': 'export function useX() {\n  return useMutation({ gcTime: 0 });\n}',
      'use-x.spec.tsx': 'const falso = useMutation({});',
    });

    expect(mutacionesDeLosHooks(dir).map((m) => m.archivo)).toEqual(['use-x.ts']);
  });

  it('dos mutaciones con el mismo nombre no se tapan entre si', () => {
    // Si se guardaran en un mapa por nombre, la ultima pisaria a la primera y
    // una desnuda desapareceria detras de una vestida.
    const dir = conArchivos({
      'use-homonimas.ts': [
        'export function useDos() {',
        '  const guardar = useMutation({ gcTime: 0 });',
        '  const otra = () => {',
        '    const guardar = useMutation({});',
        '    return guardar;',
        '  };',
        '  return { guardar, otra };',
        '}',
      ].join('\n'),
    });

    expect(mutacionesDeLosHooks(dir)).toEqual([
      { archivo: 'use-homonimas.ts', hook: 'guardar', tapada: true },
      { archivo: 'use-homonimas.ts', hook: 'guardar #2', tapada: false },
    ]);
  });
});

describe('soloCodigo', () => {
  it('vacia comentarios y textos sin mover las posiciones', () => {
    const fuente = "const a = 'hola {'; // gcTime: 0\nconst b = 1;";
    const limpio = soloCodigo(fuente);

    // Mismas posiciones: los indices del analizador valen para los dos.
    expect(limpio.length).toBe(fuente.length);
    expect(limpio).not.toContain('gcTime');
    // La llave de dentro del texto no cuenta como llave.
    expect(limpio).not.toContain('{');
    expect(limpio).toContain('const b = 1;');
  });
});
