const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  formatCliError,
  isOpencodeSessionCorruptionError,
  humanizeOpencodeProviderError,
  lastCliError,
} = require("./panel-cli");

describe("panel-cli opencode session errors", () => {
  const duplicatePayload =
    '{"name":"APIError","data":{"message":"Error from provider (Console): Upstream request failed: [invalid_request_error] Duplicate function_call_output for call_id \'read:2\'. Each function_call must have exactly one matching function_call_output","statusCode":400}}';

  it("detects duplicate function_call_output corruption", () => {
    assert.equal(isOpencodeSessionCorruptionError(duplicatePayload), true);
  });

  it("humanizes APIError JSON from OpenCode provider", () => {
    const message = humanizeOpencodeProviderError(duplicatePayload);
    assert.match(message, /sessão do OpenCode/i);
    assert.match(message, /envie a mensagem de novo/i);
  });

  it("formatCliError prefers humanized corruption message", () => {
    const message = formatCliError("opencode", duplicatePayload, null);
    assert.match(message, /sessão do OpenCode/i);
  });

  it("ignores corruption activity from before the current run", () => {
    const since = Date.now();
    const snapshot = {
      activity: [
        {
          status: "error",
          detail:
            "Duplicate function_call_output for call_id 'read:2'. Each function_call must have exactly one matching function_call_output",
          at: new Date(since - 60_000).toISOString(),
        },
      ],
    };
    assert.equal(lastCliError(snapshot, since), null);
    assert.doesNotMatch(formatCliError("opencode", "", snapshot, since), /sessão do OpenCode/i);
  });
});
