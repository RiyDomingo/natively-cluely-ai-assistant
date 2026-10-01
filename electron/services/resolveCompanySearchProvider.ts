// electron/services/resolveCompanySearchProvider.ts
// Single source of truth for the company-research search provider cascade:
//   Tavily (user key) → Natively API proxy (Natively key / trial token) → null (LLM-only).
// Used by both the manual profile:research-company IPC handler and the automatic
// AOT pipeline (injected via KnowledgeOrchestrator.setSearchProviderResolver),
// so the two paths cannot drift. Resolve per invocation — never cache the
// result — because keys can be added, changed, or removed mid-session.

import { TRIAL_SENTINEL_KEY } from '../config/constants';
import fs from 'node:fs';
import path from 'node:path';

/** Public side of the optional Premium search-provider contract. */
export interface CompanySearchProvider {
  search(query: string, maxResults?: number): Promise<any[]>;
  extractUrl?: (url: string) => Promise<any>;
  readonly quotaExhausted?: boolean;
}

interface CompanySearchCredentials {
  getTavilyApiKey(): string | undefined;
  getNativelyApiKey(): string | undefined;
  getTrialToken(): string | undefined;
}

type PremiumProviderName = 'TavilySearchProvider' | 'NativelySearchProvider';
type PremiumProviderConstructor = new (
  apiKey: string,
  trialToken?: string,
) => CompanySearchProvider;
type PremiumProviderLoader = (
  moduleName: PremiumProviderName,
) => PremiumProviderConstructor | null;

/**
 * Locate a compiled Premium provider without giving esbuild a static private
 * import to resolve. The two roots cover this module bundled into main.js and
 * emitted as its own entry point. Source-tree execution is covered by the
 * second root as well.
 */
function loadPremiumProvider(
  moduleName: PremiumProviderName,
): PremiumProviderConstructor | null {
  const relativeModule = path.join('premium', 'electron', 'knowledge', moduleName);
  const moduleBases = [
    path.resolve(__dirname, '..', relativeModule),
    path.resolve(__dirname, '..', '..', relativeModule),
  ];

  for (const moduleBase of moduleBases) {
    const modulePath = ['.js', '.ts']
      .map((extension) => `${moduleBase}${extension}`)
      .find((candidate) => fs.existsSync(candidate));
    if (!modulePath) continue;

    const premiumModule = require(modulePath) as Record<string, unknown>;
    const Provider = premiumModule[moduleName];
    if (typeof Provider !== 'function') {
      throw new TypeError(`Premium provider module does not export ${moduleName}`);
    }
    return Provider as PremiumProviderConstructor;
  }

  return null;
}

export function resolveCompanySearchProvider(
  credentials?: CompanySearchCredentials,
  loadProvider: PremiumProviderLoader = loadPremiumProvider,
): CompanySearchProvider | null {
  // Keep CredentialsManager lazy so the pure resolution cascade can be tested
  // without initializing Electron's safe-storage integration.
  const cm = credentials ?? (
    require('./CredentialsManager') as typeof import('./CredentialsManager')
  ).CredentialsManager.getInstance();

  const tavilyApiKey = cm.getTavilyApiKey();
  if (tavilyApiKey) {
    const TavilySearchProvider = loadProvider('TavilySearchProvider');
    if (TavilySearchProvider) {
      return new TavilySearchProvider(tavilyApiKey);
    }
  }

  const nativelyKey = cm.getNativelyApiKey();
  if (nativelyKey) {
    const NativelySearchProvider = loadProvider('NativelySearchProvider');
    if (NativelySearchProvider) {
      // Pass the real trial token when the key is the __trial__ sentinel so the
      // server can authenticate via x-trial-token instead of the invalid key.
      const trialToken = nativelyKey === TRIAL_SENTINEL_KEY ? cm.getTrialToken() : undefined;
      console.log('[CompanySearch] Using Natively API search (no Tavily key configured)');
      return new NativelySearchProvider(nativelyKey, trialToken ?? undefined);
    }
  }

  return null;
}
