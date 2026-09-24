import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FleetService } from "./fleet-service";
import { DEFAULT_MATE_DEFAULTS } from "./mate-defaults";

describe("mate defaults RPC backing (P-U10)", () => {
  it("reads and writes normalized defaults via plugin KV", async () => {
    const kv = new Map<string, unknown>();
    const fleet = new FleetService(
      {
        storage: {
          kv: {
            get: async <T>(key: string) => (kv.get(key) as T | undefined) ?? null,
            set: async (key: string, value: unknown) => {
              kv.set(key, value);
            },
          },
        },
        log: { warn: () => {} },
        realtime: { publish: () => {} },
      } as never,
      { getHome: () => undefined } as never,
    );

    assert.deepEqual(await fleet.readMateDefaults(), DEFAULT_MATE_DEFAULTS);
    await fleet.writeMateDefaults({
      providerId: "openai",
      model: "gpt-test",
    });
    assert.deepEqual(await fleet.readMateDefaults(), {
      providerId: "openai",
      model: "gpt-test",
    });
  });
});
