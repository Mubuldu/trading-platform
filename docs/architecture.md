# Milestone 1 — Architecture Reference

## Folder Structure

```
trading-platform/
├── src/
│   ├── app/                    # Root module, application entrypoint
│   ├── common/                 # Cross-cutting infrastructure (no business logic)
│   │   ├── decorators/         # Custom parameter / method decorators
│   │   ├── filters/            # Exception filters
│   │   ├── guards/             # Authentication / authorization guards
│   │   ├── interceptors/       # Response transformation, timing
│   │   ├── middleware/         # HTTP-layer middleware (correlation ID, logging)
│   │   └── pipes/              # Input transformation and validation
│   ├── config/                 # Environment configuration and validation
│   ├── core/                   # Infrastructure services (logging, health)
│   │   ├── health/             # Health check endpoint
│   │   └── logging/            # Winston logger + AsyncLocalStorage store
│   ├── domain/                 # Domain models, value objects, interfaces
│   ├── infrastructure/         # External system adapters (DB, queues, brokers)
│   ├── modules/                # Vertical feature slices (market data, orders…)
│   └── shared/                 # Pure utilities, constants, type aliases
├── tests/
│   ├── unit/                   # Isolated component tests (no I/O)
│   ├── integration/            # Tests that cross module boundaries
│   └── e2e/                    # Full HTTP round-trip tests
├── docker/                     # Dockerfiles
├── docs/                       # Architecture and operational runbooks
└── scripts/                    # CI/CD and operational scripts
```

## Key Architectural Decisions

### 1. Strict Separation: common vs domain
`common/` holds infrastructure concerns that apply to every HTTP request
regardless of business context (correlation ID, logging, validation, error
formatting). `domain/` holds models and rules that encode trading semantics.
Nothing in `common/` may depend on anything in `domain/` or `modules/`.

### 2. AsyncLocalStorage for Correlation IDs
Correlation IDs are propagated through `AsyncLocalStorage` (Node.js built-in)
rather than passed explicitly through function parameters. This means any
component anywhere in the call chain can emit a correlated log line without
being coupled to the HTTP layer.

Rejected alternative — `cls-hooked`: adds a third-party dependency and uses
monkey-patching to intercept async primitives. AsyncLocalStorage achieves the
same result natively since Node.js 12.17.

### 3. Custom Logger (not nest-winston)
`AppLoggerService` directly wraps Winston and implements NestJS's
`LoggerService` interface. This gives full control over format, transports,
and lifecycle without pinning to a bridge library's release cadence.

### 4. Three-Stage Docker Build
`deps` → `build` → `runtime`. The runtime stage contains only production
`node_modules` and compiled JS. Dev tools never appear in the shipped image.

### 5. Environment-Specific Config Files
`.env.<NODE_ENV>` files are loaded at startup via `@nestjs/config`. The Joi
schema rejects startup if required variables are missing or malformed. Silent
misconfiguration is treated as a fatal error.

### 6. Global API Prefix + URI Versioning
All routes are prefixed `/api/v<N>/...`. URI versioning is used over header
versioning because it is visible in proxy logs, CDN rules, and browser
developer tools without extra configuration.

## Request Lifecycle

```
Client → [CorrelationIdMiddleware] → [RequestLoggingMiddleware]
       → [ValidationPipe] → [Controller] → [Response]
       ↕                                         ↕
  [GlobalExceptionFilter]         [ClassSerializerInterceptor]
```

1. `CorrelationIdMiddleware` reads or generates the correlation ID and enters
   an AsyncLocalStorage context for the remainder of the request's lifetime.
2. `RequestLoggingMiddleware` logs the incoming request and attaches a
   `finish` listener for the response log.
3. `ValidationPipe` validates and transforms the request DTO using
   `class-validator`. Unknown fields are stripped (`whitelist: true`).
4. The controller handler executes.
5. On success: `ClassSerializerInterceptor` applies `@Exclude` and `@Expose`
   decorators before serializing the response.
6. On error: `GlobalExceptionFilter` intercepts the exception, normalizes it
   into a consistent envelope, logs it, and sends the HTTP response.

## Observability Contract

Every log line contains:
- `timestamp` — ISO 8601 with milliseconds and timezone
- `level` — error / warn / info / verbose / debug
- `service` — `APP_NAME` from environment
- `correlationId` — UUIDv4 per request, or `no-context` for background tasks
- `context` — the class or function that emitted the log
- `message` — human-readable description

## Health Endpoint

`GET /api/v1/health` → HTTP 200

```json
{
  "status": "ok",
  "info": {
    "application": { "status": "up", "version": "1.0.0", "environment": "production" },
    "uptime":      { "status": "up", "seconds": 3600.12 },
    "memory":      { "status": "up", "metrics": { "rss": 52428800, "heapUsed": 20971520, "heapTotal": 41943040, "external": 1234567 } }
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```
