import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppLoggerService } from '@core/logging/app-logger.service';
import { ExchangeFactory } from '@modules/exchange/factories/exchange.factory';
import { PositionManagerService } from '@modules/position/application/services/position-manager.service';
import { PositionModel } from '@modules/position/domain/models/position.model';
import { PositionDirection } from '@modules/position/domain/enums/position-direction.enum';
import { Position } from '@modules/exchange/models/account.models';
import { PositionSide } from '@modules/exchange/enums/position.enums';
import { ReconciliationConfig } from '@config/reconciliation.config';
import { PositionMismatchType } from '../../domain/enums/mismatch-type.enum';
import { RecoveryAction } from '../../domain/enums/recovery-action.enum';
import {
  PositionMismatch,
  InternalPositionSnapshot,
  ExchangePositionSnapshot,
} from '../../domain/models/position-mismatch.model';

@Injectable()
export class PositionReconcilerService {
  private readonly context = PositionReconcilerService.name;
  private readonly cfg: ReconciliationConfig;

  constructor(
    configService: ConfigService,
    private readonly logger: AppLoggerService,
    private readonly exchangeFactory: ExchangeFactory,
    private readonly positionManager: PositionManagerService,
  ) {
    this.cfg = configService.get<ReconciliationConfig>('reconciliation')!;
  }

  async reconcile(): Promise<PositionMismatch[]> {
    const [internalPositions, exchangePositions] = await Promise.all([
      this.fetchInternal(),
      this.fetchExchange(),
    ]);

    if (exchangePositions === null) {
      this.logger.warn(
        'Position reconciliation skipped — no exchange adapter available',
        this.context,
      );
      return [];
    }

    return this.compare(internalPositions, exchangePositions);
  }

  private async fetchInternal(): Promise<PositionModel[]> {
    try {
      return await this.positionManager.getOpenPositions();
    } catch (e) {
      this.logger.error(
        `Failed to fetch internal positions: ${(e as Error).message}`,
        undefined,
        this.context,
      );
      return [];
    }
  }

  private async fetchExchange(): Promise<Position[] | null> {
    const adapters = this.exchangeFactory.getActiveAdapters();
    if (adapters.length === 0) return null;

    const all: Position[] = [];
    for (const adapter of adapters) {
      try {
        const result = await adapter.getOpenPositions();
        if (result.isOk()) {
          all.push(...result.value);
        } else {
          this.logger.warn(
            `Exchange ${adapter.exchangeId} returned error for getOpenPositions: ${result.error.message}`,
            this.context,
          );
        }
      } catch (e) {
        this.logger.error(
          `Failed to fetch positions from ${adapter.exchangeId}: ${(e as Error).message}`,
          undefined,
          this.context,
        );
      }
    }
    return all;
  }

