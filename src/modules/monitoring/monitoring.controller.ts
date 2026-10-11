import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { ApiKeyGuard } from '@common/guards/api-key.guard';
import { NormalizedSymbol } from '@modules/exchange/models/common.model';
import { OrderSide, OrderType, TimeInForce } from '@modules/exchange/enums/order.enums';
import { PaperExchangeAdapter } from '@modules/paper-trading/infrastructure/adapters/paper-exchange.adapter';
import { PaperAccountService } from '@modules/paper-trading/application/services/paper-account.service';
import { PaperPortfolioManagerService } from '@modules/paper-trading/application/services/paper-portfolio-manager.service';
import { PaperOrderBookService } from '@modules/paper-trading/application/services/paper-order-book.service';
import { PaperReportService } from '@modules/paper-trading/application/services/paper-report.service';
import { PaperStateStoreService } from '@modules/paper-trading/infrastructure/store/paper-state-store.service';
import { RiskStateService } from '@modules/risk/application/services/risk-state.service';
import { RiskConfig } from '@config/risk.config';
import { StrategyRegistryService } from '@modules/strategy/registry/strategy-registry.service';
import { TrendFollowingV1Strategy } from '@modules/strategy/plugins/trend-following-v1/trend-following-v1.strategy';

/**
 * MonitoringController exposes real-time observability endpoints for the
 * paper trading bot — account state, positions, pending orders, trade history,
 * P&L performance, and strategy health.
 *
 * All routes are protected by the x-api-key header (ApiKeyGuard).
 * Base path: /api/v1/monitor
 */
@ApiTags('Monitoring')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('monitor')
export class MonitoringController {
  private readonly riskCfg: RiskConfig;

  constructor(
    configService: ConfigService,
    private readonly account: PaperAccountService,
    private readonly portfolio: PaperPortfolioManagerService,
    private readonly orderBook: PaperOrderBookService,
    private readonly report: PaperReportService,
    private readonly stateStore: PaperStateStoreService,
    private readonly riskState: RiskStateService,
    private readonly strategyRegistry: StrategyRegistryService,
    private readonly paperAdapter: PaperExchangeAdapter,
  ) {
    this.riskCfg = configService.get<RiskConfig>('risk')!;
  }

