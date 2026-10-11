import { ApiProperty } from '@nestjs/swagger';

export class DiagnosticsMemoryDto {
  @ApiProperty({ example: 52428800 })
  rssBytes: number;

  @ApiProperty({ example: 20971520 })
  heapUsedBytes: number;

  @ApiProperty({ example: 41943040 })
  heapTotalBytes: number;

  @ApiProperty({ example: 10485760 })
  externalBytes: number;
}

export class DiagnosticsHeapDto {
  @ApiProperty({ example: 20971520 })
  usedBytes: number;

  @ApiProperty({ example: 41943040 })
  totalBytes: number;

  @ApiProperty({ example: 1073741824 })
  limitBytes: number;

  @ApiProperty({ example: 52428800 })
  availableBytes: number;
}

export class DiagnosticsCpuDto {
  @ApiProperty({
    example: 1234.5,
    description: 'Cumulative user CPU time since process start (ms)',
  })
  userMs: number;

  @ApiProperty({
    example: 234.5,
    description: 'Cumulative system CPU time since process start (ms)',
  })
  systemMs: number;
}

export class DiagnosticsHandlesDto {
  @ApiProperty({
    example: 5,
    description: 'Active OS handles (sockets, timers, etc.). -1 if unavailable.',
  })
  activeHandles: number;

  @ApiProperty({ example: 2, description: 'Active async requests. -1 if unavailable.' })
  activeRequests: number;
}

export class RuntimeStatsDto {
  @ApiProperty({ example: 12345 })
  pid: number;

  @ApiProperty({ example: 'v20.11.0' })
  nodeVersion: string;

  @ApiProperty({ example: 'linux' })
  platform: string;

  @ApiProperty({ example: 'x64' })
  arch: string;

  @ApiProperty({ example: 3600.5 })
  uptimeSeconds: number;

  @ApiProperty({ example: 'production' })
  environment: string;

  @ApiProperty({ type: DiagnosticsMemoryDto })
  memory: DiagnosticsMemoryDto;

  @ApiProperty({ type: DiagnosticsHeapDto })
  heap: DiagnosticsHeapDto;

  @ApiProperty({ type: DiagnosticsCpuDto })
  cpu: DiagnosticsCpuDto;

  @ApiProperty({ type: DiagnosticsHandlesDto })
  handles: DiagnosticsHandlesDto;
}

export class DiagnosticsResponseDto {
  @ApiProperty({ type: RuntimeStatsDto })
  runtime: RuntimeStatsDto;

  @ApiProperty({
    description: 'Current metrics snapshot',
    example: { gauges: { 'process.uptime_seconds': 3600 } },
  })
  metrics: Record<string, unknown>;

  @ApiProperty({
    description: 'Active spans in the tracing service',
    example: [],
  })
  activeSpans: unknown[];

  @ApiProperty({
    description: 'Most recent completed spans',
    example: [],
  })
  recentSpans: unknown[];

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  collectedAt: string;
}

export class HeapSnapshotResponseDto {
  @ApiProperty({ example: '/tmp/Heap-12345-1-1704067200.heapsnapshot' })
  path: string;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  triggeredAt: string;
}
