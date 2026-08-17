import { Controller, Get } from "@nestjs/common";
import type { Skill } from "@flightdeck/shared";
import { SkillsService } from "./skills.service";

@Controller("api/skills")
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get()
  list(): Promise<Skill[]> {
    return this.skills.list();
  }
}
