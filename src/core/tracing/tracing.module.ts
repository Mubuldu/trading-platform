import { Global, Module } from '@nestjs/common';
import { TracingService } from './tracing.service';
import { TRACING_TOKEN } from './tracing.interface';

/**
 * TracingModule provides the ITracing implementation globally.
 *
 * Extension: to add OpenTelemetry, create OtelTracingService implementing
 * ITracing and change `useClass` here. Callers injecting TRACING_TOKEN
 * receive the new implementation automatically.
 */
@Global()
@Module({
  providers: [
    TracingService,
    {
      provide: TRACING_TOKEN,
      useExisting: TracingService,
    },
  ],
  exports: [TRACING_TOKEN, TracingService],
})
export class TracingModule {}
