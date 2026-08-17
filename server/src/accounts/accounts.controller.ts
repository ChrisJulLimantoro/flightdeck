import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import type { AccountsResponse } from "@flightdeck/shared";
import { AccountsService } from "./accounts.service";

@Controller("api/accounts")
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  view(): Promise<AccountsResponse> {
    return this.accounts.view();
  }

  // Every mutation answers with the whole view, so the client never has to
  // reconcile a partial update against what it already had.
  @Post()
  @HttpCode(200)
  async add(@Body() body: { token?: string }): Promise<AccountsResponse> {
    await this.accounts.add(body?.token ?? "");
    return this.accounts.view();
  }

  @Post("active")
  @HttpCode(200)
  async setActive(@Body() body: { login?: string }): Promise<AccountsResponse> {
    await this.accounts.setActive(body?.login ?? "");
    return this.accounts.view();
  }

  @Delete(":login")
  async remove(@Param("login") login: string): Promise<AccountsResponse> {
    await this.accounts.remove(login);
    return this.accounts.view();
  }
}
