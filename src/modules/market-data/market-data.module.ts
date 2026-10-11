import { Module } from '@nestjs/common';
import { ExchangeModule } from '@modules/exchange/exchange.module';
import { BinanceFeedService } from './binance-feed.service';

/**
 * MarketDataModule — real-time public market data ingestion.
 *
 * Bootstraps BinanceFeedService which opens a persistent WebSocket
 * connection to Binance Combined Streams (no API key required).
 *
 * On startup it:
 *  1. Emits TICKER_UPDATED events on MarketDataEventBus → PaperExchangeAdapter
 *     receives live bid/ask/last prices so MARKET orders fill immediately.
 *  2. Publishes closed klines to market:kline:{interval} Redis streams →
 *     KlineConsumerService feeds candles to the indicator pipeline.
 *
 * Imports ExchangeModule to access MarketDataEventBus.
 * StreamPublisherService is globally available via InfrastructureModule.
 */
@Module({
  imports: [ExchangeModule],
  providers: [BinanceFeedService],
  exports: [BinanceFeedService],
})
export class MarketDataModule {}
