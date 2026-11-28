import { Module } from '@nestjs/common';
import { AppsModule } from '../apps/apps.module';
import { BackupManagerModule } from '../backups/backup-manager.module';
import { DockerModule } from '../docker/docker.module';
import { PluginsModule } from '../plugins/plugins.module';
import { SystemModule } from '../system/system.module';
import { DashboardWidgetsController } from './dashboard-widgets.controller';
import { DashboardWidgetsRepository } from './dashboard-widgets.repository';
import { DashboardWidgetsService } from './dashboard-widgets.service';
import { InstalledAppsReader } from './installed-apps.reader';
import { AppBackupsSource } from './sources/app-backups.source';
import { AppResourcesSource } from './sources/app-resources.source';
import { AppStorageSource } from './sources/app-storage.source';
import { WidgetRegistry } from './widget-registry';

@Module({
  imports: [AppsModule, BackupManagerModule, DockerModule, PluginsModule, SystemModule],
  controllers: [DashboardWidgetsController],
  providers: [
    DashboardWidgetsService,
    DashboardWidgetsRepository,
    InstalledAppsReader,
    WidgetRegistry,
    AppResourcesSource,
    AppBackupsSource,
    AppStorageSource,
  ],
})
export class DashboardWidgetsModule {}
