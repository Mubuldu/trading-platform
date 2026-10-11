import { ArgumentsHost, BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import { Request, Response } from 'express';
import { GlobalExceptionFilter } from '@common/filters/global-exception.filter';
import { AppLoggerService } from '@core/logging/app-logger.service';

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let mockLogger: jest.Mocked<AppLoggerService>;
  let mockResponse: jest.Mocked<Partial<Response>>;
  let mockRequest: Partial<Request>;
  let mockHost: jest.Mocked<ArgumentsHost>;

  beforeEach(() => {
    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn(),
    } as unknown as jest.Mocked<AppLoggerService>;

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockRequest = {
      method: 'GET',
      url: '/api/v1/test',
      ip: '127.0.0.1',
    };

    mockHost = {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
        getResponse: jest.fn().mockReturnValue(mockResponse),
      }),
    } as unknown as jest.Mocked<ArgumentsHost>;

    filter = new GlobalExceptionFilter(mockLogger);
  });

  describe('HttpException handling', () => {
    it('should return the correct status code for NotFoundException', () => {
      const exception = new NotFoundException('Resource not found');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    });

    it('should return the correct status code for BadRequestException', () => {
      const exception = new BadRequestException('Validation failed');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    });

    it('should include the correlationId in the response body', () => {
      const exception = new NotFoundException('Not found');

      filter.catch(exception, mockHost);

      const jsonCall = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(jsonCall).toHaveProperty('correlationId');
      expect(typeof jsonCall.correlationId).toBe('string');
    });

    it('should include path and timestamp in the response body', () => {
      const exception = new NotFoundException('Not found');

      filter.catch(exception, mockHost);

      const body = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(body.path).toBe('/api/v1/test');
      expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should handle BadRequestException with array message', () => {
      const exception = new BadRequestException(['field is required', 'field must be string']);

      filter.catch(exception, mockHost);

      const body = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(body.statusCode).toBe(HttpStatus.BAD_REQUEST);
      expect(Array.isArray(body.message)).toBe(true);
    });

    it('should log a warning for 4xx errors', () => {
      const exception = new BadRequestException('Bad input');

      filter.catch(exception, mockHost);

      expect(mockLogger.warn).toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });

  describe('Unknown exception handling', () => {
    it('should return 500 for non-HttpException errors', () => {
      const exception = new Error('Database connection failed');

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it('should not expose internal error message to client for unknown errors', () => {
      const exception = new Error('Internal secret data leaked');

      filter.catch(exception, mockHost);

      const body = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(body.message).not.toContain('Internal secret data leaked');
      expect(body.message).toBe('An unexpected error occurred. Please try again later.');
    });

    it('should log error with stack trace for 5xx errors', () => {
      const exception = new Error('Unexpected failure');

      filter.catch(exception, mockHost);

      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle non-Error thrown values', () => {
      const exception = 'string exception';

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it('should handle null thrown values', () => {
      const exception = null;

      filter.catch(exception, mockHost);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });

  describe('Response structure', () => {
    it('should always include statusCode, error, message, correlationId, timestamp, path', () => {
      const exception = new NotFoundException();

      filter.catch(exception, mockHost);

      const body = (mockResponse.json as jest.Mock).mock.calls[0][0];
      expect(body).toHaveProperty('statusCode');
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('correlationId');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('path');
    });
  });
});
