import { Clock } from './clock.interface';

/**
 * MockClock gives tests full control over time.
 *
 * Usage in tests:
 *   const clock = new MockClock(new Date('2024-01-01T09:30:00Z'));
 *   // ...
 *   clock.advance(60_000); // advance 1 minute
 *   clock.setTime(new Date('2024-01-01T16:00:00Z')); // jump to specific time
 */
export class MockClock implements Clock {
  private current: Date;

  constructor(initial: Date = new Date(0)) {
    this.current = new Date(initial);
  }

  now(): Date {
    return new Date(this.current);
  }

  nowMs(): number {
    return this.current.getTime();
  }

  today(): Date {
    const d = new Date(this.current);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  setTime(date: Date): void {
    this.current = new Date(date);
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  advanceSeconds(seconds: number): void {
    this.advanceMs(seconds * 1_000);
  }

  advanceMinutes(minutes: number): void {
    this.advanceMs(minutes * 60_000);
  }

  advanceHours(hours: number): void {
    this.advanceMs(hours * 3_600_000);
  }
}
