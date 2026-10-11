import { MockClock } from '@shared/clock/mock.clock';
import { SystemClock } from '@shared/clock/system.clock';

describe('MockClock', () => {
  it('initializes to the provided date', () => {
    const d = new Date('2024-01-01T00:00:00Z');
    const clock = new MockClock(d);
    expect(clock.now().toISOString()).toBe(d.toISOString());
  });

  it('now() returns a new Date instance each call', () => {
    const clock = new MockClock(new Date('2024-01-01T00:00:00Z'));
    const a = clock.now();
    const b = clock.now();
    expect(a).not.toBe(b);
  });

  it('advanceMs() advances time', () => {
    const clock = new MockClock(new Date('2024-01-01T00:00:00.000Z'));
    clock.advanceMs(5000);
    expect(clock.now().toISOString()).toBe('2024-01-01T00:00:05.000Z');
  });

  it('advanceSeconds() advances time in seconds', () => {
    const clock = new MockClock(new Date('2024-01-01T00:00:00.000Z'));
    clock.advanceSeconds(60);
    expect(clock.now().toISOString()).toBe('2024-01-01T00:01:00.000Z');
  });

  it('advanceMinutes() advances time in minutes', () => {
    const clock = new MockClock(new Date('2024-01-01T00:00:00.000Z'));
    clock.advanceMinutes(90);
    expect(clock.now().toISOString()).toBe('2024-01-01T01:30:00.000Z');
  });

  it('setTime() jumps to exact time', () => {
    const clock = new MockClock();
    const target = new Date('2025-06-01T09:30:00Z');
    clock.setTime(target);
    expect(clock.now().toISOString()).toBe(target.toISOString());
  });

  it('nowMs() returns milliseconds', () => {
    const d = new Date('2024-01-01T00:00:00Z');
    const clock = new MockClock(d);
    expect(clock.nowMs()).toBe(d.getTime());
  });

  it('today() returns start of UTC day', () => {
    const clock = new MockClock(new Date('2024-06-15T18:30:00Z'));
    expect(clock.today().toISOString()).toBe('2024-06-15T00:00:00.000Z');
  });
});

describe('SystemClock', () => {
  let clock: SystemClock;

  beforeEach(() => {
    clock = new SystemClock();
  });

  it('now() returns approximately current time', () => {
    const before = Date.now();
    const now = clock.now();
    const after = Date.now();
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
  });

  it('nowMs() returns a number close to Date.now()', () => {
    const before = Date.now();
    const ms = clock.nowMs();
    const after = Date.now();
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });

  it('today() returns midnight UTC', () => {
    const today = clock.today();
    expect(today.getUTCHours()).toBe(0);
    expect(today.getUTCMinutes()).toBe(0);
    expect(today.getUTCSeconds()).toBe(0);
    expect(today.getUTCMilliseconds()).toBe(0);
  });
});
