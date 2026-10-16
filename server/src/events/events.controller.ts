import { Controller, Inject, MessageEvent, Req, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { BearerAuthGuard } from '../auth/guards/bearer-auth.guard';
import { RequestWithUser, SessionUser } from '../auth/request-with-user';
import { ChannelService } from '../channels/channels.service';
import { DEFAULT_COMPANY_ID } from '../constants';
import { EventHub } from './event-hub';

@Controller()
export class EventsController {
  constructor(
    @Inject(ChannelService) private readonly channels: ChannelService,
    @Inject(EventHub) private readonly events: EventHub,
  ) {}

  @Sse('api/events')
  @UseGuards(BearerAuthGuard)
  stream(@Req() request: RequestWithUser): Observable<MessageEvent> {
    const user = request.user as SessionUser;
    return new Observable((subscriber) => {
      let closed = false;
      const announced = new Set<string>();
      const emit = (channelId: string) => {
        if (closed) return;
        announced.add(channelId);
        subscriber.next({ data: { channelId } });
      };
      const unsubscribe = this.events.subscribe(user.id, emit);
      subscriber.next({ comment: 'open' });
      void this.channels
        .listPendingChannelIds(DEFAULT_COMPANY_ID, user.id)
        .then((channelIds) => {
          if (closed) return;
          for (const channelId of channelIds) {
            if (announced.has(channelId)) continue;
            emit(channelId);
          }
        })
        .catch(() => undefined);
      return () => {
        closed = true;
        unsubscribe();
      };
    });
  }
}
