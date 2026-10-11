import { Injectable } from '@nestjs/common';
import { WindowType } from '../domain/enums/window-type.enum';
import { WalkForwardConfig } from '../domain/models/walk-forward-config.model';
import { WalkForwardWindow } from '../domain/models/walk-forward-window.model';

@Injectable()
export class WindowGeneratorService {
  generate(config: WalkForwardConfig): WalkForwardWindow[] {
    const step = config.stepMs ?? config.testWindowMs;
    const windows: WalkForwardWindow[] = [];

    let testEnd = config.startTime + config.trainWindowMs + config.testWindowMs;
    let index = 0;

    while (testEnd <= config.endTime) {
      const testStart = testEnd - config.testWindowMs;
      const trainEnd = testStart;
      const trainStart =
        config.windowType === WindowType.ANCHORED
          ? config.startTime
          : trainEnd - config.trainWindowMs;

      windows.push({
        index,
        trainStartTime: trainStart,
        trainEndTime: trainEnd,
        testStartTime: testStart,
        testEndTime: testEnd,
      });
      index++;
      testEnd += step;
    }

    return windows;
  }
}
