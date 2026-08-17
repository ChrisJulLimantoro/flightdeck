import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module";
import { GithubModule } from "../github/github.module";
import { ReposModule } from "../repos/repos.module";
import { SeenModule } from "../seen/seen.module";
import { DeriveService } from "./derive.service";
import { PrsController } from "./prs.controller";
import { PrsService } from "./prs.service";

@Module({
  imports: [GithubModule, ReposModule, SeenModule, AccountsModule],
  controllers: [PrsController],
  providers: [PrsService, DeriveService],
})
export class PrsModule {}
