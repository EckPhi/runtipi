import { Module } from '@nestjs/common';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { PluginsController } from './plugins.controller';
import { PluginsRepository } from './plugins.repository';
import { PluginsService } from './plugins.service';

@Module({
  imports: [MarketplaceModule],
  controllers: [PluginsController],
  providers: [PluginsService, PluginsRepository],
  exports: [PluginsService],
})
export class PluginsModule {}
