import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { PaperTradingConfig } from '@config/paper-trading.config';
import {
  PaperAccountState,
  PaperPositionState,
} from '../../domain/models/paper-account-state.model';
import { PaperInsufficientBalanceError } from '../../domain/errors/paper-trading.errors';
import { PaperStateStoreService } from '../../infrastructure/store/paper-state-store.service';

/**
 * PaperAccountService manages the virtual USDT balance for paper trading.
 *
 * Thread-safety note: all mutations are synchronous on the in-memory state;
 * persistence is async and fire-and-forget (saves after each mutation).
 * This is safe for the single-threaded Node.js event loop — two concurrent
 * fills on the same account cannot interleave.
 *
 * Balance model (perpetual futures, quote-asset settled):
 *   - BUY  open  → lock quote (qty × price × (1 + slippage))
 *   - BUY  fill  → release lock, deduct actual fill cost + commission
 *   - SELL fill  → add fill proceeds minus commission, update realizedPnl
 *   - Funding    → deduct or credit from balance per rate
 */
@Injectable()
export class PaperAccountService {
  private readonly context = PaperAccountService.name;
  private readonly cfg: PaperTradingConfig;
  private state!: PaperAccountState;

  constructor(
    configService: ConfigService,
    private readonly logger: AppLoggerService,
    private readonly store: PaperStateStoreService,
  ) {
    this.cfg = configService.get<PaperTradingConfig>('paperTrading')!;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.cfg.resetOnRestart) {
      this.logger.warn('PAPER_TRADING_RESET_ON_RESTART=true — wiping paper state', this.context);
      await this.store.resetAll();
    }

    const saved = await this.store.loadAccount();
    if (saved) {
      this.state = saved;
      this.logger.log(
        `Paper account restored: balance=${saved.balance.toFixed(2)} equity=${saved.equity.toFixed(2)}`,
        this.context,
      );
    } else {
      this.state = this.freshAccount();
      await this.store.saveAccount(this.state);
      this.logger.log(
        `Paper account created: initialBalance=${this.cfg.initialBalanceUsd}`,
        this.context,
      );
    }
  }

  // ── Queries ──────────────────────────────────────────────────────────────────

  getState(): PaperAccountState {
    return { ...this.state };
  }

  /** The configured starting balance from PAPER_TRADING_INITIAL_BALANCE_USD. */
  getInitialBalance(): number {
    return this.cfg.initialBalanceUsd;
  }

  getAvailableBalance(): number {
    return this.state.balance;
  }

  // ── Mutations ────────────────────────────────────────────────────────────────

  /**
   * Lock quote balance for a pending buy order.
   * Call this when a limit BUY order is accepted but not yet filled.
   */
  lockForBuyOrder(quoteAmount: number): void {
    if (this.state.balance < quoteAmount) {
      throw new PaperInsufficientBalanceError(quoteAmount, this.state.balance);
    }
    this.state = {
      ...this.state,
      balance: this.state.balance - quoteAmount,
      lockedBalance: this.state.lockedBalance + quoteAmount,
      updatedAt: Date.now(),
    };
    void this.store.saveAccount(this.state);
  }

  /**
   * Release locked balance when a buy order is cancelled.
   */
  releaseLockedBalance(quoteAmount: number): void {
    const release = Math.min(quoteAmount, this.state.lockedBalance);
    this.state = {
      ...this.state,
      balance: this.state.balance + release,
      lockedBalance: Math.max(0, this.state.lockedBalance - release),
      updatedAt: Date.now(),
    };
    void this.store.saveAccount(this.state);
  }

  /**
   * Apply a completed fill: deduct cost (buy) or credit proceeds (sell),
   * accumulate commission, and update realizedPnl.
   *
   * For a BUY fill, quoteAmount is the actual fill cost (qty × price).
   * For a SELL fill, quoteAmount is the actual proceeds (qty × price).
   */
  applyFill(params: {
    isBuy: boolean;
    quoteAmount: number;
    commission: number;
    realizedPnl: number;
    fromLocked: boolean;
  }): void {
    const { isBuy, quoteAmount, commission, realizedPnl, fromLocked } = params;

    let { balance, lockedBalance } = this.state;

    if (isBuy) {
      if (fromLocked) {
        // Release lock and deduct actual fill cost
        lockedBalance = Math.max(0, lockedBalance - quoteAmount);
      } else {
        // Market buy: deduct directly
        if (balance < quoteAmount) {
          throw new PaperInsufficientBalanceError(quoteAmount, balance);
        }
        balance -= quoteAmount;
      }
      balance -= commission;
    } else {
      // Sell: add proceeds, deduct commission
      balance += quoteAmount - commission;
    }

    this.state = {
      ...this.state,
      balance,
      lockedBalance,
      equity: balance + lockedBalance,
      totalRealizedPnl: this.state.totalRealizedPnl + realizedPnl,
      totalFees: this.state.totalFees + commission,
      tradeCount: this.state.tradeCount + 1,
      updatedAt: Date.now(),
    };

    void this.store.saveAccount(this.state);
  }

  /**
   * Record realized P&L from a closed (or partially closed) position.
   *
   * Called by PaperPositionManagerService, which is the only component that
   * has position-context (entry price, direction) needed to compute P&L.
   * The exchange adapter and order-book service always pass realizedPnl=0 to
   * applyFill() because they only know notional/commission, not entry price.
   */
  recordRealizedPnl(pnl: number): void {
    this.state = {
      ...this.state,
      totalRealizedPnl: this.state.totalRealizedPnl + pnl,
      updatedAt: Date.now(),
    };
    void this.store.saveAccount(this.state);
  }

  /**
   * Apply funding payment: positive = account pays, negative = account receives.
   */
  applyFunding(amount: number): void {
    this.state = {
      ...this.state,
      balance: this.state.balance - amount,
      equity: this.state.equity - amount,
      totalFunding: this.state.totalFunding + amount,
      updatedAt: Date.now(),
    };
    void this.store.saveAccount(this.state);
  }

  /**
   * Recompute equity from all open positions and update peak equity.
   * Call after every position change.
   */
  refreshEquity(positions: PaperPositionState[]): void {
    const unrealizedPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
    const equity = this.state.balance + this.state.lockedBalance + unrealizedPnl;
    const peakEquity = Math.max(this.state.peakEquity, equity);

    this.state = { ...this.state, equity, peakEquity, updatedAt: Date.now() };
    void this.store.saveAccount(this.state);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private freshAccount(): PaperAccountState {
    const now = Date.now();
    const balance = this.cfg.initialBalanceUsd;
    return {
      balance,
      lockedBalance: 0,
      equity: balance,
      peakEquity: balance,
      totalRealizedPnl: 0,
      totalFees: 0,
      totalFunding: 0,
      tradeCount: 0,
      startedAt: now,
      updatedAt: now,
    };
  }
}
