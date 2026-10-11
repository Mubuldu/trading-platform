# Exchange Capability Matrix

Last updated: Milestone 31

Legend: ✅ Supported · ❌ Not supported · 🔧 Stub (not yet implemented)

---

## Market Types

| Exchange              | ExchangeId                  | Spot | Perpetual | Futures | Options | Margin |
|-----------------------|-----------------------------|------|-----------|---------|---------|--------|
| Binance Spot          | `binance_spot`              | ✅   | ❌        | ❌      | ❌      | ❌     |
| Binance Futures USDT  | `binance_futures_usdt`      | ❌   | 🔧        | 🔧      | ❌      | ❌     |
| Binance Futures COIN  | `binance_futures_coin`      | ❌   | 🔧        | 🔧      | ❌      | ❌     |
| Bybit Spot            | `bybit_spot`                | 🔧   | ❌        | ❌      | ❌      | 🔧     |
| Bybit Linear          | `bybit_linear`              | ❌   | 🔧        | 🔧      | ❌      | ❌     |
| Bybit Inverse         | `bybit_inverse`             | ❌   | 🔧        | 🔧      | ❌      | ❌     |
| OKX Spot              | `okx_spot`                  | 🔧   | ❌        | ❌      | ❌      | ❌     |
| OKX Futures           | `okx_futures`               | ❌   | 🔧        | 🔧      | ❌      | ❌     |
| Kraken Spot           | `kraken_spot`               | 🔧   | ❌        | ❌      | ❌      | 🔧     |
| Kraken Futures        | `kraken_futures`            | ❌   | 🔧        | 🔧      | ❌      | ❌     |

---

## Margin Types

| Exchange              | Cross Margin | Isolated Margin |
|-----------------------|:------------:|:---------------:|
| Binance Spot          | ❌           | ❌              |
| Binance Futures USDT  | 🔧           | 🔧              |
| Binance Futures COIN  | 🔧           | 🔧              |
| Bybit Spot            | ❌           | 🔧              |
| Bybit Linear          | 🔧           | 🔧              |
| Bybit Inverse         | 🔧           | 🔧              |
| OKX Spot              | ❌           | ❌              |
| OKX Futures           | 🔧           | 🔧              |
| Kraken Spot           | 🔧           | ❌              |
| Kraken Futures        | 🔧           | 🔧              |

---

## Order Features

| Exchange              | OCO | TP/SL | Batch | Reduce Only | Hedge Mode | Trailing Stop | Post Only | Conditional |
|-----------------------|:---:|:-----:|:-----:|:-----------:|:----------:|:-------------:|:---------:|:-----------:|
| Binance Spot          | ✅  | ❌    | ❌    | ❌          | ❌         | ❌            | ✅        | ❌          |
| Binance Futures USDT  | ❌  | 🔧    | 🔧    | 🔧          | 🔧         | 🔧            | 🔧        | 🔧          |
| Binance Futures COIN  | ❌  | 🔧    | 🔧    | 🔧          | 🔧         | 🔧            | 🔧        | 🔧          |
| Bybit Spot            | ❌  | 🔧    | ❌    | ❌          | ❌         | ❌            | 🔧        | ❌          |
| Bybit Linear          | ❌  | 🔧    | 🔧    | 🔧          | 🔧         | 🔧            | 🔧        | 🔧          |
| Bybit Inverse         | ❌  | 🔧    | 🔧    | 🔧          | 🔧         | 🔧            | 🔧        | 🔧          |
| OKX Spot              | ❌  | 🔧    | 🔧    | ❌          | ❌         | ❌            | 🔧        | 🔧          |
| OKX Futures           | ❌  | 🔧    | 🔧    | 🔧          | 🔧         | 🔧            | 🔧        | 🔧          |
| Kraken Spot           | ❌  | 🔧    | 🔧    | ❌          | ❌         | ❌            | 🔧        | 🔧          |
| Kraken Futures        | ❌  | 🔧    | 🔧    | 🔧          | ❌         | ❌            | 🔧        | ❌          |

---

## Batch Order Limits

| Exchange              | Max Batch Size |
|-----------------------|:--------------:|
| Binance Spot          | 0 (not supported) |
| Binance Futures USDT  | 5              |
| Binance Futures COIN  | 5              |
| Bybit Spot            | 0              |
| Bybit Linear          | 20             |
| Bybit Inverse         | 20             |
| OKX Spot              | 20             |
| OKX Futures           | 20             |
| Kraken Spot           | 15             |
| Kraken Futures        | 10             |

