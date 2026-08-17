import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { SandboxService } from "./sandbox.service";

@Module({
  controllers: [HealthController],
  providers: [SandboxService],
  exports: [SandboxService],
})
export class SandboxModule {}
