import { Controller, Get, Query } from "@nestjs/common";
import type { PrsResponse } from "@flightdeck/shared";
import { PrsService } from "./prs.service";

@Controller("api/prs")
export class PrsController {
  constructor(private readonly prs: PrsService) {}

  /** `?fresh` (valueless) bypasses the 60s cache, as the REFRESH button does. */
  @Get()
  list(@Query() query: Record<string, unknown>): Promise<PrsResponse> {
    return this.prs.list("fresh" in query);
  }
}
