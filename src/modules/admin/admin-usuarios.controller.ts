import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { RequirePermission } from '../auth/require-permission.decorator.js';
import { AdminUsuariosService } from './admin-usuarios.service.js';
import {
  ListarUsuariosQueryDto,
  PaginaUsuariosDto,
  RevogacaoResultDto,
} from './admin.dto.js';

@Controller('admin/usuarios')
export class AdminUsuariosController {
  constructor(private readonly service: AdminUsuariosService) {}

  @Get()
  @RequirePermission('usuario:listar')
  @ZodResponse({ status: 200, type: PaginaUsuariosDto })
  listar(@Query() query: ListarUsuariosQueryDto) {
    return this.service.listar(query.page, query.pageSize);
  }

  @Post(':userId/revogar-sessoes')
  @RequirePermission('sessao:revogar')
  @ZodResponse({ status: 200, type: RevogacaoResultDto })
  revogarSessoes(@Param('userId') userId: string) {
    return this.service.revogarSessoes(userId);
  }
}
