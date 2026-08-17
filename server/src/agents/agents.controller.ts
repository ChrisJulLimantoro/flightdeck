import { Controller, Get } from "@nestjs/common";
import type { AgentsResponse } from "@flightdeck/shared";
import { AgentsService } from "./agents.service";

@Controller("api/agents")
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Get()
  list(): Promise<AgentsResponse> {
    return this.agents.list();
  }
}
