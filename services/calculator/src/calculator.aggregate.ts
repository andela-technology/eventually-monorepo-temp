import { Aggregate, Apply, CommittedEvent } from "@rotorsoft/eventually";
import { PostgresSnapshotStore } from "@rotorsoft/eventually-pg";
import { Commands } from "./calculator.commands";
import { Events, events } from "./calculator.events";
import {
  CalculatorModel,
  DIGITS,
  Digits,
  Keys,
  Operators,
  SYMBOLS
} from "./calculator.models";
import * as schemas from "./calculator.schemas";

const round2 = (n: number): number => Math.round(n * 100) / 100;
const Operations = {
  ["+"]: (l: number, r: number): number => round2(l + r),
  ["-"]: (l: number, r: number): number => round2(l - r),
  ["*"]: (l: number, r: number): number => round2(l * r),
  ["/"]: (l: number, r: number): number => round2(l / r)
};

const compute = (model: CalculatorModel): CalculatorModel => {
  if (model.operator && model.left && model.right) {
    const l = Number.parseFloat(model.left);
    const r = Number.parseFloat(model.right);
    const result = Operations[model.operator](l, r);
    const left = result.toString();
    return { result, left, operator: model.operator };
  }
  return model;
};

export const Calculator = (
  id: string
): Aggregate<CalculatorModel, Omit<Commands, "Whatever">, Events> => ({
  snapshot: {
    factory: PostgresSnapshotStore,
    threshold: 2
  },
  stream: () => `Calculator${id}`,

  schema: () => schemas.CalculatorModel,

  init: (): CalculatorModel => ({
    result: 0
  }),

  applyDigitPressed: (
    model: CalculatorModel,
    event: CommittedEvent<"DigitPressed", { digit: Digits }>
  ) => {
    if (model.operator) {
      const right = (model.right || "").concat(event.data.digit);
      return { ...model, right };
    }
    const left = (model.left || "").concat(event.data.digit);
    return { ...model, left };
  },

  applyOperatorPressed: (
    model: CalculatorModel,
    event: CommittedEvent<"OperatorPressed", { operator: Operators }>
  ) => {
    if (model.left) {
      const newmodel = compute(model);
      return { ...newmodel, operator: event.data.operator };
    }
    return { ...model };
  },

  applyDotPressed: (model: CalculatorModel) => {
    if (model.operator) {
      const right = (model.right || "").concat(".");
      return { ...model, right };
    }
    const left = (model.left || "").concat(".");
    return { ...model, left };
  },

  applyEqualsPressed: (model: CalculatorModel) => compute(model),

  applyCleared: () => ({
    result: 0
  }),

  onPressKey: async (data: { key: Keys }, state: CalculatorModel) => {
    if (data.key === SYMBOLS[0]) {
      return Promise.resolve([Apply(events.DotPressed)]);
    }
    if (data.key === SYMBOLS[1]) {
      // let's say this is an invalid operation if there is no operator in the model
      if (!state.operator) throw Error("Don't have an operator!");
      return Promise.resolve([Apply(events.EqualsPressed)]);
    }
    return DIGITS.includes(data.key as Digits)
      ? [Apply(events.DigitPressed, { digit: data.key as Digits })]
      : [Apply(events.OperatorPressed, { operator: data.key as Operators })];
  },

  onReset: async () => Promise.resolve([Apply(events.Cleared)])
});
