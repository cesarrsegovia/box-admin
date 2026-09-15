import { IsIn } from 'class-validator';
import type { TipoCancelacion } from '@boxadmin/shared';

/**
 * `?tipo=recuperable|definitiva` en minusculas, como pide el documento; se
 * normaliza al enum antes de guardar.
 */
export class CancelarReservaDto {
  @IsIn(['recuperable', 'definitiva'])
  tipo!: 'recuperable' | 'definitiva';
}

export function aTipoCancelacion(tipo: 'recuperable' | 'definitiva'): TipoCancelacion {
  return tipo === 'recuperable' ? 'RECUPERABLE' : 'DEFINITIVA';
}
