'use client';

import { useEffect, useState } from 'react';
import { Aviso } from './ui';

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

export function textoDeAntiguedad(milisegundos: number): string {
  if (milisegundos < MINUTO) return 'hace instantes';
  if (milisegundos < HORA) return `hace ${Math.floor(milisegundos / MINUTO)} minutos`;
  if (milisegundos < DIA) return `hace ${Math.floor(milisegundos / HORA)} horas`;

  const dias = Math.floor(milisegundos / DIA);
  return `hace ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

/**
 * Avisa de que lo que se ve es una copia cacheada, y de cuando se cargo.
 *
 * Un calendario viejo SIN fecha es peor que no tenerlo: el alumno no sabe si
 * puede fiarse de lo que ve para decidir si presentarse a una clase.
 *
 * `actualizadoEn` sale de `dataUpdatedAt` de React Query; `0` significa que
 * nunca se cargo nada.
 */
export function AvisoOffline({ actualizadoEn }: { actualizadoEn: number }) {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    // El estado inicial se lee DENTRO del efecto: en el render del servidor no
    // existe `navigator`, y leerlo directo romperia la hidratacion.
    setOnline(navigator.onLine);

    const conectar = () => setOnline(true);
    const desconectar = () => setOnline(false);
    window.addEventListener('online', conectar);
    window.addEventListener('offline', desconectar);

    return () => {
      window.removeEventListener('online', conectar);
      window.removeEventListener('offline', desconectar);
    };
  }, []);

  if (online) return null;

  return (
    <Aviso tono="info">
      Sin conexion
      {actualizadoEn > 0 && <> · datos cargados {textoDeAntiguedad(Date.now() - actualizadoEn)}</>}.
      No vas a poder reservar ni cancelar hasta que vuelvas a tener red.
    </Aviso>
  );
}
