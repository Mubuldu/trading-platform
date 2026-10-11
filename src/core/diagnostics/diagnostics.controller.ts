import {
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { DiagnosticsService } from './diagnostics.service';
import {
  DiagnosticsResponseDto,
  HeapSnapshotResponseDto,
  RuntimeStatsDto,
} from './dto/diagnostics-response.dto';

/**
 * DiagnosticsController exposes deep runtime inspection endpoints.
 *
 * Endpoint summary:
 *  GET  /diagnostics         — full diagnostics report (runtime + metrics + spans)
 *  GET  /diagnostics/runtime — runtime stats only (PID, memory, heap, CPU, handles)
 *  POST /diagnostics/heap-snapshot — trigger a heap snapshot (non-production only)
 *
 * Authentication:
 *  All endpoints require the `x-api-key` header matching `API_KEY_SECRET`.
 *  This prevents PID, heap stats, CPU times, and active span data from being
 *  exposed to unauthenticated callers.
 *
 * Production safety:
 *  - Heap snapshot is blocked in production: taking a snapshot causes a ~1s
 *    GC pause that would impact request latency.
 *  - At the infrastructure layer, further restrict this path to internal
 *    network ranges (VPC security group / nginx allow-list).
 */
@ApiTags('Diagnostics')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('diagnostics')
export class DiagnosticsController {
  constructor(private readonly diagnosticsService: DiagnosticsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Full diagnostics report',
    description: 'Returns runtime stats, metrics snapshot, and active/recent tracing spans.',
  })
  @ApiResponse({ status: 200, description: 'Diagnostics report', type: DiagnosticsResponseDto })
  getDiagnostics(): DiagnosticsResponseDto {
    return {
      runtime: this.diagnosticsService.getRuntimeStats(),
      metrics: this.diagnosticsService.getMetricsSnapshot(),
      activeSpans: this.diagnosticsService.getActiveSpans(),
      recentSpans: this.diagnosticsService.getRecentSpans(),
      collectedAt: new Date().toISOString(),
    };
  }

  @Get('runtime')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Runtime statistics',
    description: 'Process PID, memory usage, V8 heap, CPU time, and active handle counts.',
  })
  getRuntime(): RuntimeStatsDto {
    return this.diagnosticsService.getRuntimeStats();
  }

  @Post('heap-snapshot')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trigger heap snapshot',
    description:
      'Writes a V8 heap snapshot to the OS temp directory. ' +
      'Blocked in production. Causes a brief GC pause (~1s) — use sparingly.',
  })
  @ApiResponse({ status: 200, description: 'Snapshot written', type: HeapSnapshotResponseDto })
  @ApiResponse({ status: 403, description: 'Disabled in production' })
  triggerHeapSnapshot(): HeapSnapshotResponseDto {
    if (this.diagnosticsService.isProductionEnvironment()) {
      throw new ForbiddenException(
        'Heap snapshots are disabled in production to prevent GC pauses.',
      );
    }

    const path = this.diagnosticsService.triggerHeapSnapshot();
    return {
      path,
      triggeredAt: new Date().toISOString(),
    };
  }
}
