// External harness coordination; never bundled into the application.
function createReadiness() {
  let resolve, reject, settled = false;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  // Startup may fail before the upgrade listener begins awaiting this promise.
  promise.catch(() => {});
  return {
    promise,
    ready(result) {
      if (settled) return;
      settled = true;
      if (!result || result.packaged !== true || result.visible !== true || !Number.isSafeInteger(result.renderedCharacters) || result.renderedCharacters < 50
        || result.bridge !== 'undefined' || !Array.isArray(result.registeredTestChannels) || result.registeredTestChannels.length !== 0
        || result.syntheticHandlerCaptured !== false || !Array.isArray(result.policyReplies) || !result.policyReplies.length
        || result.policyReplies.some(value => value !== false)) {
        reject(new Error('Baseline security readiness checks failed'));
      } else resolve(result);
    },
    fail(error) { if (!settled) { settled = true; reject(error); } },
  };
}
module.exports = { createReadiness };
