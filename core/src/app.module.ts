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
import { DocumentEvidenceModule } from './document-evidence';
import { FormsModule } from './forms';

@Module({
  imports: [PlatformModule, AuditModule, IdentityAccessModule, ConfigurationModule, CustomerProfileModule, ServiceCatalogueModule, FormsModule, DocumentEvidenceModule, CaseModule],
  controllers: [HealthController, AuditController],
})
export class AppModule {}
