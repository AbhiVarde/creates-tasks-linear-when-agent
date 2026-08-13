import { Sandbox } from "@vercel/sandbox";
import { nanoid } from "nanoid";

export const runtime = "nodejs";
export const maxDuration = 120;

type FileBlock = { filename: string; content: string };

const AGENT_FILES: FileBlock[] = [{"filename":"agent/instructions.md","content":"# Linear Task Agent\nYou help the user create tasks in Linear.\n\nWhen the user asks to create a task, gather the required details such as title, description, team, and any labels or assignee. Then use the Linear connection to create the issue.\n\nIf the Linear tool fails, report the failure plainly in plain language. Never show raw error codes or stack traces."},{"filename":"agent/connections/linear.ts","content":"import { defineMcpClientConnection } from \"eve/connections\";\n\nexport default defineMcpClientConnection({\n  url: \"https://mcp.linear.app/mcp\",\n  description: \"Linear workspace: issues, teams, projects, and comments.\",\n  auth: {\n    getToken: async () => ({ token: process.env.LINEAR_API_TOKEN! }),\n  },\n});"}];

const OPEN_CHANNEL_AUTH = `import { eveChannel } from "eve/channels/eve";
import { none } from "eve/channels/auth";

export default eveChannel({ auth: [none()] });
`;

async function waitForServer(url: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.status < 500) return true;
    } catch {
      // sandbox not accepting connections yet, keep polling
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function getModelEnv() {
  const env: Record<string, string> = {};
  if (process.env.AI_GATEWAY_API_KEY) env.AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY;
  if (process.env.VERCEL_OIDC_TOKEN) env.VERCEL_OIDC_TOKEN = process.env.VERCEL_OIDC_TOKEN;
  if (process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (process.env.OPENAI_API_KEY) env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  return env;
}

function getConnectionEnvVars(files: FileBlock[]): string[] {
  const vars = new Set<string>();
  for (const f of files) {
    if (!f.filename.startsWith("agent/connections/")) continue;
    const matches = f.content.matchAll(/process.env.([A-Z0-9_]+)/g);
    for (const m of matches) vars.add(m[1]);
  }
  return [...vars];
}

function getDirectories(files: { filename: string }[]): string[] {
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.filename.split("/");
    parts.pop();
    if (parts.length > 0) dirs.add(parts.join("/"));
  }
  return [...dirs];
}

export async function POST() {
  const modelEnv = getModelEnv();

  if (Object.keys(modelEnv).length === 0) {
    return Response.json({
      ok: false,
      needsCredentials: true,
      error:
        "no model credentials set on this project. add AI_GATEWAY_API_KEY (or ANTHROPIC_API_KEY / OPENAI_API_KEY) in this project's vercel settings, then redeploy",
    });
  }

  const connectionVars = getConnectionEnvVars(AGENT_FILES);
  const missingConnectionEnv = connectionVars.filter((v) => !process.env[v]);

  if (missingConnectionEnv.length > 0) {
    return Response.json({
      ok: false,
      needsCredentials: true,
      error: `this agent connects to a real service and needs ${missingConnectionEnv.join(", ")} set on this project, then redeploy`,
    });
  }

  const connectionEnv = Object.fromEntries(
    connectionVars
      .filter((v) => process.env[v])
      .map((v) => [v, process.env[v]!]),
  );

  const sandboxName = `eve-agent-${nanoid(8)}`;
  let sandbox;

  try {
    sandbox = await Sandbox.create({
      name: sandboxName,
      runtime: "node24",
      timeout: 600_000,
      ports: [3000],
      env: { ...modelEnv, ...connectionEnv },
      persistent: false,
    });
  } catch (err) {
    console.error("sandbox create failed:", err);
    return Response.json({
      ok: false,
      error: "couldn't start your agent right now, try again in a moment",
    });
  }

  await Promise.all(
    [...getDirectories(AGENT_FILES), "agent/channels"].map((dir) =>
      sandbox.fs.mkdir(dir, { recursive: true }),
    ),
  );

  await sandbox.writeFiles([
    ...AGENT_FILES.map((f) => ({
      path: f.filename,
      content: Buffer.from(f.content),
    })),
    {
      path: "package.json",
      content: Buffer.from(
        JSON.stringify(
          { name: "deployed-eve-agent", private: true, type: "module", dependencies: { eve: "latest" } },
          null,
          2,
        ),
      ),
    },
    { path: "agent/channels/eve.ts", content: Buffer.from(OPEN_CHANNEL_AUTH) },
  ]);

  const install = await sandbox.runCommand({
    cmd: "npm",
    args: ["install", "--no-audit", "--no-fund"],
  });

  if (install.exitCode !== 0) {
    const err = await install.stderr();
    await sandbox.stop();
    return Response.json({ ok: false, error: `install failed: ${err}` });
  }

  await sandbox.runCommand({
    cmd: "npx",
    args: ["eve", "dev", "--no-ui", "--port", "3000"],
    detached: true,
  });

  const url = sandbox.domain(3000);
  const ready = await waitForServer(url, 45_000);

  if (!ready) {
    await sandbox.stop();
    return Response.json({ ok: false, error: "agent didn't start in time" });
  }

  return Response.json({ ok: true, sandboxName, url });
}
