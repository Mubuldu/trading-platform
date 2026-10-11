import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { join } from 'path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '@app/app.module';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { GlobalExceptionFilter } from '@common/filters/global-exception.filter';
import { AppConfig } from '@config/app.config';

/**
 * Bootstrap sequence:
 *  1. Create NestJS application with custom logger (replaces console output)
 *  2. Apply security headers via Helmet
 *  3. Apply global prefix and URI versioning
 *  4. Apply global pipes, filters, and interceptors
 *  5. Configure CORS
 *  6. Set request body size limits (defence against oversized payloads)
 *  7. Set up Swagger (non-production only)
 *  8. Register graceful shutdown hooks
 *  9. Start listening
 *
 * Security hardening applied here:
 *  - Helmet sets: CSP, HSTS, X-Frame-Options, X-Content-Type-Options,
 *    Referrer-Policy, X-DNS-Prefetch-Control, Permissions-Policy, etc.
 *  - Body size cap (1 MB JSON, 512 KB URL-encoded) rejects oversized payloads
 *    before they reach any route handler.
 *  - CORS restricted to explicit origin allow-list (empty list → deny all).
 *  - Rate limiting applied globally via @nestjs/throttler (see AppModule).
 *  - Swagger disabled in production; no internal API surface is exposed.
 *
 * Graceful shutdown:
 *  SIGTERM / SIGINT → NestJS calls onModuleDestroy() on all modules in reverse
 *  dependency order, then closes the HTTP server. In-flight requests complete
 *  before the server stops accepting new connections.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const logger = app.get(AppLoggerService);
  app.useLogger(logger);

  const configService = app.get(ConfigService);
  const config = configService.get<AppConfig>('app');

  if (!config) {
    throw new Error('Failed to load AppConfig during bootstrap');
  }

  // ── Security headers (Helmet) ──────────────────────────────────────────────
  // Applied before any route handler. Each header is set conservatively for an
  // API server — no browsing context is needed so CSP, frame-options, etc. are
  // locked down. Swagger endpoint requires a relaxed CSP for its own assets;
  // that exception is handled by the Swagger setup block below.
  app.use(
    helmet({
      contentSecurityPolicy:
        config.environment === 'production'
          ? true // strict default-src: 'none' in production
          : false, // relaxed in dev/staging to allow Swagger UI inline scripts
      hsts: {
        maxAge: 31_536_000, // 1 year in seconds
        includeSubDomains: true,
        preload: true,
      },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  // ── Static assets (development tools) ─────────────────────────────────────
  // Serves files from <project-root>/public/ at the root path.
  // Used in development for the bot monitoring dashboard at /dashboard.html.
  // Production deployments should use a CDN or reverse-proxy for static files.
  if (config.environment !== 'production') {
    app.useStaticAssets(join(process.cwd(), 'public'));
  }

  // ── Prefix & versioning ────────────────────────────────────────────────────
  app.setGlobalPrefix('api');

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // ── Request body size limits ───────────────────────────────────────────────
  // Prevents oversized payloads from consuming memory before validation runs.
  // 1 MB for JSON bodies is generous for a trading API; adjust if bulk-upload
  // endpoints are added (those should use streaming or chunked uploads).
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '512kb', extended: true });

  // ── Global pipes, filters, interceptors ───────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
      stopAtFirstError: false,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter(logger));

  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // ── CORS ──────────────────────────────────────────────────────────────────
  // In development allow all origins so browser-based tools (Swagger, local
  // dashboards, Claude artifacts) can call the API without a CORS error.
  // In production restrict to the explicit allow-list.
  app.enableCors({
    origin: config.environment === 'development' ? true : (config.cors.origins.length > 0 ? config.cors.origins : false),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id', 'x-api-key'],
    exposedHeaders: ['x-correlation-id'],
    credentials: true,
  });

  // ── Swagger (non-production only) ─────────────────────────────────────────
  if (config.swagger.enabled && config.environment !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Trading Platform API')
      .setDescription(
        'Production-grade algorithmic trading platform — internal API documentation. ' +
          'Not available in production.',
      )
      .setVersion(config.version)
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'api-key')
      .addTag('Health', 'Platform liveness and readiness checks')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        showExtensions: true,
      },
    });

    logger.log(`Swagger UI available at http://localhost:${config.port}/api/docs`, 'Bootstrap');
  }

  app.enableShutdownHooks();

  await app.listen(config.port);

  logger.log(
    `Trading Platform v${config.version} running on port ${config.port} [${config.environment}]`,
    'Bootstrap',
  );
  logger.log(`Health endpoint: http://localhost:${config.port}/api/v1/health`, 'Bootstrap');
}

bootstrap().catch((error: Error) => {
  process.stderr.write(`Fatal bootstrap error: ${error.message}\n${error.stack ?? ''}\n`);
  process.exit(1);
});