  /**
   * Wraps any Redis-backed promise with a deadline so Docker Desktop Windows
   * networking stalls don't hang HTTP responses indefinitely.
   * Returns null when the promise takes longer than `ms` milliseconds.
   */
  private redisSafe<T>(promise: Promise<T>, ms = 3_000): Promise<T | null> {
    return Promise.race([
      promise.catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
  }

  // ── Overview ────────────────────────────────────────────────────────────────

  @Get('overview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bot overview snapshot',
    description:
      'Single-call summary: account balance, equity, drawdown, open positions/orders, ' +
      'today\'s P&L, and strategy health. Refresh every few seconds for a live view.',
  })
  async getOverview() {
    const accountState = this.account.getState();
    const positions = this.portfolio.getOpenPositions();
    const openOrders = this.orderBook.getOpenOrders();
    const strategyHealth = this.strategyRegistry.getHealth();

    let dailyPnl: number | null = null;
    let dailyReturnPct: number | null = null;
    const daily = await this.redisSafe(this.report.getDailyReport(), 500);
    if (daily) { dailyPnl = daily.netPnl; dailyReturnPct = daily.returnPercent; }

    const drawdownPct = this.portfolio.getCurrentDrawdown();
    // Use the configured starting balance (PAPER_TRADING_INITIAL_BALANCE_USD) so
    // totalReturnPct is meaningful from day one, even before any position is closed.
    const initialBalance = this.account.getInitialBalance();

    return {
      snapshotAt: new Date().toISOString(),
      account: {
        balance: accountState.balance,
        lockedBalance: accountState.lockedBalance,
        equity: accountState.equity,
        peakEquity: accountState.peakEquity,
        totalRealizedPnl: accountState.totalRealizedPnl,
        totalFees: accountState.totalFees,
        totalReturnPct:
          initialBalance > 0
            ? parseFloat((((accountState.equity - initialBalance) / initialBalance) * 100).toFixed(4))
            : 0,
        tradeCount: accountState.tradeCount,
        startedAt: new Date(accountState.startedAt).toISOString(),
      },
      risk: {
        currentDrawdownPct: parseFloat(drawdownPct.toFixed(4)),
        openPositions: positions.length,
        pendingOrders: openOrders.length,
      },
      today: {
        netPnl: dailyPnl,
        returnPct: dailyReturnPct,
      },
      strategy: {
        totalRegistered: strategyHealth.totalRegistered,
        totalEnabled: strategyHealth.enabled,
        inError: strategyHealth.inError,
        strategies: strategyHealth.strategies.map((s) => ({
          id: s.id,
          name: s.name,
          enabled: s.enabled,
          state: s.state,
          version: s.version,
          lastSignalAt: s.lastSignalAt ? new Date(s.lastSignalAt).toISOString() : null,
          lastError: s.lastError,
        })),
      },
    };
  }

  // ── Positions ────────────────────────────────────────────────────────────────

  @Get('positions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Open positions',
    description: 'All paper positions currently open with unrealized P&L.',
  })
  getPositions() {
    const positions = this.portfolio.getOpenPositions();

    // Build a symbol → livePrice map from strategy thoughts so we can compute
    // mark-to-market unrealized PnL server-side on every request.
    // Strategy thoughts are already computed in-memory — no extra I/O.
    const thoughts = this.strategyRegistry.getAll()
      .filter((s): s is TrendFollowingV1Strategy => s instanceof TrendFollowingV1Strategy)
      .flatMap((s) => s.getThought());
    const priceMap = new Map<string, number>(
      thoughts
        .filter((t): t is typeof t & { livePrice: number } => t.livePrice != null)
        .map((t) => [t.symbol, t.livePrice as number]),
    );

    return {
      count: positions.length,
      positions: positions.map((p) => {
        const sym = String(p.symbol);
        const livePrice = priceMap.get(sym) ?? null;
        const dir = String(p.direction).toUpperCase() === 'LONG' ? 1 : -1;
        // Mark-to-market: use live price when available; fall back to the
        // fill-price-based value that the position state carries (which is 0
        // at open, until the next fill updates it).
        const unrealizedPnl =
          livePrice != null && p.quantity > 0 && p.averageEntryPrice > 0
            ? p.quantity * (livePrice - p.averageEntryPrice) * dir
            : p.unrealizedPnl;

        return {
          positionId: p.positionId,
          symbol: sym,
          strategyId: p.strategyId,
          direction: p.direction,
          quantity: p.quantity,
          averageEntryPrice: p.averageEntryPrice,
          unrealizedPnl,
          livePrice,
          realizedPnl: p.realizedPnl,
          totalFees: p.totalFees,
          totalFunding: p.totalFunding,
          openedAt: new Date(p.openedAt).toISOString(),
          updatedAt: new Date(p.updatedAt).toISOString(),
        };
      }),
    };
  }

  // ── Orders ───────────────────────────────────────────────────────────────────

