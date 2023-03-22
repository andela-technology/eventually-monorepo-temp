import { z, ZodType } from "zod";
import {
  Messages,
  State,
  Command,
  CommittedEvent,
  Projection,
  StateWithId
} from "./messages";
import { EventReducer, CommandHandler, EventHandler } from "./handlers";

export type ArtifactType =
  | "aggregate"
  | "system"
  | "policy"
  | "process-manager"
  | "command-adapter"
  | "projector";

/** Empty message payload */
export type Empty = Record<string, never>;
/** Empty message payload schema */
export const ZodEmpty = z.record(z.never());

/**
 * All artifacts transferred from models have
 * - `description` to help with documentation
 */
export type WithDescription = {
  description: string;
};

/**
 * Command handling artifacts have
 * - `commands` schemas for input validation
 * - `events` schemas for output validation
 * - `on` command handlers
 */
export type WithCommandHandlers<
  S extends State,
  C extends Messages,
  E extends Messages
> = {
  schemas: {
    commands: { [K in keyof C]: ZodType<C[K]> };
    events: { [K in keyof E]: ZodType<E[K]> };
  };
  on: { [K in keyof C]: CommandHandler<S, C, E, K> };
};

/**
 * Event handling artifacts have
 * - `events` schemas for input validation
 * - `on` event handlers
 */
export type WithEventHandlers<
  S extends State,
  C extends Messages,
  E extends Messages
> = {
  schemas: {
    events: { [K in keyof E]: ZodType<E[K]> };
  };
  on: {
    [K in keyof E]: EventHandler<S, C, E, K>;
  };
};

/**
 * Command producing artifacts have
 * - `commands` produced command names to help with documentation
 */
export type WithCommandOutputs<C extends Messages> = {
  schemas: {
    commands: { [K in keyof C]: string };
  };
};

/**
 * Streamable artifacts commit events to named streams
 */
export type Streamable = WithDescription & {
  readonly stream: string;
};

/**
 * Reducible artifacts reduce state from event streams
 * - `state` schema to help with documentation
 * - `events` schemas for commit validation
 * - `init` state initializer
 * - `reduce` event reducers
 */
export type Reducible<
  S extends State = State,
  E extends Messages = Messages
> = WithDescription & {
  schemas: {
    state: ZodType<S>;
    events: { [K in keyof E]: ZodType<E[K]> };
  };
  init: () => Readonly<S>;
  reduce: { [K in keyof E]: EventReducer<S, E, K> };
};

/**
 * Aggregates handle commands and produce committed events while holding internal reducible state
 * - Provide consistency boundaries in a business model
 */
export type Aggregate<
  S extends State = State,
  C extends Messages = Messages,
  E extends Messages = Messages
> = Streamable & Reducible<S, E> & WithCommandHandlers<S, C, E>;

/**
 * Systems handle commands and produce committed events without internal state
 */
export type System<
  C extends Messages = Messages,
  E extends Messages = Messages
> = Streamable & WithCommandHandlers<State, C, E>;

/**
 * Policies handle events and can produce commands that trigger local command handlers synchronously
 */
export type Policy<
  C extends Messages = Messages,
  E extends Messages = Messages
> = WithDescription & WithEventHandlers<State, C, E> & WithCommandOutputs<C>;

/**
 * Process managers are policies with reducible state
 * - Expand consistency boundaries by reducing events from different sources into local state machines
 * - IMPORTANT! - Process manager streams are prefixed with the factory name, so we can identify these events
 */
export type ProcessManager<
  S extends State = State,
  C extends Messages = Messages,
  E extends Messages = Messages
> = Streamable &
  Reducible<S, E> &
  WithEventHandlers<S, C, E> &
  WithCommandOutputs<C>;

/**
 * Projectors handle events and produce slices of filters/values representing the area being created/merged or deleted
 */
export type Projector<
  S extends State = State,
  E extends Messages = Messages
> = WithDescription & {
  schemas: {
    state: ZodType<StateWithId<S>>;
    events: { [K in keyof E]: ZodType<E[K]> };
  };
  on: {
    [K in keyof E]: (
      event: CommittedEvent<Pick<E, K>>
    ) => Promise<Projection<S>>;
  };
};

/**
 * Command adapters map any message payload to commands
 * - These are policies with generic inputs (not committed events)
 * - `message` schema for input validation
 * - `on` command adapter
 */
export type CommandAdapter<
  S extends State = State,
  C extends Messages = Messages
> = WithDescription &
  WithCommandOutputs<C> & {
    schemas: {
      message: ZodType<S>;
    };
    on: (message: Readonly<S>) => Command<C>;
  };

/**
 * All command handling artifacts
 */
export type CommandHandlingArtifact<
  S extends State = State,
  C extends Messages = Messages,
  E extends Messages = Messages
> = Aggregate<S, C, E> | System<C, E>;

/**
 * All event handling artifacts
 */
export type EventHandlingArtifact<
  S extends State = State,
  C extends Messages = Messages,
  E extends Messages = Messages
> = ProcessManager<S, C, E> | Policy<C, E>;

/**
 * All message handling artifacts
 */
export type Artifact<
  S extends State = State,
  C extends Messages = Messages,
  E extends Messages = Messages
> =
  | CommandHandlingArtifact<S, C, E>
  | EventHandlingArtifact<S, C, E>
  | CommandAdapter<S, C>
  | Projector<S, E>;
