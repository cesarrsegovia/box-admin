'use client';

import { useState } from 'react';
import { type RolUsuario, rolAlcanza, type UsuarioDetalle } from '@boxadmin/shared';
import { Confirmar } from '@/componentes/confirmar';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { useDarDeBaja, useResetearPassword } from '@/hooks/use-usuarios';
import { mensajeDeFallo } from './errores';

/**
 * Las dos acciones destructivas de la ficha.
 *
 * EL BLOQUE DE RESETEAR NO SE RENDERIZA si el rol no alcanza `ADMIN_SALON`. No
 * se esconde con CSS ni se deshabilita: un boton deshabilitado sigue estando en
 * el DOM, y quien abra las herramientas del navegador lo tiene a un clic. Es la
 * UNICA accion del area con ese nivel; todo lo demas pide `ADMIN_OPERATIVO`.
 *
 * Esto NO es la seguridad: la seguridad es el `@Roles('ADMIN_SALON')` de la API.
 * Esto es no ofrecer lo que no se puede hacer.
 *
 * Las dos confirman NOMBRANDO a quien afectan. "¿Estas seguro?" sobre una ficha
 * abierta en una pestaña vieja es como se le resetea la clave a quien no era.
 */
export function BloqueDeAcciones({
  usuario,
  rolDeQuienMira,
}: {
  usuario: UsuarioDetalle;
  rolDeQuienMira: RolUsuario | null;
}) {
  const baja = useDarDeBaja(usuario.id);
  const reset = useResetearPassword(usuario.id);

  const [enCurso, setEnCurso] = useState<'baja' | 'reset' | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [claveTemporal, setClaveTemporal] = useState<string | null>(null);

  const puedeResetear = rolDeQuienMira !== null && rolAlcanza(rolDeQuienMira, 'ADMIN_SALON');

  function cerrar(): void {
    setEnCurso(null);
    setFallo(null);
  }

  async function darDeBaja(): Promise<void> {
    setFallo(null);
    try {
      await baja.mutateAsync();
      setEnCurso(null);
    } catch (error) {
      setFallo(mensajeDeFallo(error, 'ADMIN_OPERATIVO'));
    }
  }

  async function resetear(): Promise<void> {
    setFallo(null);
    try {
      const respuesta = await reset.mutateAsync();
      setClaveTemporal(respuesta.passwordTemporal);
      setEnCurso(null);
    } catch (error) {
      // El 403 de AQUI no es el de la puerta del panel: hay sesion y el rol
      // alcanza para estar en esta pantalla, pero no para esta accion.
      setFallo(mensajeDeFallo(error, 'ADMIN_SALON'));
    }
  }

  return (
    <Tarjeta>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Acciones</h2>

        {/* La clave se ve UNA vez: la API no la vuelve a mostrar nunca. Por eso
            no se desvanece sola y hay que cerrarla a mano. */}
        {claveTemporal !== null && (
          <Aviso tono="exito" alerta>
            <span className="flex flex-col gap-2">
              <span>
                Contrasena temporal de {usuario.nombreCompleto}:{' '}
                <strong className="font-mono">{claveTemporal}</strong>
              </span>
              <span>Copiala ahora: no se puede volver a ver.</span>
              <span>
                <Boton type="button" tono="secundario" onClick={() => setClaveTemporal(null)}>
                  Ya la copie
                </Boton>
              </span>
            </span>
          </Aviso>
        )}

        {usuario.activo ? (
          enCurso === 'baja' ? (
            <Confirmar
              pregunta={`Dar de baja a ${usuario.nombreCompleto}`}
              detalle="Sus reservas futuras NO se cancelan: eso se decide a mano."
              textoDeConfirmar="Dar de baja"
              cargando={baja.isPending}
              error={fallo ?? undefined}
              alConfirmar={() => void darDeBaja()}
              alCancelar={cerrar}
            />
          ) : (
            <div>
              <Boton type="button" tono="peligro" onClick={() => setEnCurso('baja')}>
                Dar de baja
              </Boton>
            </div>
          )
        ) : (
          /* La baja ya la anuncia la cabecera de la ficha; aqui solo se explica
             por que no hay boton. */
          <p className="text-sm text-slate-600">
            Volver a darle el alta no se hace desde esta pantalla.
          </p>
        )}

        {puedeResetear &&
          (enCurso === 'reset' ? (
            <Confirmar
              pregunta={`Resetear la contrasena de ${usuario.nombreCompleto}`}
              detalle="La actual deja de servir en el acto. La nueva se ve una sola vez."
              textoDeConfirmar="Resetear"
              cargando={reset.isPending}
              error={fallo ?? undefined}
              alConfirmar={() => void resetear()}
              alCancelar={cerrar}
            />
          ) : (
            <div>
              <Boton type="button" tono="peligro" onClick={() => setEnCurso('reset')}>
                Resetear contrasena
              </Boton>
            </div>
          ))}
      </div>
    </Tarjeta>
  );
}
