export class ControlClient {
  constructor({ baseUrl, workerToken, workerId, fetchImpl = fetch }) {
    if (!baseUrl) throw new Error('baseUrl is required');
    if (!workerToken) throw new Error('workerToken is required');
    if (!workerId) throw new Error('workerId is required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.workerToken = workerToken;
    this.workerId = workerId;
    this.fetch = fetchImpl;
  }

  async call(action, body = {}) {
    const response = await this.fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-integritas-worker-token': this.workerToken,
        'x-integritas-worker-id': this.workerId,
      },
      body: JSON.stringify({ action, worker_id: this.workerId, ...body }),
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: 'invalid_json_response' }; }
    if (!response.ok) throw new Error(`control API ${action} failed: ${response.status} ${data.error ?? ''}`.trim());
    return data;
  }

  heartbeat(details) { return this.call('worker_heartbeat', details); }
  lease() { return this.call('worker_lease'); }
  touch(commandId) { return this.call('worker_touch', { command_id: commandId }); }
  complete(commandId, result) { return this.call('worker_complete', { command_id: commandId, result_summary: result }); }
  fail(commandId, code, summary) { return this.call('worker_fail', { command_id: commandId, error_code: code, error_summary: summary }); }
  manifest(commandId, caseJobId) { return this.call('worker_manifest', { command_id: commandId, case_job_id: caseJobId }); }
  checkpoint(commandId, caseJobId, caseRevision, stage, progress, safeMetadata = {}) {
    return this.call('worker_checkpoint', { command_id: commandId, case_job_id: caseJobId, case_revision: caseRevision, stage, progress, safe_metadata: safeMetadata });
  }
  publishOutput(commandId, caseJobId, caseRevision, outputType, contentType, content, sha256) {
    return this.call('worker_publish_output', { command_id: commandId, case_job_id: caseJobId, case_revision: caseRevision, output_type: outputType, content_type: contentType, content, sha256 });
  }
  commitBundle(commandId, caseJobId, caseRevision, bundleSha256, reportSha256, bundle) {
    return this.call('worker_commit_bundle', {
      command_id: commandId, case_job_id: caseJobId, case_revision: caseRevision,
      bundle_sha256: bundleSha256, report_sha256: reportSha256, bundle,
    });
  }
  jobState(commandId, caseJobId) {
    return this.call('worker_job_state', { command_id: commandId, case_job_id: caseJobId });
  }
  acknowledgeCancel(commandId, caseJobId) {
    return this.call('worker_cancel_ack', { command_id: commandId, case_job_id: caseJobId });
  }
}
