import { LoggerService } from '@/core/logger/logger.service';
import { type INestApplication, type NestMiddleware } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { AuthGuard } from '../../auth/auth.guard';
import { PluginsController } from '../plugins.controller';
import { PluginsService } from '../plugins.service';

describe('PluginsController authentication', () => {
  let app: INestApplication;
  const plugins = mock<PluginsService>();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PluginsController],
      providers: [AuthGuard, { provide: PluginsService, useValue: plugins }, { provide: LoggerService, useValue: mock<LoggerService>() }],
    }).compile();
    app = module.createNestApplication();
    app.use(((req, _res, next) => {
      if (req.headers.authorization === 'Bearer test') {
        req.user = { id: 7 };
        req.authMethod = 'session';
      }
      next();
    }) as NestMiddleware['use']);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('requires authentication for discovery and installation', async () => {
    expect((await request(app.getHttpServer()).get('/plugins')).status).toBe(401);
    expect((await request(app.getHttpServer()).post('/plugins/app-health/install')).status).toBe(401);
    expect(plugins.update).not.toHaveBeenCalled();
  });

  it('uses the authenticated account and rejects session mutations without a matching origin', async () => {
    plugins.list.mockResolvedValue([]);
    expect((await request(app.getHttpServer()).get('/plugins').set('Authorization', 'Bearer test')).status).toBe(200);
    expect(plugins.list).toHaveBeenCalledWith(7);
    expect((await request(app.getHttpServer()).post('/plugins/app-health/install').set('Authorization', 'Bearer test')).status).toBe(403);
    expect(plugins.update).not.toHaveBeenCalled();
    plugins.update.mockResolvedValue([]);
    expect(
      (
        await request(app.getHttpServer())
          .post('/plugins/app-health/install')
          .set('Authorization', 'Bearer test')
          .set('Host', 'localhost')
          .set('Origin', 'http://localhost')
      ).status,
    ).toBe(201);
    expect(plugins.update).toHaveBeenCalledWith(7, 'app-health', 'install');
  });
});
