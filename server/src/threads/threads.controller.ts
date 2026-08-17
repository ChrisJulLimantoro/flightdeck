import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import type { EngineName, SafetyMode, ThreadSummary, Verdict } from "@flightdeck/shared";
import { ReposService } from "../repos/repos.service";
import { TranscriptService } from "../transcripts/transcript.service";
import { ApprovalService } from "./approval.service";
import type { Thread } from "./thread.model";
import { ThreadRegistry } from "./thread-registry.service";
import { TurnService } from "./turn.service";

const ENGINES: EngineName[] = ["claude", "codex"];
const MODES: SafetyMode[] = ["read", "write", "unsandboxed"];
const DECISIONS: Verdict[] = ["allow", "deny"];

interface CreateBody {
  engine?: string;
  skill?: string;
  target?: string;
  prompt?: string;
  repo?: string;
  mode?: string;
  approvals?: boolean;
}

@Controller("api")
export class ThreadsController {
  constructor(
    private readonly registry: ThreadRegistry,
    private readonly turns: TurnService,
    private readonly approvals: ApprovalService,
    private readonly repos: ReposService,
    private readonly transcripts: TranscriptService,
  ) {}

  @Get("threads")
  list(): ThreadSummary[] {
    return this.registry.list();
  }

  @Post("threads")
  @HttpCode(200)
  async create(@Body() body: CreateBody): Promise<ThreadSummary> {
    const engine = body.engine as EngineName;
    if (!ENGINES.includes(engine)) throw new BadRequestException("unknown engine");

    const prompt = buildPrompt(body);
    if (!prompt?.trim()) throw new BadRequestException("nothing to send");

    const repo = body.repo ?? "";
    const { path, cloned, codexTrusted } = await this.repos.resolve(repo);
    if (!cloned || !path) throw new BadRequestException(`${repo} is not cloned locally`);
    if (engine === "codex" && !codexTrusted) {
      throw new BadRequestException(`${repo} is not a trusted Codex project`);
    }

    const thread = this.turns.create({
      engine,
      skill: body.skill ?? "prompt",
      label: body.target ?? repo,
      cwd: path,
      mode: MODES.includes(body.mode as SafetyMode) ? (body.mode as SafetyMode) : "read",
      approvals: body.approvals,
    });
    return this.registry.summarise(this.turns.start(thread, prompt));
  }

  @Post("threads/:id/turn")
  @HttpCode(200)
  turn(@Param("id") id: string, @Body() body: { prompt?: string }): ThreadSummary {
    const thread = this.require(id);
    if (!body?.prompt?.trim()) throw new BadRequestException("nothing to send");
    return this.registry.summarise(this.turns.start(thread, body.prompt));
  }

  @Post("threads/:id/permission")
  @HttpCode(200)
  permission(
    @Param("id") id: string,
    @Body() body: { askId?: string; decision?: string },
  ): { resolved: boolean } {
    const thread = this.require(id);
    if (!DECISIONS.includes(body?.decision as Verdict)) {
      throw new BadRequestException("bad decision");
    }
    const resolved = this.approvals.resolve(thread, body.askId ?? "", body.decision as Verdict);
    return { resolved };
  }

  // Deliberately not a 404 on an unknown id: stopping something that is already
  // gone is not an error, and the client only reads `stopped`.
  @Post("threads/:id/stop")
  @HttpCode(200)
  stop(@Param("id") id: string): { stopped: boolean } {
    return { stopped: this.registry.stop(id) };
  }

  /** Adopt a session this process did not start, for replay and resume. */
  @Post("sessions/:engine/:sessionId/open")
  @HttpCode(200)
  async open(
    @Param("engine") engine: string,
    @Param("sessionId") sessionId: string,
    @Body() body: { fork?: boolean },
  ): Promise<ThreadSummary> {
    const { cwd, events } = await this.transcripts.read(engine, sessionId);
    const thread = this.turns.create({
      engine: engine as EngineName,
      skill: "adopted",
      label: sessionId,
      cwd: cwd ?? "",
      mode: "read",
      sessionId,
      fork: Boolean(body?.fork),
    });
    thread.events = events.map((event) => ({ ...event, replayed: true }));
    return this.registry.summarise(thread);
  }

  private require(id: string): Thread {
    const thread = this.registry.get(id);
    if (!thread) throw new NotFoundException("unknown thread");
    return thread;
  }
}

/**
 * Both CLIs resolve skills from the same skills directory, so the prompt is
 * identical for either engine.
 */
const buildPrompt = ({ skill, target, prompt }: CreateBody) =>
  skill ? `/${skill}${target ? ` ${target}` : ""}` : prompt;
