'use client';

import { useEffect, useState } from 'react';
import { ErrorDeApi, pedir } from '@/lib/cliente';
import { claveAplicacionDesdeBase64, serializar } from '@/lib/push';
import { Aviso, Boton } from './ui';

/**
 * Los estados del push, que son mas de los que parece.
 *
 * `imposible` y `denegado` no son lo mismo y no se pueden juntar: el primero es
 * un navegador que no sabe hacer esto (o un despliegue sin clave VAPID) y no se
 * pinta nada; el segundo es un alumno que dijo que no, y ahi SI hay que decir
 * algo, porque `requestPermission()` ya no vuelve a preguntarle nunca.
 *
 * `sin-configurar` es el 503 de la API: esta instalacion no tiene claves VAPID.
 * Tampoco es un error del alumno.
 */
type Estado = 'comprobando' | 'imposible' | 'inactivo' | 'activo' | 'denegado' | 'sin-configurar';

/** Lo que hace falta para que un boton de push pueda funcionar. */
function elNavegadorPuede(): boolean {
  return (
    typeof Notification !== 'undefined' &&
    typeof PushManager !== 'undefined' &&
    'serviceWorker' in navigator
  );
}

/**
 * Activa y desactiva las notificaciones de este navegador.
 *
 * No se pinta si no puede funcionar —navegador sin soporte, o despliegue sin
 * `NEXT_PUBLIC_VAPID_PUBLIC_KEY`—: un boton que no hace nada es peor que
 * ninguno, porque el alumno lo pulsa, no pasa nada y cree que la aplicacion
 * esta rota.
 */
