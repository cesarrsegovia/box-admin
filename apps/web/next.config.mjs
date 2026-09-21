import withSerwistInit from '@serwist/next';

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  // En desarrollo el service worker sirve versiones viejas y vuelve loco el
  // ciclo de trabajo. Por eso Playwright corre contra el build de produccion:
  // probarlo contra `next dev` no probaria nada.
  disable: process.env.NODE_ENV === 'development',
});

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // `@boxadmin/shared` se publica como TypeScript compilado dentro del
  // monorepo; sin esto Next no lo procesa y el import falla en el build.
  transpilePackages: ['@boxadmin/shared'],
};

export default withSerwist(config);
