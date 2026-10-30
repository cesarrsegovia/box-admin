/**
 * Los meses viven en `@/lib/mes` desde la Fase 15, cuando el area de la
 * profesora tambien los necesito. Esto queda para que Analisis siga
 * importando de `./filtros` sin tocar sus pantallas.
 *
 * Y fuera de `page.tsx`: Next 15 prohibe que un `page.tsx` exporte algo que no
 * sea el `default`, y el error de `next build` habla de `OmitWithTag`, que no
 * se parece a la causa.
 */
export * from '@/lib/mes';
