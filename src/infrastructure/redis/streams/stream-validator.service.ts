import { Injectable } from '@nestjs/common';
import { StreamEvent, STREAM_SCHEMA_VERSION } from './stream-event.interface';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

@Injectable()
export class StreamValidatorService {
  private readonly supportedSchemaVersions = new Set([STREAM_SCHEMA_VERSION]);

  validate(event: StreamEvent): ValidationResult {
    const errors: string[] = [];

    if (!event.eventId || event.eventId.trim() === '') {
      errors.push('eventId is required');
    }

    if (!event.correlationId || event.correlationId.trim() === '') {
      errors.push('correlationId is required');
    }

    if (!event.eventType || event.eventType.trim() === '') {
      errors.push('eventType is required');
    }

    if (!event.exchange || event.exchange.trim() === '') {
      errors.push('exchange is required');
    }

    if (!event.symbol || event.symbol.trim() === '') {
      errors.push('symbol is required');
    }

    if (!event.timestamp || event.timestamp <= 0) {
      errors.push('timestamp must be a positive number');
    } else {
      const now = Date.now();
      const fiveMinutesMs = 5 * 60 * 1000;
      const oneHourMs = 60 * 60 * 1000;
      if (event.timestamp > now + fiveMinutesMs) {
        errors.push(`timestamp ${event.timestamp} is too far in the future`);
      }
      if (event.timestamp < now - oneHourMs) {
        errors.push(`timestamp ${event.timestamp} is too old (>1h)`);
      }
    }

    if (!event.producer || event.producer.trim() === '') {
      errors.push('producer is required');
    }

    if (!event.schemaVersion || event.schemaVersion.trim() === '') {
      errors.push('schemaVersion is required');
    } else if (!this.supportedSchemaVersions.has(event.schemaVersion)) {
      errors.push(`schemaVersion '${event.schemaVersion}' is not supported`);
    }

    if (!event.payload || typeof event.payload !== 'object') {
      errors.push('payload must be an object');
    }

    if (!event.metadata || typeof event.metadata !== 'object') {
      errors.push('metadata must be an object');
    }

    return { valid: errors.length === 0, errors };
  }

  validatePartial(fields: Record<string, string>): ValidationResult {
    const errors: string[] = [];
    const required = [
      'eventId',
      'correlationId',
      'eventType',
      'exchange',
      'symbol',
      'timestamp',
      'producer',
      'schemaVersion',
      'payload',
    ];
    for (const field of required) {
      if (!fields[field]) errors.push(`${field} is required`);
    }
    return { valid: errors.length === 0, errors };
  }
}
