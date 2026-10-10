'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { EstadoJob, EstadoPublicacion, MesCalendarioPublico } from '@boxadmin/shared';
import { rolAlcanza } from '@boxadmin/shared';
import { Aviso, Boton } from '@/componentes/ui';
import type { ErrorDeApi } from '@/lib/cliente';
import { clavesDelCalendario, type MesElegido, usePublicarMes } from '@/hooks/use-calendario-admin';
import { useRolDeQuienMira } from '../rol-del-panel';

// ---------------------------------------------------------------------------
// El estado del mes: informacion, y la ve todo el mundo
// ---------------------------------------------------------------------------

/** Los dos estados en los que el trabajo todavia se mueve. */
const EN_CURSO: readonly EstadoJob[] = ['en_cola', 'procesando'];

export function trabajoEnCurso(mes: MesCalendarioPublico): boolean {
  return mes.publicacion !== null && EN_CURSO.includes(mes.publicacion.estado);
}

/**
 * EL DIA SE RECORTA DEL ISO, no se formatea.
 *
 * Mismo motivo que en la columna "Vence" de las invitaciones y en los nombres
 * de mes del selector: `toLocaleDateString` dice una cosa u otra segun la
 * configuracion regional y el huso de la maquina del mostrador, y el mismo
 * enlace compartido se leeria distinto en dos computadoras del mismo gimnasio.
 */
