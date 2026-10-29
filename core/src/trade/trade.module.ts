import { Module, OnModuleInit } from '@nestjs/common';
import { AuditModule } from '../audit';
import { CaseModule } from '../case';
import { ConfigurationModule, ConfigValidatorRegistry } from '../configuration';
import { IdentityAccessModule } from '../identity-access';
import { tradeValidator } from './trade-schema';
import { TradeController, TradeOpsController } from './trade.controller';
import { TradeService } from './trade.service';

@Module({ imports: [AuditModule, IdentityAccessModule, ConfigurationModule, CaseModule], controllers: [TradeController, TradeOpsController], providers: [TradeService], exports: [TradeService] })
export class TradeModule implements OnModuleInit {
  constructor(private readonly validators: ConfigValidatorRegistry) {}
  onModuleInit() { this.validators.register(tradeValidator); }
}
