import { Injectable } from "@nestjs/common";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { STATE_DIR, stateFile } from "../common/state-dir";

/**
 * `~/.flightdeck/config.json`. Every field is optional — Flight Deck must run
 * with no config at all, which is what makes `npx flightdeck` work for someone
 * who has never heard of this file.
 */
export interface FlightdeckConfig {
  /** Extra roots to scan for clones, for checkouts outside $HOME. */
  scanRoots?: string[];
  /** Explicit slug -> path overrides, for anything discovery cannot find. */
  repos?: Record<string, string>;
}

const FILE = stateFile("config.json");

@Injectable()
export class ConfigService {
  private cache?: Promise<FlightdeckConfig>;

  read(): Promise<FlightdeckConfig> {
    this.cache ??= readFile(FILE, "utf8").then(
      (source) => JSON.parse(source) as FlightdeckConfig,
      () => ({}),
    );
    return this.cache;
  }

  async scanRoots(): Promise<string[]> {
    return (await this.read()).scanRoots ?? [];
  }

  async repoOverrides(): Promise<Record<string, string>> {
    return (await this.read()).repos ?? {};
  }

  /** Remember where a repo lives, so discovery never has to find it again. */
  async rememberRepo(slug: string, path: string): Promise<void> {
    const config = await this.read();
    config.repos = { ...config.repos, [slug]: path };
    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(FILE, JSON.stringify(config, null, 2));
    this.cache = Promise.resolve(config);
  }
}
