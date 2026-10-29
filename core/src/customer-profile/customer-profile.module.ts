import { Module } from '@nestjs/common';
import { AuditModule } from '../audit';
import { ConfigurationModule } from '../configuration';
import { IdentityAccessModule } from '../identity-access';
import { CustomerController } from './customer.controller';
import { OtpService } from './otp.service';
import { CoreBankingPort, OtpDelivery, UnconfiguredCoreBanking, UnconfiguredOtpDelivery } from './ports';
import { ProfileService } from './profile.service';
import { StaffCustomerController } from './staff-customer.controller';

@Module({
  imports: [AuditModule, ConfigurationModule, IdentityAccessModule],
  controllers: [CustomerController, StaffCustomerController],
  providers: [
    OtpService, ProfileService,
    // Safe defaults: refuse to send OTPs / match customers until a bank-approved provider is wired in [BANK-DECIDES].
    { provide: OtpDelivery, useClass: UnconfiguredOtpDelivery },
    { provide: CoreBankingPort, useClass: UnconfiguredCoreBanking },
  ],
  exports: [ProfileService],
})
export class CustomerProfileModule {}
