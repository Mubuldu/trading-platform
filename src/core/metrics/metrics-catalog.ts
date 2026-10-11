export const MetricsCatalog = {
  // ── Process ───────────────────────────────────────────────────────────────
  PROCESS_UPTIME_SECONDS: 'process.uptime_seconds',
  PROCESS_MEMORY_RSS: 'process.memory.rss_bytes',
  PROCESS_MEMORY_HEAP_USED: 'process.memory.heap_used_bytes',
  PROCESS_MEMORY_HEAP_TOTAL: 'process.memory.heap_total_bytes',
  PROCESS_MEMORY_EXTERNAL: 'process.memory.external_bytes',
  PROCESS_CPU_USER_MS: 'process.cpu.user_ms',
  PROCESS_CPU_SYSTEM_MS: 'process.cpu.system_ms',
  PROCESS_CPU_USER_PERCENT: 'process.cpu.user_percent',
  PROCESS_CPU_SYSTEM_PERCENT: 'process.cpu.system_percent',

  // ── V8 Heap ───────────────────────────────────────────────────────────────
  V8_HEAP_USED: 'v8.heap.used_bytes',
  V8_HEAP_TOTAL: 'v8.heap.total_bytes',
  V8_HEAP_LIMIT: 'v8.heap.limit_bytes',
  V8_HEAP_AVAILABLE: 'v8.heap.available_bytes',
  V8_MALLOCED_MEMORY: 'v8.malloced_memory_bytes',

  // ── Garbage Collection ────────────────────────────────────────────────────
  GC_DURATION_MS: 'gc.duration_ms',
  GC_COUNT: 'gc.count',

  // ── Event Loop ────────────────────────────────────────────────────────────
  EVENT_LOOP_LAG_MS: 'event_loop.lag_ms',

  // ── HTTP ──────────────────────────────────────────────────────────────────
  HTTP_REQUEST_DURATION_MS: 'http.request.duration_ms',
  HTTP_REQUESTS_TOTAL: 'http.requests.total',
  HTTP_REQUESTS_ACTIVE: 'http.requests.active',

  // ── Database ──────────────────────────────────────────────────────────────
  DB_QUERY_DURATION_MS: 'db.query.duration_ms',
  DB_CONNECTIONS_ACTIVE: 'db.connections.active',
  DB_CONNECTIONS_IDLE: 'db.connections.idle',
  DB_LATENCY_MS: 'db.latency_ms',

  // ── Redis ─────────────────────────────────────────────────────────────────
  REDIS_LATENCY_MS: 'redis.latency_ms',
  REDIS_COMMANDS_TOTAL: 'redis.commands.total',
  REDIS_CONNECTIONS_ACTIVE: 'redis.connections.active',

  // ── WebSocket ─────────────────────────────────────────────────────────────
  WS_LATENCY_MS: 'ws.latency_ms',
  WS_MESSAGES_RECEIVED: 'ws.messages.received',
  WS_BYTES_RECEIVED: 'ws.bytes.received',
  WS_CONNECTIONS_ACTIVE: 'ws.connections.active',

  // ── Queue / Streams ───────────────────────────────────────────────────────
  QUEUE_LENGTH: 'queue.length',
  STREAM_CONSUMER_LAG: 'stream.consumer.lag',
  EVENT_PROCESSING_RATE: 'event.processing.rate',

  // ── Application ───────────────────────────────────────────────────────────
  OPEN_CONNECTIONS: 'connections.open',
} as const;

export type MetricName = (typeof MetricsCatalog)[keyof typeof MetricsCatalog];
