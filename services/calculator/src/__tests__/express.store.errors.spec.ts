import { app, dispose, store, ValidationError } from "@rotorsoft/eventually";
import { ExpressApp, tester } from "@rotorsoft/eventually-express";
import { Calculator } from "@rotorsoft/calculator-artifacts";

const port = 4002;
const t = tester(port);

const exapp = app(new ExpressApp()).with(Calculator);

jest.spyOn(store(), "query").mockRejectedValue(new Error("store query error"));
jest.spyOn(store(), "stats").mockRejectedValue(new Error("store stats error"));

describe("express app", () => {
  beforeAll(async () => {
    const express = exapp.build();
    express.get("/query", () => {
      throw new ValidationError(["express query error"]);
    });
    await exapp.listen(false, port);
  });

  afterAll(async () => {
    await dispose()();
  });

  describe("errors", () => {
    it("should throw internal error on stream", async () => {
      await expect(t.get("/all")).rejects.toThrowError();
    });

    it("should throw internal error on aggregate", async () => {
      await expect(t.get("/calculator/test")).rejects.toThrowError("500");
    });

    it("should throw internal error on stats", async () => {
      await expect(t.get("/stats")).rejects.toThrowError("500");
    });

    it("should throw validation error", async () => {
      await expect(t.get("/query")).rejects.toThrowError("400");
    });
  });
});
