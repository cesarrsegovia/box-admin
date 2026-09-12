import { defineConfig } from 'prisma/config';

// Prisma 7 ya no acepta `url = env("DATABASE_URL")` dentro del datasource
// del schema.prisma; la URL de conexión para Migrate se declara aquí.
// El script pnpm que invoca este CLI usa `dotenv-cli` para cargar el .env
// de la raíz del monorepo ANTES de spawnear el proceso, así que
// `process.env.DATABASE_URL` ya está disponible cuando este archivo se evalúa.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
