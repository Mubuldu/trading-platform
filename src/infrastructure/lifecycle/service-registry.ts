import { Injectable } from '@nestjs/common';

export type ServiceStatus = 'starting' | 'healthy' | 'degraded' | 'stopping' | 'stopped';

export interface ServiceRegistration {
  readonly name: string;
  readonly version: string;
  readonly capabilities: string[];
  readonly startedAt: Date;
  status: ServiceStatus;
  lastStatusChange: Date;
}

/**
 * ServiceRegistry tracks all registered services and their operational status.
 *
 * Responsibilities:
 *  - Central record of which services are registered at boot time
 *  - Status transitions (starting → healthy → degraded → stopping → stopped)
 *  - Observable by health endpoints, dashboards, and alerting systems
 *
 * This is an in-process registry. In a distributed system, register with
 * Consul, etcd, or a cloud service discovery mechanism.
 *
 * Extension: add watch() method that emits status change events so that
 * the health endpoint can push updates via SSE instead of polling.
 */
@Injectable()
export class ServiceRegistry {
  private readonly services = new Map<string, ServiceRegistration>();

  register(registration: Omit<ServiceRegistration, 'lastStatusChange'>): void {
    this.services.set(registration.name, {
      ...registration,
      lastStatusChange: new Date(),
    });
  }

  updateStatus(name: string, status: ServiceStatus): void {
    const svc = this.services.get(name);
    if (!svc) return;
    svc.status = status;
    svc.lastStatusChange = new Date();
  }

  deregister(name: string): void {
    this.services.delete(name);
  }

  get(name: string): ServiceRegistration | undefined {
    return this.services.get(name);
  }

  getAll(): ServiceRegistration[] {
    return [...this.services.values()];
  }

  isHealthy(name: string): boolean {
    return this.services.get(name)?.status === 'healthy';
  }

  areAllHealthy(): boolean {
    return this.getAll().every((s) => s.status === 'healthy');
  }
}
