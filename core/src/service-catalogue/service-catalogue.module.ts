import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration';
import { CustomerProfileModule } from '../customer-profile';
import { IdentityAccessModule } from '../identity-access';
import { CatalogueController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';

@Module({ imports: [ConfigurationModule, CustomerProfileModule, IdentityAccessModule], controllers: [CatalogueController], providers: [CatalogueService] })
export class ServiceCatalogueModule {}