function diaDelIso(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * QUE DICE LA FILA DEL MES, con la distincion que mas cuesta ver.
 *
 * `id: null` NO es BORRADOR: es que la fila no existe, o sea que nadie
 * previsualizo ni publico nunca ese mes en esa sala. Pintarlo como "en
 * borrador" inventa un estado que no esta en ningun sitio y el admin entiende
 * que alguien empezo y lo dejo a medias.
 *
 * `publicadoPor` SE ENSEÑA COMO ID, y no por falta de ganas: NO HAY DONDE
 * RESOLVERLO. Es `actor.sub`, o sea el `Usuario.id` de quien publico, y
 * publicar pide ADMIN_SALON; pero `GET /usuarios` —la lista contra la que esta
 * pantalla resuelve los nombres de los conflictos— filtra por
 * `rol: { in: ['ALUMNO', 'PROFESOR'] }` y NUNCA devuelve administradores. Una
 * busqueda contra esa lista no acertaria jamas: seria codigo muerto por
 * construccion, y un test que lo cubriera tendria que inventar un ADMIN en una
 * respuesta que la API no produce.
 *
 * Mientras tanto se muestra el id y no se omite el dato: es informacion de
 * auditoria —quien toco el mes— y perderla seria peor que leerla fea.
 */
function textoDelEstado(mes: MesCalendarioPublico): string {
  if (mes.id === null)
    return 'Este mes nunca se publico: todavia no hay ninguna fila suya en el calendario.';

  if (mes.estado === 'BORRADOR')
    return 'Mes en borrador: lo de abajo es el plan calculado, todavia no hay nada escrito.';

  const cuando = mes.publicadoEn === null ? '' : ` el ${diaDelIso(mes.publicadoEn)}`;
  const quien = mes.publicadoPor === null ? '' : ` por ${mes.publicadoPor}`;

  return `Mes publicado${cuando}${quien}.`;
}

/**
 * Lo que esta haciendo el trabajo de fondo.
 *
 * Va FUERA del bloque de la accion y sin pedir rol: saber si el mes se esta
 * escribiendo ahora mismo es informacion, no una accion, y un ADMIN_OPERATIVO
 * que mire la pantalla tiene que entender por que los numeros van a cambiar
 * solos. El mes queda en BORRADOR hasta que el worker termina de escribir;
 * recien ahi pasa a HABILITADO.
 */
function EstadoDelTrabajo({ trabajo }: { trabajo: EstadoPublicacion }) {
  if (trabajo.estado === 'fallido')
    return (
      // EL ERROR QUE VINO, no "algo salio mal": el worker escribe por que fallo,
      // y eso es lo que decide si el admin reintenta o arregla un dato antes.
      <Aviso tono="error">
        La publicacion fallo: {trabajo.error ?? 'el trabajo no dejo dicho por que.'}
      </Aviso>
    );

  if (trabajo.estado === 'terminado') return <Aviso tono="exito">El mes se escribio entero.</Aviso>;

  return (
    // `alerta` porque aparece solo, sin que nadie pulse nada, y sustituye a lo
    // que el admin estaba mirando.
    <Aviso alerta>Publicando el mes… esta pantalla se actualiza sola.</Aviso>
  );
}

export function EstadoDelMes({ mes }: { mes: MesCalendarioPublico }) {
  const trabajo = mes.publicacion;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-slate-700">{textoDelEstado(mes)}</p>

      {/* `sin_job` y `publicacion: null` son dos formas de decir lo mismo: no
          hay nada corriendo y no hay nada que contar. */}
      {trabajo !== null && trabajo.estado !== 'sin_job' && <EstadoDelTrabajo trabajo={trabajo} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// El plan envejece cuando el trabajo termina
// ---------------------------------------------------------------------------

/**
 * CUANDO EL WORKER TERMINA, EL PLAN QUE SE VE YA NO ES EL QUE ES.
 *
 * `previsualizar` es incremental: lee lo que existe y calcula lo que falta. En
 * cuanto el worker escribe el mes, "quedan 42 turnos por crear" pasa a ser
 * "quedan 0", y la pantalla se queda enseñando el de antes —un plan que ya se
 * aplico— sin ninguna señal de que caduco.
 *
 * SE INVALIDA EN LA TRANSICION, no mientras `estado === 'terminado'`.
 *
 * La diferencia importa: con la condicion a secas, abrir un mes publicado hace
 * mucho dispararia una previsualizacion de mas en CADA carga, y
 * `previsualizar` es un POST que recalcula el mes entero. Solo cuenta el paso
 * de "estaba corriendo" a "termino", que es el unico momento en que el plan que
 * ya tenemos envejecio delante nuestro.
 *
 * El efecto depende de los TRES numeros sueltos y no del objeto `elegido`: ese
 * objeto se construye en cada pintado, y como dependencia haria que el efecto
 * corriera siempre —invalidar, repintar, invalidar— en un bucle de peticiones.
 */
export function useRefrescarElPlanAlTerminar(
  elegido: MesElegido | null,
  mes: MesCalendarioPublico | undefined,
): void {
  const cliente = useQueryClient();
  const estado = mes?.publicacion?.estado;
  const anterior = useRef<EstadoJob | undefined>(undefined);

  const salaId = elegido?.salaId;
  const anio = elegido?.anio;
  const numeroDeMes = elegido?.mes;

  useEffect(() => {
    const antes = anterior.current;
    anterior.current = estado;

    if (estado !== 'terminado') return;
    if (antes === undefined || !EN_CURSO.includes(antes)) return;
    if (salaId === undefined || anio === undefined || numeroDeMes === undefined) return;

    void cliente.invalidateQueries({
      queryKey: clavesDelCalendario.plan({ salaId, anio, mes: numeroDeMes }),
    });
  }, [estado, salaId, anio, numeroDeMes, cliente]);
}

// ---------------------------------------------------------------------------
// La accion: solo ADMIN_SALON
// ---------------------------------------------------------------------------

/**
 * QUE SE DICE CUANDO EL POST DE PUBLICAR FALLA.
 *
 * Los tres casos que no pueden caer en el mismo cajon:
 *
 *  - SIN RED: la peticion no salio del navegador, asi que NO se encolo nada.
 *    Es justo la duda del admin —«¿se mando o no?»— y un "no se pudo publicar"
 *    la deja abierta: con un mes a medias, reintentar da miedo.
 *  - 403: el mensaje de la API es «Forbidden resource», que delante del
 *    mostrador no explica nada. Puede pasar aunque el boton solo se dibuje para
 *    un ADMIN_SALON, porque el rol se resolvio AL ENTRAR al panel y a alguien
 *    se le puede bajar con la pantalla abierta.
 *  - El resto: el mensaje de la API tal cual. El 400 de «un mes que ya paso»
 *    esta escrito para que lo lea una persona, y sustituirlo seria tirar lo
 *    unico util.
 */
function textoDelFallo(error: ErrorDeApi): string {
  if (error.esSinConexion)
    return 'La peticion no salio de este navegador: no se encolo nada. Comproba tu red y volve a intentarlo.';

  if (error.esSesionCaducada) return 'Tu sesion caduco. Volve a entrar para seguir.';

  if (error.estado === 403) return 'Tu rol no alcanza: esta accion pide ADMIN_SALON.';

  return error.message;
}

/**
 * EL BOTON QUE PUBLICA EL MES.
 *
 * PIDE ADMIN_SALON y el resto del modulo pide ADMIN_OPERATIVO. No es un
 * descuido: lo dice el controlador —«publicar crea reservas para todo el salon
 * de golpe: es gestion, no operacion diaria»—. Previsualizar y mirar el plan es
 * operacion; escribir el mes entero, no.
 *
 * NO SE DIBUJA, no se esconde. Un `hidden` deja el boton en el DOM, pulsable
 * desde las herramientas del navegador y delatando que la accion existe; y los
 * `*ByRole` de los tests consultan el arbol de accesibilidad, que ya excluye lo
 * oculto, asi que esa version pasa en verde. Es la leccion que costo la fase
 * anterior. Esto NO es la seguridad —la seguridad son los `@Roles` de la API—:
 * esto es no ofrecer lo que no se puede hacer.
 *
 * `rol === null` es SIN PROVEEDOR, y vale "no alcanza para nada". Si un dia un
 * reordenamiento del layout deja esta pantalla fuera del armazon del panel, lo
 * que no puede pasar es que eso ABRA la accion mas consecuente del sistema.
 */
export function AccionDePublicar({
  elegido,
  mes,
}: {
  elegido: MesElegido;
  mes: MesCalendarioPublico;
}) {
  const rol = useRolDeQuienMira();
  const cliente = useQueryClient();
  const publicar = usePublicarMes(elegido);

  if (rol === null || !rolAlcanza(rol, 'ADMIN_SALON')) return null;

  const enCurso = trabajoEnCurso(mes);
  const yaPublicado = mes.estado === 'HABILITADO';

  function alPulsar(): void {
    publicar.mutate(undefined, {
      // Se invalida SOLO el estado del mes, que es lo que cambia al encolar:
      // ahi aparece el `publicacion.estado`, y con el arranca el sondeo. El
      // plan no se toca —sigue siendo el mismo calculo hasta que el worker
      // escriba— y volver a pedirlo seria recalcular el mes entero para nada.
      onSuccess: () => {
        void cliente.invalidateQueries({ queryKey: clavesDelCalendario.mes(elegido) });
      },
    });
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {yaPublicado && (
        /**
         * SE EXPLICA, NO SE ADVIERTE.
         *
         * El planificador es incremental: lee lo que ya existe y completa lo
         * que falta. El worker lo dice de los turnos con profesora —«los que YA
         * tienen profesora no se tocan: tener profesora significa que alguien lo
         * decidio, y republicar el mes no puede deshacerlo»—. Un "¿estas seguro?
         * esto puede romper el mes" seria mentir, y el admin que se lo crea deja
         * de republicar justo cuando tiene que hacerlo.
         */
        <Aviso>
          Volver a publicar es seguro: el plan es incremental —completa lo que falta y no deshace
          nada—. Los turnos que ya tienen profesora asignada se quedan como estan.
        </Aviso>
      )}

      <Boton
        type="button"
        onClick={alPulsar}
        cargando={publicar.isPending}
        // Mientras el trabajo corre no se vuelve a encolar: serian dos jobs
        // sobre el mismo mes peleandose por el mismo cerrojo.
        disabled={enCurso}
      >
        {yaPublicado ? 'Volver a publicar el mes' : 'Publicar el mes'}
      </Boton>

      {publicar.error !== null && <Aviso tono="error">{textoDelFallo(publicar.error)}</Aviso>}
    </div>
  );
}
