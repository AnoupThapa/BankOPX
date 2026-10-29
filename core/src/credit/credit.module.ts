import { Module, OnModuleInit } from '@nestjs/common';
import { AuditModule } from '../audit';
import { CaseModule } from '../case';
import { ConfigurationModule, ConfigValidatorRegistry } from '../configuration';
import { IdentityAccessModule } from '../identity-access';
import { CreditController, CreditOpsController } from './credit.controller';
import { creditValidator } from './credit-schema';
import { CreditService } from './credit.service';
import { ExternalCheckPort, UnconfiguredExternalCheck } from './external-check';

@Module({ imports: [AuditModule, IdentityAccessModule, ConfigurationModule, CaseModule], controllers: [CreditController, CreditOpsController], providers: [CreditService, { provide: ExternalCheckPort, useClass: UnconfiguredExternalCheck }], exports: [CreditService] })
export class CreditModule implements OnModuleInit {
  constructor(private readonly validators: ConfigValidatorRegistry) {}
  onModuleInit() { this.validators.register(creditValidator); }   // regression packs for the credit kinds (CFG-03)
}
