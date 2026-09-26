import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEvidenceDrivenSpecialistRouting } from '../../specialist-router.mjs';

function basePlan(overrides = {}) {
  return {
    document_profiles: [{
      document_id: '11111111-1111-4111-8111-111111111111',
      document_type: 'commercial offer', purpose: 'fuel sale', issuer_claim: 'seller',
      parties: ['Synthetic Seller A.Ş.'], material_identifiers: [], material_terms: [], priority_questions: [],
    }],
    case_profile: { case_type: 'counterparty due diligence', jurisdictions: [], assets_or_products: [], incoterms: [], payment_instruments: [], critical_transaction_features: [] },
    research_lanes: [], cross_document_tests: [], specialist_checks: [], automatic_stop_conditions: [],
    ...overrides,
  };
}

const manifest = (depth = 'maximum') => ({ depth, case: { title: 'Regression fixture', intended_subjects: '', jurisdictions: [] } });

test('maximum depth alone never activates petroleum specialist lanes', () => {
  const routed = applyEvidenceDrivenSpecialistRouting(basePlan({
    case_profile: { case_type: 'software vendor diligence', jurisdictions: ['GB'], assets_or_products: ['software'], incoterms: [], payment_instruments: [], critical_transaction_features: [] },
  }), manifest('maximum'));
  assert.equal(routed.routing_metadata.specialist_route, 'none');
  assert.equal(routed.research_lanes.length, 0);
});

test('Turkey EN590 transaction activates exact evidence-proportional specialist lanes', () => {
  const routed = applyEvidenceDrivenSpecialistRouting(basePlan({
    document_profiles: [{
      document_id: '11111111-1111-4111-8111-111111111111', document_type: 'soft corporate offer',
      purpose: 'offer EN590 diesel ex Mersin terminal', issuer_claim: 'Synthetic Anatolia Petroleum A.Ş.',
      parties: ['Synthetic Anatolia Petroleum A.Ş.', 'Synthetic Buyer Ltd'],
      material_identifiers: ['MERSIS 0123456789012345', 'EPDK PET/00000-00/00000', 'IMO 9876543'],
      material_terms: ['100,000 MT monthly', 'Mersin, Türkiye', 'payment by MT700 documentary letter of credit', 'tanker nomination required'],
      priority_questions: ['authority', 'title', 'capacity', 'origin'],
    }],
    case_profile: {
      case_type: 'petroleum sale', jurisdictions: ['Türkiye'], assets_or_products: ['EN590 diesel'], incoterms: ['CIF'],
      payment_instruments: ['MT700 letter of credit'], critical_transaction_features: ['Mersin terminal', 'tanker IMO 9876543'],
    },
  }), manifest('maximum'));
  assert.equal(routed.routing_metadata.specialist_route, 'turkey_petroleum');
  assert.deepEqual(routed.routing_metadata.triggers, { turkey: true, petroleum: true, maritime: true, trade_finance: true });
  const ids = routed.research_lanes.map((row) => row.lane_id);
  for (const expected of [
    'specialist.tr.corporate_authority', 'specialist.tr.epdk_licence', 'specialist.fuel.title_capacity',
    'specialist.fuel.sanctions_origin', 'specialist.maritime.vessel', 'specialist.trade_finance.payment',
  ]) assert.ok(ids.includes(expected), `missing ${expected}`);
  for (const row of routed.research_lanes) assert.ok(row.stop_condition.length > 20, `${row.lane_id} must have a real stop condition`);
});

test('Turkey petroleum evidence without vessel or banking claims does not run those optional lanes', () => {
  const routed = applyEvidenceDrivenSpecialistRouting(basePlan({
    case_profile: { case_type: 'petroleum seller diligence', jurisdictions: ['Turkey'], assets_or_products: ['diesel fuel'], incoterms: [], payment_instruments: [], critical_transaction_features: ['seller licence'] },
  }), manifest('deep'));
  const ids = routed.research_lanes.map((row) => row.lane_id);
  assert.ok(ids.includes('specialist.tr.epdk_licence'));
  assert.ok(!ids.includes('specialist.maritime.vessel'));
  assert.ok(!ids.includes('specialist.trade_finance.payment'));
});

test('existing equivalent model-planned lane is not duplicated', () => {
  const plan = basePlan({
    case_profile: { case_type: 'petroleum sale', jurisdictions: ['Türkiye'], assets_or_products: ['EN590'], incoterms: [], payment_instruments: [], critical_transaction_features: [] },
    research_lanes: [{
      lane_id: 'model-epdk', priority: 'critical', question: 'Verify the EPDK licence held by the Turkish seller.', preferred_sources: ['EPDK'], fallback_sources: [], tools: ['browser'], search_identifiers: [], stop_condition: 'Authoritative regulator result.', manual_only: false,
    }],
  });
  const routed = applyEvidenceDrivenSpecialistRouting(plan, manifest('maximum'));
  assert.equal(routed.research_lanes.filter((row) => /epdk/i.test(row.question)).length, 1);
  assert.ok(routed.routing_metadata.covered_lane_ids.includes('specialist.tr.epdk_licence'));
});
