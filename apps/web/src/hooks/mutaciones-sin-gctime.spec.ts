import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mutacionesDeLosHooks } from '@/test/mutaciones-sin-gctime';

/**
 * UN SOLO CENTINELA PARA TODOS LOS HOOKS.
 *
 * Esto reemplaza a los tres analizadores que vivian copiados dentro de
 * `use-usuarios.spec`, `use-turnos.spec` y `use-calendario-admin.spec`. No por
 * ahorrar lineas: por la propiedad. Un centinela por spec cubre los archivos
 * que ya tienen spec y deja nacer desnudo al siguiente, porque hay que
 * acordarse de copiarlo. Asi se quedo afuera `use-comprobantes` —guardando el
 * `File` del comprobante de pago del alumno en la cache de mutaciones— y asi
 * `use-rutinas`, que no tiene spec ninguno, no podia estar cubierto por nadie.
 *
 * Ahora la garantia es del DIRECTORIO: un archivo de hooks nuevo nace cubierto
 * sin su propio spec y sin figurar en ninguna lista. El porque de la regla
 * esta en `src/test/mutaciones-sin-gctime.ts`.
 */
// Desde la raiz de Vitest (`apps/web`), no desde `import.meta.url`: bajo jsdom
// esa URL no es `file:` y `readFileSync` la rechaza.
const HOOKS = resolve(process.cwd(), 'src/hooks');

describe('ninguna mutacion sin gcTime', () => {
  it('ningun hook del proyecto deja una mutacion sin tapar', () => {
    const todas = mutacionesDeLosHooks(HOOKS);

    // UN CONJUNTO VACIO CUMPLE CUALQUIER COSA QUE SE LE PIDA. Si el analizador
    // dejara de casar —un cambio de estilo, un `useMutation` partido en dos
    // lineas, un directorio mal resuelto—, el barrido no daria error: daria
    // una lista corta, y una lista corta aprueba. El suelo es lo unico que
    // distingue "no hay ninguna desnuda" de "no estoy mirando nada".
    expect(
      todas.length,
      'el barrido saco menos mutaciones de las que hay: el analizador dejo de casar',
    ).toBeGreaterThanOrEqual(20);

    // Y que vengan de varios archivos: un directorio que se filtrara entero
    // menos uno tambien pasaria el suelo si ese uno tuviera muchas.
    expect(
      new Set(todas.map((m) => m.archivo)).size,
      'el barrido toco menos archivos de los que hay',
    ).toBeGreaterThanOrEqual(6);

    // Nombrando archivo Y hook, y como UNA CADENA y no como lista: con una
    // lista, el diff de Vitest la resume en `[ Array(1) ]` y el fallo deja de
    // decir donde esta el problema, que es justo para lo que sirve.
    const desnudas = todas.filter((m) => !m.tapada).map((m) => `${m.archivo} → ${m.hook}`);
    expect(desnudas.join('\n'), 'hay mutaciones sin `gcTime: 0`').toBe('');
  });
});
