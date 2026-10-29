import { Controller, Get } from '@nestjs/common';
import { Public } from './identity-access';

@Controller('health')
export class HealthController {
  @Public() @Get() ok() { return { status: 'ok' }; }
}
