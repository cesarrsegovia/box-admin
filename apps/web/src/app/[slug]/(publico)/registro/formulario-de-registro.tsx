'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Campo } from '@/componentes/formulario';
import { Aviso, Boton } from '@/componentes/ui';

/**
 * El esquema refleja el DTO de la API, no lo sustituye.
 *
 * Validar aqui le ahorra al alumno un viaje y un 401 que no explica nada — la
 * API devuelve el mismo mensaje para las cuatro formas de clave invalida, a
 * proposito, asi que "tu codigo tiene 5 caracteres" solo se lo puede decir el
 * cliente.
 */
const esquema = z.object({
  nombreCompleto: z.string().min(1, 'Hace falta tu nombre').max(120),
  email: z.string().email('Ese email no parece valido'),
  codigo: z.string().length(32, 'La clave tiene 32 caracteres'),
  password: z.string().min(8, 'Al menos 8 caracteres').max(128),
});

type Datos = z.infer<typeof esquema>;

export function FormularioDeRegistro({ slug }: { slug: string }) {
  const router = useRouter();
  const [errorDeApi, setErrorDeApi] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Datos>({ resolver: zodResolver(esquema) });

  async function enviar(datos: Datos) {
    setErrorDeApi(null);

    const respuesta = await fetch('/api/auth/auto-registro', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // El slug sale de la URL: el alumno no tiene por que saber que existe.
      body: JSON.stringify({ ...datos, tenantSlug: slug }),
    });

    if (!respuesta.ok) {
      const cuerpo = (await respuesta.json()) as { message?: string };
      setErrorDeApi(cuerpo.message ?? 'No se pudo completar el registro');
      return;
    }

    router.push(`/${slug}/calendario`);
  }

  return (
    <form onSubmit={handleSubmit(enviar)} className="flex flex-col gap-4" noValidate>
      {errorDeApi !== null && <Aviso tono="error">{errorDeApi}</Aviso>}

      <Campo
        etiqueta="Nombre completo"
        error={errors.nombreCompleto?.message}
        {...register('nombreCompleto')}
      />
      <Campo etiqueta="Email" type="email" error={errors.email?.message} {...register('email')} />
      <Campo
        etiqueta="Clave de invitacion"
        error={errors.codigo?.message}
        placeholder="La que te dio tu gimnasio"
        {...register('codigo')}
      />
      <Campo
        etiqueta="Contrasena"
        type="password"
        error={errors.password?.message}
        {...register('password')}
      />

      <Boton type="submit" cargando={isSubmitting}>
        Crear mi cuenta
      </Boton>
    </form>
  );
}