  @Get('orders')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pending orders',
    description: 'All paper orders that have been submitted but not yet filled or cancelled.',
  })
  getOrders() {
    const orders = this.orderBook.getOpenOrders();
    return {
      count: orders.length,
      orders: orders.map((o) => ({
        orderId: o.orderId,
        clientOrderId: o.clientOrderId,
        strategyId: o.strategyId,
        symbol: String(o.symbol),
        side: o.side,
        type: o.type,
        timeInForce: o.timeInForce,
        state: o.state,
        requestedQuantity: o.requestedQuantity,
        filledQuantity: o.filledQuantity,
        remainingQuantity: o.remainingQuantity,
        limitPrice: o.limitPrice ?? null,
        stopPrice: o.stopPrice ?? null,
        trailingDeltaBps: o.trailingDeltaBps ?? null,
        trailStopPrice: o.trailStopPrice ?? null,
        reduceOnly: o.reduceOnly,
        postOnly: o.postOnly,
        createdAt: new Date(o.createdAt).toISOString(),
        updatedAt: new Date(o.updatedAt).toISOString(),
      })),
    };
  }

  // ── Trades ───────────────────────────────────────────────────────────────────

  @Get('trades')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reconstructed round-trip trades',
    description:
      'Pairs BUY and SELL fills into complete trades (FIFO average-cost). Each row shows ' +
      'entry price, exit price, gross/net P&L, total commissions, hold duration, and strategy. ' +
      'Returns newest-first. Max 500 trades per request.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max trades to return (default 50, max 500)' })
  async getTrades(@Query('limit') limitParam?: string) {
    const limit = Math.min(parseInt(limitParam ?? '50', 10) || 50, 500);
    const trades = (await this.redisSafe(this.report.getReconstructedTrades(limit * 4))) ?? [];
    // Slice after reconstruction because limit applies to trades, not raw fills
    const sliced = trades.slice(0, limit);
    return {
      count: sliced.length,
      trades: sliced.map((t) => ({
        tradeId: t.tradeId,
        strategyId: t.strategyId,
        symbol: t.symbol,
        side: t.side,
        quantity: t.quantity,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        entryTime: new Date(t.entryTime).toISOString(),
        exitTime: new Date(t.exitTime).toISOString(),
        durationMs: t.durationMs,
        grossPnl: parseFloat(t.grossPnl.toFixed(4)),
        commission: parseFloat(t.commission.toFixed(4)),
        netPnl: parseFloat(t.netPnl.toFixed(4)),
        slippage: parseFloat(t.slippage.toFixed(4)),
        isWin: t.isWin,
      })),
    };
  }

  @Get('fills')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Raw fill log',
    description: 'Individual fill records (one row per executed order leg). Useful for debugging. Max 200 per request.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max fills to return (default 50, max 200)' })
  async getFills(@Query('limit') limitParam?: string) {
    const limit = Math.min(parseInt(limitParam ?? '50', 10) || 50, 200);
    const fills = (await this.redisSafe(this.report.getTradeHistory(limit))) ?? [];
    return {
      count: fills.length,
      fills,
    };
  }

  // ── Performance ───────────────────────────────────────────────────────────────

  @Get('performance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'P&L performance report',
    description:
      'Full performance breakdown: daily, weekly, monthly, all-time P&L plus drawdown and exposure.',
  })
  async getPerformance() {
    const [daily, weekly, monthly, allTime, drawdown] = await Promise.all([
      this.redisSafe(this.report.getDailyReport()),
      this.redisSafe(this.report.getWeeklyReport()),
      this.redisSafe(this.report.getMonthlyReport()),
      this.redisSafe(this.report.getAllTimeReport()),
      this.redisSafe(this.report.getDrawdownReport()),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      daily,
      weekly,
      monthly,
      allTime,
      drawdown,
    };
  }

  // ── Strategy ──────────────────────────────────────────────────────────────────

  @Get('strategy')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Strategy registry health',
    description: 'Status of all loaded strategies: enabled/running state, version, health.',
  })
  getStrategy() {
    const health = this.strategyRegistry.getHealth();
    const all = this.strategyRegistry.getAll();

    return {
      summary: {
        totalRegistered: health.totalRegistered,
        totalEnabled: health.enabled,
        inError: health.inError,
        byState: health.byState,
      },
      strategies: all.map((s) => {
        const h = s.getHealth();
        return {
          id: s.id,
          name: h.name,
          version: s.version,
          state: h.state,
          enabled: h.enabled,
          metrics: h.metrics,
          lastSignalAt: h.lastSignalAt ? new Date(h.lastSignalAt).toISOString() : null,
          lastErrorAt: h.lastErrorAt ? new Date(h.lastErrorAt).toISOString() : null,
          lastError: h.lastError,
        };
      }),
    };
  }

  // ── Strategy thought ─────────────────────────────────────────────────────────

  @Get('thought')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Strategy reasoning snapshot',
    description:
      'Returns what each strategy is currently "thinking" — its internal state, live indicator ' +
      'values, and a plain-English explanation of why it is or isn\'t entering a position.',
  })
  getThought() {
    const strategies = this.strategyRegistry.getAll();
    // Each TrendFollowingV1Strategy now returns one thought per symbol (BTC, ETH, …).
    // flatMap flattens the per-strategy arrays into a single list for the dashboard.
    const thoughts = strategies
      .filter((s): s is TrendFollowingV1Strategy => s instanceof TrendFollowingV1Strategy)
      .flatMap((s) => s.getThought());

    return {
      generatedAt: new Date().toISOString(),
      count: thoughts.length,
      thoughts,
    };
  }

  // ── Equity curve ─────────────────────────────────────────────────────────────

  @Get('equity-curve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Daily equity curve',
    description:
      'Historical daily equity snapshots for charting account growth over time. ' +
      'Returns up to 400 days of records plus the live current equity.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max days to return (default 90, max 400)' })
  async getEquityCurve(@Query('limit') limitParam?: string) {
    const limit = Math.min(parseInt(limitParam ?? '90', 10) || 90, 400);
    const records = (await this.redisSafe(this.stateStore.loadDailyRecords(limit))) ?? [];
    const accountState = this.account.getState();
    const initialBalance = this.account.getInitialBalance();
    const totalReturnPct =
      initialBalance > 0
        ? parseFloat((((accountState.equity - initialBalance) / initialBalance) * 100).toFixed(4))
        : 0;

    return {
      generatedAt: new Date().toISOString(),
      current: {
        equity: accountState.equity,
        totalReturnPct,
      },
      points: records.map((r) => ({
        date: r.date,
        equity: r.closeEquity,
        pnl: r.netPnl,
        returnPct: r.returnPercent,
        trades: r.tradeCount,
      })),
    };
  }

  // ── Risk guard ────────────────────────────────────────────────────────────────

  @Get('risk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Risk engine status',
    description:
      'Live risk metrics — daily loss, drawdown, consecutive losses, win rate — ' +
      'plus the configured limits, so the dashboard can render progress bars.',
  })
  getRisk() {
    const m = this.riskState.getMetrics();

    // Determine aggregate status
    let status: 'OK' | 'WARNING' | 'BLOCKED' = 'OK';
    if (m.isKillSwitchActive || m.isTradingPaused) {
      status = 'BLOCKED';
    } else if (
      m.currentDrawdownPercent >= this.riskCfg.maxDrawdownPercent * 0.7 ||
      m.dailyLoss >= this.riskCfg.maxDailyLossUsd * 0.7 ||
      m.consecutiveLosses >= this.riskCfg.maxConsecutiveLosses - 1
    ) {
      status = 'WARNING';
    }

    return {
      status,
      metrics: {
        currentEquity: m.currentEquity,
        peakEquity: m.peakEquity,
        dailyLoss: m.dailyLoss,
        dailyTradeCount: m.dailyTradeCount,
        consecutiveLosses: m.consecutiveLosses,
        consecutiveWins: m.consecutiveWins,
        currentDrawdownPercent: m.currentDrawdownPercent,
        winRate: m.winRate,
        totalTrades: m.totalTrades,
        isKillSwitchActive: m.isKillSwitchActive,
        isTradingPaused: m.isTradingPaused,
        isExposureLocked: m.isExposureLocked,
      },
      limits: {
        maxDailyLossUsd: this.riskCfg.maxDailyLossUsd,
        maxDrawdownPercent: this.riskCfg.maxDrawdownPercent,
        maxConsecutiveLosses: this.riskCfg.maxConsecutiveLosses,
        dailyTradeLimit: this.riskCfg.dailyTradeLimit,
      },
    };
  }

  // ── Test order injection (development / QA only) ──────────────────────────

  @Post('test/order')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Inject a test paper order (dev/QA)',
    description:
      'Submits a real order through the paper exchange adapter so you can see fills, ' +
      'positions, and trade history appear in the dashboard without needing live strategy signals. ' +
      'MARKET orders fill immediately. LIMIT orders sit in the order book until a matching tick arrives.',
  })
  async injectTestOrder(
    @Body()
    body: {
      symbol?: string;
      side?: 'BUY' | 'SELL';
      type?: 'MARKET' | 'LIMIT';
      quantity?: number;
      price?: number;
    },
  ) {
    const symbol = NormalizedSymbol.unsafe(body.symbol ?? 'BTC/USDT');
    const side = (body.side === 'SELL' ? OrderSide.SELL : OrderSide.BUY);
    const type = (body.type === 'LIMIT' ? OrderType.LIMIT : OrderType.MARKET);
    const quantity = body.quantity ?? 0.001;
    const price = body.price;

    const request = {
      symbol,
      side,
      type,
      quantity,
      ...(price !== undefined ? { price } : {}),
      timeInForce: type === OrderType.LIMIT ? TimeInForce.GTC : TimeInForce.GTC,
    };

    // Wrap submitOrder with a 5-second deadline so Docker Desktop Windows Redis
    // stalls (in the fill-path XADD publishes) don't hang this HTTP response.
    // The fill still completes on the server even if we respond before it finishes.
    const result = await this.redisSafe(this.paperAdapter.submitOrder(request), 5_000);

    if (result === null) {
      // Timed out waiting for the fill pipeline's Redis publishes — the order was
      // accepted and is executing; Redis just didn't acknowledge in time.
      return {
        ok: true,
        orderId: null,
        symbol: String(symbol),
        side,
        type,
        status: 'PENDING',
        quantity,
        price: null,
        note: type === OrderType.MARKET
          ? 'Market order accepted (Redis publish slow) — check /monitor/trades in a moment'
          : 'Limit order accepted (Redis publish slow) — check /monitor/orders in a moment',
      };
    }

    if (result.isErr()) {
      return {
        ok: false,
        error: result.error.message,
        request: { symbol: String(symbol), side, type, quantity, price },
      };
    }

    const order = result.value;
    return {
      ok: true,
      orderId: order.clientOrderId,
      symbol: String(order.symbol),
      side: order.side,
      type: order.type,
      status: order.status,
      quantity: order.originalQuantity,
      price: order.price,
      note: type === OrderType.MARKET
        ? 'Market order — filled immediately, check /monitor/trades'
        : 'Limit order placed — will fill when price reaches limit, check /monitor/orders',
    };
  }
}
