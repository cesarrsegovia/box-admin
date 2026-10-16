'use client';

import { useState } from 'react';
import {
  PATRON_FECHA,
  PATRON_HORA,
  horasSeSolapan,
  type HorarioProfesorPublico,
} from '@boxadmin/shared';
import { Campo } from '@/componentes/formulario';
import { Aviso, Boton } from '@/componentes/ui';
import { Seleccion } from '../usuarios/[id]/controles';

/**
 * EL FORMULARIO DE UN HORARIO FIJO, el de alta y el de edicion.
 *
 * Es UN solo componente con dos modos y no dos componentes porque los dos
 * formularios comparten las seis decisiones dificiles —la tarifa que es dinero,
 * el `hasta` que puede ser indefinido, que validaciones se hacen aqui y cuales
 * NO— y dos copias significa arreglarlas en una y dejarlas rotas en la otra.
 * Lo unico que cambia entre modos es QUE CAMPOS se dibujan y QUE CUERPO sale.
 *
 * EN EDICION NO SE OFRECEN NI LA PROFESORA NI LA SALA, y no es una omision
 * cosmetica: `ActualizarHorarioProfesorDto` las EXCLUYE a proposito —«mover un
 * horario de profesora o de sala por PATCH dejaria los turnos ya etiquetados
 * colgando de un patron que ya no existe»—. Dibujar los dos selectores seria
 * ofrecer una operacion que la API rechaza con un 400 del whitelist, y el admin
 * que la intente se queda sin entender por que.
 *
 * LO QUE ESTE FORMULARIO *NO* VALIDA, A PROPOSITO:
 *
 * - que `horaFin` sea posterior a `horaInicio`;
 * - que `hasta` no sea anterior a `desde`;
 * - que la franja no choque con otra.
 *
 * Las tres las comprueba el servicio y las tres tienen un mensaje escrito alli
 * —«horaFin debe ser posterior a horaInicio», «hasta no puede ser anterior a
 * desde», y los TRES textos distintos de los tres choques—. Repetir la
 * comprobacion aqui no ahorraria nada util y costaria dos cosas: un segundo
 * texto que puede decir algo distinto del de la API, y —peor— que el camino de
 * la API dejara de ejercitarse nunca, con lo que el dia que ese mensaje cambie
 * no se enteraria nadie.
 *
 * LO QUE SI SE VALIDA AQUI es lo que la pantalla sabe sin preguntar: que estan
 * los obligatorios, que las horas y las fechas tienen la FORMA que el DTO pide,
 * y que la tarifa cabe en el patron de dinero. Eso ultimo ahorra un viaje de
 * verdad: `@Matches(/^\d{1,8}(\.\d{1,2})?$/)` rechaza `1500.555` y el admin no
 * tiene por que descubrirlo despues de que el servidor conteste.
 */

/** Indexado por `diaSemana`: 0 = domingo, como `Date.getUTCDay()`. */
export const NOMBRES_DE_DIA: readonly string[] = [
  'domingo',
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
];

/**
 * El orden en que se lee una semana, y no el del contrato.
 *
 * El contrato numera desde el domingo porque copia a `Date.getUTCDay()`, pero
 * la semana de un gimnasio empieza el lunes —es lo que ya hace `lib/semana.ts`
 * y lo que ya hace el selector de dias fijos de la ficha—. Ordenar por el
 * numero crudo pone el domingo primero, que no es «sin ordenar» sino ordenado
 * de una forma que nadie reconoce.
 */
export const DIAS_EN_ORDEN_DE_SEMANA: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

export function conMayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** «lunes de 18:00 a 19:00». En minusculas: se interpola dentro de frases. */
export function descripcionDeFranja(franja: {
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
}): string {
  const dia = NOMBRES_DE_DIA[franja.diaSemana] ?? 'dia desconocido';
  return `${dia} de ${franja.horaInicio} a ${franja.horaFin}`;
}

/**
 * La vigencia, con el indefinido DICHO.
 *
 * Un `hasta` en null es «indefinido», que no es lo mismo que «no lo cargaron»:
 * una celda a medias se lee como un hueco de la pantalla y este es el estado
 * normal de casi todos los horarios.
 */
