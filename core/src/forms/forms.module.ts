import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration';
import { FormsService } from './forms.service';

@Module({ imports: [ConfigurationModule], providers: [FormsService], exports: [FormsService] })
export class FormsModule {}
