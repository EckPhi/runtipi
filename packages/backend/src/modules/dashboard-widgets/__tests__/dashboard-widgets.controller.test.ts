import { LoggerService } from '@/core/logger/logger.service';
import { type INestApplication, type NestMiddleware } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';
import { AuthGuard } from '../../auth/auth.guard';
import { DashboardWidgetsController } from '../dashboard-widgets.controller';
import { DashboardWidgetsService } from '../dashboard-widgets.service';

describe('DashboardWidgetsController', () => {
  let app: INestApplication;
  const service = mock<DashboardWidgetsService>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DashboardWidgetsController],
      providers: [AuthGuard, { provide: DashboardWidgetsService, useValue: service }, { provide: LoggerService, useValue: mock<LoggerService>() }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(((req, _res, next) => {
      if (req.headers.authorization === 'Bearer token') req.user = { id: 3 };
      next();
    }) as NestMiddleware['use']);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    service.getWidgets.mockReset();
    service.getWidgetData.mockReset();
    service.setHiddenWidgets.mockReset();
    service.getWidgets.mockResolvedValue([]);
  });

  it.each([
    ['get', '/dashboard/widgets'],
    ['get', '/dashboard/widgets/data?key=a:b/c'],
    ['put', '/dashboard/widgets/preferences'],
  ] as const)('requires authentication for %s %s', async (method, url) => {
    const response = await request(app.getHttpServer())[method](url).send({ hidden: [] });

    expect(response.status).toBe(401);
    expect(service.getWidgets).not.toHaveBeenCalled();
    expect(service.getWidgetData).not.toHaveBeenCalled();
    expect(service.setHiddenWidgets).not.toHaveBeenCalled();
  });

  it('lists the widgets of the current user', async () => {
    const response = await request(app.getHttpServer()).get('/dashboard/widgets').set('Authorization', 'Bearer token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ widgets: [] });
    expect(service.getWidgets).toHaveBeenCalledWith(3);
  });

  it('returns the data of a widget', async () => {
    service.getWidgetData.mockResolvedValue({
      key: 'a:b/c',
      status: 'ok',
      sampledAt: 1,
      data: { type: 'stat', value: { kind: 'failures', value: 0 }, secondary: null },
    });

    const response = await request(app.getHttpServer()).get('/dashboard/widgets/data').query({ key: 'a:b/c' }).set('Authorization', 'Bearer token');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ type: 'stat', value: { kind: 'failures', value: 0 }, secondary: null });
    expect(service.getWidgetData).toHaveBeenCalledWith('a:b/c');
  });

  it('saves the hidden widgets of the current user', async () => {
    const response = await request(app.getHttpServer())
      .put('/dashboard/widgets/preferences')
      .set('Authorization', 'Bearer token')
      .send({ hidden: ['a:b/c'] });

    expect(response.status).toBe(200);
    expect(service.setHiddenWidgets).toHaveBeenCalledWith(3, ['a:b/c']);
  });
});
