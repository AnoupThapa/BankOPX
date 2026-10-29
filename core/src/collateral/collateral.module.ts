import { Module, OnModuleInit } from '@nestjs/common';
import { AuditModule } from '../audit';
import { CaseModule } from '../case';
import { ConfigurationModule, ConfigValidatorRegistry } from '../configuration';
import { IdentityAccessModule } from '../identity-access';
import { collateralValidator } from './collateral-schema';
import { CollateralController, CollateralOpsController } from './collateral.controller';
import { CollateralService } from './collateral.service';

@Module({ imports: [AuditModule, IdentityAccessModule, ConfigurationModule, CaseModule], controllers: [CollateralController, CollateralOpsController], providers: [CollateralService], exports: [CollateralService] })
export class CollateralModule implements OnModuleInit {
  constructor(private readonly validators: ConfigValidatorRegistry) {}
  onModuleInit() { this.validators.register(collateralValidator); }
}