---

## WebSocket

| Exchange              | WS Supported | Ticker | Order Book | Trades | Funding | Mark Price |
|-----------------------|:------------:|:------:|:----------:|:------:|:-------:|:----------:|
| Binance Spot          | ✅           | ✅     | ✅         | ✅     | ❌      | ❌         |
| Binance Futures USDT  | 🔧           | 🔧     | 🔧         | 🔧     | 🔧      | 🔧         |
| Binance Futures COIN  | 🔧           | 🔧     | 🔧         | 🔧     | 🔧      | 🔧         |
| Bybit Spot            | 🔧           | 🔧     | 🔧         | 🔧     | ❌      | ❌         |
| Bybit Linear          | 🔧           | 🔧     | 🔧         | 🔧     | 🔧      | 🔧         |
| Bybit Inverse         | 🔧           | 🔧     | 🔧         | 🔧     | 🔧      | 🔧         |
| OKX Spot              | 🔧           | 🔧     | 🔧         | 🔧     | ❌      | ❌         |
| OKX Futures           | 🔧           | 🔧     | 🔧         | 🔧     | 🔧      | 🔧         |
| Kraken Spot           | 🔧           | 🔧     | 🔧         | 🔧     | ❌      | ❌         |
| Kraken Futures        | 🔧           | 🔧     | 🔧         | 🔧     | 🔧      | ❌         |

---

## Authentication Method

| Exchange              | Auth Method                        | Credential Env Vars                                     |
|-----------------------|------------------------------------|--------------------------------------------------------|
| Binance Spot          | HMAC-SHA256 query-string signature | `BINANCE_SPOT_API_KEY`, `BINANCE_SPOT_SECRET_KEY`      |
| Binance Futures USDT  | Same as Spot (Futures sub-key)     | `BINANCE_FUTURES_API_KEY`, `BINANCE_FUTURES_SECRET_KEY` |
| Binance Futures COIN  | Same as Spot                       | Same as Futures USDT                                   |
| Bybit                 | HMAC-SHA256 header signature       | `BYBIT_API_KEY`, `BYBIT_SECRET_KEY`                    |
| OKX                   | HMAC-SHA256 + passphrase           | `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`     |
| Kraken Spot           | API key + HMAC-SHA512 nonce        | `KRAKEN_SPOT_API_KEY`, `KRAKEN_SPOT_PRIVATE_KEY`       |
| Kraken Futures        | Separate Futures credentials       | `KRAKEN_FUTURES_API_KEY`, `KRAKEN_FUTURES_PRIVATE_KEY` |

---

## Adapter Status

| Exchange              | Status      | Target Milestone |
|-----------------------|-------------|-----------------|
| Binance Spot          | ✅ Complete | M5              |
| Binance Futures USDT  | 🔧 Stub     | M32             |
| Binance Futures COIN  | 🔧 Stub     | M32             |
| Bybit Spot            | 🔧 Stub     | M33             |
| Bybit Linear          | 🔧 Stub     | M33             |
| Bybit Inverse         | 🔧 Stub     | M33             |
| OKX Spot              | 🔧 Stub     | M34             |
| OKX Futures           | 🔧 Stub     | M34             |
| Kraken Spot           | 🔧 Stub     | M35             |
| Kraken Futures        | 🔧 Stub     | M35             |

---

## Notes

**Bybit Linear vs. Inverse**: Both use the same API base URL and same credential
pair. The `category` query parameter differentiates them. Linear uses USDT
collateral; Inverse uses the base asset (BTC, ETH, etc.).

**OKX instType**: OKX uses a single REST host for all product types. The `instType`
query parameter selects SPOT / SWAP / FUTURES / OPTION. A future OKX Options adapter
would extend `OkxFuturesAdapter` and set `instType=OPTION`.

**Kraken symbol format**: Kraken's asset naming (XXBTZUSD, XETHZUSD) is
inconsistent. The `SymbolNormalizer` must be seeded from the `/0/public/AssetPairs`
response rather than any convention-based auto-splitting.

**Binance Futures credentials**: Binance allows Futures to use the same API key
as Spot, or separate keys. The adapter should be configurable for either mode.
