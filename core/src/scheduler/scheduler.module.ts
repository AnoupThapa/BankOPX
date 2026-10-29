import { Module } from '@nestjs/common';
import { CollateralModule } from '../collateral';
import { CreditModule } from '../credit';
import { TradeModule } from '../trade';
import { IntegrationModule } from '../integration';
import { WorkflowModule } from '../workflow';
import { SchedulerService } from './scheduler.service';

@Module({ imports: [WorkflowModule, IntegrationModule, CreditModule, CollateralModule, TradeModule], providers: [SchedulerService], exports: [SchedulerService] })
export class SchedulerModule {}
