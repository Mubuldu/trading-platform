/**
 * RollingWindow defines the look-back periods (in days) used by rolling
 * metric calculators. Each value is the exact number of calendar days.
 */
export enum RollingWindow {
  SEVEN_DAYS = 7,
  THIRTY_DAYS = 30,
  NINETY_DAYS = 90,
  ONE_EIGHTY_DAYS = 180,
  THREE_SIXTY_FIVE_DAYS = 365,
}

export const ALL_ROLLING_WINDOWS: RollingWindow[] = [
  RollingWindow.SEVEN_DAYS,
  RollingWindow.THIRTY_DAYS,
  RollingWindow.NINETY_DAYS,
  RollingWindow.ONE_EIGHTY_DAYS,
  RollingWindow.THREE_SIXTY_FIVE_DAYS,
];
