#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import crypto from "node:crypto";
import { fileURLToPath, URL } from "node:url";

import { buildActionSummary, toPlainText } from "../src/ui/summary.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RUN_DIR = path.join(ROOT, "run");
const DATA_DIR = path.join(ROOT, "src", "data");

const LATEST_PATH = path.join(DATA_DIR, "latest.seed.json");
const PERF_SUMMARY_PATH = path.join(RUN_DIR, "perf_summary.json");
const DAILY_STATUS_PATH = path.join(RUN_DIR, "daily_status.json");
const ITERATION_DIR = path.join(RUN_DIR, "iteration");
const DISCORD_STATUS_PATH = path.join(RUN_DIR, "discord_status.json");
const ENV_PATH = path.join(ROOT, ".env");

function localDateKey(date = new Date()) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseArgs(argv) {
  const args = {
    type: "daily",
    date: localDateKey(),
    baseUrl: process.env.DASHBOARD_PUBLIC_URL || "https://etha.mytagclash001.help",
    force: false,
    key: "",
    title: "",
    reason: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--type") args.type = argv[++i] || args.type;
    else if (token === "--date") args.date = argv[++i] || args.date;
    else if (token === "--base-url") args.baseUrl = argv[++i] || args.baseUrl;
    else if (token === "--force") args.force = true;
    else if (token === "--key") args.key = argv[++i] || args.key;
    else if (token === "--title") args.title = argv[++i] || args.title;
    else if (token === "--reason") args.reason = argv[++i] || args.reason;
  }
  if (!/^(daily|alert)$/.test(args.type)) {
    throw new Error(`invalid --type: ${args.type}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
    throw new Error(`invalid --date: ${args.date}`);
  }
  return args;
}

function readJson(pathname, fallback = null) {
  if (!fs.existsSync(pathname)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(pathname, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(pathname, payload) {
  fs.mkdirSync(path.dirname(pathname), { recursive: true });
  const tempPath = `${pathname}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf-8");
  fs.renameSync(tempPath, pathname);
}

function loadEnv(pathname) {
  if (!fs.existsSync(pathname)) return {};
  const lines = fs.readFileSync(pathname, "utf-8").split(/\r?\n/);
  const output = {};
  for (const line of lines) {
    const text = String(line || "").trim();
    if (!text || text.startsWith("#") || !text.includes("=")) continue;
    const idx = text.indexOf("=");
    const key = text.slice(0, idx).trim();
    const value = text.slice(idx + 1).trim();
    if (!key) continue;
    output[key] = value;
  }
  return output;
}

function sha1(text) {
  return crypto.createHash("sha1").update(String(text || ""), "utf-8").digest("hex");
}

function pickLatestIteration(date) {
  const specific = path.join(ITERATION_DIR, `${date}.md`);
  if (fs.existsSync(specific)) return { path: specific, text: fs.readFileSync(specific, "utf-8") };
  if (!fs.existsSync(ITERATION_DIR)) return null;
  const files = fs
    .readdirSync(ITERATION_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
  if (!files.length) return null;
  const latest = path.join(ITERATION_DIR, files[files.length - 1]);
  return { path: latest, text: fs.readFileSync(latest, "utf-8") };
}

function excerptMarkdown(text, maxLines = 6) {
  if (!text) return "";
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trimEnd());
  const picked = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    picked.push(line);
    if (picked.length >= maxLines) break;
  }
  return picked.join("\n");
}

export function buildDiscordMessage({
  type = "daily",
  baseUrl = "https://etha.mytagclash001.help",
  date,
  record,
  perfSummary = null,
  dailyStatus = null,
  iterationExcerpt = "",
  alertTitle = "",
  alertReason = "",
} = {}) {
  const resolvedDate = date || record?.date || localDateKey();
  const output = record?.output || {};
  const state = output?.state || "--";
  const actionSummary = buildActionSummary(output);
  const action = toPlainText(actionSummary?.humanAdvice || actionSummary?.detail || actionSummary?.action || "--");

  const beta = typeof output.beta === "number" ? output.beta.toFixed(2) : "--";
  const betaCap = typeof output.betaCap === "number" ? output.betaCap.toFixed(2) : "--";
  const confidence = typeof output.confidence === "number" ? output.confidence.toFixed(2) : "--";
  const hedge = output.hedge ? "ON" : "OFF";

  const exec = dailyStatus?.status ? String(dailyStatus.status).toUpperCase() : "--";
  const matured = perfSummary?.maturity?.matured ?? null;
  const total = perfSummary?.maturity?.total ?? null;
  const acc7 = perfSummary?.byHorizon?.["7"]?.accuracy;
  const acc14 = perfSummary?.byHorizon?.["14"]?.accuracy;
  const drift7 = perfSummary?.drift?.["7"]?.level || "--";
  const drift14 = perfSummary?.drift?.["14"]?.level || "--";

  const fmtPct = (value) => (typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "--");
  const fmtLevel = (level) => {
    const raw = String(level || "").toLowerCase();
    if (raw === "ok") return "OK";
    if (raw === "warn") return "WARN";
    if (raw === "danger") return "DANGER";
    return "--";
  };

  const reasons = Array.isArray(output?.reasonsTop3)
    ? output.reasonsTop3.slice(0, 3).map((item) => toPlainText(item?.text || "")).filter(Boolean)
    : [];

  const deepLink = `${String(baseUrl || "").replace(/\/$/, "")}?date=${resolvedDate}&tab=explain#evalPanelSection`;
  const header =
    type === "alert"
      ? `ETH-A 报警 · ${resolvedDate}${alertTitle ? ` · ${alertTitle}` : ""}`
      : `ETH-A 日报 · ${resolvedDate} · ${state}`;

  const lines = [];
  lines.push(`**${header}**`);
  if (type === "alert" && alertReason) lines.push(`原因：${alertReason}`);
  lines.push(`动作：${action}`);
  lines.push(`β/β_cap：${beta}/${betaCap} · 置信度：${confidence} · 对冲：${hedge} · 可执行：${exec}`);
  if (matured !== null && total !== null) {
    lines.push(`成熟度：${matured}/${total} · 7D 命中：${fmtPct(acc7)}（漂移 ${fmtLevel(drift7)}） · 14D 命中：${fmtPct(acc14)}（漂移 ${fmtLevel(drift14)}）`);
  }
  if (reasons.length) {
    lines.push(`Top3 驱动：${reasons.join(" / ")}`);
  }
  if (iterationExcerpt) {
    lines.push("");
    lines.push("迭代建议（节选）：");
    lines.push("```");
    lines.push(iterationExcerpt.slice(0, 900));
    lines.push("```");
  }
  lines.push("");
  lines.push(deepLink);

  const content = lines.join("\n").slice(0, 1990);
  return { content };
}

function postWebhookJson(urlStr, payload, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlStr);
    } catch (error) {
      reject(error);
      return;
    }
    const body = JSON.stringify(payload || {});
    const req = https.request(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": "eth-a-dashboard-discord-notify",
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
          resolve({ ok, status: res.statusCode || 0, text });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("webhook timeout")));
    req.write(body);
    req.end();
  });
}

