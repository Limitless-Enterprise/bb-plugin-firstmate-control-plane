import { useEffect, useState } from "react";
import {
  experimental_ProviderModelPicker as ProviderModelPicker,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import { DEFAULT_MATE_DEFAULTS } from "../lib/mate-defaults";

export function FleetSettingsSection() {
  const rpc = useRpc<typeof rpcContract>();
  const [providerId, setProviderId] = useState(DEFAULT_MATE_DEFAULTS.providerId);
  const [model, setModel] = useState(DEFAULT_MATE_DEFAULTS.model);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpc
      .call("getMateDefaults", null)
      .then((result) => {
        setProviderId(result.providerId);
        setModel(result.model);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setLoading(false));
  }, [rpc]);

  const save = (next: { providerId: string; model: string }) => {
    setProviderId(next.providerId);
    setModel(next.model);
    setError(null);
    rpc.call("setMateDefaults", next).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">Loading mate defaults…</p>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div>
        <p className="text-sm font-medium text-foreground">New mate threads</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Default provider and model when Fleet creates a mate home thread.
        </p>
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">{error}</p>
      ) : null}
      <ProviderModelPicker
        value={{
          providerId,
          model,
          reasoningLevel: "medium",
        }}
        onChange={(value) =>
          save({ providerId: value.providerId, model: value.model })
        }
        align="start"
      />
    </section>
  );
}
