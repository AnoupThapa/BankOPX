import { Module } from '@nestjs/common';
import { CustomerProfileModule } from '../customer-profile';
import { IdentityAccessModule } from '../identity-access';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({ imports: [IdentityAccessModule, CustomerProfileModule], controllers: [NotificationController], providers: [NotificationService], exports: [NotificationService] })
export class NotificationModule {}
