import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { CaseModule } from '../case';
import { ConfigurationModule } from '../configuration';
import { IdentityAccessModule } from '../identity-access';
import { NotificationModule } from '../notification';
import { TatSlaModule } from '../tat-sla';
import { ControlledHandoffConnector, FULFILMENT_CONNECTORS } from './handoff';
import { IntegrationCallbackController, IntegrationCustomerController, IntegrationOpsController, IntegrationStaffController } from './integration.controller';
import { ConnectorSecrets, EnvConnectorSecrets, IntegrationService } from './integration.service';

@Module({
  imports: [AuditModule, IdentityAccessModule, ConfigurationModule, CaseModule, TatSlaModule, NotificationModule],
  controllers: [IntegrationStaffController, IntegrationOpsController, IntegrationCallbackController, IntegrationCustomerController],
  providers: [
    IntegrationService,
    { provide: ConnectorSecrets, useClass: EnvConnectorSecrets },
    // Connectors are registered here. The pilot starts with the controlled hand-off; a bank adapter replaces or joins it behind the same port (docs/09 §2).
    { provide: FULFILMENT_CONNECTORS, useValue: [new ControlledHandoffConnector('controlled-handoff')] },
  ],
  exports: [IntegrationService],
})
export class IntegrationModule {}