export function textoDeVigencia(horario: { desde: string; hasta: string | null }): string {
  return horario.hasta === null
    ? `Desde ${horario.desde}, indefinido`
    : `${horario.desde} a ${horario.hasta}`;
}

/**
 * La tarifa, con la HERENCIA dicha y distinta del cero.
 *
 * `null` significa «usa la tarifa general del gimnasio» y es un valor
 * legitimo: la mayoria de los horarios lo tienen. Pintar un hueco en blanco lo
 * confundiria con «no cargo», y pintar un `0` seria mentir sobre lo que la
 * liquidacion va a pagarle a esa profesora.
 */
export function textoDeTarifa(tarifa: string | null): string {
  return tarifa === null ? 'Tarifa del gimnasio' : `$${tarifa}`;
}

/** Hasta 8 enteros y como mucho 2 decimales: el mismo patron que el DTO. */
const PATRON_TARIFA = /^\d{1,8}(\.\d{1,2})?$/;

/**
 * `'1500'` -> `'1500.00'`, SIN pasar por `Number`.
 *
 * Es dinero. Un `Number(escrito).toFixed(2)` daria hoy el mismo resultado y
 * seria exactamente la puerta que esta regla existe para cerrar: en cuanto
 * algun dia se sume o se multiplique por el camino, un float binario deja de
 * representar 1500.10 y la liquidacion paga otra cosa. La normalizacion es
 * puro texto: se rellenan los decimales que falten.
 */
export function normalizarTarifa(escrito: string): string {
  const [enteros = '0', decimales = ''] = escrito.split('.');
  return `${enteros}.${`${decimales}00`.slice(0, 2)}`;
}

/** Los campos que la API nombra en sus 400. En un solo sitio. */
export const CAMPOS_DE_HORARIO = [
  'profesorId',
  'salaId',
  'diaSemana',
  'horaInicio',
  'horaFin',
  'desde',
  'hasta',
  'tarifaPorHora',
] as const;

export type CampoDeHorario = (typeof CAMPOS_DE_HORARIO)[number];

export interface OpcionDeCatalogo {
  valor: string;
  texto: string;
}

interface ValoresDelFormulario {
  profesorId: string;
  salaId: string;
  diaSemana: string;
  horaInicio: string;
  horaFin: string;
  desde: string;
  hasta: string;
  tarifaPorHora: string;
}

function valoresIniciales(horario: HorarioProfesorPublico | undefined): ValoresDelFormulario {
  if (horario === undefined) {
    return {
      profesorId: '',
      salaId: '',
      // Lunes: el primer dia de la semana que lee el gimnasio.
      diaSemana: '1',
      horaInicio: '',
      horaFin: '',
      desde: '',
      hasta: '',
      tarifaPorHora: '',
    };
  }

  return {
    profesorId: horario.profesorId,
    salaId: horario.salaId,
    diaSemana: String(horario.diaSemana),
    horaInicio: horario.horaInicio,
    horaFin: horario.horaFin,
    desde: horario.desde,
    hasta: horario.hasta ?? '',
    tarifaPorHora: horario.tarifaPorHora ?? '',
  };
}

/**
 * LO QUE YA HAY EN LA FRANJA QUE SE ESTA ELIGIENDO.
 *
 * Para que el choque se evite MIRANDO y no chocando: los tres conflictos del
 * servicio son todos solapes, y la forma barata de no provocarlos es ver antes
 * de guardar quien ocupa ese hueco. Se filtra por dia y por solape de horas
 * —`horasSeSolapan`, la misma funcion que usa el servicio— y solo entre los
 * ACTIVOS: un horario de baja no choca con nada.
 *
 * NO se mira la vigencia. El servicio si la mira (`rangosSeSolapan`), asi que
 * esta lista puede enseñar algo que al final no choque. Esa es la direccion
 * correcta del error: avisar de mas hace mirar, y callarse de menos hace
 * chocar.
 */
export function loQueYaHayEn(
  horarios: readonly HorarioProfesorPublico[],
  franja: { diaSemana: string; horaInicio: string; horaFin: string },
  excluir?: string,
): HorarioProfesorPublico[] {
  if (!PATRON_HORA.test(franja.horaInicio) || !PATRON_HORA.test(franja.horaFin)) return [];

  const dia = Number(franja.diaSemana);

  return horarios.filter(
    (horario) =>
      horario.activo &&
      horario.id !== excluir &&
      horario.diaSemana === dia &&
      horasSeSolapan(franja.horaInicio, franja.horaFin, horario.horaInicio, horario.horaFin),
  );
}

