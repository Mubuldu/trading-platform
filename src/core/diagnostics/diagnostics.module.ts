import { Module } from '@nestjs/common';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { DiagnosticsController } from './diagnostics.controller';
import { DiagnosticsService } from './diagnostics.service';

/**
 * DiagnosticsModule wires runtime inspection endpoints.
 *
 * InMemoryMetricsService and TracingService are both @Global() exports, so
 * they are available here without importing MetricsModule or TracingModule
 * explicitly. DiagnosticsService injects them as @Optional() so the module
 * works in isolation (unit tests, early startup) if those providers are absent.
 *
 * ApiKeyGuard is registered as a provider so NestJS DI can inject ConfigService
 * into it. The guard is applied at the controller level via @UseGuards().
 */
@Module({
  controllers: [DiagnosticsController],
  providers: [DiagnosticsService, ApiKeyGuard],
  exports: [DiagnosticsService],
})
export class DiagnosticsModule {}
