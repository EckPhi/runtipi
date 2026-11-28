import { Body, Controller, Get, Put, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { DashboardWidgetsService } from './dashboard-widgets.service';
import {
  DashboardWidgetDataDto,
  DashboardWidgetDataQueryDto,
  DashboardWidgetPreferencesBodyDto,
  DashboardWidgetsDto,
} from './dto/dashboard-widgets.dto';

const getUserId = (req: Request) => {
  if (!req.user) throw new UnauthorizedException();
  return req.user.id;
};

@Controller('dashboard/widgets')
@UseGuards(AuthGuard)
export class DashboardWidgetsController {
  constructor(private readonly widgets: DashboardWidgetsService) {}

  @Get()
  @ApiResponse({ type: DashboardWidgetsDto })
  async getDashboardWidgets(@Req() req: Request) {
    const widgets = await this.widgets.getWidgets(getUserId(req));

    return DashboardWidgetsDto.parse({ widgets }, { reportOnly: true });
  }

  @Get('data')
  @ApiResponse({ type: DashboardWidgetDataDto })
  async getDashboardWidgetData(@Query() query: DashboardWidgetDataQueryDto) {
    const data = await this.widgets.getWidgetData(query.key);

    return DashboardWidgetDataDto.parse(data, { reportOnly: true });
  }

  @Put('preferences')
  @ApiResponse({ type: DashboardWidgetsDto })
  async setDashboardWidgetPreferences(@Req() req: Request, @Body() body: DashboardWidgetPreferencesBodyDto) {
    const userId = getUserId(req);
    await this.widgets.setHiddenWidgets(userId, body.hidden);

    return DashboardWidgetsDto.parse({ widgets: await this.widgets.getWidgets(userId) }, { reportOnly: true });
  }
}
