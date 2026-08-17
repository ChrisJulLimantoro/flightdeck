import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { ErrorFilter } from "./common/error.filter";
import { migrateStateDir } from "./common/state-dir";

const PORT = Number(process.env.PORT ?? 4321);

async function bootstrap() {
  // Before any service reads state: tokens and seen-marks move exactly once.
  await migrateStateDir();

  const app = await NestFactory.create(AppModule, { logger: ["error", "warn", "log"] });
  app.useGlobalFilters(new ErrorFilter());

  // Shutdown hooks are what let the registry reap spawned agents on exit.
  app.enableShutdownHooks();

  // Loopback only: this process holds GitHub tokens and can spawn agents.
  await app.listen(PORT, "127.0.0.1");
  console.log(`flight deck → http://127.0.0.1:${PORT}`);
}

void bootstrap();
