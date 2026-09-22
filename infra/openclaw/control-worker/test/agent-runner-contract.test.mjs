import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('OpenClaw runner materializes only validated structured final output', async () => {
  const source = await readFile(new URL('../../investigation-agent-runner.mjs', import.meta.url), 'utf8');
  assert.match(source, /parseAgentBundle\(researchStdout, manifest\)/);
  assert.match(source, /parseAgentBundle\(finalStdout, manifest\)/);
  assert.match(source, /writeSharedAtomic\('bundle\.json'/);
  assert.match(source, /writeSharedAtomic\('report\.md'/);
  assert.match(source, /'--code-mode', 'direct'/);
  assert.doesNotMatch(source, /report\.html/);
  assert.doesNotMatch(source, /'--state-dir'/, 'agent exec must use OpenClaw isolated temporary state while the Gateway owns the persistent state directory');
  assert.match(source, /const ACTIVE_CONFIG_PATH = ZEN_ENABLED \? ZEN_CONFIG_PATH : BASE_CONFIG_PATH/);
  assert.match(source, /'--config', ACTIVE_CONFIG_PATH/);
});

test('OpenClaw runner uses evidence-first planning, bounded research and an independent critic for deep work', async () => {
  const source = await readFile(new URL('../../investigation-agent-runner.mjs', import.meta.url), 'utf8');
  assert.match(source, /const NVIDIA_PRIMARY = 'integritas-nvidia\/nvidia\/nemotron-3-ultra-550b-a55b'/);
  assert.match(source, /const FREE_FAST = 'integritas-openrouter\/nvidia\/nemotron-3-super-120b-a12b:free'/);
  assert.match(source, /const ZEN_ENABLED = !!process\.env\.OPENCODE_ZEN_API_KEY && existsSync\(ZEN_ENABLE_MARKER\)/);
  assert.match(source, /const ZEN_ENABLE_MARKER = '\/etc\/openclaw\/zen-enabled'/);
  assert.match(source, /ACTIVE_FREE_FALLBACKS = ZEN_ENABLED/);
  assert.match(source, /SYNTHETIC_MODEL_ROUTES = routes\(NVIDIA_PRIMARY, ACTIVE_FREE_FALLBACKS\)/);
  assert.doesNotMatch(source, /NVIDIA_LIGHTNING/, 'unhealthy Lightning route must not be auto-selected');
  assert.ok(source.includes("const DEEPSEEK_FLASH = 'integritas-openrouter/deepseek/deepseek-v4.1-flash';"));
  assert.ok(source.includes("const GLM_53 = 'integritas-openrouter/z-ai/glm-5.3';"));
  assert.ok(source.includes("const GLM_53_FLASH = 'integritas-openrouter/z-ai/glm-5.3-flash';"));
  assert.ok(source.includes('planner: { model: GLM_53'));
  assert.ok(source.includes('research: { model: DEEPSEEK_FLASH'));
  assert.match(source, /integritas-openrouter\/nvidia\/nemotron-3-ultra-550b-a55b:free/);
  assert.match(source, /integritas-openrouter\/nvidia\/nemotron-3-super-120b-a12b:free/);
  assert.match(source, /integritas-openrouter\/nex-agi\/nex-n2\.5-pro:free/);
  assert.match(source, /integritas-openrouter\/cohere\/north-mini-code:free/);
  assert.match(source, /integritas-openrouter\/poolside\/laguna-xs-2\.1:free/);
  assert.match(source, /trustedForensics/);
  assert.match(source, /integritas_forensics_v1/);
  assert.match(source, /parsePlan/);
  assert.match(source, /row\.parties = normalizeOptionalStringArray/, 'planner must normalize null or omitted optional party arrays instead of crashing');
  assert.match(source, /plan\.case_profile\.jurisdictions = normalizeOptionalStringArray/, 'optional case-profile arrays must be null-safe');
  assert.match(source, /lane\.preferred_sources = normalizeOptionalStringArray/, 'optional lane source arrays must be null-safe');
  assert.match(source, /isTrustedSyntheticValidationManifest\(manifest\)/, 'zero-lane exception must depend on trusted manifest metadata');
  assert.match(source, /plan\.research_lanes\.length < 1 && !allowZeroResearchLanes/, 'real investigations must still require at least one research lane');
  assert.match(source, /filterSyntheticExternalResearchLanes/, 'trusted synthetic plans must remove external research lanes');
  assert.match(source, /applyEvidenceDrivenSpecialistRouting\(plan, manifest\)/, 'validated plans must pass through deterministic evidence-driven specialist routing');
  assert.ok(source.indexOf('applyEvidenceDrivenSpecialistRouting(plan, manifest)') < source.indexOf('filterSyntheticExternalResearchLanes(plan, isTrustedSyntheticValidationManifest(manifest))'), 'synthetic lane filtering must run after specialist routing so test fixtures cannot regain external lanes');
  assert.match(source, /synthetic validation research must not perform external research/, 'synthetic external tool use must fail closed');
  const retainedPlannerRead = source.indexOf("readFile(path.join(jobDir, 'planner-agent-exec.json'), 'utf8')");
  const plannerRun = source.indexOf("runAgent('planner-task.md', route.planner)");
  assert.ok(retainedPlannerRead >= 0 && plannerRun > retainedPlannerRead, 'runner must try retained planner output before calling the planner model');
  assert.match(source, /integritas_planner_recovery_v1/, 'planner reuse must be recorded in execution provenance');
  assert.match(source, /STRICT SYNTHETIC OUTPUT-SIZE CONTRACT/, 'trusted synthetic research must have a bounded compact output contract');
  assert.match(source, /report\.markdown <= 3000 characters/, 'synthetic research report must remain compact');
  assert.match(source, /syntheticCriticGuard/, 'synthetic critic output must be bounded');
  assert.match(source, /syntheticSynthesisGuard/, 'synthetic synthesis must preserve compact bundle limits');
  const retainedResearchRead = source.indexOf("readFile(path.join(jobDir, 'research-agent-exec.json'), 'utf8')");
  const researchRun = source.indexOf("runAgent('research-task.md', route.research)");
  assert.ok(retainedResearchRead >= 0 && researchRun > retainedResearchRead, 'runner must try retained research output before calling the research model');
  const retainedCriticRead = source.indexOf("readFile(path.join(jobDir, 'critic-agent-exec.json'), 'utf8')");
  const criticRun = source.indexOf("runAgent('critic-task.md', route.critic)");
  assert.ok(retainedCriticRead >= 0 && criticRun > retainedCriticRead, 'runner must try retained critic output before calling the critic model');
  const retainedSynthesisRead = source.indexOf("readFile(path.join(jobDir, 'synthesis-agent-exec.json'), 'utf8')");
  const synthesisRun = source.indexOf("runAgent('synthesis-task.md', route.synthesis)");
  assert.ok(retainedSynthesisRead >= 0 && synthesisRun > retainedSynthesisRead, 'runner must try retained synthesis output before calling the synthesis model');
  assert.match(source, /integritas_research_recovery_v1/, 'research reuse must be recorded in provenance');
  assert.match(source, /integritas_critic_recovery_v1/, 'critic reuse must be recorded in provenance');
  assert.match(source, /integritas_synthesis_recovery_v1/, 'synthesis reuse must be recorded in provenance');
  assert.match(source, /shouldUseLargeInvestigation\(manifest\)/, 'maximum/large investigations must take the sharded v2 path');
  assert.match(source, /runLargeInvestigationV2/, 'large investigations must use the bounded v2 execution engine');
  assert.match(source, /plannerTask/);
  assert.match(source, /researchTask/);
  assert.match(source, /investigation-plan\.json/);
  assert.match(source, /deterministic-checks\.json/);
  assert.match(source, /buildDeterministicChecks/);
  assert.match(source, /integritas_transaction_checks_v1/);
  assert.match(source, /planner must not perform external research/);
  assert.match(source, /MASTER SUMMARY — READ THIS FIRST/);
  assert.match(source, /DIRECT NEXT STEPS — WHAT TO DO NOW/);
  assert.match(source, /parseCritique/);
  assert.match(source, /critic must not perform external research/);
  assert.match(source, /synthesis pass must not perform external research/);
  assert.match(source, /mergeToolSummaries/);
  assert.match(source, /milestoneSnapshot/);
  assert.match(source, /reconcilePlanChecks/);
  assert.ok(source.includes('lane.${lane.lane_id}'), 'planner lane check keys must remain stable');
  assert.match(source, /planning_research/);
  assert.match(source, /agent-progress\.json/);
  assert.match(source, /'--model', phaseRoute\.model/);
  assert.match(source, /args\.push\('--fallback', fallback\)/);
  assert.doesNotMatch(source, /opencode-go\/deepseek-v4-pro/);
});


test('large investigations shard before legacy planning and assemble the canonical bundle deterministically', async () => {
  const parent = await readFile(new URL('../../investigation-agent-runner.mjs', import.meta.url), 'utf8');
  const large = await readFile(new URL('../../large-investigation-agent-runner-v2.mjs', import.meta.url), 'utf8');
  const guard = parent.indexOf('if (shouldUseLargeInvestigation(manifest))');
  const legacyPlanner = parent.indexOf("await writeSharedAtomic('planner-task.md', plannerTask())");
  assert.ok(guard >= 0 && legacyPlanner > guard, 'large-case dispatch must happen before the legacy all-document planner');
  assert.match(parent, /large-investigation-agent-runner-v2\.mjs/);
  assert.match(large, /buildDocumentShards\(manifest, 4\)/, 'document shards must remain bounded to four documents');
  assert.match(large, /mapLimit\(shards, 2/, 'document shard concurrency must remain rate-safe');
  assert.match(large, /mapLimit\(plan\.research_lanes, 2/, 'research lane concurrency must remain rate-safe');
  assert.match(large, /parseLargePlanFinal/, 'large plan must use a bounded contract');
  assert.match(large, /applyEvidenceDrivenSpecialistRouting\(plan, manifest\)/, 'large plans must use the same evidence-driven specialist router');
  assert.match(large, /parseDocumentShardFinal/, 'document shards must validate exact coverage');
  assert.match(large, /parseLaneFinal/, 'research lanes must use a bounded schema');
  assert.match(large, /validateInvestigationBundle\(finalBundle, manifest, reportMarkdown\)/, 'deterministic assembly must pass the canonical bundle validator');
  assert.match(large, /provider: 'integritas', model: 'deterministic-large-assembly-v2'/, 'final canonical bundle must be assembled deterministically rather than by a model');
  assert.match(large, /failed every validated model route/, 'schema-invalid model output must trigger application-level model failover');
  assert.match(large, /readFile\(path\.join\(jobDir, execName\)/, 'validated phase artifacts must be reused on retry');
  assert.match(large, /timeoutForModel\(role, model\)/, 'provider routes must use bounded per-provider timeouts');
  assert.match(large, /openRouterPaidCircuitOpen/, 'credit-limited OpenRouter must open a per-investigation circuit');
  assert.match(large, /looksLikeProviderCapacityFailure/, 'provider capacity failures must fail over without waiting for every route');
  assert.ok(large.includes("const NVIDIA_ULTRA = 'integritas-nvidia/nvidia/nemotron-3-ultra-550b-a55b';"), 'large investigations must use the explicit verified NVIDIA Ultra route');
  assert.ok(large.includes("const DEEPSEEK_FLASH = 'integritas-openrouter/deepseek/deepseek-v4.1-flash';"), 'large research lanes must expose DeepSeek V4.1 Flash');
  assert.ok(large.includes("const GLM_53 = 'integritas-openrouter/z-ai/glm-5.3';"), 'large planning and critic lanes must expose GLM 5.3');
  assert.ok(large.includes("const GLM_53_FLASH = 'integritas-openrouter/z-ai/glm-5.3-flash';"), 'large investigations must expose the low-cost GLM fallback');
  assert.ok(large.includes('FREE_OPENROUTER_MODELS.has(model)'), 'free-fallback budget must apply only to free OpenRouter routes');
  assert.match(large, /MAX_OPENROUTER_FREE_USES = 4/, 'OpenRouter free fallback must remain synthetic-only and bounded');
  assert.match(large, /MAX_ZEN_FREE_USES = 4/, 'Zen free fallback must remain bounded per investigation');
  assert.match(large, /const zen = ZEN_ENABLED/, 'large-case Zen activation must require the validated enable marker');
  assert.match(large, /ZEN_FREE_MODELS\.has\(model\)/, 'Zen free routes must use their own bounded budget');
  assert.match(large, /external lane sources require observed research-tool use in the same phase/, 'external source provenance must be phase-local');
  assert.match(large, /# MASTER SUMMARY — READ THIS FIRST/);
  assert.match(large, /## DIRECT NEXT STEPS — WHAT TO DO NOW/);
  assert.match(large, /## Master Issue Dashboard/);
  assert.match(large, /## Source Ledger/);
  assert.doesNotMatch(large, /synthesis-task/, 'large-case final assembly must not depend on a giant synthesis completion');
});

test('investigation profile uses only required provider SecretRefs and keeps the evidence workspace read-only', async () => {
  const config = await readFile(new URL('../../integritas-investigation.json5', import.meta.url), 'utf8');
  const zenConfig = await readFile(new URL('../../integritas-investigation-zen.json5', import.meta.url), 'utf8');
  assert.doesNotMatch(config, /\$include:\s*["']\.\/openclaw\.json["']/, 'case workers must not inherit the operator config');
  assert.match(config, /memory:\s*\{[\s\S]*search:\s*\{[\s\S]*enabled:\s*false/, 'case-worker memory must be disabled to preserve case isolation');
  assert.match(config, /workspaceAccess: "ro"/);
  assert.match(config, /profile: "minimal"/);
  assert.match(config, /modelPolicy:\s*\{[\s\S]*allow:/, 'investigation overlay must carry its own model policy');
  for (const model of [
    'integritas-openrouter/deepseek/deepseek-v4.1-flash',
    'integritas-openrouter/z-ai/glm-5.3',
    'integritas-openrouter/z-ai/glm-5.3-flash',
    'integritas-nvidia/nvidia/nemotron-3-ultra-550b-a55b',
  ]) {
    assert.ok(config.includes(`"${model}"`), `model policy must allow ${model}`);
  }
  assert.doesNotMatch(config, /"integritas-groq"/);
  assert.doesNotMatch(config, /GROQ_API_KEY/);
  assert.match(config, /"integritas-openrouter"/);
  assert.doesNotMatch(config, /integritas-opencode-zen/, 'active investigation config must not require unauthenticated Zen');
  assert.doesNotMatch(config, /OPENCODE_ZEN_API_KEY/, 'active investigation config must not resolve the optional Zen secret');
  assert.match(zenConfig, /"integritas-opencode-zen"/, 'staged Zen chat provider must be configured');
  assert.match(zenConfig, /"integritas-opencode-zen-responses"/, 'staged Zen responses provider must be configured');
  assert.match(zenConfig, /id: "OPENCODE_ZEN_API_KEY"/, 'staged Zen provider must use the Zen API key SecretRef');
  for (const model of [
    'integritas-opencode-zen/big-pickle',
    'integritas-opencode-zen/deepseek-v4-flash-free',
    'integritas-opencode-zen/mimo-v2.5-free',
    'integritas-opencode-zen/ling-3.0-flash-fin-free',
    'integritas-opencode-zen/nemotron-3-ultra-free',
    'integritas-opencode-zen/nemotron-3.5-lightning-free',
    'integritas-opencode-zen-responses/muse-spark-1.3-contributor-free',
  ]) {
    assert.ok(zenConfig.includes(`"${model}"`), `missing staged Zen model: ${model}`);
  }
  assert.match(config, /apiKey: \{ source: "env", provider: "default", id: "OPENROUTER_API_KEY" \}/);
  assert.match(config, /id: "nvidia\/nemotron-3-ultra-550b-a55b:free"/);
  assert.match(config, /id: "nvidia\/nemotron-3-ultra-550b-a55b:free"[\s\S]*maxTokens: 65536/, 'Nemotron free fallback must expose its verified completion budget');
  assert.match(config, /id: "openrouter\/free"/);
  assert.match(config, /"nvidia\/nvidia\/nemotron-3-ultra-550b-a55b"[\s\S]*maxTokens: 32768/, 'direct Ultra must have explicit 32K output headroom');
  assert.match(config, /"nvidia\/nvidia\/nemotron-3\.5-lightning-30b-a3b"[\s\S]*maxTokens: 16384/, 'Lightning must be configured as the bounded high-throughput worker');
  for (const model of [
    'integritas-openrouter/nvidia/nemotron-3-ultra-550b-a55b:free',
    'integritas-openrouter/openrouter/free',
    'integritas-nvidia/nvidia/nemotron-3-ultra-550b-a55b',
    'integritas-openrouter/nvidia/nemotron-3-super-120b-a12b:free',
  ]) {
    assert.ok(config.includes(`"${model}"`), `missing routed model allowlist entry: ${model}`);
  }
  for (const model of [
    'integritas-openrouter/deepseek/deepseek-v4.1-flash',
    'integritas-openrouter/z-ai/glm-5.3',
    'integritas-openrouter/z-ai/glm-5.3-flash',
  ]) {
    assert.ok(config.includes(`"${model}": {}`), `missing optimized real-investigation model: ${model}`);
  }
  const currentFreeModels = [
    'integritas-openrouter/cohere/north-mini-code:free',
    'integritas-openrouter/dots-studio/dots-3-note-preview:free',
    'integritas-openrouter/google/gemma-4-31b-it:free',
    'integritas-openrouter/inclusionai/ling-3.0-flash-vl:free',
    'integritas-openrouter/nex-agi/nex-n2.5-pro:free',
    'integritas-openrouter/nvidia/nemotron-3-super-120b-a12b:free',
    'integritas-openrouter/nvidia/nemotron-3.5-lightning:free',
    'integritas-openrouter/poolside/laguna-s-2.1:free',
    'integritas-openrouter/qwen/qwen3.8-27b:free',
    'integritas-openrouter/thinkingmachines/inkling:free',
    'integritas-openrouter/z-ai/glm-5.2:free',
    'nvidia/z-ai/glm-5.3',
    'nvidia/z-ai/glm-5.3-flash',
    'nvidia/moonshotai/kimi-k3',
    'nvidia/nvidia/nemotron-3-super-120b-a12b',
    'nvidia/meta/muse-glimmer-30b',
    'nvidia/google/gemma-4-31b-it',
  ];
  for (const model of currentFreeModels) {
    assert.ok(config.includes(`"${model}"`), `missing current free model: ${model}`);
  }
  const currentGoModels = [
    'opencode-go/grok-4.7',
    'opencode-go/glm-5.3-flash',
    'opencode-go/glm-5.3',
    'opencode-go/gpt-5.6-luna',
    'opencode-go/deepseek-v4.1-flash',
    'opencode-go/qwen3.8-flash',
    'opencode-go/minimax-m3',
    'opencode-go/mimo-v2.5',
    'opencode-go/hy4-preview',
    'opencode-go/omen-alpha',
  ];
  for (const model of currentGoModels) {
    assert.ok(config.includes(`"${model}"`), `missing current OpenCode Go model: ${model}`);
  }
  assert.doesNotMatch(config, /gsk_[A-Za-z0-9_-]+/);
  assert.doesNotMatch(config, /sk-or-v1-[A-Za-z0-9_-]+/);
  assert.doesNotMatch(config, /nvapi-[A-Za-z0-9_-]+/);
  for (const tool of ['ls', 'read', 'web_search', 'web_fetch', 'browser', 'view_image', 'pdf']) {
    assert.match(config, new RegExp(`"${tool}"`));
  }
  for (const tool of ['write', 'edit', 'exec', 'apply_patch', 'process', 'code_execution', 'terminal', 'sessions_spawn', 'subagents', 'secrets']) {
    assert.match(config, new RegExp(`deny: \\[.*"${tool}"`, 's'));
  }
});

test('runner passes only approved provider credentials into OpenClaw', async () => {
  const source = await readFile(new URL('../../investigation-agent-runner.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes("const providerNames = ['OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'OPENCODE_ZEN_API_KEY'];"));
  assert.ok(source.includes('env: agentEnv()'));
  for (const name of ['GROQ_API_KEY', 'GEMINI_API_KEY', 'CEREBRAS_API_KEY', 'EXA_API_KEY', 'HF_TOKEN']) {
    assert.doesNotMatch(source, new RegExp(`'${name}'`));
  }
  assert.doesNotMatch(source, /process\.env\s*[,}]/);
});

test('investigation skill imposes research and reread budgets', async () => {
  const runner = await readFile(new URL('../../investigation-agent-runner.mjs', import.meta.url), 'utf8');
  const skill = await readFile(new URL('../../skills/integritas-investigation-v1/SKILL.md', import.meta.url), 'utf8');
  assert.match(skill, /fast.*8 distinct external sources.*16 web\/browser tool calls/s);
  assert.match(skill, /standard.*16 distinct external sources.*32 web\/browser tool calls/s);
  assert.match(skill, /deep.*32 distinct external sources.*64 web\/browser tool calls/s);
  assert.match(skill, /maximum.*50 distinct external sources.*100 web\/browser tool calls/s);
  assert.match(skill, /Read each submitted evidence file comprehensively once/);
  assert.match(skill, /Do not repeatedly fetch the same URL/);
  assert.match(skill, /Turkey petroleum \/ fuel transactions/);
  assert.match(skill, /MERSİS or trade-registry record/);
  assert.match(skill, /EPDK lane/);
  assert.match(skill, /IMO-anchored vessel/);
  assert.match(skill, /Stop a specialist lane once authoritative evidence answers its specific question/);
  assert.match(runner, /fast:[\s\S]*timeoutSeconds: 90/);
  assert.match(runner, /maximum:[\s\S]*research:[\s\S]*timeoutSeconds: 900/);
});

test('investigation prompts use the read-only /agent workspace mount', async () => {
  const runtime = await readFile(new URL('../src/investigation.mjs', import.meta.url), 'utf8');
  const skill = await readFile(new URL('../../skills/integritas-investigation-v1/SKILL.md', import.meta.url), 'utf8');
  assert.match(runtime, /workspaceAccess ro/);
  assert.match(runtime, /\/agent\/bundle-template\.json/);
  assert.match(runtime, /\/agent\/investigation-plan\.json/);
  assert.match(runtime, /\/agent\/deterministic-checks\.json/);
  assert.match(skill, /mounted read-only at `\/agent`/);
  assert.doesNotMatch(runtime, /\/workspace\//, 'runtime prompt must not use writable /workspace paths');
  assert.doesNotMatch(skill, /\/workspace\//, 'skill must not use writable /workspace paths');
});
