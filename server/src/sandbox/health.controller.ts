import { Controller, Get } from "@nestjs/common";
import type { Health } from "@flightdeck/shared";
import { SandboxService } from "./sandbox.service";

@Controller("api/health")
export class HealthController {
  constructor(private readonly sandbox: SandboxService) {}

  @Get()
  async health(): Promise<Health> {
    return { codexSandbox: await this.sandbox.probe() };
  }
}
