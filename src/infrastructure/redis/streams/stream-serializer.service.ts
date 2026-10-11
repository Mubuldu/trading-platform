import { Injectable } from '@nestjs/common';
import { StreamEvent, StreamEntryRaw } from './stream-event.interface';

export type SerializationFormat = 'json';

@Injectable()
export class StreamSerializerService {
  private readonly format: SerializationFormat = 'json';

  serialize(event: StreamEvent): Record<string, string> {
    return {
      eventId: event.eventId,
      correlationId: event.correlationId,
      eventType: event.eventType,
      exchange: event.exchange,
      symbol: event.symbol,
      timestamp: String(event.timestamp),
      producer: event.producer,
      schemaVersion: event.schemaVersion,
      payload: JSON.stringify(event.payload),
      metadata: JSON.stringify(event.metadata),
      format: this.format,
    };
  }

  deserialize(entry: StreamEntryRaw): StreamEvent {
    const f = entry.fields;

    if (!f['format'] || f['format'] !== 'json') {
      throw new Error(`Unsupported serialization format: ${f['format']}`);
    }

    return {
      eventId: f['eventId'] ?? '',
      correlationId: f['correlationId'] ?? '',
      eventType: f['eventType'] ?? '',
      exchange: f['exchange'] ?? '',
      symbol: f['symbol'] ?? '',
      timestamp: Number(f['timestamp'] ?? 0),
      producer: f['producer'] ?? '',
      schemaVersion: f['schemaVersion'] ?? '',
      payload: f['payload'] ? (JSON.parse(f['payload']) as Record<string, unknown>) : {},
      metadata: f['metadata']
        ? (JSON.parse(f['metadata']) as { retryCount: number; [key: string]: unknown })
        : { retryCount: 0 },
    };
  }

  parseRawEntry(rawId: string, rawFields: string[]): StreamEntryRaw {
    const fields: Record<string, string> = {};
    for (let i = 0; i < rawFields.length - 1; i += 2) {
      fields[rawFields[i]] = rawFields[i + 1];
    }
    return { id: rawId, fields };
  }
}
