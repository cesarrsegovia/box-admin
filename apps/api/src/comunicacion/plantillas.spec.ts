import Handlebars from 'handlebars';
import { $Enums } from '@prisma/client';
import { TIPOS_DE_PLANTILLA } from '@boxadmin/shared';
import { motivoDePlantillaInvalida, PLANTILLAS_POR_DEFECTO, resolverMensaje } from './plantillas';

const DATOS = {
  alumno: 'Ana Perez',
  gimnasio: 'Box Palermo',
  clase: 'Pilates',
  fecha: '2026-09-07',
  hora: '18:00',
};

describe('resolverMensaje', () => {
  it('sin plantilla propia usa la del codigo', () => {
    const { asunto, html } = resolverMensaje(null, 'CONFIRMACION', DATOS);

    // Contra el contenido real, no contra otra llamada a la misma funcion: eso
    // ultimo pasaria aunque `resolverMensaje` devolviera siempre lo mismo.
    expect(asunto).toContain('Pilates');
    expect(html).toContain('Ana Perez');
    expect(html).toContain('18:00');
  });

  it('la del gimnasio gana a la del codigo', () => {
    const propia = { asunto: 'Che {{alumno}}', cuerpoHtml: '<p>{{clase}} el {{fecha}}</p>' };

    const { asunto, html } = resolverMensaje(propia, 'CONFIRMACION', DATOS);

    expect(asunto).toBe('Che Ana Perez');
    expect(html).toBe('<p>Pilates el 2026-09-07</p>');
  });

  it('un dato que la plantilla no usa no molesta', () => {
    const propia = { asunto: 'Hola', cuerpoHtml: '<p>{{alumno}}</p>' };

    expect(resolverMensaje(propia, 'CONFIRMACION', DATOS).html).toBe('<p>Ana Perez</p>');
  });

  it('un hueco sin dato queda vacio, no rompe', () => {
    const propia = { asunto: '{{noExiste}}', cuerpoHtml: '<p>{{tampoco}}</p>' };

    const { asunto, html } = resolverMensaje(propia, 'CONFIRMACION', DATOS);

    expect(asunto).toBe('');
    expect(html).toBe('<p></p>');
  });

  it('el HTML del dato sale ESCAPADO', () => {
    // Las plantillas las escribe el admin y los datos vienen de nombres que
    // eligen los alumnos. Con {{{ }}} en vez de {{ }}, un alumno llamado
    // <script> seria XSS contra el admin que previsualiza.
    const propia = { asunto: 'x', cuerpoHtml: '<p>{{alumno}}</p>' };

    const { html } = resolverMensaje(propia, 'CONFIRMACION', {
      ...DATOS,
      alumno: '<script>alert(1)</script>',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('el asunto NO se escapa aunque el cuerpo SI, en la misma llamada', () => {
    // El asunto termina en el `subject` de nodemailer, que es texto plano: no
    // hay HTML que interpretar, asi que escaparlo no defiende de nada y si
    // rompe apellidos corrientes. El cuerpo si es HTML y ahi el escapado es la
    // defensa de la fase.
    //
    // Las dos comprobaciones van en la MISMA llamada a proposito: separadas,
    // alguien podria unificar las dos ramas de `resolverMensaje` y hacer pasar
    // cada una por su lado cambiando su expectativa. Juntas, ninguna version
    // con una sola rama las satisface.
    const propia = { asunto: 'Hola {{alumno}}', cuerpoHtml: '<p>{{alumno}}</p>' };

    const { asunto, html } = resolverMensaje(propia, 'CONFIRMACION', {
      ...DATOS,
      alumno: "O'Brien & Ana",
    });

    expect(asunto).toBe("Hola O'Brien & Ana");
    expect(html).toBe('<p>O&#x27;Brien &amp; Ana</p>');
  });

  it('el contrato de TipoPlantilla no se separo del enum de Prisma', () => {
    // Son dos listas de cinco valores en archivos distintos: el union de
    // `packages/shared` y el enum del schema. TypeScript no puede ver la deriva
    // —el union es solo strings— asi que el dia que alguien anada un tipo al
    // schema y olvide el contrato, el fallo sale en RUNTIME al guardar.
    //
    // Mismo criterio que el centinela de clasificacion de modelos en
    // `tenant-scoped.extension.spec.ts`, que existe por la misma razon. Vive
    // aqui y no en `packages/shared` porque ese paquete no depende de Prisma, y
    // no deberia.
    //
    // La fuente es `$Enums` y no `Prisma.dmmf.datamodel.enums` —que es lo que
    // usa el centinela de modelos— porque en Prisma 7 el dmmf del cliente en
    // runtime trae los modelos pero deja `enums` vacio. `$Enums.TipoPlantilla`
    // lo genera `prisma generate` a partir del schema, asi que sigue siendo el
    // schema quien manda y la deriva se sigue viendo.
    const delEsquema = Object.keys($Enums.TipoPlantilla);

    expect([...TIPOS_DE_PLANTILLA].sort()).toEqual([...delEsquema].sort());
  });

  it('hay una plantilla por defecto para cada tipo', () => {
    // Si alguien anade un tipo al enum y se olvida del texto, el email saldria
    // vacio. Esto lo caza antes.
    for (const [tipo, plantilla] of Object.entries(PLANTILLAS_POR_DEFECTO)) {
      expect(plantilla.asunto.length).toBeGreaterThan(0);
      expect(plantilla.cuerpoHtml.length).toBeGreaterThan(0);
      expect(tipo.length).toBeGreaterThan(0);
    }
    expect(Object.keys(PLANTILLAS_POR_DEFECTO)).toHaveLength(5);
  });

  it('las plantillas por defecto se renderizan sin dejar huecos', () => {
    for (const tipo of Object.keys(PLANTILLAS_POR_DEFECTO)) {
      const { asunto, html } = resolverMensaje(null, tipo as never, DATOS);
      expect(asunto).not.toContain('{{');
      expect(html).not.toContain('{{');
    }
  });
});

describe('motivoDePlantillaInvalida', () => {
  it('acepta las plantillas del codigo', () => {
    for (const plantilla of Object.values(PLANTILLAS_POR_DEFECTO)) {
      expect(motivoDePlantillaInvalida(plantilla)).toBeNull();
    }
  });

  it('caza un bloque sin cerrar', () => {
    expect(motivoDePlantillaInvalida({ asunto: 'x', cuerpoHtml: '{{#if a}}sin cerrar' })).toMatch(
      /Parse error/,
    );
  });

  it('caza una llave sin cerrar en el asunto', () => {
    expect(motivoDePlantillaInvalida({ asunto: 'Hola {{a', cuerpoHtml: '<p>x</p>' })).toMatch(
      /Parse error/,
    );
  });

  it('NO se puede escribir con Handlebars.compile, que es perezoso', () => {
    // Fija la trampa por la que esta funcion usa `precompile`: `compile` no
    // parsea hasta que se invoca la funcion que devuelve, asi que un
    // `try { compile(x) } catch` no comprueba nada. Si esto algun dia lanza,
    // Handlebars cambio y el comentario de la funcion hay que reescribirlo.
    expect(() => Handlebars.compile('{{#if a}}sin cerrar')).not.toThrow();
  });
});
