import { Controller, Get, Param, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { PluginsService } from './plugins.service';

@Controller('plugins')
@UseGuards(AuthGuard)
export class PluginsController {
  constructor(private readonly plugins: PluginsService) {}

  @Get()
  getPlugins(@Req() req: Request) {
    if (!req.user) throw new UnauthorizedException();
    return this.plugins.list(req.user.id);
  }

  @Post(':id/:action')
  updatePlugin(@Req() req: Request, @Param('id') id: string, @Param('action') action: string) {
    if (!req.user) throw new UnauthorizedException();
    return this.plugins.update(req.user.id, id, action);
  }
}
