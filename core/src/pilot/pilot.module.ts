import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { CaseModule } from '../case';
import { IdentityAccessModule } from '../identity-access';
import { IntegrationModule } from '../integration';
import { TatSlaModule } from '../tat-sla';
import { PilotController } from './pilot.controller';
import { PilotService } from './pilot.service';

@Module({ imports: [AuditModule, IdentityAccessModule, CaseModule, TatSlaModule, IntegrationModule], controllers: [PilotController], providers: [PilotService] })
export class PilotModule {}
