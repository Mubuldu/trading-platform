import { Injectable } from '@nestjs/common';
import { Result, ok, err } from '@common/result';
import { ExchangeAdapter } from '@modules/exchange/interfaces/exchange-adapter.interface';
import { SubmitOrderRequest } from '@modules/exchange/models/trading.models';
import { Order } from '@modules/exchange/models/trading.models';
import { ExchangeError } from '@modules/exchange/errors/exchange.error';
import { ExecutionMaxRetriesError, SubmissionError } from '../../domain/errors/execution.errors';

type RetryableError = ExecutionMaxRetriesError | SubmissionError;

export interface SubmitResult {
  readonly order: Order;
  readonly attempts: number;
}

@Injectable()
export class RetryManagerService {
  async submit(
    adapter: ExchangeAdapter,
    request: SubmitOrderRequest,
    maxRetries: number,
  ): Promise<Result<SubmitResult, RetryableError>> {
    let lastError: ExchangeError | undefined;
    let attempts = 0;
    const maxAttempts = maxRetries + 1;

    while (attempts < maxAttempts) {
      attempts++;

      const result = await adapter.submitOrder(request);

      if (result.isOk()) {
        return ok({ order: result.value, attempts });
      }

      lastError = result.error;

      if (!lastError.isRetryable) {
        return err(new SubmissionError(lastError.message, lastError));
      }

      if (attempts < maxAttempts) {
        await this.delay(this.backoffMs(attempts));
      }
    }

    return err(new ExecutionMaxRetriesError(attempts, lastError));
  }

  private backoffMs(attempt: number): number {
    return Math.min(200 * Math.pow(2, attempt - 1), 5_000);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
