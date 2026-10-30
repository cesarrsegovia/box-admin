import { describe, expect, it } from 'vitest';
import { metadata } from './page';

describe('la pagina de mi liquidacion', () => {
  it('tiene titulo propio, distinto del «Mis clases» del layout', () => {
    expect(metadata.title).toBe('Mi liquidación · BoxAdmin');
  });
});
