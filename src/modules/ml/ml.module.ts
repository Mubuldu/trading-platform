import { Module } from '@nestjs/common';
import { MlSignalService } from './application/services/ml-signal.service';

/**
 * MlModule — ML signal sidecar client.
 *
 * Provides:
 *   MlSignalService — HTTP wrapper around the Python FastAPI sidecar.
 *
 * Import this module in StrategyModule so MlSignalService can be injected
 * into the strategy factory closure and forwarded to TrendFollowingV1Strategy.
 *
 * The sidecar is optional — if ML_SERVICE_URL is not set, MlSignalService
 * returns the pass-through fallback immediately without touching the network.
 */
@Module({
  providers: [MlSignalService],
  exports: [MlSignalService],
})
export class MlModule {}
