import { Module } from "@nestjs/common";
import { SeenController } from "./seen.controller";
import { SeenService } from "./seen.service";

@Module({
  controllers: [SeenController],
  providers: [SeenService],
  exports: [SeenService],
})
export class SeenModule {}
