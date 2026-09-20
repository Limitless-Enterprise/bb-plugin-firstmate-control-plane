import { type BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contract";
import { FleetStore, migrations } from "./lib/db";
import { FLEET_CHANGED, FleetService } from "./lib/fleet-service";
import { projectFsm } from "./lib/fsm";

export type { rpcContract };

function parseCliFlags(argv: string[]): {
  positional: string[];
  flags: Map<string, string | boolean>;
} {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(key, next);
      i++;
    } else {
      flags.set(key, true);
    }
  }
  return { positional, flags };
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("firstmate-control-plane: loading");

  const settings = bb.settings.define({
    probeIntervalSec: {
      type: "string",
      label: "Liveness probe interval (seconds)",
      default: "60",
    },
    autoRespawn: {
      type: "boolean",
      label: "Auto-respawn on proven dead/missing (never ambiguous)",
      default: false,
    },
    busyAgeSec: {
      type: "string",
      label: "Busy-age stall threshold (seconds)",
      default: "900",
    },
    cosThreadId: {
      type: "string",
      label: "CoS thread id for digest delivery (optional)",
      default: "",
    },
    firstmateRepoUrl: {
      type: "string",
      label: "Firstmate git repository URL (cloned for each new mate home)",
      default: "https://github.com/kunchenguid/firstmate.git",
    },
    defaultParentDir: {
      type: "string",
      label: "Default parent directory for new mate home checkouts",
      default: "/workspace/Codes",
    },
  });

  const db = bb.storage.database();
  bb.storage.migrate(db, migrations);
  const store = new FleetStore(db);

  const getFleetConfig = async () => {
    const values = await settings.get();
    const firstmateRepoUrl = values.firstmateRepoUrl.trim();
    const defaultParentDir = values.defaultParentDir.trim();
    return {
      firstmateRepoUrl:
        firstmateRepoUrl || "https://github.com/kunchenguid/firstmate.git",
      defaultParentDir: defaultParentDir || "/workspace/Codes",
    };
  };

  const fleet = new FleetService(bb, store, await getFleetConfig());

  const getConfig = async () => {
    const values = await settings.get();
    const probeIntervalSec = Math.max(
      15,
      Number.parseInt(values.probeIntervalSec, 10) || 60,
    );
    const busyAgeSec = Math.max(
      60,
      Number.parseInt(values.busyAgeSec, 10) || 900,
    );
    return {
      probeIntervalMs: probeIntervalSec * 1000,
      autoRespawn: values.autoRespawn,
      busyAgeSec,
      cosThreadId: values.cosThreadId.trim() || null,
    };
  };

  const resolveHomeId = (homeId?: string | null): string => {
    const id = homeId ?? store.getSelectedHomeId();
    if (!id) throw new Error("No mate home selected. Run bb fleet home create.");
    fleet.assertHome(id);
    return id;
  };

  bb.rpc.register(rpcContract, {
    listHomes: () => ({
      homes: store.listHomes(),
      selectedHomeId: store.getSelectedHomeId(),
    }),
    selectHome: (input) => {
      fleet.assertHome(input.homeId);
      store.setSelectedHomeId(input.homeId);
      fleet.publish();
      return null;
    },
    registerHome: (input) => fleet.registerHome(input),
    createHome: (input) => fleet.createHome(input),
    createHomeWithMateThread: (input) => fleet.createHomeWithMateThread(input),
    getHomeCreateDefaults: async () => {
      const config = await getFleetConfig();
      return {
        defaultParentDir: config.defaultParentDir,
        firstmateRepoUrl: config.firstmateRepoUrl,
      };
    },
    getMateDefaults: async () => await fleet.readMateDefaults(),
    setMateDefaults: async (input) => await fleet.writeMateDefaults(input),
    previewHomeCheckout: async (input) =>
      await fleet.previewHomeCheckout(input),
    updateHome: (input) => fleet.updateHome(input.homeId, input),
    deleteHome: (input) => {
      fleet.deleteHome(input.homeId);
      return { deleted: true };
    },
    listThreadCandidates: async (input) => ({
      threads: await fleet.listThreadCandidates(input?.limit ?? 40),
    }),
    pickCheckoutFolder: async (input) =>
      await fleet.pickCheckoutFolder(input.clientHostId ?? undefined),
    browseHostDirectory: async (input) =>
      await fleet.browseHostDirectory(input.path),
    getTree: (input) => ({
      tree: fleet.buildTree(input.homeId),
    }),
    listNodes: (input) => ({
      nodes: store.listNodes(input.homeId),
    }),
    attachCrew: (input) => fleet.attachCrew(input),
    createSecondmate: (input) => fleet.createSecondmate(input),
    spawnCrew: (input) => fleet.spawnCrew(input),
    markThread: (input) => {
      fleet.markThread(input.homeId, input.threadId, input.state, input.detail ?? undefined);
      return null;
    },
    steer: async (input) => {
      await fleet.steer(input.homeId, input.threadId, input.text);
      return null;
    },
    interrupt: async (input) => {
      await fleet.interrupt(input.homeId, input.threadId);
      return null;
    },
    exitThread: async (input) => {
      await fleet.exitThread(input.homeId, input.threadId);
      return null;
    },
    listProfiles: (input) => ({
      profiles: store.listProfiles(input.homeId),
    }),
    upsertProfile: (input) =>
      store.upsertProfile({
        id: input.id,
        homeId: input.homeId,
        label: input.label,
        providerId: input.providerId ?? null,
        model: input.model ?? null,
        effort: input.effort ?? null,
        taskClasses: input.taskClasses ?? [],
      }),
    listWakes: (input) => ({
      wakes: store.listWakes(input.homeId, input.acked),
    }),
    ackWake: (input) => {
      fleet.assertHome(input.homeId);
      store.ackWake(input.id);
      fleet.publish();
      return null;
    },
    openHold: (input) => fleet.openHold(input),
    resolveHold: (input) => {
      fleet.resolveHold(input.homeId, input.holdId);
      return null;
    },
    listHolds: (input) => ({
      holds: store.listHolds(input.homeId, input.state),
    }),
    listInbox: (input) => ({
      items: store.listInbox(input.homeId, input.state),
    }),
    snoozeInbox: (input) => {
      fleet.assertHome(input.homeId);
      store.snoozeInbox(input.id, input.untilMs);
      fleet.publish();
      return null;
    },
    resolveInbox: (input) => {
      fleet.assertHome(input.homeId);
      store.resolveInbox(input.id);
      fleet.publish();
      return null;
    },
    probe: async (input) => ({
      verdict: await fleet.probeThread(input.threadId),
    }),
    probeHome: async (input) => {
      const nodes = store.listNodes(input.homeId);
      const results = await Promise.all(
        nodes.map(async (node) => ({
          threadId: node.threadId,
          verdict: await fleet.probeThread(node.threadId),
        })),
      );
      fleet.publish();
      return { results };
    },
    digest: (input) => fleet.buildDigest(input.homeId),
    status: (input) => {
      const homeId = input.homeId ?? store.getSelectedHomeId();
      const homes = store.listHomes();
      if (!homeId) {
        return {
          homes,
          selectedHomeId: null,
          openInbox: store.countOpenInbox(),
          tree: [],
        };
      }
      return {
        homes,
        selectedHomeId: homeId,
        openInbox: store.countOpenInbox(homeId),
        tree: fleet.buildTree(homeId),
      };
    },
    inboxBadge: () => ({ count: store.countOpenInbox() }),
  });

  bb.events.on("thread.idle", async (event) => {
    const threadId = event.thread.id;
    const node = store.getNodeByThread(threadId);
    if (!node) return;
    store.appendLedger({
      homeId: node.homeId,
      threadId,
      verb: "turn.end",
      fsmState: projectFsm(store.tailLedger(threadId, 50).reverse()),
    });
    fleet.publish();
  });

  bb.events.on("turn.failed", async (event) => {
    const threadId = event.threadId;
    const node = store.getNodeByThread(threadId);
    if (!node) return;
    store.appendLedger({
      homeId: node.homeId,
      threadId,
      verb: "turn.failed",
      fsmState: "error",
    });
    store.enqueueWake({
      homeId: node.homeId,
      threadId,
      targetMateId: store.getHome(node.homeId)?.primaryMateId ?? null,
      reason: "turn.failed",
      priority: 8,
      dedupeKey: `turn.failed:${threadId}`,
    });
    store.createInboxItem({
      homeId: node.homeId,
      threadId,
      kind: "wake",
      urgency: "high",
      title: "Turn failed",
      body: `Thread ${threadId} failed a turn.`,
    });
    fleet.publish();
  });

  bb.background.service("fleet-supervisor", {
    async start(signal) {
      while (!signal.aborted) {
        const config = await getConfig();
        const homes = store.listHomes();
        for (const home of homes) {
          const nodes = store.listNodes(home.homeId);
          for (const node of nodes) {
            const verdict = await fleet.probeThread(node.threadId);
            if (verdict === "dead" || verdict === "missing") {
              store.createInboxItem({
                homeId: home.homeId,
                threadId: node.threadId,
                kind: "liveness",
                urgency: "high",
                title: `${node.label} ${verdict}`,
                body: `Liveness probe returned ${verdict}.`,
              });
              if (config.autoRespawn) {
                store.enqueueWake({
                  homeId: home.homeId,
                  threadId: home.mateThreadId,
                  targetMateId: home.primaryMateId,
                  reason: `liveness.${verdict}:${node.threadId}`,
                  priority: 9,
                  dedupeKey: `liveness:${node.threadId}`,
                });
              }
            }
            const entries = store.tailLedger(node.threadId, 20);
            const lastWorking = entries.find((e) => e.verb === "mark.working");
            if (
              lastWorking &&
              Date.now() - lastWorking.createdAtMs > config.busyAgeSec * 1000
            ) {
              store.enqueueWake({
                homeId: home.homeId,
                threadId: home.mateThreadId,
                targetMateId: home.primaryMateId,
                reason: `stall:${node.threadId}`,
                priority: 4,
                dedupeKey: `stall:${node.threadId}`,
              });
            }
          }
        }
        fleet.publish();
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, config.probeIntervalMs);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
    },
  });

  const usage = [
    "Usage:",
    "  bb fleet status [--mate <homeId>] [--json]",
    "  bb fleet home bootstrap <homeId> --label <name> [--parent <dir>]",
    "  bb fleet home create <homeId> --label <name> --thread <threadId> [--parent <dir>] [--checkout <path>]",
    "  bb fleet home list [--json]",
    "  bb fleet home select <homeId>",
    "  bb fleet tree [--mate <homeId>] [--json]",
    "  bb fleet crew attach --mate <homeId> --thread <id> --label <name> --role ship|scout",
    "  bb fleet secondmate create --mate <homeId> --thread <id> --label <name>",
    "  bb fleet spawn --mate <homeId> --role ship|scout --label <name> --prompt <text>",
    "  bb fleet mark --mate <homeId> --thread <id> --state <fsm>",
    "  bb fleet steer --mate <homeId> --thread <id> --text <message>",
    "  bb fleet interrupt|exit --mate <homeId> --thread <id>",
    "  bb fleet hold open|resolve ...",
    "  bb fleet inbox [--mate <homeId>] [--json]",
    "  bb fleet inbox snooze|resolve <id> [--mate <homeId>]",
    "  bb fleet probe [--mate <homeId>] [--thread <id>]",
    "  bb fleet digest [--mate <homeId>] [--tell-cos] [--json]",
    "  bb fleet profiles --mate <homeId>",
    "  bb fleet integration apply [--mate <homeId>]",
    "  bb fleet integration check [--mate <homeId>] [--json]",
  ].join("\n");

  bb.cli.register({
    name: "fleet",
    summary: "Firstmate Fleet control plane",
    commands: [
      { name: "status", summary: "Fleet status", usage: "bb fleet status" },
      { name: "home", summary: "Mate home management", usage: "bb fleet home ..." },
      { name: "tree", summary: "Fleet tree", usage: "bb fleet tree" },
      { name: "crew", summary: "Crew registry", usage: "bb fleet crew ..." },
      { name: "secondmate", summary: "Lead secondmate", usage: "bb fleet secondmate ..." },
      { name: "spawn", summary: "Spawn crew thread", usage: "bb fleet spawn ..." },
      { name: "mark", summary: "Mark FSM state", usage: "bb fleet mark ..." },
      { name: "steer", summary: "Data-plane steer", usage: "bb fleet steer ..." },
      { name: "interrupt", summary: "Interrupt thread", usage: "bb fleet interrupt ..." },
      { name: "exit", summary: "Exit thread", usage: "bb fleet exit ..." },
      { name: "hold", summary: "Holds", usage: "bb fleet hold ..." },
      { name: "inbox", summary: "Fleet inbox", usage: "bb fleet inbox ..." },
      { name: "probe", summary: "Liveness probe", usage: "bb fleet probe ..." },
      { name: "digest", summary: "CoS digest", usage: "bb fleet digest ..." },
      { name: "profiles", summary: "Dispatch profiles", usage: "bb fleet profiles ..." },
      { name: "integration", summary: "Firstmate BB overlay", usage: "bb fleet integration ..." },
    ],
    async run(argv) {
      const json = argv.includes("--json");
      const filtered = argv.filter((arg) => arg !== "--json");
      const { positional, flags } = parseCliFlags(filtered);
      const reply = (value: unknown, text: string) => ({
        exitCode: 0,
        stdout: json ? JSON.stringify(value, null, 2) : text,
      });
      const mateFlag = flags.get("mate");
      const homeId = () =>
        resolveHomeId(
          typeof mateFlag === "string" ? mateFlag : store.getSelectedHomeId(),
        );

      const [command, sub, ...rest] = positional;
      try {
        switch (command) {
          case undefined:
          case "help":
          case "--help":
            return { exitCode: 0, stdout: usage };
          case "status": {
            const id = flags.has("mate") ? homeId() : store.getSelectedHomeId();
            if (id) {
              const digest = fleet.buildDigest(id);
              return reply(digest, digest.summary);
            }
            const homes = store.listHomes();
            return reply(
              { homes, selectedHomeId: null },
              `Homes: ${homes.map((h) => h.homeId).join(", ") || "none"}`,
            );
          }
          case "home": {
            if (sub === "list") {
              const homes = store.listHomes();
              return reply(
                homes,
                homes.length
                  ? homes.map((h) => `${h.homeId}\t${h.label}`).join("\n")
                  : "No mate homes.",
              );
            }
            if (sub === "select") {
              const id = rest[0];
              if (!id) return { exitCode: 1, stderr: "Usage: bb fleet home select <homeId>" };
              fleet.assertHome(id);
              store.setSelectedHomeId(id);
              fleet.publish();
              return reply({ selectedHomeId: id }, `Selected ${id}`);
            }
            if (sub === "bootstrap") {
              const id = rest[0];
              const label = flags.get("label");
              const parentFlag = flags.get("parent");
              const parent =
                typeof parentFlag === "string" ? parentFlag : undefined;
              if (!id || typeof label !== "string") {
                return {
                  exitCode: 1,
                  stderr:
                    "Usage: bb fleet home bootstrap <homeId> --label <name> [--parent <dir>]",
                };
              }
              const home = await fleet.createHomeWithMateThread({
                homeId: id,
                label,
                parentDir: parent,
              });
              return reply(
                home,
                `Bootstrapped home ${home.homeId} at ${home.checkoutPath}`,
              );
            }
            if (sub === "create") {
              const id = rest[0];
              const label = flags.get("label");
              const checkoutFlag = flags.get("checkout");
              const checkout =
                typeof checkoutFlag === "string" ? checkoutFlag : undefined;
              const parentFlag = flags.get("parent");
              const parent =
                typeof parentFlag === "string" ? parentFlag : undefined;
              const thread = flags.get("thread");
              if (!id || typeof label !== "string" || typeof thread !== "string") {
                return {
                  exitCode: 1,
                  stderr:
                    "Usage: bb fleet home create <homeId> --label <name> --thread <threadId> [--parent <dir>] [--checkout <path>]",
                };
              }
              const home = await fleet.createHome({
                homeId: id,
                label,
                parentDir: parent,
                checkoutPath: checkout,
                mateThreadId: thread,
              });
              return reply(home, `Registered home ${home.homeId}`);
            }
            break;
          }
          case "tree": {
            const id = homeId();
            const tree = fleet.buildTree(id);
            return reply({ tree }, JSON.stringify(tree, null, 2));
          }
          case "crew": {
            if (sub === "attach") {
              const thread = flags.get("thread");
              const label = flags.get("label");
              const role = flags.get("role");
              if (
                typeof thread !== "string" ||
                typeof label !== "string" ||
                (role !== "ship" && role !== "scout")
              ) {
                return { exitCode: 1, stderr: "Missing --thread --label --role" };
              }
              const node = fleet.attachCrew({
                homeId: homeId(),
                threadId: thread,
                label,
                role,
              });
              return reply(node, `Attached crew ${node.id}`);
            }
            break;
          }
          case "secondmate": {
            if (sub === "create") {
              const thread = flags.get("thread");
              const label = flags.get("label");
              if (typeof thread !== "string" || typeof label !== "string") {
                return { exitCode: 1, stderr: "Missing --thread --label" };
              }
              const node = fleet.createSecondmate({
                homeId: homeId(),
                threadId: thread,
                label,
              });
              return reply(node, `Created secondmate ${node.id}`);
            }
            break;
          }
          case "spawn": {
            const label = flags.get("label");
            const role = flags.get("role");
            const prompt = flags.get("prompt");
            if (
              typeof label !== "string" ||
              (role !== "ship" && role !== "scout") ||
              typeof prompt !== "string"
            ) {
              return { exitCode: 1, stderr: "Missing --label --role --prompt" };
            }
            const node = await fleet.spawnCrew({
              homeId: homeId(),
              label,
              role,
              prompt,
            });
            return reply(node, `Spawned ${role} ${node.threadId}`);
          }
          case "mark": {
            const thread = flags.get("thread");
            const state = flags.get("state");
            if (typeof thread !== "string" || typeof state !== "string") {
              return { exitCode: 1, stderr: "Missing --thread --state" };
            }
            fleet.markThread(homeId(), thread, state as Parameters<typeof fleet.markThread>[2]);
            return reply(null, `Marked ${thread} as ${state}`);
          }
          case "steer": {
            const thread = flags.get("thread");
            const text = flags.get("text");
            if (typeof thread !== "string" || typeof text !== "string") {
              return { exitCode: 1, stderr: "Missing --thread --text" };
            }
            await fleet.steer(homeId(), thread, text);
            return reply(null, `Steered ${thread}`);
          }
          case "interrupt":
          case "exit": {
            const thread = flags.get("thread");
            if (typeof thread !== "string") {
              return { exitCode: 1, stderr: "Missing --thread" };
            }
            if (command === "interrupt") await fleet.interrupt(homeId(), thread);
            else await fleet.exitThread(homeId(), thread);
            return reply(null, `${command} ${thread}`);
          }
          case "hold": {
            const id = homeId();
            if (sub === "open") {
              const thread = flags.get("thread");
              const title = flags.get("title");
              const body = flags.get("body");
              const mate = flags.get("mate-id") ?? store.getHome(id)?.primaryMateId;
              if (
                typeof thread !== "string" ||
                typeof title !== "string" ||
                typeof body !== "string" ||
                typeof mate !== "string"
              ) {
                return { exitCode: 1, stderr: "Missing hold fields" };
              }
              const hold = fleet.openHold({
                homeId: id,
                mateId: mate,
                threadId: thread,
                title,
                body,
              });
              return reply(hold, `Opened hold ${hold.id}`);
            }
            if (sub === "resolve") {
              const holdId = rest[0];
              if (!holdId) return { exitCode: 1, stderr: "Usage: bb fleet hold resolve <id>" };
              fleet.resolveHold(id, holdId);
              return reply(null, `Resolved hold ${holdId}`);
            }
            break;
          }
          case "inbox": {
            const id = flags.has("mate") ? homeId() : store.getSelectedHomeId();
            if (!id) return { exitCode: 1, stderr: "No home selected" };
            if (sub === "snooze") {
              const itemId = rest[0];
              const hours = Number(flags.get("hours") ?? "1");
              if (!itemId) return { exitCode: 1, stderr: "Missing inbox id" };
              store.snoozeInbox(itemId, Date.now() + hours * 3600_000);
              fleet.publish();
              return reply(null, `Snoozed ${itemId}`);
            }
            if (sub === "resolve") {
              const itemId = rest[0];
              if (!itemId) return { exitCode: 1, stderr: "Missing inbox id" };
              store.resolveInbox(itemId);
              fleet.publish();
              return reply(null, `Resolved ${itemId}`);
            }
            const items = store.listInbox(id, "open");
            return reply(
              items,
              items.length
                ? items.map((item) => `${item.id}\t${item.title}`).join("\n")
                : "Inbox empty.",
            );
          }
          case "probe": {
            const thread = flags.get("thread");
            if (typeof thread === "string") {
              const verdict = await fleet.probeThread(thread);
              return reply({ verdict }, verdict);
            }
            const id = homeId();
            const nodes = store.listNodes(id);
            const results = await Promise.all(
              nodes.map(async (node) => ({
                threadId: node.threadId,
                label: node.label,
                verdict: await fleet.probeThread(node.threadId),
              })),
            );
            return reply(
              results,
              results.map((r) => `${r.label}\t${r.verdict}`).join("\n"),
            );
          }
          case "digest": {
            const id = homeId();
            const digest = fleet.buildDigest(id);
            if (flags.has("tell-cos")) {
              const config = await getConfig();
              if (config.cosThreadId) {
                await bb.sdk.threads.send({
                  threadId: config.cosThreadId,
                  mode: "auto",
                  input: [
                    {
                      type: "text",
                      text: digest.summary,
                      mentions: [],
                    },
                  ],
                });
              }
            }
            return reply(digest, digest.summary);
          }
          case "profiles": {
            const profiles = store.listProfiles(homeId());
            return reply(
              profiles,
              profiles.map((p) => `${p.id}\t${p.label}`).join("\n") || "No profiles.",
            );
          }
          case "integration": {
            const id = homeId();
            const home = store.getHome(id);
            if (!home) {
              return { exitCode: 1, stderr: `Unknown mate home "${id}".` };
            }
            if (sub === "check") {
              const result = await fleet.checkBbIntegration({
                checkoutPath: home.checkoutPath,
                mateThreadId: home.mateThreadId,
              });
              return reply(
                result,
                result.ok
                  ? "BB integration overlay OK."
                  : `BB integration issues:\n- ${result.issues.join("\n- ")}`,
              );
            }
            if (sub === "apply" || sub === undefined) {
              const applied = await fleet.ensureBbIntegration({
                homeId: id,
                mateThreadId: home.mateThreadId,
                checkoutPath: home.checkoutPath,
              });
              return reply(
                applied,
                `Applied BB integration v${applied.integrationVersion} to ${applied.checkoutPath}`,
              );
            }
            return {
              exitCode: 1,
              stderr: "Usage: bb fleet integration apply|check [--mate <homeId>]",
            };
          }
        }
      } catch (error) {
        return { exitCode: 1, stderr: String(error) };
      }
      return { exitCode: 1, stderr: usage };
    },
  });

  bb.onDispose(() => {
    bb.log.info("firstmate-control-plane: disposed");
  });
}
