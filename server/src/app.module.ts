import { Module } from "@nestjs/common";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "node:path";
import { AccountsModule } from "./accounts/accounts.module";
import { AgentsModule } from "./agents/agents.module";
import { ConfigModule } from "./config/config.module";
import { PrsModule } from "./prs/prs.module";
import { SandboxModule } from "./sandbox/sandbox.module";
import { SeenModule } from "./seen/seen.module";
import { SkillsModule } from "./skills/skills.module";
import { ThreadsModule } from "./threads/threads.module";

/**
 * The SPA is copied into `server/public` at build time rather than served from
 * `../../web/dist`, so a published tarball and a working tree resolve assets by
 * the same path. `exclude` keeps unknown `/api/*` paths 404ing as themselves
 * instead of being answered with the HTML shell.
 */
const WEB_ROOT = join(__dirname, "..", "public");

@Module({
  imports: [
    ConfigModule,
    ServeStaticModule.forRoot({
      rootPath: WEB_ROOT,
      exclude: ["/api/{*path}"],
    }),
    AccountsModule,
    PrsModule,
    AgentsModule,
    SkillsModule,
    SeenModule,
    SandboxModule,
    ThreadsModule,
  ],
})
export class AppModule {}
