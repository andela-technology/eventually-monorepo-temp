import {
  Aggregate,
  Bus,
  MessageFactory,
  Policy,
  Projector,
  Store
} from "../core";
import { AppBase, decamelize, handlersOf } from "../engine";

export class InMemoryApp extends AppBase {
  constructor(bus: Bus, store: Store) {
    super(bus, store);
  }

  routeAggregate<Model, Commands, Events>(
    aggregate: (id: string) => Aggregate<Model, Commands, Events>,
    factory: MessageFactory<Commands>
  ): Promise<void> {
    handlersOf(factory).map((f) => {
      const command = f();
      const path = "/".concat(
        decamelize(aggregate("").name()),
        "/",
        decamelize(command.name)
      );
      this.register(command.name, aggregate, path);
    });
    return Promise.resolve();
  }

  routePolicy<Commands, Events>(
    policy: () => Policy<Commands, Events>,
    factory: MessageFactory<Events>
  ): Promise<void> {
    const instance = policy();
    handlersOf(factory).map(async (f) => {
      const event = f();
      if (Object.keys(instance).includes("on".concat(event.name))) {
        const path = "/".concat(
          decamelize(instance.name()),
          "/",
          decamelize(event.name)
        );
        await this.subscribe(event, policy, path);
      }
    });
    return Promise.resolve();
  }

  routeProjector<Events>(
    projector: () => Projector<Events>,
    factory: MessageFactory<Events>
  ): Promise<void> {
    const instance = projector();
    handlersOf(factory).map(async (f) => {
      const event = f();
      if (Object.keys(instance).includes("on".concat(event.name))) {
        const path = "/".concat(
          decamelize(instance.name()),
          "/",
          decamelize(event.name)
        );
        await this.subscribe(event, projector, path);
      }
    });
    return Promise.resolve();
  }

  listen(): void {
    this.log.info("InMemoryApp is listening...");
  }
}
