import { AllocationMethod } from '../enums/allocation-method.enum';

export interface AllocationWeight {
  readonly strategyId: string;
  readonly weight: number;
  readonly allocatedCapital: number;
  readonly maxPositionSize: number;
}

export interface CapitalAllocationModel {
  readonly method: AllocationMethod;
  readonly totalCapital: number;
  readonly allocations: AllocationWeight[];
  readonly computedAt: number;
}
