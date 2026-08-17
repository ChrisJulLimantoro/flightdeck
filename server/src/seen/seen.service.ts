import { Injectable } from "@nestjs/common";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { STATE_DIR, stateFile } from "../common/state-dir";

const FILE = stateFile("seen.json");

type SeenMarks = Record<string, string>;

/** Last-seen timestamps per PR id — what the "something happened" pip reads. */
@Injectable()
export class SeenService {
  private state?: SeenMarks;

  async all(): Promise<SeenMarks> {
    this.state ??= await readFile(FILE, "utf8").then(
      (source) => JSON.parse(source) as SeenMarks,
      () => ({}),
    );
    return this.state;
  }

  async mark(id: string): Promise<string> {
    const marks = await this.all();
    marks[id] = new Date().toISOString();
    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(FILE, JSON.stringify(marks, null, 2));
    return marks[id];
  }
}
