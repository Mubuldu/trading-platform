import { ApiProperty } from '@nestjs/swagger';

export class MemoryMetrics {
  @ApiProperty({ example: 52428800 })
  rss: number;

  @ApiProperty({ example: 20971520 })
  heapUsed: number;

  @ApiProperty({ example: 41943040 })
  heapTotal: number;

  @ApiProperty({ example: 10485760 })
  external: number;
}

export class HealthDetails {
  @ApiProperty({ example: 'up', enum: ['up', 'down'] })
  status: 'up' | 'down';
}

export class ApplicationHealthDetail extends HealthDetails {
  @ApiProperty({ example: '1.0.0' })
  version: string;

  @ApiProperty({ example: 'development' })
  environment: string;
}

export class UptimeHealthDetail extends HealthDetails {
  @ApiProperty({ example: 3600.5 })
  seconds: number;
}

export class MemoryHealthDetail extends HealthDetails {
  @ApiProperty({ type: MemoryMetrics })
  metrics: MemoryMetrics;
}

export class HealthInfo {
  @ApiProperty({ type: ApplicationHealthDetail })
  application: ApplicationHealthDetail;

  @ApiProperty({ type: UptimeHealthDetail })
  uptime: UptimeHealthDetail;

  @ApiProperty({ type: MemoryHealthDetail })
  memory: MemoryHealthDetail;
}

export class HealthMetricsDto {
  @ApiProperty({ example: 3600 })
  uptimeSeconds: number;

  @ApiProperty({ example: 52428800 })
  rssBytes: number;

  @ApiProperty({ example: 20971520 })
  heapUsedBytes: number;

  @ApiProperty({ example: 41943040 })
  heapTotalBytes: number;

  @ApiProperty({ required: false, example: 3.2 })
  eventLoopLagMs?: number;

  @ApiProperty({ required: false, example: 142 })
  httpRequestsTotal?: number;

  @ApiProperty({ required: false, example: 48.7 })
  httpRequestDurationP95Ms?: number;

  @ApiProperty({ required: false, example: 9 })
  gcCount?: number;

  @ApiProperty({ required: false, example: 1.4 })
  gcDurationP95Ms?: number;
}

export class HealthResponseDto {
  @ApiProperty({ example: 'ok', enum: ['ok', 'degraded', 'error'] })
  status: 'ok' | 'degraded' | 'error';

  @ApiProperty({ type: HealthInfo })
  info: HealthInfo;

  @ApiProperty({
    required: false,
    description: 'Infrastructure provider health checks',
    example: { database: { status: 'healthy' }, cache: { status: 'healthy' } },
  })
  infrastructure?: Record<string, unknown>;

  @ApiProperty({
    required: false,
    type: HealthMetricsDto,
    description: 'Key runtime metrics at time of health check',
  })
  metrics?: HealthMetricsDto;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;
}
