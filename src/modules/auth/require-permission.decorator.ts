import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiForbiddenResponse } from '@nestjs/swagger';
import type { Permissao } from './permissions.js';

export const PERMISSAO_KEY = 'permissao';

// Um decorator, dois efeitos: registra a permissão exigida (lida pelo
// PermissionGuard) e documenta o 403 no OpenAPI que o orval consome.
export const RequirePermission = (permissao: Permissao) =>
  applyDecorators(
    SetMetadata(PERMISSAO_KEY, permissao),
    ApiForbiddenResponse({
      description: `Requer a permissão '${permissao}'`,
    }),
  );
