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
}
