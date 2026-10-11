/**
 * PluginModule — NestJS module for the Strategy Plugin SDK integration.
 *
 * Provides:
 *   - PluginValidationService   — static plugin validation (manifest, version, security)
 *   - SdkContextProviderService — builds SdkStrategyContext from platform state
 *   - PluginLifecycleManagerService — manages plugin install/uninstall/pause/resume
 *
 * Imports (all @Global or explicitly imported):
 *   - RiskModule     — for RiskStateService
 *   - PortfolioModule — for PortfolioManagerService
 *   - StrategyModule  — for StrategyRegistryService
 *   - DatabaseModule  — @Global; provides DATABASE_TOKENS.CANDLE_REPOSITORY
 *
 * Usage — integrate plugin installations at platform startup via StrategyModule:
 *
 *   // In your StrategyModule.onModuleInit():
 *   await pluginLifecycleManager.install(new MyStrategy(), config, 'binance-futures');
 */

import { Module } from '@nestjs/common';
import { StrategyModule } from '@modules/strategy/strategy.module';
import { RiskModule } from '@modules/risk/risk.module';
import { PortfolioModule } from '@modules/portfolio/portfolio.module';
import { PluginValidationService } from './services/plugin-validation.service';
import { SdkContextProviderService } from './services/sdk-context-provider.service';
import { PluginLifecycleManagerService } from './services/plugin-lifecycle-manager.service';

@Module({
  imports: [
    StrategyModule, // provides StrategyRegistryService
    RiskModule, // provides RiskStateService
    PortfolioModule, // provides PortfolioManagerService
    // DatabaseModule is @Global — its tokens are available without explicit import
  ],
  providers: [PluginValidationService, SdkContextProviderService, PluginLifecycleManagerService],
  exports: [PluginValidationService, SdkContextProviderService, PluginLifecycleManagerService],
})
export class PluginModule {}
