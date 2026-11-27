import { castAppUrn } from '@/common/helpers/app-helpers';
import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { AppUrn } from '@runtipi/common/types';
import { AuthGuard } from '../auth/auth.guard';
import {
  InstalledPluginDto,
  InstalledPluginsDto,
  InstallPluginBodyDto,
  PluginDetailsDto,
  PluginSuccessDto,
  SearchPluginsDto,
  SearchPluginsQueryDto,
  UpdatePluginBodyDto,
  UpdatePluginConfigBodyDto,
} from './dto/plugins.dto';
import { PluginsService } from './plugins.service';

const parseUrn = (urn: string): AppUrn => {
  try {
    return castAppUrn(urn);
  } catch {
    throw new BadRequestException(`Invalid plugin urn: ${urn}`);
  }
};

@Controller('plugins')
@UseGuards(AuthGuard)
export class PluginsController {
  constructor(private readonly pluginsService: PluginsService) {}

  @Get('catalog/search')
  @ApiResponse({ type: SearchPluginsDto })
  async searchCatalog(@Query() query: SearchPluginsQueryDto) {
    const { search, pageSize, cursor, capability, storeId } = query;
    const res = await this.pluginsService.searchCatalog({ search, pageSize: pageSize ?? 24, cursor, capability, storeId });

    return SearchPluginsDto.parse(res, { reportOnly: true });
  }

  @Get('catalog/:urn')
  @ApiResponse({ type: PluginDetailsDto })
  async getCatalogPlugin(@Param('urn') urn: string) {
    const res = await this.pluginsService.getCatalogPlugin(parseUrn(urn));

    return PluginDetailsDto.parse(res, { reportOnly: true });
  }

  @Get('installed')
  @ApiResponse({ type: InstalledPluginsDto })
  async getInstalledPlugins() {
    const plugins = await this.pluginsService.getInstalledPlugins();

    return InstalledPluginsDto.parse({ plugins }, { reportOnly: true });
  }

  @Get('installed/:urn')
  @ApiResponse({ type: InstalledPluginDto })
  async getInstalledPlugin(@Param('urn') urn: string) {
    const plugin = await this.pluginsService.getInstalledPlugin(parseUrn(urn));

    return InstalledPluginDto.parse(plugin, { reportOnly: true });
  }

  @Post(':urn/install')
  @ApiResponse({ type: PluginSuccessDto })
  async installPlugin(@Param('urn') urn: string, @Body() body: InstallPluginBodyDto) {
    await this.pluginsService.installPlugin(parseUrn(urn), body.globalConfig ?? {});

    return PluginSuccessDto.parse({ success: true });
  }

  @Post(':urn/update')
  @ApiResponse({ type: PluginSuccessDto })
  async updatePlugin(@Param('urn') urn: string, @Body() body: UpdatePluginBodyDto) {
    await this.pluginsService.updatePlugin(parseUrn(urn), body?.globalConfig ?? {});

    return PluginSuccessDto.parse({ success: true });
  }

  @Delete(':urn')
  @ApiResponse({ type: PluginSuccessDto })
  async removePlugin(@Param('urn') urn: string) {
    await this.pluginsService.removePlugin(parseUrn(urn));

    return PluginSuccessDto.parse({ success: true });
  }

  @Post(':urn/enable')
  @ApiResponse({ type: PluginSuccessDto })
  async enablePlugin(@Param('urn') urn: string) {
    await this.pluginsService.setPluginEnabled(parseUrn(urn), true);

    return PluginSuccessDto.parse({ success: true });
  }

  @Post(':urn/disable')
  @ApiResponse({ type: PluginSuccessDto })
  async disablePlugin(@Param('urn') urn: string) {
    await this.pluginsService.setPluginEnabled(parseUrn(urn), false);

    return PluginSuccessDto.parse({ success: true });
  }

  @Patch(':urn/config')
  @ApiResponse({ type: PluginSuccessDto })
  async updateGlobalConfig(@Param('urn') urn: string, @Body() body: UpdatePluginConfigBodyDto) {
    await this.pluginsService.updateGlobalConfig(parseUrn(urn), body.globalConfig);

    return PluginSuccessDto.parse({ success: true });
  }
}
