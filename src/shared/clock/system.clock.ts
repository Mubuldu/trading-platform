import { Injectable } from '@nestjs/common';
import { Clock } from './clock.interface';

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowMs(): number {
    return Date.now();
  }

  today(): Date {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }
}
