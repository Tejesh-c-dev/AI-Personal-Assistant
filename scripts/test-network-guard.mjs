import { isIP } from "node:net";
import net from "node:net";
import dgram from "node:dgram";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";

const nativeFetch = globalThis.fetch;

const OPENROUTER_HOST = "openrouter.ai";

function isLoopbackHost(value) {
  const hostname = String(value ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  return hostname === "localhost" || hostname === "::1" || (isIP(hostname) === 4 && hostname.startsWith("127."));
}

function isAllowedDnsName(value) {
  const hostname = String(value ?? "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return hostname === OPENROUTER_HOST || isLoopbackHost(hostname);
}

function isAllowedFetchUrl(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  if (isLoopbackHost(url.hostname)) return url.protocol === "http:" && !url.username && !url.password;
  return url.protocol === "https:" && url.hostname.toLowerCase() === OPENROUTER_HOST
    && (url.port === "" || url.port === "443") && !url.username && !url.password;
}

globalThis.fetch = async (input, init) => {
  const target = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
  if (!isAllowedFetchUrl(target)) throw new Error("The live integration test blocks this network destination.");
  const destination = new URL(target);
  const isOpenRouter = destination.hostname.toLowerCase() === OPENROUTER_HOST;
  if (isOpenRouter) {
    let body;
    try { body = JSON.parse(String(init?.body ?? "")); } catch { throw new Error("The live integration test blocks invalid OpenRouter requests."); }
    const provider = body?.provider;
    if (destination.pathname !== "/api/v1/chat/completions"
      || init?.method !== "POST"
      || body?.model !== process.env.OPENROUTER_MODEL
      || provider?.zdr !== true
      || provider?.data_collection !== "deny"
      || provider?.require_parameters !== true
      || provider?.allow_fallbacks !== false) {
      throw new Error("The live integration test blocks OpenRouter requests that do not match the required model and privacy settings.");
    }
  }
  if (isOpenRouter && init?.redirect && init.redirect !== "manual") {
    throw new Error("The live integration test blocks redirects to unapproved network destinations.");
  }
  return nativeFetch(input, isOpenRouter ? { ...init, redirect: "manual" } : init);
};

const nativeConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  let host;
  let port;
  if (typeof args[0] === "number") {
    port = args[0];
    host = typeof args[1] === "string" ? args[1] : "localhost";
  } else if (args[0] && typeof args[0] === "object") {
    const options = Array.isArray(args[0]) ? args[0][0] : args[0];
    port = options?.port;
    host = options?.host ?? options?.hostname ?? "localhost";
  }
  const normalizedHost = String(host ?? "").toLowerCase().replace(/^\[|\]$/g, "");
  const numericPort = Number(port);
  const allowedLoopback = isLoopbackHost(normalizedHost);
  const allowedOpenRouter = normalizedHost === OPENROUTER_HOST && numericPort === 443;
  if ((!allowedLoopback && !allowedOpenRouter) || !Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    throw new Error("The live integration test blocks this socket destination.");
  }
  return nativeConnect.apply(this, args);
};

const nativeDatagramConnect = dgram.Socket.prototype.connect;
const nativeDatagramSend = dgram.Socket.prototype.send;
const datagramDestinations = new WeakMap();
dgram.Socket.prototype.connect = function guardedDatagramConnect(port, address, ...args) {
  if (!isLoopbackHost(address)) throw new Error("The live integration test blocks this datagram destination.");
  datagramDestinations.set(this, address);
  return nativeDatagramConnect.call(this, port, address, ...args);
};
dgram.Socket.prototype.send = function guardedDatagramSend(...args) {
  const address = typeof args[4] === "string" ? args[4]
    : typeof args[2] === "string" ? args[2]
      : datagramDestinations.get(this);
  if (!isLoopbackHost(address)) throw new Error("The live integration test blocks this datagram destination.");
  return nativeDatagramSend.apply(this, args);
};

const nativeDnsLookup = dns.lookup;
dns.lookup = function guardedDnsLookup(hostname, ...args) {
  if (!isAllowedDnsName(hostname)) throw new Error("The live integration test blocks this DNS destination.");
  return nativeDnsLookup.call(this, hostname, ...args);
};
const nativeDnsPromiseLookup = dns.promises.lookup;
dns.promises.lookup = function guardedDnsPromiseLookup(hostname, ...args) {
  if (!isAllowedDnsName(hostname)) throw new Error("The live integration test blocks this DNS destination.");
  return nativeDnsPromiseLookup.call(this, hostname, ...args);
};

for (const resolverPrototype of new Set([dns.Resolver.prototype, dnsPromises.Resolver.prototype])) {
  for (const method of ["resolve", "resolve4", "resolve6", "resolveAny", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolveSoa", "resolveSrv", "resolveTxt"]) {
    const nativeResolve = resolverPrototype[method];
    if (typeof nativeResolve !== "function") continue;
    resolverPrototype[method] = function guardedDnsResolve(hostname, ...args) {
      if (!isAllowedDnsName(hostname)) throw new Error("The live integration test blocks this DNS destination.");
      return nativeResolve.call(this, hostname, ...args);
    };
  }
  const nativeReverse = resolverPrototype.reverse;
  if (typeof nativeReverse === "function") {
    resolverPrototype.reverse = function guardedDnsReverse(address, ...args) {
      if (!isLoopbackHost(address)) throw new Error("The live integration test blocks this DNS destination.");
      return nativeReverse.call(this, address, ...args);
    };
  }
}

const nativeDnsLookupService = dns.lookupService;
dns.lookupService = function guardedDnsLookupService(address, ...args) {
  if (!isLoopbackHost(address)) throw new Error("The live integration test blocks this DNS destination.");
  return nativeDnsLookupService.call(this, address, ...args);
};