export function FormularioDeHorario({
  modo,
  horario,
  profesoras = [],
  salas = [],
  yaCargados,
  conFiltros,
  guardando,
  porCampo,
  aviso,
  alEnviar,
  alCancelar,
}: {
  modo: 'alta' | 'edicion';
  /** El horario que se edita. Solo en modo `edicion`. */
  horario?: HorarioProfesorPublico;
  /** El `perfilId` de cada profesora, que es lo que `profesorId` nombra. */
  profesoras?: readonly OpcionDeCatalogo[];
  salas?: readonly OpcionDeCatalogo[];
  /** Lo que la pantalla ya tiene cargado, para el aviso de franja ocupada. */
  yaCargados: readonly HorarioProfesorPublico[];
  /** Si la lista de arriba esta recortada por los filtros. */
  conFiltros: boolean;
  guardando: boolean;
  /** Lo que la API dijo de cada campo. */
  porCampo: Partial<Record<CampoDeHorario, string>>;
  /** Lo que la API dijo y no nombra ningun campo: los choques, el 403. */
  aviso: string | null;
  alEnviar: (cuerpo: Record<string, unknown>) => void;
  alCancelar?: () => void;
}) {
  const [valores, setValores] = useState<ValoresDelFormulario>(() => valoresIniciales(horario));
  const [locales, setLocales] = useState<Partial<Record<CampoDeHorario, string>>>({});

  function cambiar(campo: keyof ValoresDelFormulario, valor: string): void {
    setValores((previos) => ({ ...previos, [campo]: valor }));
  }

  /** El error que se pinta: el local manda, porque es el que acaba de pasar. */
  function errorDe(campo: CampoDeHorario): string | undefined {
    return locales[campo] ?? porCampo[campo];
  }

  /**
   * El cuerpo que sale, o `null` si algo no pasa la puerta de aqui.
   *
   * Devuelve el cuerpo en vez de enviarlo para que la decision de QUE se manda
   * sea una funcion pura de los valores y se pueda leer de un vistazo.
   */
  function cuerpoDelAlta(): Record<string, unknown> | null {
    const fallos: Partial<Record<CampoDeHorario, string>> = {};

    if (valores.profesorId === '') fallos.profesorId = 'Elegi una profesora.';
    if (valores.salaId === '') fallos.salaId = 'Elegi una sala.';
    if (!PATRON_HORA.test(valores.horaInicio)) fallos.horaInicio = 'La hora va como HH:MM.';
    if (!PATRON_HORA.test(valores.horaFin)) fallos.horaFin = 'La hora va como HH:MM.';
    if (!PATRON_FECHA.test(valores.desde)) fallos.desde = 'La fecha va como YYYY-MM-DD.';
    if (valores.hasta !== '' && !PATRON_FECHA.test(valores.hasta)) {
      fallos.hasta = 'La fecha va como YYYY-MM-DD. Vacio = indefinido.';
    }
    if (valores.tarifaPorHora !== '' && !PATRON_TARIFA.test(valores.tarifaPorHora)) {
      fallos.tarifaPorHora = 'Un numero con hasta dos decimales, como 1500.00.';
    }

    if (Object.keys(fallos).length > 0) {
      setLocales(fallos);
      return null;
    }

    return {
      profesorId: valores.profesorId,
      salaId: valores.salaId,
      diaSemana: Number(valores.diaSemana),
      horaInicio: valores.horaInicio,
      horaFin: valores.horaFin,
      desde: valores.desde,
      /**
       * `hasta` VACIO = INDEFINIDO, y se omite la clave.
       *
       * El DTO lo dice por escrito («Ausente = indefinido») y la columna nace
       * en null. Mandar `hasta: ''` seria un 400 del `@Matches(PATRON_FECHA)`,
       * y mandar una fecha inventada —hoy, fin de año— cerraria una vigencia
       * que nadie pidio cerrar y dejaria de etiquetar turnos a partir de ahi.
       */
      ...(valores.hasta === '' ? {} : { hasta: valores.hasta }),
      /**
       * LA TARIFA VACIA = HEREDAR LA DEL GIMNASIO, y se omite la clave.
       *
       * NO es cero. `null` en esa columna significa «usa
       * `Tenant.tarifaPorHoraProfesor`» y es el estado normal; un `'0'` seria
       * una profesora que trabaja gratis, y la liquidacion lo pagaria asi. Son
       * dos cosas distintas y por eso el hueco vacio no puede significar la
       * segunda.
       *
       * Y cuando hay valor viaja como CADENA con dos decimales, nunca como
       * number: es dinero.
       */
      ...(valores.tarifaPorHora === ''
        ? {}
        : { tarifaPorHora: normalizarTarifa(valores.tarifaPorHora) }),
    };
  }

  /**
   * En edicion: SOLO LO QUE CAMBIO, comparado contra el horario cargado.
   *
   * Un PATCH con las seis claves siempre pisaria con los valores que esta
   * pantalla leyo hace cinco minutos lo que otro admin acabe de tocar, y lo
   * haria en silencio porque la API contesta 200. Es la misma decision que el
   * bloque de datos de la ficha de una sala.
   */
  function cuerpoDeLaEdicion(): Record<string, unknown> | null {
    if (horario === undefined) return null;

    const fallos: Partial<Record<CampoDeHorario, string>> = {};

    if (!PATRON_HORA.test(valores.horaInicio)) fallos.horaInicio = 'La hora va como HH:MM.';
    if (!PATRON_HORA.test(valores.horaFin)) fallos.horaFin = 'La hora va como HH:MM.';
    if (!PATRON_FECHA.test(valores.desde)) fallos.desde = 'La fecha va como YYYY-MM-DD.';
    if (valores.hasta !== '' && !PATRON_FECHA.test(valores.hasta)) {
      fallos.hasta = 'La fecha va como YYYY-MM-DD.';
    }
    if (valores.tarifaPorHora !== '' && !PATRON_TARIFA.test(valores.tarifaPorHora)) {
      fallos.tarifaPorHora = 'Un numero con hasta dos decimales, como 1500.00.';
    }

    if (Object.keys(fallos).length > 0) {
      setLocales(fallos);
      return null;
    }

    const cuerpo: Record<string, unknown> = {};

    if (Number(valores.diaSemana) !== horario.diaSemana) {
      cuerpo.diaSemana = Number(valores.diaSemana);
    }
    if (valores.horaInicio !== horario.horaInicio) cuerpo.horaInicio = valores.horaInicio;
    if (valores.horaFin !== horario.horaFin) cuerpo.horaFin = valores.horaFin;
    if (valores.desde !== horario.desde) cuerpo.desde = valores.desde;
    if (valores.hasta !== '' && valores.hasta !== horario.hasta) cuerpo.hasta = valores.hasta;

    /**
     * VOLVER A LA TARIFA DEL GIMNASIO MANDA `null` EXPLICITO.
     *
     * Omitir la clave es el PATCH de «no toques esto», que es lo contrario de
     * lo que la persona acaba de pedir al vaciar el campo. `@IsOptional()`
     * salta la validacion cuando el valor es null y el whitelist conserva la
     * clave porque la propiedad esta decorada, asi que el null llega entero al
     * `data` del service. Es la misma comprobacion que ya hizo
     * `ajuste-heredable.tsx` contra el ValidationPipe real.
     */
    const tarifa = valores.tarifaPorHora === '' ? null : normalizarTarifa(valores.tarifaPorHora);
    if (tarifa !== horario.tarifaPorHora) cuerpo.tarifaPorHora = tarifa;

    if (Object.keys(cuerpo).length === 0) {
      setLocales({ diaSemana: 'No cambiaste nada.' });
      return null;
    }

    return cuerpo;
  }

  function enviar(): void {
    setLocales({});

    const cuerpo = modo === 'alta' ? cuerpoDelAlta() : cuerpoDeLaEdicion();
    if (cuerpo === null) return;

    alEnviar(cuerpo);
  }

  const ocupado = loQueYaHayEn(yaCargados, valores, horario?.id);
  const franjaElegida = PATRON_HORA.test(valores.horaInicio) && PATRON_HORA.test(valores.horaFin);

  return (
    <form
      aria-label={modo === 'alta' ? 'Nuevo horario' : 'Editar horario'}
      onSubmit={(evento) => {
        evento.preventDefault();
        enviar();
      }}
      className="flex flex-col gap-3"
      noValidate
    >
      {aviso !== null && <Aviso tono="error">{aviso}</Aviso>}

      {modo === 'alta' && (
        <>
          <Seleccion
            etiqueta="Profesora"
            id="horario-profesora"
            value={valores.profesorId}
            error={errorDe('profesorId')}
            onChange={(evento) => cambiar('profesorId', evento.target.value)}
            opciones={[{ valor: '', texto: 'Elegi una profesora' }, ...profesoras]}
          />
          <Seleccion
            etiqueta="Sala"
            id="horario-sala"
            value={valores.salaId}
            error={errorDe('salaId')}
            onChange={(evento) => cambiar('salaId', evento.target.value)}
            opciones={[{ valor: '', texto: 'Elegi una sala' }, ...salas]}
          />
        </>
      )}

      <Seleccion
        etiqueta="Dia"
        id={`horario-dia-${modo}`}
        value={valores.diaSemana}
        error={errorDe('diaSemana')}
        onChange={(evento) => cambiar('diaSemana', evento.target.value)}
        opciones={DIAS_EN_ORDEN_DE_SEMANA.map((dia) => ({
          valor: String(dia),
          texto: conMayuscula(NOMBRES_DE_DIA[dia] ?? ''),
        }))}
      />

      <Campo
        etiqueta="Hora de inicio"
        id={`horario-inicio-${modo}`}
        placeholder="HH:MM"
        value={valores.horaInicio}
        error={errorDe('horaInicio')}
        onChange={(evento) => cambiar('horaInicio', evento.target.value)}
      />
      <Campo
        etiqueta="Hora de fin"
        id={`horario-fin-${modo}`}
        placeholder="HH:MM"
        value={valores.horaFin}
        error={errorDe('horaFin')}
        onChange={(evento) => cambiar('horaFin', evento.target.value)}
      />

      {/* LO QUE YA HAY EN ESA FRANJA, en cuanto hay dia y horas. Mirar sale
          mas barato que chocar: los tres conflictos de la API son solapes. */}
      {franjaElegida && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            En esa franja ya hay
          </p>
          {ocupado.length === 0 ? (
            <p className="text-sm text-slate-600">Nada cargado en esa franja.</p>
          ) : (
            <ul aria-label="Lo que ya hay en esa franja" className="text-sm text-slate-700">
              {ocupado.map((otro) => (
                <li key={otro.id}>
                  {otro.profesorNombre} en {otro.salaNombre}, {otro.horaInicio} a {otro.horaFin}
                </li>
              ))}
            </ul>
          )}
          {/* La lista de arriba es la que la pantalla tiene cargada, y los
              filtros la recortan. Decir «nada cargado» sin esta advertencia
              seria prometer un hueco libre mirando media sala. */}
          {conFiltros && (
            <p className="text-xs text-slate-500">
              Mirando solo lo que dejan ver los filtros de arriba.
            </p>
          )}
        </div>
      )}

      <Campo
        etiqueta="Desde"
        id={`horario-desde-${modo}`}
        placeholder="YYYY-MM-DD"
        value={valores.desde}
        error={errorDe('desde')}
        onChange={(evento) => cambiar('desde', evento.target.value)}
      />
      <Campo
        etiqueta="Hasta"
        id={`horario-hasta-${modo}`}
        placeholder="Vacio = indefinido"
        value={valores.hasta}
        error={errorDe('hasta')}
        onChange={(evento) => cambiar('hasta', evento.target.value)}
      />

      <Campo
        etiqueta="Tarifa por hora"
        id={`horario-tarifa-${modo}`}
        placeholder="Vacio = la del gimnasio"
        value={valores.tarifaPorHora}
        error={errorDe('tarifaPorHora')}
        onChange={(evento) => cambiar('tarifaPorHora', evento.target.value)}
      />

      <div className="flex gap-2">
        <Boton type="submit" cargando={guardando}>
          {modo === 'alta' ? 'Crear horario' : 'Guardar horario'}
        </Boton>
        {alCancelar !== undefined && (
          <Boton type="button" tono="secundario" onClick={alCancelar}>
            Cancelar
          </Boton>
        )}
      </div>
    </form>
  );
}
