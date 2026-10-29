import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { AuthedRequest, RequirePermission } from '../identity-access';
import { ProfileService } from '../customer-profile';
import { NotificationService } from './notification.service';

@Controller('customer/notifications')
export class NotificationController {
  constructor(private readonly notes: NotificationService, private readonly profiles: ProfileService) {}
  @Get() @RequirePermission('application.read')
  async list(@Req() req: AuthedRequest) { return this.notes.listMine(req.session$!, await this.profiles.profileIdOf(req.session$!)); }
  @Post(':id/read') @HttpCode(204) @RequirePermission('application.read')
  async read(@Req() req: AuthedRequest, @Param('id') id: string) { await this.notes.markRead(req.session$!, await this.profiles.profileIdOf(req.session$!), id); }
}