  private compare(internal: PositionModel[], exchange: Position[]): PositionMismatch[] {
    const mismatches: PositionMismatch[] = [];
    const now = Date.now();

    const internalBySymbol = new Map(internal.map((p) => [p.symbol, p]));
    // Coerce NormalizedSymbol keys to plain strings so both maps share the same key type
    const exchangeBySymbol = new Map(exchange.map((p) => [String(p.symbol), p]));

    // Check every internal position against exchange
    for (const [symbol, internalPos] of internalBySymbol) {
      const exchangePos = exchangeBySymbol.get(symbol);
      const internalSnap = this.toInternalSnapshot(internalPos);

      if (!exchangePos || exchangePos.quantity === 0) {
        mismatches.push({
          symbol,
          type: PositionMismatchType.MISSING_POSITION,
          internal: internalSnap,
          exchange: null,
          internalValue: internalPos.quantity,
          exchangeValue: 0,
          diffPct: null,
          recoveryAction: this.classifyQuantityDiff(internalPos.quantity, 0),
          detectedAt: now,
        });
        continue;
      }

      const exchangeSnap = this.toExchangeSnapshot(exchangePos);

      // Quantity check
      const qtyDiff = Math.abs(internalPos.quantity - exchangePos.quantity);
      if (qtyDiff > this.cfg.smallDiffAbsolute) {
        const diffPct = internalPos.quantity > 0 ? qtyDiff / internalPos.quantity : 1;
        mismatches.push({
          symbol,
          type: PositionMismatchType.QUANTITY_DIFF,
          internal: internalSnap,
          exchange: exchangeSnap,
          internalValue: internalPos.quantity,
          exchangeValue: exchangePos.quantity,
          diffPct,
          recoveryAction: this.classifyQuantityDiff(qtyDiff, internalPos.quantity),
          detectedAt: now,
        });
      }

      // Direction check
      const internalDir = this.directionToSide(internalPos.direction);
      if (internalDir !== exchangePos.positionSide && internalPos.quantity > 0) {
        mismatches.push({
          symbol,
          type: PositionMismatchType.DIRECTION_MISMATCH,
          internal: internalSnap,
          exchange: exchangeSnap,
          internalValue: internalPos.direction,
          exchangeValue: exchangePos.positionSide,
          diffPct: null,
          recoveryAction: RecoveryAction.MANUAL_REQUIRED,
          detectedAt: now,
        });
      }

      // Average price check
      if (internalPos.averageEntryPrice > 0 && exchangePos.entryPrice > 0) {
        const priceDiffPct =
          Math.abs(internalPos.averageEntryPrice - exchangePos.entryPrice) / exchangePos.entryPrice;
        if (priceDiffPct > this.cfg.priceDiffPercent) {
          mismatches.push({
            symbol,
            type: PositionMismatchType.PRICE_DIFF,
            internal: internalSnap,
            exchange: exchangeSnap,
            internalValue: internalPos.averageEntryPrice,
            exchangeValue: exchangePos.entryPrice,
            diffPct: priceDiffPct,
            recoveryAction:
              priceDiffPct > 0.05
                ? RecoveryAction.MANUAL_REQUIRED
                : RecoveryAction.SYNC_FROM_EXCHANGE,
            detectedAt: now,
          });
        }
      }
    }

    // Detect ghost positions (on exchange but not internally tracked)
    for (const [symbol, exchangePos] of exchangeBySymbol) {
      if (exchangePos.quantity === 0) continue;
      if (!internalBySymbol.has(symbol)) {
        mismatches.push({
          symbol,
          type: PositionMismatchType.GHOST_POSITION,
          internal: null,
          exchange: this.toExchangeSnapshot(exchangePos),
          internalValue: 0,
          exchangeValue: exchangePos.quantity,
          diffPct: null,
          recoveryAction: this.classifyQuantityDiff(exchangePos.quantity, 0),
          detectedAt: now,
        });
      }
    }

    return mismatches;
  }

  private classifyQuantityDiff(diff: number, base: number): RecoveryAction {
    if (diff <= this.cfg.smallDiffAbsolute) return RecoveryAction.NO_ACTION;
    const pct = base > 0 ? diff / base : 1;
    return pct <= this.cfg.smallDiffPercent
      ? RecoveryAction.SYNC_FROM_EXCHANGE
      : RecoveryAction.MANUAL_REQUIRED;
  }

  private directionToSide(direction: PositionDirection): PositionSide {
    return direction === PositionDirection.LONG ? PositionSide.LONG : PositionSide.SHORT;
  }

  private toInternalSnapshot(p: PositionModel): InternalPositionSnapshot {
    return {
      symbol: p.symbol,
      direction: p.direction,
      quantity: p.quantity,
      averageEntryPrice: p.averageEntryPrice,
      unrealizedPnl: p.unrealizedPnl,
      realizedPnl: p.realizedPnl,
    };
  }

  private toExchangeSnapshot(p: Position): ExchangePositionSnapshot {
    return {
      symbol: p.symbol,
      positionSide: p.positionSide,
      quantity: p.quantity,
      entryPrice: p.entryPrice,
      markPrice: p.markPrice,
      unrealizedPnl: p.unrealizedPnl,
      leverage: p.leverage,
      marginMode: p.marginMode,
    };
  }
}
