import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../audit';
import { AccessService } from './access.service';
import { AdminController } from './admin.controller';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Module({
  imports: [AuditModule],
  controllers: [AuthController, AdminController],
  providers: [AuthService, AccessService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService, AccessService],
})
export class IdentityAccessModule {}
