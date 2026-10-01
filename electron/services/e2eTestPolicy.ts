// Main owns test authorization. A launch environment alone must never enable
// privileged test interfaces in a packaged application.
export const E2E_TEST_POLICY_CHANNEL = 'e2e-test-policy';

export function isE2eTestEnabled(isPackaged: boolean, flag: string | undefined): boolean {
  return !isPackaged && flag === '1';
}

export const E2E_TEST_CHANNELS = Object.freeze([
  '__e2e__:upload-reference-file-from-path',
  '__e2e__:add-reference-file',
  '__e2e__:prewarm-mode',
  '__e2e__:reindex-embeddings',
  '__e2e__:index-status',
  '__e2e__:dump-okf-cards',
  '__e2e__:inspect-retrieval',
  '__e2e__:detect-question',
  '__e2e__:inject-transcript',
  '__e2e__:ingest-profile-doc',
  '__e2e__:profile-state',
  '__e2e__:clear-profile',
  '__e2e__:ask',
  '__e2e__:context-os-benchmark-audit',
  '__e2e__:context-os-benchmark-audit-clear',
  '__e2e__:context-os-prompt-audit',
  '__e2e__:context-os-prompt-audit-clear',
  '__e2e__:manual-ask',
  '__e2e__:last-provider-model',
  '__e2e__:reset-session',
  '__e2e__:enable-pro',
] as const);

const allowedChannels: ReadonlySet<string> = new Set(E2E_TEST_CHANNELS);

export interface E2eTestBridge {
  e2eInvoke?: (channel: string, ...args: any[]) => Promise<any>;
}

export function createE2eTestBridge(
  mainDecision: unknown,
  invoke: (channel: string, ...args: any[]) => Promise<any>,
): E2eTestBridge {
  if (mainDecision !== true) return {};
  return {
    e2eInvoke: async (channel: string, ...args: any[]) => {
      // No prefix wildcard: the test bridge must not become a generic route
      // around the named production preload APIs, even in development.
      if (typeof channel !== 'string' || !allowedChannels.has(channel)) {
        throw new Error('E2E channel not allowed');
      }
      return invoke(channel, ...args);
    },
  };
}
