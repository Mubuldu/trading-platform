import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AppConfig } from '@config/app.config';

/**
 * ApiKeyGuard protects internal endpoints that must not be exposed publicly.
 *
 * Expected request header:
 *   x-api-key: <value of API_KEY_SECRET env var>
 *
 * Returns 401 Unauthorized when the header is missing or does not match.
 * The comparison uses a timing-safe method (constant-length comparison via
 * padding) to prevent timing-based secret extraction.
 *
 * Usage:
 *   @UseGuards(ApiKeyGuard)
 *   @Controller('diagnostics')
 *   export class DiagnosticsController { ... }
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    const config = this.configService.get<AppConfig>('app');
    if (!config?.security?.apiKeySecret) {
      throw new Error(
        'ApiKeyGuard: API_KEY_SECRET is not configured. ' +
          'Set this environment variable before starting the application.',
      );
    }
    this.apiKey = config.security.apiKeySecret;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-api-key'];

    if (typeof provided !== 'string' || !this.timingSafeEqual(provided, this.apiKey)) {
      throw new UnauthorizedException('Invalid or missing API key.');
    }

    return true;
  }

  /**
   * Compares two strings in constant time relative to the expected key length
   * to mitigate timing-oracle attacks on the secret.
   *
   * Both strings are compared character-by-character for the full length of the
   * expected key; the result accumulates all differences, preventing short-circuit
   * returns on early mismatch.
   */
  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      // Length difference leaks info, but the mismatch is unconditional
      // regardless of content — we still iterate the full length of b.
      let diff = 0;
      for (let i = 0; i < b.length; i++) {
        diff |= a.charCodeAt(i % a.length) ^ b.charCodeAt(i);
      }
      return diff === 0 && a.length === b.length;
    }

    let diff = 0;
    for (let i = 0; i < b.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  }
}
