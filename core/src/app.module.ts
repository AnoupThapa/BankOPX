import { Module } from '@nestjs/common';
import { AuditController } from './audit/audit.controller';
import { AuditModule } from './audit';
import { ConfigurationModule } from './configuration';
import { HealthController } from './health.controller';
import { IdentityAccessModule } from './identity-access';
import { PlatformModule } from './platform';
import { CustomerProfileModule } from './customer-profile';
import { ServiceCatalogueModule } from './service-catalogue';
import { CaseModule } from './case';
import { NotificationModule } from './notification';
import { TatSlaModule } from './tat-sla';
import { WorkflowModule } from './workflow';
import { DocumentEvidenceModule } from './document-evidence';
import { FormsModule } from './forms';
import { IntegrationModule } from './integration';
import { PilotModule } from './pilot';
import { SchedulerModule } from './scheduler';
import { CreditModule } from './credit';
import { CollateralModule } from './collateral';
import { TradeModule } from './trade';

@Module({
  imports: [PlatformModule, AuditModule, IdentityAccessModule, ConfigurationModule, CustomerProfileModule, ServiceCatalogueModule, FormsModule, DocumentEvidenceModule, CaseModule, TatSlaModule, NotificationModule, WorkflowModule, IntegrationModule, PilotModule, SchedulerModule, CreditModule, CollateralModule, TradeModule],
  controllers: [HealthController, AuditController],
})
export class AppModule {}
