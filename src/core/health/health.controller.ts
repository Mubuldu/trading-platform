import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { HealthService } from './health.service';
import { LivenessResponseDto } from './dto/liveness-response.dto';
import { ReadinessResponseDto } from './dto/readiness-response.dto';
import { HealthResponseDto } from './dto/health-response.dto';

/**
 * HealthController exposes three tiers of health information.
 *
 * Endpoint semantics:
 *
 *  GET /live   — Liveness probe.
 *    Always 200 if the process is responding. Checks nothing external.
 *    K8s uses this to decide whether to restart the pod.
 *
 *  GET /ready  — Readiness probe.
 *    200 = ready to serve traffic; 503 = not ready (remove from LB).
 *    K8s uses this to gate traffic to the pod.
 *
 *  GET /       — Full health check (for dashboards and monitoring).
 *    Always 200. Includes infrastructure checks + metrics snapshot.
 *    Status is expressed in the response body, not the HTTP code.
 *
 * Route order matters in Express: more specific routes (/live, /ready)
 * must be declared before the catch-all GET /.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Liveness probe',
    description: 'Returns 200 if the process is alive. Checks no external dependencies.',
  })
  @ApiResponse({ status: 200, description: 'Process is alive', type: LivenessResponseDto })
  getLiveness(): LivenessResponseDto {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Returns 200 if all infrastructure dependencies are healthy or degraded. Returns 503 if any dependency is unhealthy.',
  })
  @ApiResponse({
    status: 200,
    description: 'Service is ready to accept traffic',
    type: ReadinessResponseDto,
  })
  @ApiResponse({
    status: 503,
    description: 'Service is not ready — one or more dependencies are unhealthy',
    type: ReadinessResponseDto,
  })
  async getReadiness(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponseDto> {
    const { response, isReady } = await this.healthService.getReadiness();
    if (!isReady) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return response;
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Full platform health check',
    description:
      'Comprehensive health including infrastructure checks and runtime metrics snapshot. Always returns 200 — check the status field in the body.',
  })
  @ApiResponse({ status: 200, description: 'Health data', type: HealthResponseDto })
  async getHealth(): Promise<HealthResponseDto> {
    return this.healthService.getHealth();
  }
}
