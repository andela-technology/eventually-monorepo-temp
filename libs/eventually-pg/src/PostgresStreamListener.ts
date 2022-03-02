import {
  log,
  store,
  Subscription,
  subscriptions,
  TriggerCallback
} from "@rotorsoft/eventually";
import createSubscriber from "pg-listen";
import { config } from "./config";
import { PostgresStore } from "./PostgresStore";

export const PostgresStreamListener = async (
  sub: Subscription,
  callback: TriggerCallback
): Promise<() => Promise<void>> => {
  let pumping = false;

  store(PostgresStore(sub.channel));
  await store().init();
  await subscriptions().init();
  const subscriber = createSubscriber(config.pg);

  const close = async (): Promise<void> => {
    await subscriber.close();
    await subscriptions().close();
    await store().close();
  };

  process.on("exit", async () => {
    log().info(
      "red",
      `[${process.pid}] exit ${sub.id}`,
      `${sub.channel} -> ${sub.endpoint}`
    );
    await close();
  });

  subscriber.events.on("error", (error) => {
    log().error(error);
    process.exit(1);
  });

  subscriber.notifications.on(sub.channel, async (event): Promise<void> => {
    if (!pumping) {
      pumping = true;
      await callback({ position: event.id, reason: "commit" }, sub);
      pumping = false;
    }
  });

  void subscriber.connect().then(async () => {
    await subscriber.listenTo(sub.channel);
    log().info(
      "green",
      `[${process.pid}] connect ${sub.id}`,
      `${sub.channel} -> ${sub.endpoint}`,
      `@ ${sub.position}`
    );
  });

  return close;
};
