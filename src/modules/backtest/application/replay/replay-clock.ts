export class ReplayClock {
  private _currentTime: number;
  private readonly _startTime: number;
  private readonly _endTime: number;

  constructor(startTime: number, endTime: number) {
    this._startTime = startTime;
    this._endTime = endTime;
    this._currentTime = startTime;
  }

  get currentTime(): number {
    return this._currentTime;
  }

  get startTime(): number {
    return this._startTime;
  }

  get endTime(): number {
    return this._endTime;
  }

  advance(toTimestamp: number): void {
    if (toTimestamp < this._currentTime) {
      throw new Error(
        `ReplayClock cannot go backwards: current=${this._currentTime}, requested=${toTimestamp}`,
      );
    }
    this._currentTime = toTimestamp;
  }

  jumpTo(timestamp: number): void {
    if (timestamp < this._startTime || timestamp > this._endTime) {
      throw new Error(
        `Timestamp ${timestamp} is outside replay window [${this._startTime}, ${this._endTime}]`,
      );
    }
    this._currentTime = timestamp;
  }

  isExpired(): boolean {
    return this._currentTime > this._endTime;
  }

  progressPercent(): number {
    const range = this._endTime - this._startTime;
    if (range === 0) return 100;
    return Math.min(100, ((this._currentTime - this._startTime) / range) * 100);
  }

  elapsed(): number {
    return this._currentTime - this._startTime;
  }

  remaining(): number {
    return Math.max(0, this._endTime - this._currentTime);
  }
}
