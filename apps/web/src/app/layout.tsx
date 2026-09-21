import type { Metadata, Viewport } from 'next';
import { ProveedorDeDatos } from '@/lib/query';
import './globals.css';

export const metadata: Metadata = {
  title: 'BoxAdmin',
  description: 'Tus clases, en tu bolsillo.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'BoxAdmin' },
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
  // `viewportFit: cover` para que la barra inferior no quede debajo del area
  // de gestos en los telefonos con muesca.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <ProveedorDeDatos>{children}</ProveedorDeDatos>
      </body>
    </html>
  );
}
