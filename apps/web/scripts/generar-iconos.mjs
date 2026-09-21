/**
 * Rasteriza el SVG del icono a los PNG que exige el manifest.
 *
 * Los PNG SI se commitean, a diferencia del service worker: son fuente, no
 * artefacto de build, y sin ellos la aplicacion deja de ser instalable sin que
 * nada lo avise — Chrome no dice nada, simplemente no ofrece instalar.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(resolve(raiz, 'public/icono.svg'));

for (const tamano of [192, 512]) {
  const png = await sharp(svg).resize(tamano, tamano).png().toBuffer();
  await writeFile(resolve(raiz, `public/icono-${tamano}.png`), png);
  console.log(`icono-${tamano}.png:`, png.length, 'bytes');
}
