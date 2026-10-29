import { Module } from '@nestjs/common';
import { CreditModule } from '../credit';
import { IntegrationModule } from '../integration';
import { WorkflowModule } from '../workflow';
import { SchedulerService } from './scheduler.service';

@Module({ imports: [WorkflowModule, IntegrationModule, CreditModule], providers: [SchedulerService], exports: [SchedulerService] })
export class SchedulerModule {}
