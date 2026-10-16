import { Injectable } from '@nestjs/common';

type ChannelListener = (channelId: string) => void;

@Injectable()
export class EventHub {
  private readonly listeners = new Map<string, Set<ChannelListener>>();

  subscribe(userId: string, listener: ChannelListener): () => void {
    let bucket = this.listeners.get(userId);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(userId, bucket);
    }
    bucket.add(listener);
    return () => {
      const current = this.listeners.get(userId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(userId);
    };
  }

  publish(userId: string, channelId: string): void {
    const bucket = this.listeners.get(userId);
    if (!bucket) return;
    for (const listener of [...bucket]) {
      try {
        listener(channelId);
      } catch {
        // One connection failing to write must not drop the others.
      }
    }
  }
}
