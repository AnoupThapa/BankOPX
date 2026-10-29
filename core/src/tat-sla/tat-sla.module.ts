import { Module } from '@nestjs/common';
import { IdentityAccessModule } from '../identity-access';
import { TatService } from './tat.service';

@Module({ imports: [IdentityAccessModule], providers: [TatService], exports: [TatService] })
export class TatSlaModule {}
