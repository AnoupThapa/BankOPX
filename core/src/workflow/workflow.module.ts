import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { CaseModule } from '../case';
import { CollateralModule } from '../collateral';
import { TradeModule } from '../trade';
import { ConfigurationModule } from '../configuration';
import { IntegrationModule } from '../integration';
import { IdentityAccessModule } from '../identity-access';
import { NotificationModule } from '../notification';
import { TatSlaModule } from '../tat-sla';
import { OpsController, WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';

@Module({
  imports: [AuditModule, IdentityAccessModule, ConfigurationModule, CaseModule, TatSlaModule, NotificationModule, IntegrationModule, CollateralModule, TradeModule],
  controllers: [WorkflowController, OpsController],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
