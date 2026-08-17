import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { SeenService } from "./seen.service";

@Controller("api/seen")
export class SeenController {
  constructor(private readonly seen: SeenService) {}

  @Post()
  @HttpCode(200)
  async mark(@Body() body: { id?: string }): Promise<{ id: string; at: string }> {
    const id = body?.id ?? "";
    return { id, at: await this.seen.mark(id) };
  }
}
