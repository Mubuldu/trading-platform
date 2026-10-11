export const REDIS_TOKENS = {
  REDIS_CLIENT: Symbol('RedisClient'),
  STREAM_PUBLISHER: Symbol('StreamPublisher'),
  STREAM_CONSUMER: Symbol('StreamConsumer'),
  CONSUMER_MANAGER: Symbol('ConsumerManager'),
  DEAD_LETTER_SERVICE: Symbol('DeadLetterService'),
  REPLAY_SERVICE: Symbol('ReplayService'),
  REDIS_HASH_SERVICE: Symbol('RedisHashService'),
  REDIS_SORTED_SET_SERVICE: Symbol('RedisSortedSetService'),
  BACKPRESSURE_MONITOR: Symbol('BackpressureMonitor'),
} as const;
