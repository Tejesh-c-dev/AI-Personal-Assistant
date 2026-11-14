import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const composeFile = resolve("compose.test.yaml");
const expectedDatabase = "ai_personal_assistant_test";
const expectedRole = "postgres";

function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) {
    throw new Error("Could not verify the dedicated test PostgreSQL Compose container.");
  }
  return result.stdout.trim();
}

function isLoopbackHost(host) {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

export function inspectTestContainer() {
  const containerId = docker(["compose", "-f", composeFile, "ps", "-q", "postgres-test"]);
  if (!containerId) throw new Error("The dedicated postgres-test Compose service is not running.");
  const inspected = JSON.parse(docker(["inspect", containerId]))[0];
  const labels = inspected?.Config?.Labels ?? {};
  const configFiles = (labels["com.docker.compose.project.config_files"] ?? "").split(",").map((item) => resolve(item.trim()));
  const service = labels["com.docker.compose.service"];
  const project = labels["com.docker.compose.project"];
  if (!project || service !== "postgres-test" || !configFiles.some((file) => file.toLowerCase() === composeFile.toLowerCase())) {
    throw new Error("The running PostgreSQL container is not the postgres-test service from compose.test.yaml.");
  }
  if (inspected.State?.Running !== true || inspected.State?.Health?.Status !== "healthy") {
    throw new Error("The dedicated postgres-test Compose container is not running and healthy.");
  }
  const bindings = inspected.NetworkSettings?.Ports?.["5432/tcp"] ?? [];
  if (bindings.length !== 1 || bindings[0].HostIp !== "127.0.0.1" || bindings[0].HostPort !== "55432") {
    throw new Error("PostgreSQL is not published exclusively on the required 127.0.0.1:55432 binding.");
  }
  const networkIps = Object.values(inspected.NetworkSettings?.Networks ?? {}).map((network) => network.IPAddress).filter(Boolean);
  if (networkIps.length === 0) throw new Error("The dedicated PostgreSQL container has no inspectable internal network IP.");
  return { containerId, project, service, networkIps };
}

export function validateTestUrl(raw) {
  if (!raw) throw new Error("TEST_DATABASE_URL_UNPOOLED is required.");
  let url;
  try { url = new URL(raw); } catch { throw new Error("TEST_DATABASE_URL_UNPOOLED is invalid."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("TEST_DATABASE_URL_UNPOOLED must use PostgreSQL.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!isLoopbackHost(host)) throw new Error("The test database host must be loopback.");
  if (url.port !== "55432") throw new Error("The test database port must be 55432.");
  if (decodeURIComponent(url.pathname.slice(1)) !== expectedDatabase) throw new Error(`The test database name must be ${expectedDatabase}.`);
  return url;
}

export async function verifyTestDatabase(client, raw, container = inspectTestContainer()) {
  const url = validateTestUrl(raw);
  const identity = (await client.query("select current_database() as database, current_user as role, host(inet_server_addr()) as address")).rows[0];
  if (identity.database !== expectedDatabase || identity.role !== expectedRole || !container.networkIps.includes(identity.address)) {
    throw new Error("Connected PostgreSQL identity does not match the healthy dedicated Compose test container.");
  }
  return { host: url.hostname, port: Number(url.port), database: identity.database, role: identity.role, address: identity.address, ...container };
}
