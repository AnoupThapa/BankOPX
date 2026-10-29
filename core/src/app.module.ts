import { Module } from '@nestjs/common';
import { AuditController } from './audit/audit.controller';
import { AuditModule } from './audit';
import { ConfigurationModule } from './configuration';
import { HealthController } from './health.controller';
import { IdentityAccessModule } from './identity-access';
import { PlatformModule } from './platform';

@Module({
  imports: [PlatformModule, AuditModule, IdentityAccessModule, ConfigurationModule],
  controllers: [HealthController, AuditController],
})
export class AppModule {}
