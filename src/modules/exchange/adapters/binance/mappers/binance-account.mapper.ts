import { Injectable } from '@nestjs/common';
import { Result, ok, err } from '@common/result';
import { ExchangeId } from '@modules/exchange/enums/exchange.enums';
import {
  AssetBalance,
  Balance,
  AccountInfo,
  FeeRates,
  FeeRateInfo,
  TradingPermission,
} from '@modules/exchange/models/account.models';
import {
  ExchangeError,
  ExchangeInvalidRequestError,
} from '@modules/exchange/errors/exchange.error';
import { BinanceRawAccount } from '../client/binance-http.types';

const EX = ExchangeId.BINANCE_SPOT;
const COMMISSION_DIVISOR = 10_000;

/**
 * BinanceAccountMapper normalizes Binance account responses.
 *
 * Commission rates from Binance are expressed as integers in units of 0.01bps.
 * Example: makerCommission=10 → 10/10000 = 0.001 = 0.1%
 *
 * The commissionRates field (present in newer API versions) returns string
 * decimal values (e.g. "0.0001") which are used when available.
 */
@Injectable()
export class BinanceAccountMapper {
  mapBalance(raw: BinanceRawAccount, receivedAt: Date): Result<Balance, ExchangeError> {
    try {
      const assets: Record<string, AssetBalance> = {};

      for (const b of raw.balances) {
        const free = parseFloat(b.free);
        const locked = parseFloat(b.locked);
        // Skip zero-balance assets to reduce noise
        if (free === 0 && locked === 0) continue;

        assets[b.asset] = {
          asset: b.asset,
          free,
          locked,
          total: free + locked,
        };
      }

      return ok({
        exchangeId: EX,
        timestamp: new Date(raw.updateTime),
        receivedAt,
        assets,
      });
    } catch (e) {
      return err(new ExchangeInvalidRequestError(EX, `Failed to parse balance: ${String(e)}`));
    }
  }

  mapAccountInfo(raw: BinanceRawAccount, receivedAt: Date): Result<AccountInfo, ExchangeError> {
    try {
      const permissions = raw.permissions
        .map((p) => p as TradingPermission)
        .filter((p) => ['SPOT', 'MARGIN', 'FUTURES', 'OPTIONS', 'DELIVERY'].includes(p));

      return ok({
        exchangeId: EX,
        timestamp: new Date(raw.updateTime),
        receivedAt,
        accountType: raw.accountType,
        permissions,
        canTrade: raw.canTrade,
        canWithdraw: raw.canWithdraw,
        canDeposit: raw.canDeposit,
        makerCommission: raw.makerCommission / COMMISSION_DIVISOR,
        takerCommission: raw.takerCommission / COMMISSION_DIVISOR,
        buyerCommission: raw.buyerCommission / COMMISSION_DIVISOR,
        sellerCommission: raw.sellerCommission / COMMISSION_DIVISOR,
        updateTime: new Date(raw.updateTime),
      });
    } catch (e) {
      return err(new ExchangeInvalidRequestError(EX, `Failed to parse account info: ${String(e)}`));
    }
  }

  mapFeeRates(raw: BinanceRawAccount, receivedAt: Date): Result<FeeRates, ExchangeError> {
    try {
      let makerFee: number;
      let takerFee: number;

      if (raw.commissionRates) {
        makerFee = parseFloat(raw.commissionRates.maker);
        takerFee = parseFloat(raw.commissionRates.taker);
      } else {
        makerFee = raw.makerCommission / COMMISSION_DIVISOR;
        takerFee = raw.takerCommission / COMMISSION_DIVISOR;
      }

      const defaultFees: FeeRateInfo = { makerFee, takerFee };

      return ok({
        exchangeId: EX,
        timestamp: new Date(raw.updateTime),
        receivedAt,
        defaultFees,
        symbolFees: {},
      });
    } catch (e) {
      return err(new ExchangeInvalidRequestError(EX, `Failed to parse fee rates: ${String(e)}`));
    }
  }
}
