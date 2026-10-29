import { Module } from '@nestjs/common';
import { IntegrationModule } from '../integration';
import { WorkflowModule } from '../workflow';
import { SchedulerService } from './scheduler.service';

@Module({ imports: [WorkflowModule, IntegrationModule], providers: [SchedulerService], exports: [SchedulerService] })
export class SchedulerModule {}
