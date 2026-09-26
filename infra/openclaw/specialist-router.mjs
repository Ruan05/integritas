const TURKEY = /\b(?:turkey|türkiye|turkiye|turkish|mersin|ceyhan|aliağa|aliaga|botaş|botas|mersis|epdk)\b/i;
const PETROLEUM = /\b(?:en\s*590|diesel|gasoil|gas\s*oil|jet\s*a-?1|aviation\s+fuel|petroleum|crude|fuel\s+oil|lng|lpg|naphtha|gasoline|mogas|hydrocarbon|refinery)\b/i;
const MARITIME = /\b(?:imo(?:\s*(?:no\.?|number|#))?|vessel|tanker|ship(?:ping)?|charter(?:er|party)?|ais|port\s+call|berth|loading\s+port|discharge\s+port)\b/i;
const TRADE_FINANCE = /\b(?:mt\s*700|mt\s*760|mt\s*799|mt\s*103|mt\s*199|sblc|letter\s+of\s+credit|documentary\s+credit|swift|issuing\s+bank|advising\s+bank|beneficiary|bank\s+guarantee|payment\s+trigger)\b/i;

function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) strings(item, out);
  return out;
}

function evidenceText(plan, manifest) {
  const safePlan = {
    document_profiles: plan?.document_profiles ?? [],
    case_profile: plan?.case_profile ?? {},
    cross_document_tests: plan?.cross_document_tests ?? [],
    specialist_checks: plan?.specialist_checks ?? [],
  };
  const safeCase = {
    title: manifest?.case?.title ?? '',
    intended_subjects: manifest?.case?.intended_subjects ?? '',
    jurisdictions: manifest?.case?.jurisdictions ?? [],
  };
  return strings([safePlan, safeCase]).join('\n').slice(0, 250_000);
}

function lane(lane_id, priority, question, preferred_sources, fallback_sources, tools, search_identifiers, stop_condition, manual_only = false) {
  return { lane_id, priority, question, preferred_sources, fallback_sources, tools, search_identifiers, stop_condition, manual_only };
}

function turkeyPetroleumLanes(text) {
  const lanes = [
    lane(
      'specialist.tr.corporate_authority', 'critical',
      'Verify the exact Turkish contracting entity, registration/MERSİS or trade-registry identity, legal status, directors and representative/signatory authority for this transaction.',
      ['Turkish Trade Registry Gazette / TOBB records', 'MERSİS or authoritative Turkish registry evidence'],
      ['Official company filings', 'Direct company confirmation through independently sourced channels'],
      ['web_search', 'web_fetch', 'browser'], ['MERSİS', 'trade registry number', 'tax identity', 'legal name', 'representative name'],
      'Stop when authoritative identity and current representative authority are established, or record a manual gate if direct/authoritative confirmation is unavailable.'
    ),
    lane(
      'specialist.tr.epdk_licence', 'critical',
      'Determine whether the claimed Turkish petroleum activity requires an EPDK licence and verify the licence class, holder, validity, permitted activity and exact link to the contracting seller.',
      ['EPDK official licence/market records'], ['Turkish official gazette or regulator publications', 'Direct EPDK confirmation'],
      ['web_search', 'web_fetch', 'browser'], ['EPDK', 'licence number', 'legal name', 'facility name'],
      'Stop when the regulator record establishes the relevant licence scope and holder, or leave a regulator-confirmation gate if it cannot be established.'
    ),
    lane(
      'specialist.fuel.title_capacity', 'critical',
      'Verify product source/title and commercial capacity: refinery/importer/title holder, storage or terminal operator, allocation/tank reference, volume, loading window and nomination/release authority.',
      ['Producer/refinery or terminal operator records', 'Port/terminal operator confirmation', 'Authoritative licence/capacity records'],
      ['Independent inspection evidence', 'Direct operator confirmation'],
      ['web_search', 'web_fetch', 'browser'], ['product grade', 'refinery', 'terminal', 'tank/allocation', 'volume', 'loading window'],
      'Stop when title/source and the claimed capacity are independently supported, or convert missing operator/title confirmation into an explicit transaction stop gate.'
    ),
    lane(
      'specialist.fuel.sanctions_origin', 'critical',
      'Verify product origin, route, ownership/control and counterparties against applicable sanctions/export-control risk; do not treat Turkish location as proof of non-sanctioned origin.',
      ['Official sanctions lists and regulator guidance', 'Authoritative customs/origin/shipping records where available'],
      ['Reputable shipping/commodity records', 'Direct origin/title documentation from independently verified issuers'],
      ['web_search', 'web_fetch', 'browser'], ['origin', 'producer', 'seller', 'owner/control', 'route'],
      'Stop when material counterparties and origin are screened with adequate identifiers and the route/origin is independently supported; otherwise retain unresolved sanctions/origin gates.'
    ),
  ];
  if (MARITIME.test(text)) lanes.push(lane(
    'specialist.maritime.vessel', 'high',
    'Verify the claimed maritime leg using IMO-anchored vessel identity, flag/class/P&I, owner/operator, charter/nomination and port/terminal feasibility.',
    ['IMO/flag-state/port-state records', 'Equasis/class society/P&I', 'Official port or terminal records'],
    ['AIS/commercial vessel tracking as operational context only'],
    ['web_search', 'web_fetch', 'browser'], ['IMO number', 'vessel name', 'owner/operator', 'charter/nomination', 'port call'],
    'Stop when vessel identity and operational feasibility are corroborated by authoritative sources; direct charter/nomination control remains manual if not publicly verifiable.'
  ));
  if (TRADE_FINANCE.test(text)) lanes.push(lane(
    'specialist.trade_finance.payment', 'critical',
    'Verify the trade-finance and payment structure: beneficiary, issuing/advising bank, instrument/SWIFT claim, payment trigger, title-transfer sequence, third-party payments and unusual fees.',
    ['Official bank/SWIFT-published identity and routing sources', 'ICC/Wolfsberg/BAFT methodology where applicable'],
    ['Direct bank-to-bank or issuer confirmation'],
    ['web_search', 'web_fetch', 'browser'], ['beneficiary', 'bank', 'BIC/SWIFT', 'instrument type', 'payment trigger'],
    'Stop public research once bank/instrument structure is established; beneficiary ownership and message/instrument authenticity require direct bank/issuer confirmation.'
  ));
  return lanes;
}

function sameIntent(a, b) {
  if (a.lane_id === b.lane_id) return true;
  const q = String(b.question ?? '').toLowerCase();
  if (a.lane_id.includes('corporate_authority')) return /mersis|turkish.*(?:registry|entity)|representative.*authority/.test(q);
  if (a.lane_id.includes('epdk')) return /epdk/.test(q);
  if (a.lane_id.includes('title_capacity')) return /(?:title|source).*(?:capacity|terminal|storage)|(?:capacity|terminal|storage).*(?:title|source)/.test(q);
  if (a.lane_id.includes('sanctions_origin')) return /sanction.*origin|origin.*sanction/.test(q);
  if (a.lane_id.includes('maritime')) return /(?:imo|vessel).*(?:owner|class|p&i|port|charter)|(?:owner|class|p&i|port|charter).*(?:imo|vessel)/.test(q);
  if (a.lane_id.includes('trade_finance')) return /(?:swift|letter of credit|mt700|beneficiary).*(?:bank|payment|title)|(?:bank|payment|title).*(?:swift|letter of credit|mt700|beneficiary)/.test(q);
  return false;
}

export function applyEvidenceDrivenSpecialistRouting(plan, manifest) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || !Array.isArray(plan.research_lanes)) return plan;
  const text = evidenceText(plan, manifest);
  const triggers = {
    turkey: TURKEY.test(text),
    petroleum: PETROLEUM.test(text),
    maritime: MARITIME.test(text),
    trade_finance: TRADE_FINANCE.test(text),
  };
  if (!triggers.turkey || !triggers.petroleum) {
    return { ...plan, routing_metadata: { specialist_route: 'none', triggers } };
  }

  const canonical = turkeyPetroleumLanes(text);
  const covered = new Set();
  for (const required of canonical) {
    if (plan.research_lanes.some((existing) => sameIntent(required, existing))) covered.add(required.lane_id);
  }
  const inserted = canonical.filter((required) => !covered.has(required.lane_id));
  const research_lanes = [...inserted, ...plan.research_lanes].slice(0, 50);
  const specialist_checks = [
    ...(Array.isArray(plan.specialist_checks) ? plan.specialist_checks : []),
    ...canonical.map((row) => `Evidence-triggered specialist lane: ${row.lane_id}`),
  ].slice(0, 80);
  return {
    ...plan,
    research_lanes,
    specialist_checks: [...new Set(specialist_checks)],
    routing_metadata: {
      specialist_route: 'turkey_petroleum',
      triggers,
      inserted_lane_ids: inserted.map((row) => row.lane_id),
      covered_lane_ids: [...covered],
    },
  };
}
