import { Specification } from '@domain/base/specification';
import { Candle } from '../models/candle.model';

export class CandleHasRequiredFieldsSpecification extends Specification<Candle> {
  isSatisfiedBy(candle: Candle): boolean {
    return candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0;
  }
}

export class CandleHasValidOhlcRelationSpecification extends Specification<Candle> {
  isSatisfiedBy(candle: Candle): boolean {
    return (
      candle.high >= candle.low &&
      candle.high >= candle.open &&
      candle.high >= candle.close &&
      candle.low <= candle.open &&
      candle.low <= candle.close
    );
  }
}

export class CandleHasNonNegativeVolumeSpecification extends Specification<Candle> {
  isSatisfiedBy(candle: Candle): boolean {
    return candle.volume >= 0;
  }
}

export class CandleHasValidTimestampsSpecification extends Specification<Candle> {
  isSatisfiedBy(candle: Candle): boolean {
    return candle.openTime > 0 && candle.closeTime > 0 && candle.closeTime > candle.openTime;
  }
}

export class CandleIsNotInFutureSpecification extends Specification<Candle> {
  constructor(private readonly maxSkewMs: number) {
    super();
  }

  isSatisfiedBy(candle: Candle): boolean {
    return candle.openTime <= Date.now() + this.maxSkewMs;
  }
}

export const VALID_CANDLE_SPECIFICATION = new CandleHasRequiredFieldsSpecification()
  .and(new CandleHasValidOhlcRelationSpecification())
  .and(new CandleHasNonNegativeVolumeSpecification())
  .and(new CandleHasValidTimestampsSpecification());
