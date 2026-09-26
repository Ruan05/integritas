import copy
import json
import tempfile
import unittest
from pathlib import Path
from quality import digest, render, validate
from capture import capture


class EvidenceQualityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'record.txt').write_text('Registry entry: entity exists; authority unknown.')
        self.bundle = {
            'case_id': 'synthetic-case', 'report_id': 'synthetic-report', 'title': 'Synthetic validation',
            'revision': 1, 'publication_status': 'draft', 'excluded_subject_ids': ['client'],
            'sources': [{'id': 'S1', 'title': 'Synthetic registry record', 'authority': 'official',
                         'origin_id': 'registry', 'acquired_by': 'intake', 'retrieved_at': '2026-09-15T12:00:00Z',
                         'effective_at': None, 'url': 'https://example.org/record', 'artifact': 'record.txt',
                         'sha256': digest(self.root / 'record.txt')}],
            'executions': [{'id': 'J1', 'status': 'completed', 'agent': 'researcher', 'tool': 'registry-read',
                            'input_summary': 'Look up exact company identifier', 'started_at': '2026-09-15T12:00:00Z',
                            'ended_at': '2026-09-15T12:01:00Z', 'source_ids': ['S1']}],
            'claims': [{'id': 'C1', 'subject_id': 'counterparty', 'text': 'Entity exists',
                        'conclusion': 'corroborated', 'decision_effect': 'informational',
                        'rationale': 'Exact registry identifier', 'execution_ids': ['J1'],
                        'evidence': [{'source_id': 'S1', 'locator': 'line 1', 'excerpt': 'entity exists', 'relation': 'supports'}]}],
            'actions': []}

    def errors(self):
        return validate(self.bundle, self.root, 1)

    def test_valid_bundle_and_links(self):
        self.assertEqual(self.errors(), [])
        self.assertIn('href="https://example.org/record"', render(self.bundle))

    def test_evidence_tampering(self):
        (self.root / 'record.txt').write_text('Changed')
        self.assertTrue(any('SHA-256' in x for x in self.errors()))

    def test_stale_revision(self):
        self.assertIn('revision: stale or invalid', validate(self.bundle, self.root, 2))

    def test_failed_job_cannot_support_verification(self):
        self.bundle['executions'][0].update(status='failed', failure_reason='Access denied')
        self.assertTrue(any('no completed execution' in x for x in self.errors()))

    def test_source_free_completion(self):
        self.bundle['executions'][0]['source_ids'] = []
        self.assertTrue(any('no captured evidence' in x for x in self.errors()))

    def test_claim_without_evidence(self):
        self.bundle['claims'][0]['evidence'] = []
        self.assertTrue(any('lacks matching evidence' in x for x in self.errors()))

    def test_blocker_requires_owner_and_closure(self):
        self.bundle['claims'][0]['decision_effect'] = 'blocking'
        self.assertTrue(any('closure action' in x for x in self.errors()))
        self.bundle['actions'] = [{'id': 'A1', 'claim_id': 'C1', 'status': 'open', 'owner': 'Analyst',
                                   'next_step': 'Confirm authority', 'required_evidence': 'Direct issuer response',
                                   'acceptance_condition': 'Independent reviewer authenticates response'}]
        self.assertEqual(self.errors(), [])
        self.assertIn('HOLD:', render(self.bundle))
        self.bundle['actions'][0]['status'] = 'closed'
        self.assertTrue(any('closure evidence' in x for x in self.errors()))

    def test_path_escape_and_symlink(self):
        self.bundle['sources'][0]['artifact'] = '../record.txt'
        self.assertTrue(any('invalid evidence path' in x for x in self.errors()))
        (self.root / 'escape').symlink_to('/etc/hosts')
        self.bundle['sources'][0]['artifact'] = 'escape'
        self.assertTrue(any('invalid evidence path' in x for x in self.errors()))

    def test_html_and_url_injection(self):
        self.bundle['claims'][0]['text'] = '<script>alert(1)</script>'
        self.assertNotIn('<script>', render(self.bundle))
        self.bundle['sources'][0]['url'] = 'javascript:alert(1)'
        self.assertTrue(any('HTTPS' in x for x in self.errors()))
        self.assertNotIn('href="javascript:', render(self.bundle))

    def test_namesake_ids_remain_separate(self):
        other = copy.deepcopy(self.bundle['claims'][0])
        other.update(id='C2', subject_id='different-jurisdiction', conclusion='inconclusive', evidence=[])
        self.bundle['claims'].append(other)
        self.assertEqual(self.errors(), [])
        self.assertEqual(len({c['subject_id'] for c in self.bundle['claims']}), 2)

    def test_excluded_client(self):
        self.bundle['claims'][0]['subject_id'] = 'client'
        self.assertTrue(any('excluded subject' in x for x in self.errors()))

    def test_independent_review(self):
        self.bundle.update(publication_status='reviewed', review={'reviewer': 'researcher',
                           'reviewed_at': '2026-09-15T13:00:00Z', 'revision': 1, 'accepted': True})
        self.assertTrue(any('separate' in x for x in self.errors()))
        self.bundle['review']['reviewer'] = 'independent-reviewer'
        self.assertEqual(self.errors(), [])

    def test_malformed_input(self):
        for bad in ([], {}, {'sources': 'invalid'}):
            self.assertTrue(validate(bad, self.root, 1))

    def test_duplicate_ids(self):
        self.bundle['sources'].append(copy.deepcopy(self.bundle['sources'][0]))
        self.assertTrue(any('duplicate' in x for x in self.errors()))

    def test_unrelated_execution_cannot_verify_claim(self):
        second = copy.deepcopy(self.bundle['sources'][0])
        second['id'] = 'S2'
        self.bundle['sources'].append(second)
        self.bundle['executions'][0]['source_ids'] = ['S2']
        self.assertTrue(any('not captured' in x for x in self.errors()))

    def test_capture_preserves_original_and_deduplicates(self):
        source = self.root / 'record.txt'
        before = digest(source)
        store = self.root / 'store'
        first = capture(source, store, 'intake', 'synthetic-message')
        second = capture(source, store, 'intake', 'synthetic-message')
        self.assertEqual(first['sha256'], second['sha256'])
        self.assertEqual(digest(source), before)
        self.assertEqual(len(list(store.iterdir())), 1)

    def test_capture_rejects_modified_existing_evidence(self):
        store = self.root / 'store'
        result = capture(self.root / 'record.txt', store, 'intake', 'synthetic')
        (store / result['artifact']).write_text('tampered')
        with self.assertRaisesRegex(RuntimeError, 'modified'):
            capture(self.root / 'record.txt', store, 'intake', 'synthetic')


if __name__ == '__main__':
    unittest.main()
