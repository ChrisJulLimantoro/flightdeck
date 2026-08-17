import { Global, Module } from "@nestjs/common";
import { ConfigService } from "./config.service";

/** Global: nearly every adapter wants the config, and it holds no request state. */
@Global()
@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
