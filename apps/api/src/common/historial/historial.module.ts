import { Global, Module } from '@nestjs/common';
import { HistorialService } from './historial.service';

// Global: lo usan los cinco modulos de la fase y todos los que vengan despues.
// Importarlo uno a uno seria ruido sin beneficio.
@Global()
@Module({
  providers: [HistorialService],
  exports: [HistorialService],
})
export class HistorialModule {}
