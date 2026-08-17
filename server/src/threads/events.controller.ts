import { Controller, NotFoundException, Param, Sse } from "@nestjs/common";
import type { MessageEvent } from "@nestjs/common";
import type { ThreadEvent } from "@flightdeck/shared";
import { Observable, map } from "rxjs";
import { ThreadRegistry } from "./thread-registry.service";

@Controller("api/stream")
export class EventsController {
  constructor(private readonly registry: ThreadRegistry) {}

  /**
   * `subscribe` replays the buffered events and the current status before
   * attaching, so a reload rebuilds the whole transcript from this one stream.
   * Unsubscribing on disconnect is what keeps a closed tab from leaking a
   * subscriber into the thread forever.
   */
  @Sse(":id")
  stream(@Param("id") id: string): Observable<MessageEvent> {
    const thread = this.registry.get(id);
    if (!thread) throw new NotFoundException("unknown thread");

    return new Observable<ThreadEvent>((subscriber) =>
      this.registry.subscribe(thread, (event) => subscriber.next(event)),
    ).pipe(map((data): MessageEvent => ({ data })));
  }
}
