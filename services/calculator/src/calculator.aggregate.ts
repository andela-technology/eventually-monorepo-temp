import { Aggregate, CommittedEvent } from "@rotorsoft/eventually";
import {
  DIGITS,
  SYMBOLS,
  Digits,
  CalculatorModel,
  Operators,
  Keys
} from "./calculator.models";
import { Commands } from "./calculator.commands";
import { Events, events } from "./calculator.events";

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
): Aggregate<CalculatorModel, Commands, Events> => ({
  id,

  // Model Reducer with event side effects
  init: (): CalculatorModel => ({
    result: 0
  }),

  applyDigitPressed: (
    model: CalculatorModel,
    event: CommittedEvent<"DigitPressed", { digit: Digits }>
  ) => {
    if (model.operator) {
      const right = (model.right || "").concat(event.data.digit || "");
      return { ...model, right };
    }
    const left = (model.left || "").concat(event.data.digit || "");
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

  // Command Handlers validate business rules and poduce events
  // eslint-disable-next-line
  onPressKey: async (model: CalculatorModel, data: { key: Keys }) => {
    if (data.key === SYMBOLS[0]) return [events.DotPressed()];
    if (data.key === SYMBOLS[1]) return [events.EqualsPressed()];
    return DIGITS.includes(data.key as Digits)
      ? [events.DigitPressed({ digit: data.key as Digits })]
      : [events.OperatorPressed({ operator: data.key as Operators })];
  },

  // eslint-disable-next-line
  onReset: async () => [events.Cleared()]
});