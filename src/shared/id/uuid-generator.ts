import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { IdGenerator } from './id-generator.interface';

@Injectable()
export class UuidGenerator implements IdGenerator {
  generate(): string {
    return randomUUID();
  }
}
