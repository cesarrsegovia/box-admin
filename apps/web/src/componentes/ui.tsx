import type { ButtonHTMLAttributes, ReactNode } from 'react';

type TonoDeBoton = 'primario' | 'secundario' | 'peligro';

const CLASES_DE_BOTON: Record<TonoDeBoton, string> = {
  primario: 'bg-slate-900 text-white hover:bg-slate-800',
  secundario: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
  peligro: 'bg-red-50 text-red-700 hover:bg-red-100',
};

interface PropsDeBoton extends ButtonHTMLAttributes<HTMLButtonElement> {
  tono?: TonoDeBoton;
  cargando?: boolean;
}

export function Boton({
  tono = 'primario',
  cargando = false,
  disabled,
  children,
  className = '',
  ...resto
}: PropsDeBoton) {
  return (
    <button
      // `aria-busy` y no solo un spinner: un lector de pantalla tiene que poder
      // saber que la accion esta en curso.
      aria-busy={cargando}
      disabled={disabled === true || cargando}
      className={
        `rounded-lg px-4 py-2 text-sm font-medium transition ` +
        `disabled:cursor-not-allowed disabled:opacity-50 ` +
        `${CLASES_DE_BOTON[tono]} ${className}`
      }
      {...resto}
    >
      {children}
    </button>
  );
}

type TonoDeAviso = 'info' | 'error' | 'exito';

const CLASES_DE_AVISO: Record<TonoDeAviso, string> = {
  info: 'bg-slate-50 text-slate-700 border-slate-200',
  error: 'bg-red-50 text-red-800 border-red-200',
  exito: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};

export function Aviso({
  tono = 'info',
  alerta = false,
  children,
}: {
  tono?: TonoDeAviso;
  /**
   * Anunciarlo aunque no sea un error.
   *
   * Para el aviso que SUSTITUYE al control que la persona acaba de accionar: si
   * el boton desaparece y en su sitio aparece una explicacion, quien usa lector
   * de pantalla pierde el foco y no oye nada —pulsa, y para el no pasa nada—.
   * No se activa solo por `tono="info"` porque un "datos de hace 3 minutos" que
   * aparece por su cuenta si seria ruido.
   */
  alerta?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      // Los errores lo llevan siempre; el resto, solo si lo piden. Ese rol
      // interrumpe al lector de pantalla y no se reparte gratis.
      role={tono === 'error' || alerta ? 'alert' : undefined}
      className={`rounded-lg border px-3 py-2 text-sm ${CLASES_DE_AVISO[tono]}`}
    >
      {children}
    </div>
  );
}

export function Tarjeta({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">{children}</div>
  );
}
