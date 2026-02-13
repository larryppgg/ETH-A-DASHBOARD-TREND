import { PROMPT_VERSION, buildSummaryPrompt, buildGatePrompt, buildOverallPrompt, buildFieldPrompt } from "./prompts.js";
import { coverageGroups, fieldMeta } from "../ui/fieldMeta.js";
import { deriveFieldTrend, summarizeTrendForPrompt } from "../ui/fieldTrend.js";

function uniqueCoverageKeys() {
  const seen = new Set();
  const list = [];
  coverageGroups.forEach((group) => {
    (group.keys || []).forEach((key) => {
      if (seen.has(key)) return;
      seen.add(key);
      list.push(key);
    });
  });
  return list;
}

export function buildAiPayload(record, history = []) {
  const output = record.output;
  const input = record.input;
  const keys = uniqueCoverageKeys().filter((key) => key in input);
  const fields = keys.map((key) => {
    const meta = fieldMeta[key] || { label: key, desc: "", unit: "", gate: "未知" };
    const source = (input.__sources || {})[key] || "来源缺失";
    const observedAt =
      (input.__fieldObservedAt || {})[key] ||
      (input.__fieldUpdatedAt || {})[key] ||
      input.__generatedAt ||
      "";
    const fetchedAt = (input.__fieldFetchedAt || {})[key] || input.__generatedAt || "";
    const freshnessLabel = (input.__fieldFreshness || {})[key]?.label || "未知";
    const value = input[key];
    const field = {
      key,
      label: meta.label,
      desc: meta.desc,
      gate: meta.gate,
      unit: meta.unit,
      source,
      observedAt,
      fetchedAt,
      freshnessLabel,
      value,
      trend: summarizeTrendForPrompt(deriveFieldTrend(history, record.date, key)),
    };
    return {
      ...field,
      prompt: buildFieldPrompt(field, { output, input, date: record.date }),
    };
  });
  return {
    date: record.date,
    promptVersion: PROMPT_VERSION,
    summary: {
      prompt: buildSummaryPrompt(output, input),
    },
    overall: {
      prompt: buildOverallPrompt(output, input),
    },
    gates: output.gates.map((gate) => ({
      id: gate.id,
      name: gate.name,
      prompt: buildGatePrompt(gate),
    })),
    fields,
  };
}
