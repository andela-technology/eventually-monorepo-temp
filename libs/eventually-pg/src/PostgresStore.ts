import type {
  AllQuery,
  CommittedEvent,
  CommittedEventMetadata,
  Lease,
  Message,
  Messages,
  PollOptions,
  Store,
  StoreStat,
  Subscription
} from "@rotorsoft/eventually";
import {
  ActorConcurrencyError,
  ConcurrencyError,
  STATE_EVENT,
  dateReviver,
  log
} from "@rotorsoft/eventually";
import { randomUUID } from "crypto";
import { Pool, types } from "pg";
import { config } from "./config";
import { stream } from "./seed";

type Event = {
  id: number;
  name: string;
  data: any;
  stream: string;
  version: number;
  created: Date;
  actor: string;
  metadata: any;
};

types.setTypeParser(types.builtins.JSON, (val) => JSON.parse(val, dateReviver));

export const PostgresStore = (table: string): Store => {
  const pool = new Pool(config.pg);

  const query = async <E extends Messages>(
    callback: (event: CommittedEvent<E>) => void,
    query?: AllQuery
  ): Promise<number> => {
    const {
      stream,
      names,
      before,
      after,
      limit,
      created_before,
      created_after,
      backward,
      actor,
      correlation,
      loading
    } = query || {};

    let sql = `SELECT * FROM "${table}" WHERE`;
    const values: any[] = [];

    if (loading) {
      // optimize aggregate loading after last state event
      sql = sql.concat(
        ` id>=COALESCE((SELECT id
          FROM "${table}"
          WHERE stream='${stream}' AND name='${STATE_EVENT}'
          ORDER BY id DESC LIMIT 1), 0)
          AND stream='${stream}'`
      );
    } else {
      if (typeof after !== "undefined") {
        values.push(after);
        sql = sql.concat(" id>$1");
      } else sql = sql.concat(" id>-1");
      if (stream) {
        values.push(stream);
        sql = sql.concat(` AND stream=$${values.length}`);
      }
      if (actor) {
        values.push(actor);
        sql = sql.concat(` AND actor=$${values.length}`);
      }
      if (names && names.length) {
        values.push(names);
        sql = sql.concat(` AND name = ANY($${values.length})`);
      }
      if (before) {
        values.push(before);
        sql = sql.concat(` AND id<$${values.length}`);
      }
      if (created_after) {
        values.push(created_after.toISOString());
        sql = sql.concat(` AND created>$${values.length}`);
      }
      if (created_before) {
        values.push(created_before.toISOString());
        sql = sql.concat(` AND created<$${values.length}`);
      }
      if (correlation) {
        values.push(correlation);
        sql = sql.concat(` AND metadata->>'correlation'=$${values.length}`);
      }
    }
    sql = sql.concat(` ORDER BY id ${backward ? "DESC" : "ASC"}`);
    if (limit) {
      values.push(limit);
      sql = sql.concat(` LIMIT $${values.length}`);
    }

    const result = await pool.query<Event>(sql, values);
    for (const row of result.rows)
      callback(row as unknown as CommittedEvent<E>);

    return result.rowCount;
  };

  return {
    name: `PostgresStore:${table}`,
    dispose: async () => {
      await pool.end();
    },

    seed: async () => {
      const seed = stream(table);
      log().yellow().info(`>>> Seeding event store: ${table}`);
      log().gray().info(seed);
      await pool.query(seed);
    },

    query,

    commit: async <E extends Messages>(
      stream: string,
      events: Message<E>[],
      metadata: CommittedEventMetadata,
      expectedVersion?: number
    ): Promise<CommittedEvent<E>[]> => {
      const client = await pool.connect();
      let version = -1;
      try {
        await client.query("BEGIN");

        // stream concurrency
        const last = await client.query<Event>(
          `SELECT version FROM "${table}" WHERE stream=$1 ORDER BY version DESC LIMIT 1`,
          [stream]
        );
        version = last.rowCount ? last.rows[0].version : -1;
        if (expectedVersion && version !== expectedVersion)
          throw new ConcurrencyError(version, events, expectedVersion);

        // actor concurrency
        const {
          id: actorId,
          name: actorName,
          expectedCount
        } = metadata.causation.command?.actor || {
          id: undefined,
          name: ""
        };
        if (expectedCount && actorId) {
          const count = (
            await client.query<{ count: number }>(
              `SELECT COUNT(id) FROM "${table}" WHERE actor=$1`,
              [actorId]
            )
          ).rows[0].count;
          if (count !== expectedCount)
            throw new ActorConcurrencyError(
              `${actorName}:${actorId}`,
              events.at(0) as Message,
              count,
              expectedCount
            );
        }

        const committed = await Promise.all(
          events.map(async ({ name, data }) => {
            version++;
            const sql = `INSERT INTO "${table}"(name, data, stream, version, actor, metadata) VALUES($1, $2, $3, $4, $5, $6) RETURNING *`;
            const vals = [name, data, stream, version, actorId, metadata];
            log().magenta().data(sql, vals);
            const committed = await client.query<Event>(sql, vals);
            return committed.rows[0] as unknown as CommittedEvent<E>;
          })
        );

        await client
          .query(
            `
            NOTIFY "${table}", '${JSON.stringify({
              operation: "INSERT",
              id: committed[0].name,
              position: committed[0].id
            })}';
            COMMIT;
            `
          )
          .catch((error) => {
            log().error(error);
            throw new ConcurrencyError(version, events, expectedVersion || -1);
          });
        return committed;
      } catch (error) {
        log().error(error);
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    reset: async (): Promise<void> => {
      await pool.query(`TRUNCATE TABLE "${table}"`);
    },

    stats: async (): Promise<StoreStat[]> => {
      const sql = `SELECT 
          name, 
          MIN(id) as firstId, 
          MAX(id) as lastId, 
          MIN(created) as firstCreated, 
          MAX(created) as lastCreated, 
          COUNT(*) as count
        FROM 
          "${table}"
        GROUP BY 
          name
        ORDER BY 
          5 DESC`;

      return (await pool.query<StoreStat>(sql)).rows;
    },

    poll: async <E extends Messages>(
      consumer: string,
      { names, timeout, limit }: PollOptions
    ): Promise<Lease<E> | undefined> => {
      const client = await pool.connect();
      try {
        const events: CommittedEvent<E>[] = [];
        let lease, expires;

        await client.query("BEGIN");
        const { rows } = await pool.query<Subscription>(
          `SELECT * FROM "${table}_subscriptions" WHERE consumer=$1`,
          [consumer]
        );
        const subscription =
          rows.at(0) || ({ consumer, watermark: -1 } as Subscription);
        // block competing consumers while existing lease is valid
        if (
          !(
            subscription.lease &&
            subscription.expires &&
            subscription.expires > new Date()
          )
        ) {
          // get events after watermark
          await query<E>((e) => events.push(e), {
            after: subscription.watermark,
            limit,
            names
          });

          // create a new lease when events found
          if (events.length) {
            lease = randomUUID();
            expires = new Date(Date.now() + timeout);
            const sql = `INSERT INTO "${table}_subscriptions" VALUES($1, $2, $3, $4) ON CONFLICT (consumer) DO UPDATE SET lease=$3, expires=$4 WHERE "${table}_subscriptions".consumer=$1`;
            const vals = [consumer, subscription.watermark, lease, expires];
            log().silver().data(sql, vals);
            await client.query(sql, vals);
          }
        }
        await client.query("COMMIT");
        return events.length
          ? ({
              consumer,
              watermark: subscription.watermark,
              lease,
              expires,
              events
            } as Lease<E>)
          : undefined;
      } catch (error) {
        log().error(error);
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    ack: async <E extends Messages>(lease: Lease<E>, watermark?: number) => {
      let acked = false;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await pool.query<Subscription>(
          `SELECT * FROM "${table}_subscriptions" WHERE consumer=$1`,
          [lease.consumer]
        );
        const subscription =
          rows.at(0) ||
          ({ consumer: lease.consumer, watermark: -1 } as Subscription);
        // update watermark while lease is still valid
        if (
          subscription.lease &&
          subscription.lease === lease.lease &&
          subscription.expires &&
          subscription.expires > new Date()
        ) {
          const sql = `UPDATE "${table}_subscriptions" SET watermark=$2, lease=null, expires=null WHERE "${table}_subscriptions".consumer=$1`;
          const vals = [
            lease.consumer,
            Math.max(watermark || -1, subscription.watermark)
          ];
          acked = (await client.query(sql, vals)).rowCount > 0;
          log().silver().data(sql, vals, { acked });
        }
        await client.query("COMMIT");
      } catch (error) {
        log().error(error);
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      return acked;
    },

    subscriptions: async () => {
      const { rows } = await pool.query<Subscription>(
        `SELECT * FROM "${table}_subscriptions"`
      );
      return rows;
    }
  };
};
