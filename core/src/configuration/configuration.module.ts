import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { IdentityAccessModule } from '../identity-access';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';
import { ConfigValidatorRegistry } from './validators';

@Module({
  imports: [AuditModule, IdentityAccessModule],
  controllers: [ConfigController],
  providers: [ConfigService, ConfigValidatorRegistry],
  exports: [ConfigService, ConfigValidatorRegistry],
})
export class ConfigurationModule {}
