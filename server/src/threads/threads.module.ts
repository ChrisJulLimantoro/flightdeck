import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module";
import { ReposModule } from "../repos/repos.module";
import { TranscriptsModule } from "../transcripts/transcripts.module";
import { ApprovalService } from "./approval.service";
import { ClaudeDriver } from "./drivers/claude.driver";
import { CodexDriver } from "./drivers/codex.driver";
import { ENGINE_DRIVERS } from "./drivers/engine-driver.port";
import { EventsController } from "./events.controller";
import { ThreadRegistry } from "./thread-registry.service";
import { ThreadsController } from "./threads.controller";
import { TurnService } from "./turn.service";

@Module({
  imports: [ReposModule, TranscriptsModule, AgentsModule],
  controllers: [ThreadsController, EventsController],
  providers: [
    ThreadRegistry,
    ApprovalService,
    TurnService,
    ClaudeDriver,
    CodexDriver,
    {
      // The set of engines, assembled once. Adding one means adding a driver
      // here and nowhere else.
      provide: ENGINE_DRIVERS,
      useFactory: (claude: ClaudeDriver, codex: CodexDriver) => [claude, codex],
      inject: [ClaudeDriver, CodexDriver],
    },
  ],
})
export class ThreadsModule {}
