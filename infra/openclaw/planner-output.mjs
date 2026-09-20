import { parseSingleJsonObject } from './agent-result.mjs';

const RESEARCH_TOOLS = new Set(['web_search', 'web_fetch', 'browser']);
const MAX_PLANNER_WRAPPER_BYTES = 8 * 1024;

export function parsePlannerJsonObject(text) {
  try {
    return parseSingleJsonObject(text, 'planner final response');
  } catch (error) {
    if (typeof text !== 'string') throw error;
    const matches = [...text.matchAll(/```json\s*([\s\S]*?)\s*```/gi)];
    if (matches.length !== 1) throw error;
    const match = matches[0];
    const prefix = text.slice(0, match.index).trim();
    const suffix = text.slice((match.index ?? 0) + match[0].length).trim();
    if (Buffer.byteLength(prefix) + Buffer.byteLength(suffix) > MAX_PLANNER_WRAPPER_BYTES
      || /[{}]/.test(prefix) || /[{}]/.test(suffix)) {
      throw error;
    }
    try {
      return JSON.parse(match[1].trim());
    } catch {
      throw error;
    }
  }
}

export function filterSyntheticExternalResearchLanes(plan, trustedSynthetic) {
  if (!trustedSynthetic || !plan || typeof plan !== 'object' || Array.isArray(plan)
    || !Array.isArray(plan.research_lanes)) return plan;
  return {
    ...plan,
    research_lanes: plan.research_lanes.filter((lane) => {
      const tools = Array.isArray(lane?.tools) ? lane.tools : [];
      return !tools.some((tool) => RESEARCH_TOOLS.has(tool));
    }),
  };
}
