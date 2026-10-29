import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { CustomerProfileModule } from '../customer-profile';
import { IdentityAccessModule } from '../identity-access';
import { ObjectStore, UnconfiguredObjectStore } from '../platform';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { MalwareScanner, UnconfiguredScanner } from './ports';

@Module({
  imports: [AuditModule, IdentityAccessModule, CustomerProfileModule],
  controllers: [DocumentController],
  providers: [DocumentService,
    // Safe defaults: no storage and no scanner until the bank's providers are wired in [BANK-DECIDES]. A missing scanner leaves files closed to staff.
    { provide: ObjectStore, useClass: UnconfiguredObjectStore }, { provide: MalwareScanner, useClass: UnconfiguredScanner }],
  exports: [DocumentService],
})
export class DocumentEvidenceModule {}
