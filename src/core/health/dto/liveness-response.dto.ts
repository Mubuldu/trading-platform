import { ApiProperty } from '@nestjs/swagger';

export class LivenessResponseDto {
  @ApiProperty({ example: 'alive' })
  status: 'alive';

  @ApiProperty({ example: 12345 })
  pid: number;

  @ApiProperty({ example: 3600.5 })
  uptimeSeconds: number;

  @ApiProperty({ example: '2024-01-01T00:00:00.000Z' })
  timestamp: string;
}
