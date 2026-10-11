import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { HealthController } from '@core/health/health.controller';
import { HealthService } from '@core/health/health.service';
import { LivenessResponseDto } from '@core/health/dto/liveness-response.dto';
import { ReadinessResponseDto } from '@core/health/dto/readiness-response.dto';
import { HealthResponseDto } from '@core/health/dto/health-response.dto';

const makeLiveness = (): LivenessResponseDto => ({
  status: 'alive',
  pid: process.pid,
  uptimeSeconds: 3600,
  timestamp: new Date().toISOString(),
});

const makeReadiness = (status: 'ready' | 'not-ready' = 'ready'): ReadinessResponseDto => ({
  status,
  checks: { database: { status: 'healthy' } },
  timestamp: new Date().toISOString(),
});

const makeHealth = (status: 'ok' | 'degraded' | 'error' = 'ok'): HealthResponseDto => ({
  status,
  info: {
    application: { status: 'up', version: '1.0.0', environment: 'test' },
    uptime: { status: 'up', seconds: 3600 },
    memory: { status: 'up', metrics: { rss: 1, heapUsed: 1, heapTotal: 2, external: 0 } },
  },
  timestamp: new Date().toISOString(),
});

describe('HealthController', () => {
  let controller: HealthController;
  let mockHealthService: jest.Mocked<HealthService>;

  beforeEach(async () => {
    mockHealthService = {
      getLiveness: jest.fn().mockReturnValue(makeLiveness()),
      getReadiness: jest.fn().mockResolvedValue({ response: makeReadiness(), isReady: true }),
      getHealth: jest.fn().mockResolvedValue(makeHealth()),
    } as unknown as jest.Mocked<HealthService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: mockHealthService }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('getLiveness()', () => {
    it('should return status "alive"', () => {
      expect(controller.getLiveness().status).toBe('alive');
    });

    it('should return a positive pid', () => {
      expect(controller.getLiveness().pid).toBeGreaterThan(0);
    });

    it('should return a valid ISO timestamp', () => {
      const { timestamp } = controller.getLiveness();
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
    });
  });

  describe('getReadiness()', () => {
    const mockRes = () => ({ status: jest.fn().mockReturnThis() }) as unknown as Response;

    it('should return status "ready" when healthy', async () => {
      const result = await controller.getReadiness(mockRes());
      expect(result.status).toBe('ready');
    });

    it('should set 503 and return "not-ready" when unhealthy', async () => {
      mockHealthService.getReadiness.mockResolvedValue({
        response: makeReadiness('not-ready'),
        isReady: false,
      });
      const res = mockRes();
      const result = await controller.getReadiness(res);
      expect(result.status).toBe('not-ready');
      expect(res.status).toHaveBeenCalledWith(503);
    });

    it('should include check results', async () => {
      const result = await controller.getReadiness(mockRes());
      expect(result.checks).toBeDefined();
    });
  });

  describe('getHealth()', () => {
    it('should return status "ok"', async () => {
      const result = await controller.getHealth();
      expect(result.status).toBe('ok');
    });

    it('should return application info', async () => {
      const result = await controller.getHealth();
      expect(result.info.application.status).toBe('up');
      expect(result.info.application.version).toBe('1.0.0');
    });

    it('should return a valid ISO timestamp', async () => {
      const result = await controller.getHealth();
      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });
});
