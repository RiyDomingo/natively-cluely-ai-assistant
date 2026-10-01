import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const { resolveCompanySearchProvider } = require(path.join(
  root,
  'dist-electron/electron/services/resolveCompanySearchProvider.js',
));

const credentials = (overrides = {}) => ({
  getTavilyApiKey: () => undefined,
  getNativelyApiKey: () => undefined,
  getTrialToken: () => undefined,
  ...overrides,
});

test('default loader returns null when the Premium checkout is absent', () => {
  const provider = resolveCompanySearchProvider(credentials({
    getTavilyApiKey: () => 'configured-tavily-key',
    getNativelyApiKey: () => 'configured-natively-key',
  }));

  assert.equal(provider, null);
});

test('missing Premium providers return null without attempting to construct one', () => {
  const requested = [];
  const provider = resolveCompanySearchProvider(
    credentials({
      getTavilyApiKey: () => 'configured-tavily-key',
      getNativelyApiKey: () => 'configured-natively-key',
    }),
    (moduleName) => {
      requested.push(moduleName);
      return null;
    },
  );

  assert.equal(provider, null);
  assert.deepEqual(requested, ['TavilySearchProvider', 'NativelySearchProvider']);
});

test('authorized Premium provider constructors preserve Tavily-first behavior', () => {
  class TavilyProvider {
    constructor(apiKey) { this.apiKey = apiKey; }
  }
  const requested = [];
  const provider = resolveCompanySearchProvider(
    credentials({
      getTavilyApiKey: () => 'configured-tavily-key',
      getNativelyApiKey: () => 'configured-natively-key',
    }),
    (moduleName) => {
      requested.push(moduleName);
      return moduleName === 'TavilySearchProvider' ? TavilyProvider : null;
    },
  );

  assert.ok(provider instanceof TavilyProvider);
  assert.equal(provider.apiKey, 'configured-tavily-key');
  assert.deepEqual(requested, ['TavilySearchProvider']);
});

test('trial sentinel is forwarded with its trial token to the Natively provider', () => {
  class NativelyProvider {
    constructor(apiKey, trialToken) {
      this.apiKey = apiKey;
      this.trialToken = trialToken;
    }
  }
  const provider = resolveCompanySearchProvider(
    credentials({
      getNativelyApiKey: () => '__trial__',
      getTrialToken: () => 'signed-trial-token',
    }),
    (moduleName) => moduleName === 'NativelySearchProvider' ? NativelyProvider : null,
  );

  assert.ok(provider instanceof NativelyProvider);
  assert.equal(provider.apiKey, '__trial__');
  assert.equal(provider.trialToken, 'signed-trial-token');
});
