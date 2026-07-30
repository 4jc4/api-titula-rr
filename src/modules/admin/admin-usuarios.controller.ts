import { Controller, Get, Param, Post } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { RequirePermission } from '../auth/require-permission.decorator.js';
import { AdminUsuariosService } from './admin-usuarios.service.js';
import { ListaUsuariosDto, RevogacaoResultDto } from './admin.dto.js';

@Controller('admin/usuarios')
export class AdminUsuariosController {
  constructor(private readonly service: AdminUsuariosService) {}

  @Get()
  @RequirePermission('usuario:listar')
  @ZodResponse({ status: 200, type: ListaUsuariosDto })
  listar() {
    return this.service.listar();
  }

  @Post(':userId/revogar-sessoes')
  @RequirePermission('sessao:revogar')
  @ZodResponse({ status: 200, type: RevogacaoResultDto })
  revogarSessoes(@Param('userId') userId: string) {
    return this.service.revogarSessoes(userId);
  }
}
