import { PubSub, Topic as GcpTopic } from "@google-cloud/pubsub";
import {
  Broker,
  eventPath,
  Evt,
  EvtOf,
  Payload,
  PolicyFactory,
  TopicNotFound
} from "@rotorsoft/eventually";
import { config } from "./config";

type Message = {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
  };
  subscription: string;
};

export const PubSubBroker = (): Broker => {
  const topics: { [name: string]: GcpTopic } = {};

  return {
    topic: async <E>(event: EvtOf<E>): Promise<void> => {
      const options = config.gcp.project
        ? { projectId: config.gcp.project }
        : {};

      const pubsub = new PubSub(options);
      const topic = new GcpTopic(pubsub, event.name);
      const [exists] = await topic.exists();
      if (!exists) await topic.create();
      topics[event.name] = topic;
    },

    subscribe: async <C, E>(
      factory: PolicyFactory<C, E>,
      event: EvtOf<E>
    ): Promise<void> => {
      const topic = topics[event.name];
      if (!topic) throw new TopicNotFound(event);

      const url = `${config.host}${eventPath(factory, event)}`;
      const sub = topic.subscription(factory.name.concat(".", event.name));
      const [exists] = await sub.exists();
      if (!exists) await sub.create({ pushEndpoint: url });
      else if (sub.metadata?.pushConfig?.pushEndpoint !== url)
        await sub.modifyPushConfig({ pushEndpoint: url });
    },

    emit: async <E>(event: EvtOf<E>): Promise<void> => {
      const topic = topics[event.name];
      if (!topic) throw new TopicNotFound(event);

      await topic.publish(Buffer.from(JSON.stringify(event)));
    },

    decode: (msg: Payload): Evt => {
      const { message, subscription } = msg as unknown as Message;
      if (message && subscription)
        return JSON.parse(
          Buffer.from(message.data, "base64").toString("utf-8")
        ) as Evt;
      return msg as Evt;
    }
  };
};