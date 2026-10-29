import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { AuthedRequest, RequirePermission } from '../identity-access';
import { Channel } from './contact';
import { ProfileService } from './profile.service';

@Controller('staff/customers')
export class StaffCustomerController {
  constructor(private readonly profiles: ProfileService) {}
  /** Exact-match lookup by verified contact, branch-scoped (SEC-12). POST so the contact never appears in a URL (SEC-03). */
  @Post('lookup') @HttpCode(200) @RequirePermission('customer.lookup')
  lookup(@Req() req: AuthedRequest, @Body() b: { channel?: Channel; destination?: string }) { return this.profiles.staffLookup(req.session$!, b.channel as Channel, String(b.destination ?? '')); }
}