function shouldSkipSend(status, { type, date, key, contentHash, force }) {
  if (force) return false;
  if (!status || typeof status !== "object") return false;
  if (type === "daily") {
    return status.daily?.date === date && status.daily?.hash === contentHash;
  }
  const bucket = status.alerts?.[date];
  if (!bucket || typeof bucket !== "object") return false;
  const sentKeys = Array.isArray(bucket.sentKeys) ? bucket.sentKeys : [];
  return key && sentKeys.includes(key);
}

function updateSendStatus(status, { type, date, key, contentHash }) {
  const next = status && typeof status === "object" ? { ...status } : {};
  next.generatedAt = new Date().toISOString();
  if (type === "daily") {
    next.daily = { date, sentAt: new Date().toISOString(), hash: contentHash };
    return next;
  }
  next.alerts = next.alerts && typeof next.alerts === "object" ? next.alerts : {};
  const bucket = next.alerts[date] && typeof next.alerts[date] === "object" ? next.alerts[date] : { sentKeys: [] };
  const sentKeys = Array.isArray(bucket.sentKeys) ? bucket.sentKeys : [];
  if (key && !sentKeys.includes(key)) sentKeys.push(key);
  next.alerts[date] = { sentAt: new Date().toISOString(), sentKeys };
  return next;
}

export async function sendDiscordNotification(options = {}) {
  const env = { ...loadEnv(ENV_PATH), ...process.env };
  const type = options.type || "daily";
  const date = options.date || localDateKey();
  const force = Boolean(options.force);
  const webhook =
    type === "alert"
      ? env.DISCORD_WEBHOOK_ALERT_URL || env.DISCORD_WEBHOOK_URL
      : env.DISCORD_WEBHOOK_URL;
  if (!webhook) {
    console.log("discord notify skipped: webhook env missing");
    return { ok: true, skipped: true };
  }

  const record = options.record || readJson(LATEST_PATH, null);
  const perfSummary = options.perfSummary || readJson(PERF_SUMMARY_PATH, null);
  const dailyStatus = options.dailyStatus || readJson(DAILY_STATUS_PATH, null);
  const iteration = pickLatestIteration(date);
  const iterationExcerpt = options.iterationExcerpt || excerptMarkdown(iteration?.text || "", 8);

  const payload = buildDiscordMessage({
    type,
    baseUrl: options.baseUrl || env.DASHBOARD_PUBLIC_URL || "https://etha.mytagclash001.help",
    date,
    record,
    perfSummary,
    dailyStatus,
    iterationExcerpt,
    alertTitle: options.title || "",
    alertReason: options.reason || "",
  });
  const contentHash = sha1(payload.content);
  const status = readJson(DISCORD_STATUS_PATH, {});
  const key = options.key || (type === "alert" ? contentHash.slice(0, 10) : "");
  if (shouldSkipSend(status, { type, date, key, contentHash, force })) {
    console.log(`discord notify skipped: already sent (${type} ${date})`);
    return { ok: true, skipped: true };
  }

  const url = webhook.includes("?") ? `${webhook}&wait=true` : `${webhook}?wait=true`;
  const result = await postWebhookJson(url, payload, 20_000);
  if (!result.ok) {
    throw new Error(`discord webhook failed: status=${result.status} body=${result.text.slice(0, 200)}`);
  }
  const nextStatus = updateSendStatus(status, { type, date, key, contentHash });
  writeJson(DISCORD_STATUS_PATH, nextStatus);
  return { ok: true, skipped: false };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await sendDiscordNotification(args);
}

try {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
  if (entry && fileURLToPath(import.meta.url) === entry) {
    main().catch((error) => {
      console.error(error?.message || error);
      process.exitCode = 1;
    });
  }
} catch {}
