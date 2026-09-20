const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);

function bounded(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function priorCheckMap(bundle) {
  return new Map(
    (Array.isArray(bundle?.checks) ? bundle.checks : [])
      .filter((row) => row && typeof row === 'object' && typeof row.check_key === 'string')
      .map((row) => [row.check_key, row]),
  );
}

export function reconcilePlanChecks(bundle, plan, priorBundle = null) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new Error('bundle is required');
  }
  if (!Array.isArray(bundle.checks)) bundle.checks = [];
  const current = new Set(
    bundle.checks
      .filter((row) => row && typeof row === 'object' && typeof row.check_key === 'string')
      .map((row) => row.check_key),
  );
  const prior = priorCheckMap(priorBundle);
  let restored = 0;
  let inserted = 0;

  for (const lane of Array.isArray(plan?.research_lanes) ? plan.research_lanes : []) {
    const laneId = bounded(lane?.lane_id, 120);
    if (!laneId) continue;
    const checkKey = `lane.${laneId}`;
    if (current.has(checkKey)) continue;

    const previous = prior.get(checkKey);
    if (previous) {
      bundle.checks.push(structuredClone(previous));
      current.add(checkKey);
      restored += 1;
      continue;
    }

    const preferred = Array.isArray(lane?.preferred_sources)
      ? lane.preferred_sources.map((value) => bounded(value, 500)).filter(Boolean)
      : [];
    const manualOnly = lane?.manual_only === true;
    bundle.checks.push({
      check_key: checkKey,
      check_type: 'planned_research',
      description: bounded(lane?.question || `Complete planner research lane ${laneId}`, 12000),
      priority: PRIORITIES.has(lane?.priority) ? lane.priority : 'medium',
      required_source: bounded(preferred.join(' | '), 4000),
      status: manualOnly ? 'blocked' : 'open',
      outcome: manualOnly
        ? 'Manual or issuer-side verification is required; the automated investigation did not complete this lane.'
        : 'The model omitted the structured lane result. The planner requirement is retained as open and must not be treated as complete.',
    });
    current.add(checkKey);
    inserted += 1;
  }

  return {
    total_lanes: Array.isArray(plan?.research_lanes) ? plan.research_lanes.length : 0,
    inserted,
    restored,
  };
}
