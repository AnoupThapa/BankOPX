import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { CustomerProfileModule } from '../customer-profile';
import { DocumentEvidenceModule } from '../document-evidence';
import { FormsModule } from '../forms';
import { IdentityAccessModule } from '../identity-access';
import { ServiceCatalogueModule } from '../service-catalogue';
import { CaseController, StaffCaseController, TrackController } from './case.controller';
import { CaseService } from './case.service';

@Module({
  imports: [AuditModule, IdentityAccessModule, CustomerProfileModule, DocumentEvidenceModule, FormsModule, ServiceCatalogueModule],
  controllers: [CaseController, StaffCaseController, TrackController],
  providers: [CaseService],
  exports: [CaseService],
})
export class CaseModule {}
