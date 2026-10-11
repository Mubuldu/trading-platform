import { ReplaySpeed } from '../../domain/enums/replay-mode.enum';

export class ReplaySpeedController {
  private _speed: ReplaySpeed;
  private _paused = false;

  constructor(speed: ReplaySpeed = ReplaySpeed.UNLIMITED) {
    this._speed = speed;
  }

  get speed(): ReplaySpeed {
    return this._speed;
  }

  get isPaused(): boolean {
    return this._paused;
  }

  setSpeed(speed: ReplaySpeed): void {
    this._speed = speed;
  }

  pause(): void {
    this._paused = true;
  }

  resume(): void {
    this._paused = false;
  }

  async waitForNextBar(barDurationMs: number): Promise<void> {
    if (this._speed === ReplaySpeed.UNLIMITED) return;

    const delayMs = barDurationMs / this._speed;
    if (delayMs > 0) {
      await this.sleep(delayMs);
    }

    while (this._paused) {
      await this.sleep(50);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
