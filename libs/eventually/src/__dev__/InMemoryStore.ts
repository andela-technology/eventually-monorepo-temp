import { Store } from "../interfaces";
import {
  AllQuery,
  CommittedEvent,
  CommittedEventMetadata,
  Message,
  Payload,
  StoreStat
} from "../types";

export const InMemoryStore = (): Store => {
  const _events: CommittedEvent<string, Payload>[] = [];

  return {
    init: (): Promise<void> => {
      _events.length = 0;
      return;
    },

    close: (): Promise<void> => {
      _events.length = 0;
      return;
    },

    query: (
      callback: (event: CommittedEvent<string, Payload>) => void,
      query?: AllQuery
    ): Promise<void> => {
      const {
        stream,
        names,
        before,
        after = -1,
        limit,
        created_before,
        created_after
      } = query;
      let i = after + 1,
        count = 0;
      while (i < _events.length) {
        const e = _events[i++];
        if (stream && e.stream !== stream) continue;
        if (names && !names.includes(e.name)) continue;
        if (created_after && e.created <= created_after) continue;
        if (before && e.id >= before) break;
        if (created_before && e.created >= created_before) break;
        callback(e);
        if (limit && ++count >= limit) break;
      }
      return Promise.resolve();
    },

    commit: async (
      stream: string,
      events: Message<string, Payload>[],
      metadata: CommittedEventMetadata,
      expectedVersion?: number,
      callback?: (events: CommittedEvent<string, Payload>[]) => Promise<void>
    ): Promise<CommittedEvent<string, Payload>[]> => {
      const aggregate = _events.filter((e) => e.stream === stream);
      if (expectedVersion && aggregate.length - 1 !== expectedVersion)
        throw Error("Concurrency Error");

      let version = aggregate.length;
      const committed = events.map(({ name, data }) => {
        const committed: CommittedEvent<string, Payload> = {
          id: _events.length,
          stream,
          version,
          created: new Date(),
          name,
          data,
          metadata
        };
        _events.push(committed);
        version++;
        return committed;
      });

      callback && (await callback(committed));

      return committed;
    },

    stats: (): Promise<StoreStat[]> => {
      const stats: Record<string, StoreStat> = {};
      _events.map((e) => {
        const stat: StoreStat = (stats[e.name] = stats[e.name] || {
          name: e.name,
          count: 0
        });
        stat.count++;
        stat.firstId = stat.firstId || e.id;
        stat.lastId = e.id;
        stat.firstCreated = stat.firstCreated || e.created;
        stat.lastCreated = e.created;
      });
      return Promise.resolve(Object.values(stats));
    }
  };
};
