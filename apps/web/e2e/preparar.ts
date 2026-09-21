/**
 * Prepara un gimnasio con una sala, un turno publicado y una clave de
 * invitacion, llamando a la API — nunca escribiendo en la base directamente.
 *
 * Usar la API y no SQL no es purismo: si el alta cambiara de reglas, un seed
 * por SQL seguiria pasando mientras la aplicacion real se rompe.
 */
const API = process.env.API_URL ?? 'http://localhost:3000';
const BOOTSTRAP = process.env.BOOTSTRAP_KEY ?? 'changeme_bootstrap_key';

async function llamar<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const respuesta = await fetch(`${API}${ruta}`, {
    ...opciones,
    headers: { 'content-type': 'application/json', ...(opciones.headers ?? {}) },
  });

  if (!respuesta.ok) {
    throw new Error(`${ruta} devolvio ${respuesta.status}: ${await respuesta.text()}`);
  }

  return (await respuesta.json()) as T;
}

export interface GimnasioDePrueba {
  slug: string;
  adminToken: string;
  salaId: string;
  turnoId: string;
  codigo: string;
  anio: number;
  mes: number;
  fecha: string;
}

/**
 * El turno se crea MAÑANA, no en un 2099 lejano.
 *
 * Los e2e del backend usan 2099 porque solo les importa la contabilidad, pero
 * aqui la pantalla abre en la semana de HOY: un turno en 2099 sencillamente no
 * se ve, y el test fallaria por un motivo que no tiene nada que ver con lo que
 * intenta probar.
 *
 * Mañana esta dentro de la semana actual salvo que hoy sea domingo, y para ese
 * caso el propio test navega a la semana siguiente.
 */
function manana(): { anio: number; mes: number; fecha: string } {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const anio = d.getUTCFullYear();
  const mes = d.getUTCMonth() + 1;
  const dia = d.getUTCDate();

  return {
    anio,
    mes,
    fecha: `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`,
  };
}

export async function prepararGimnasio(): Promise<GimnasioDePrueba> {
  const slug = `e2e${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const { anio, mes, fecha } = manana();

  await llamar(`/auth/tenants`, {
    method: 'POST',
    headers: { 'x-bootstrap-key': BOOTSTRAP },
    body: JSON.stringify({ nombre: slug, slug }),
  });

  await llamar(`/auth/register`, {
    method: 'POST',
    headers: { 'x-bootstrap-key': BOOTSTRAP },
    body: JSON.stringify({
      tenantSlug: slug,
      nombreCompleto: 'Admin',
      email: `admin@${slug}.io`,
      password: 'Password123!',
    }),
  });

  const login = await llamar<{ accessToken: string }>(`/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ tenantSlug: slug, email: `admin@${slug}.io`, password: 'Password123!' }),
  });
  const auth = { authorization: `Bearer ${login.accessToken}` };

  const sala = await llamar<{ id: string }>(`/salas`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ nombre: 'Sala A', cupoBase: 5 }),
  });

  const turno = await llamar<{ id: string }>(`/turnos`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      salaId: sala.id,
      nombre: 'Pilates',
      fecha,
      horaInicio: '18:00',
      horaFin: '19:00',
      cupo: 5,
    }),
  });

  const clave = await llamar<{ codigo: string }>(`/invitaciones`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ nombre: 'e2e', salaIds: [sala.id] }),
  });

  // Sin publicar el mes, el alumno no ve NINGUN turno: es el gate de la
  // decision D1 de la Fase 3A.
  await fetch(`${API}/calendario/${sala.id}/${anio}/${mes}/publicar`, {
    method: 'POST',
    headers: auth,
  });

  for (let i = 0; i < 80; i++) {
    const estado = await llamar<{ publicacion: { estado: string } | null }>(
      `/calendario/${sala.id}/${anio}/${mes}`,
      { headers: auth },
    );
    if (estado.publicacion?.estado === 'terminado') break;
    if (estado.publicacion?.estado === 'fallido') {
      throw new Error('La publicacion del mes fallo. ¿Hay otra API robando jobs de Redis?');
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  return {
    slug,
    adminToken: login.accessToken,
    salaId: sala.id,
    turnoId: turno.id,
    codigo: clave.codigo,
    anio,
    mes,
    fecha,
  };
}