export function BotonDePush() {
  const [estado, setEstado] = useState<Estado>('comprobando');
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const clave = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    // Todo esto vive en el efecto y no en el render: en el render del servidor
    // no hay `window` ni `navigator`, y decidir ahi lo que se pinta rompe la
    // hidratacion aunque no lance.
    if (!elNavegadorPuede() || clave === undefined || clave === '') {
      setEstado('imposible');
      return;
    }

    // Quien ya dijo que no se detecta ANTES de mirar la suscripcion: no hay
    // ninguna, y dejarlo en "inactivo" pintaria un boton que al pulsarlo no
    // abre ningun dialogo.
    if (Notification.permission === 'denied') {
      setEstado('denegado');
      return;
    }

    let vivo = true;

    void (async () => {
      let suscrito = false;
      try {
        const registro = await navigator.serviceWorker.getRegistration();
        suscrito = (await registro?.pushManager.getSubscription()) != null;
      } catch {
        // Sin service worker registrado todavia (o con el desactivado en
        // desarrollo) no hay suscripcion: "inactivo" es la respuesta correcta.
      }

      if (vivo) setEstado(suscrito ? 'activo' : 'inactivo');
    })();

    return () => {
      vivo = false;
    };
  }, [clave]);

  async function activar(): Promise<void> {
    if (clave === undefined || clave === '') return;

    setError(null);
    setTrabajando(true);

    try {
      const permiso = await Notification.requestPermission();

      // Tres estados, no dos. `denied` es definitivo hasta que el alumno lo
      // cambie en la configuracion del navegador; `default` es que cerro el
      // dialogo sin decidir, y ahi no hay nada que explicar: el boton sigue
      // donde estaba y puede volver a pulsarlo.
      if (permiso === 'denied') {
        setEstado('denegado');
        return;
      }
      if (permiso !== 'granted') return;

      const registro = await navigator.serviceWorker.ready;
      const suscripcion = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: claveAplicacionDesdeBase64(clave),
      });

      try {
        await pedir('/push/suscripcion', { metodo: 'POST', cuerpo: serializar(suscripcion) });
      } catch (fallo) {
        // Si el servidor no se queda con la suscripcion, el navegador tampoco.
        // Sin esto queda una suscripcion viva que nadie conoce: el alumno ve
        // "Activar" —asi que se cree sin avisos— y ademas el navegador le
        // reserva un permiso que no usa nadie. Pulsar otra vez crearia una
        // segunda suscripcion con otro endpoint.
        await suscripcion.unsubscribe().catch(() => false);
        throw fallo;
      }

      setEstado('activo');
    } catch (fallo) {
      // El 503 NO es un error del alumno: es que este despliegue no tiene
      // claves VAPID. Un "algo salio mal" ahi manda a alguien a reintentarlo
      // toda la tarde.
      if (fallo instanceof ErrorDeApi && fallo.estado === 503) {
        setEstado('sin-configurar');
        return;
      }

      setError(
        fallo instanceof Error ? fallo.message : 'No se pudieron activar las notificaciones.',
      );
    } finally {
      setTrabajando(false);
    }
  }

  async function desactivar(): Promise<void> {
    setError(null);
    setTrabajando(true);

    try {
      const registro = await navigator.serviceWorker.getRegistration();
      const suscripcion = (await registro?.pushManager.getSubscription()) ?? null;

      // PRIMERO el servidor y DESPUES el navegador, y el orden importa.
      //
      // Al reves —desuscribir primero— un DELETE que falla deja al alumno
      // viendo "Desactivar" (sigue "activo" porque el fallo se muestra) pero
      // con el navegador ya desuscrito: cree que tiene avisos y no le llega
      // ninguno. En este orden, si falla el DELETE no se toca el navegador y
      // los dos lados siguen diciendo lo mismo.
      //
      // Sin endpoint la API borra TODOS los dispositivos del alumno, que es lo
      // que corresponde cuando este navegador ya no tiene ninguno que nombrar.
      await pedir(
        suscripcion === null
          ? '/push/suscripcion'
          : `/push/suscripcion?endpoint=${encodeURIComponent(suscripcion.endpoint)}`,
        { metodo: 'DELETE' },
      );

      // A partir de aqui el servidor YA NO TIENE la fila, asi que no va a llegar
      // ni un aviso mas pase lo que pase debajo. El estado se pone AHORA, antes
      // del `unsubscribe`, y no al final: si el navegador se negara a
      // desuscribir, dejar el boton en "Desactivar" seria prometerle al alumno
      // unos avisos que ya no existen. Es el unico camino por el que podria
      // creerse avisado sin estarlo, y se cierra con esta linea de sitio.
      setEstado('inactivo');

      // Y esta es la otra mitad: sin el `unsubscribe`, el navegador conserva la
      // suscripcion. Es basura inerte —el servidor no la conoce y nadie le manda
      // nada—, y al volver a activar se reutiliza el mismo endpoint y se
      // registra otra vez. Si falla, el error se muestra igual.
      await suscripcion?.unsubscribe();
    } catch (fallo) {
      setError(
        fallo instanceof Error ? fallo.message : 'No se pudieron desactivar las notificaciones.',
      );
    } finally {
      setTrabajando(false);
    }
  }

  if (estado === 'comprobando' || estado === 'imposible') return null;

  if (estado === 'denegado') {
    return (
      // `alerta`: este aviso SUSTITUYE al boton que el alumno acaba de pulsar.
      // Sin anunciarlo, quien usa lector de pantalla pierde el foco y para el no
      // ha pasado nada.
      <Aviso tono="info" alerta>
        Bloqueaste las notificaciones en este navegador. Este boton ya no puede volver a pedirtelas:
        hay que habilitarlas desde la configuracion del navegador —el candado de la barra de
        direcciones— y recargar la pagina.
      </Aviso>
    );
  }

  if (estado === 'sin-configurar') {
    return (
      // Igual que el de arriba: aparece en el sitio del boton que se pulso.
      <Aviso tono="info" alerta>
        Este gimnasio todavia no tiene las notificaciones configuradas. No es un fallo tuyo: cuando
        las active, el boton vuelve a aparecer.
      </Aviso>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Boton
        tono={estado === 'activo' ? 'secundario' : 'primario'}
        cargando={trabajando}
        onClick={() => void (estado === 'activo' ? desactivar() : activar())}
      >
        {estado === 'activo' ? 'Desactivar notificaciones' : 'Activar notificaciones'}
      </Boton>
      {/* `{error}` y no `dangerouslySetInnerHTML`: React lo pinta como texto. */}
      {error !== null && <Aviso tono="error">{error}</Aviso>}
    </div>
  );
}
