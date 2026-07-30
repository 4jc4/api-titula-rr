import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminUsuariosController } from './admin-usuarios.controller.js';
import { AdminUsuariosService } from './admin-usuarios.service.js';

@Module({
  imports: [AuthModule], // SessionService vem do exports do AuthModule
  controllers: [AdminUsuariosController],
  providers: [AdminUsuariosService],
})
export class AdminModule {}
