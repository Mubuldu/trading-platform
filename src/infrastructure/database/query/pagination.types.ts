export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface CursorParams {
  cursor?: string;
  limit: number;
  direction?: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface CursorResult<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function buildPaginatedResult<T>(
  data: T[],
  total: number,
  { page, pageSize }: PaginationParams,
): PaginatedResult<T> {
  const totalPages = Math.ceil(total / pageSize);
  return {
    data,
    total,
    page,
    pageSize,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
}

export function paginationToOffsetLimit({ page, pageSize }: PaginationParams): {
  offset: number;
  limit: number;
} {
  return {
    offset: (page - 1) * pageSize,
    limit: pageSize,
  };
}
