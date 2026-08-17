import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module";
import { GithubAdapter } from "./github.adapter";

@Module({
  imports: [AccountsModule],
  providers: [GithubAdapter],
  exports: [GithubAdapter],
})
export class GithubModule {}
