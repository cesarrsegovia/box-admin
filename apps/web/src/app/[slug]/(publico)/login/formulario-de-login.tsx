'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Campo } from '@/componentes/formulario';
import { Aviso, Boton } from '@/componentes/ui';

const esquema = z.object({
  email: z.string().email('Ese email no parece valido'),
  password: z.string().min(1, 'Hace falta tu contrasena'),
});

type Datos = z.infer<typeof esquema>;

export function FormularioDeLogin({ slug }: { slug: string }) {
  const router = useRouter();
  const [errorDeApi, setErrorDeApi] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Datos>({ resolver: zodResolver(esquema) });

  async function enviar(datos: Datos) {
    setErrorDeApi(null);

    const respuesta = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...datos, tenantSlug: slug }),
    });

    if (!respuesta.ok) {
      const cuerpo = (await respuesta.json()) as { message?: string };
      // La API devuelve el mismo mensaje para email inexistente y password
      // incorrecta, a proposito: no filtra que emails estan dados de alta.
      setErrorDeApi(cuerpo.message ?? 'No se pudo iniciar sesion');
      return;
    }

    router.push(`/${slug}/calendario`);
  }

  return (
    <form onSubmit={handleSubmit(enviar)} className="flex flex-col gap-4" noValidate>
      {errorDeApi !== null && <Aviso tono="error">{errorDeApi}</Aviso>}

      <Campo etiqueta="Email" type="email" error={errors.email?.message} {...register('email')} />
      <Campo
        etiqueta="Contrasena"
        type="password"
        error={errors.password?.message}
        {...register('password')}
      />

      <Boton type="submit" cargando={isSubmitting}>
        Entrar
      </Boton>
    </form>
  );
}
