import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule, ConfigService } from '@nestjs/config';
import { appConfig } from './app.config';
import { loggingConfig } from './logging.config';
import { exchangeConfig } from './exchange.config';
import { monitoringConfig } from './monitoring.config';
import { riskConfig } from './risk.config';
import { strategyConfig } from './strategy.config';
import { executionConfig } from './execution.config';
import { backtestingConfig } from './backtesting.config';
import { paperTradingConfig } from './paper-trading.config';
import { alertsConfig } from './alerts.config';
import { secretsConfig } from './secrets.config';
import { redisConfig } from '@infrastructure/redis/config/redis.config';
import { databaseConfig } from '@infrastructure/database/config/database.config';
import { binanceConfig } from '@modules/exchange/adapters/binance/config/binance.config';
import { indicatorConfig } from './indicator.config';
import { positionConfig } from './position.config';
import { orderConfig } from './order.config';
import { reconciliationConfig } from './reconciliation.config';
import { portfolioConfig } from './portfolio.config';
import { clusterConfig } from './cluster.config';
import { envValidationSchema } from './env.validation';
import { ReloadableConfigService } from './reload/reloadable-config.service';
import { AppLoggerService } from '@core/logging/app-logger.service';

/**
 * GlobalConfigModule wraps @nestjs/config and makes typed configuration
 * available throughout the application without re-importing.
 *
 * Responsibilities:
 *  - Load the correct .env.<NODE_ENV> file at startup
 *  - Validate all required env vars via Joi before any module initializes
 *  - Expose all typed config namespaces via ConfigService.get('<namespace>')
 *  - Provide ReloadableConfigService for SIGHUP-triggered hot reload
 *
 * Failure mode: invalid env causes Joi to throw; NestJS aborts bootstrap
 * and prints every violated constraint. The process exits with code 1.
 *
 * Config namespaces:
 *   app, logging, exchange, monitoring, risk, strategy, execution,
 *   backtesting, paperTrading, alerts, secrets,
 *   redis, database, binance
 *
 * Hot-reloadable namespaces (SIGHUP — see ReloadableConfigService):
 *   risk, strategy, monitoring (thresholds), alerts
 *
 * Non-reloadable (require full process restart):
 *   All others — they contain credentials, URLs, or structural settings
 *   that would leave the application in an inconsistent state if changed
 *   at runtime.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
      load: [
        appConfig,
        loggingConfig,
        exchangeConfig,
        monitoringConfig,
        riskConfig,
        strategyConfig,
        executionConfig,
        backtestingConfig,
        paperTradingConfig,
        alertsConfig,
        secretsConfig,
        redisConfig,
        databaseConfig,
        binanceConfig,
        indicatorConfig,
        positionConfig,
        orderConfig,
        reconciliationConfig,
        portfolioConfig,
        clusterConfig,
      ],
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
      expandVariables: false,
    }),
  ],
  providers: [
    {
      provide: ReloadableConfigService,
      useFactory: (
        configService: ConfigService,
        logger: AppLoggerService,
      ): ReloadableConfigService => {
        const env =
          configService.get<string>('app.environment') ?? process.env.NODE_ENV ?? 'development';
        return new ReloadableConfigService(configService, logger, `.env.${env}`);
      },
      inject: [ConfigService, AppLoggerService],
    },
  ],
  exports: [NestConfigModule, ReloadableConfigService],
})
export class ConfigModule {}
