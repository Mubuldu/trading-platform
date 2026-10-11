import { ApiProperty } from '@nestjs/swagger';

export class ReadinessCheckDetail {
  @ApiProperty({ example: 'healthy', enum: ['healthy', 'degraded', 'unhealthy'] })
  status: string;

  @ApiProperty({ required: false, example: 'Connected' })
  message?: string;

  @ApiProperty({ required: false, example: 2 })
  latencyMs?: number;
}

export class ReadinessResponseDto {
  @ApiProperty({ example: 'ready', enum: ['ready', 'not-ready'] })
  status: 'ready' | 'not-ready';

  @ApiProperty({
    description: 'Per-dependency readiness check results',
    example: { database: { status: 'healthy' }, cache: { status: 'healthy' } },
  })
  checks: Record<string, ReadinessCheckDetail>;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;
}
