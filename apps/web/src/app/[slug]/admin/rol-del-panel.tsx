'use client';

import { createContext, type ReactNode, useContext } from 'react';
import type { RolUsuario } from '@boxadmin/shared';

/**
 * El rol de QUIEN MIRA, disponible en cualquier pantalla del panel.
 *
 * La puerta (`layout.tsx`) ya resolvio el rol contra `/auth/me` para decidir si
 * te deja pasar, y se lo pasa al armazon porque la navegacion se dibuja desde
 * el. El armazon lo pone aqui y asi lo tiene cualquier descendiente, sin una
 * peticion mas y sin que el layout tenga que pasarle props a sus `children`
 * —cosa que un layout no puede hacer—.
 *
 * LO QUE VIAJA ES EL ROL Y NADA MAS. El objeto de `/auth/me` entero no cruza
 * esta frontera: esto es cliente, y lo que cruza se serializa en el payload RSC
 * que llega al navegador, legible con "ver codigo fuente" aunque nadie lo
 * dibuje. Hay un test en `layout.spec.tsx` que fija el conjunto exacto de props
 * que la puerta le pasa al armazon, y este contexto no lo ensancha: reparte lo
 * que el armazon YA recibia.
 *
 * El valor por defecto es `null` —sin proveedor, no hay rol— y quien lo lea
 * tiene que tratarlo como "no alcanza para nada". Fallar hacia el lado que no
 * da permisos de mas es lo unico seguro cuando el contexto falta.
 *
 * Esto NO es la seguridad: la seguridad son los `@Roles` de la API. Esto es no
 * ofrecer lo que no se puede hacer.
 */
const ContextoDeRol = createContext<RolUsuario | null>(null);

export function ProveedorDeRol({ rol, children }: { rol: RolUsuario; children: ReactNode }) {
  return <ContextoDeRol.Provider value={rol}>{children}</ContextoDeRol.Provider>;
}

export function useRolDeQuienMira(): RolUsuario | null {
  return useContext(ContextoDeRol);
}
