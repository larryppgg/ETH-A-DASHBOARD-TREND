import { buildSummaryPrompt, buildGatePrompt, buildOverallPrompt } from "./prompts.js";

export function buildAiPayload(record) {
  const output = record.output;
  const input = record.input;
  return {
    date: record.date,
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
  };
}
