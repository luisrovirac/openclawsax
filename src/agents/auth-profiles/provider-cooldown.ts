// src/agents/auth-profiles/provider-cooldown.ts

import path from "node:path";
import { resolveAuthStorePath } from "./paths.js";
import { withFileLock, type FileLockOptions } from "../../plugin-sdk/file-lock.js";
import { loadJsonFile, saveJsonFile } from "../../infra/json-file.js";
import type { AuthProfileFailureReason } from "./types.js";
import type { ProviderGlobalCooldown, ProviderGlobalCooldownStore } from "./types.js";
import { log } from "./constants.js";

const PROVIDER_COOLDOWN_VERSION = 1;
const PROVIDER_COOLDOWN_FILE = "provider-cooldowns.json";

function resolveProviderCooldownPath(agentDir?: string): string {
  const authPath = resolveAuthStorePath(agentDir);
  return path.join(path.dirname(authPath), PROVIDER_COOLDOWN_FILE);
}

export function loadProviderCooldownStore(agentDir?: string): ProviderGlobalCooldownStore {
  const cooldownPath = resolveProviderCooldownPath(agentDir);
  const raw = loadJsonFile(cooldownPath);
  
  if (raw && typeof raw === "object" && "cooldowns" in raw) {
    return raw as ProviderGlobalCooldownStore;
  }
  
  return {
    version: PROVIDER_COOLDOWN_VERSION,
    cooldowns: {},
  };
}

export function saveProviderCooldownStore(
  store: ProviderGlobalCooldownStore,
  agentDir?: string
): void {
  const cooldownPath = resolveProviderCooldownPath(agentDir);
  saveJsonFile(cooldownPath, store);
}

export async function updateProviderCooldownStoreWithLock<T>(
  agentDir: string | undefined,
  updater: (store: ProviderGlobalCooldownStore) => T
): Promise<T> {
  const cooldownPath = resolveProviderCooldownPath(agentDir);
  
  // CORREGIDO: Usar la estructura correcta para file-lock
  const lockOptions: FileLockOptions = {
    retries: {
      retries: 10,        // 10 intentos
      factor: 2,          // backoff exponencial
      minTimeout: 100,    // 100ms inicial
      maxTimeout: 5000,   // max 5 segundos
      randomize: true,    // jitter para evitar thundering herd
    },
    stale: 30000,         // 30 segundos para locks stale
  };
  
  return withFileLock(cooldownPath, lockOptions, async () => {
    const store = loadProviderCooldownStore(agentDir);
    const result = updater(store);
    saveProviderCooldownStore(store, agentDir);
    return result;
  });
}

/**
 * Calcula el tiempo de cooldown basado en la razón y el número de intentos
 */
export function calculateProviderCooldownMs(
  reason: AuthProfileFailureReason,
  attemptCount: number
): number {
  const baseDurations: Record<AuthProfileFailureReason, number> = {
    billing: 300_000,      // 5 min base
    rate_limit: 60_000,     // 1 min base
    auth: 300_000,          // 5 min base
    timeout: 30_000,        // 30 seg base
    format: 10_000,         // 10 seg base
    model_not_found: 300_000, // 5 min base
    unknown: 60_000,        // 1 min base
  };
  
  const baseMs = baseDurations[reason] ?? 60_000;
  const normalized = Math.max(1, attemptCount);
  
  // Backoff exponencial: base * 2^(attempt-1), max 1 hora
  const multiplier = Math.min(Math.pow(2, normalized - 1), 64); // 2^6 = 64 max
  const calculated = baseMs * multiplier;
  
  // CORREGIDO: Asegurar que el máximo sea 1 hora (3,600,000 ms)
  return Math.min(calculated, 3_600_000);
}

/**
 * Marca un proveedor en cooldown global
 */
export async function markProviderGlobalCooldown(params: {
  provider: string;
  reason: AuthProfileFailureReason;
  agentDir?: string;
  affectedProfiles?: string[];
  customDurationMs?: number;
}): Promise<void> {
  const { provider, reason, agentDir, affectedProfiles, customDurationMs } = params;
  
  await updateProviderCooldownStoreWithLock(agentDir, (store) => {
    const now = Date.now();
    const existing = store.cooldowns[provider];
    
    const attemptCount = existing?.attemptCount ?? 0;
    const nextAttemptCount = attemptCount + 1;
    
    const durationMs = customDurationMs ?? calculateProviderCooldownMs(reason, nextAttemptCount);
    
    store.cooldowns[provider] = {
      provider,
      until: now + durationMs,
      reason,
      attemptCount: nextAttemptCount,
      lastError: reason,
      affectedProfiles,
    };
    
    log.debug(`Provider ${provider} in global cooldown for ${durationMs}ms due to ${reason}`);
    return store;
  });
}

/**
 * Verifica si un proveedor está en cooldown global
 */
export async function isProviderInGlobalCooldown(
  provider: string,
  agentDir?: string
): Promise<{
  inCooldown: boolean;
  cooldown?: ProviderGlobalCooldown;
  remainingMs?: number;
}> {
  const store = loadProviderCooldownStore(agentDir);
  const cooldown = store.cooldowns[provider];
  
  if (!cooldown) {
    return { inCooldown: false };
  }
  
  const now = Date.now();
  if (now < cooldown.until) {
    return {
      inCooldown: true,
      cooldown,
      remainingMs: cooldown.until - now,
    };
  }
  
  // Cooldown expirado, limpiar
  await updateProviderCooldownStoreWithLock(agentDir, (s) => {
    delete s.cooldowns[provider];
    return s;
  });
  
  return { inCooldown: false };
}

/**
 * Limpia cooldowns expirados
 */
export async function clearExpiredProviderCooldowns(agentDir?: string): Promise<number> {
  return updateProviderCooldownStoreWithLock(agentDir, (store) => {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [provider, cooldown] of Object.entries(store.cooldowns)) {
      if (now >= cooldown.until) {
        delete store.cooldowns[provider];
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      log.debug(`Cleaned ${cleaned} expired provider cooldowns`);
    }
    
    return cleaned;
  });
}

/**
 * Limpia manualmente el cooldown de un proveedor
 */
export async function clearProviderGlobalCooldown(
  provider: string,
  agentDir?: string
): Promise<boolean> {
  return updateProviderCooldownStoreWithLock(agentDir, (store) => {
    if (store.cooldowns[provider]) {
      delete store.cooldowns[provider];
      log.debug(`Cleared global cooldown for provider ${provider}`);
      return true;
    }
    return false;
  });
}

/**
 * Obtiene estadísticas de cooldown por proveedor
 */
export async function getProviderCooldownStats(agentDir?: string): Promise<{
  totalProviders: number;
  activeCooldowns: number;
  cooldownsByReason: Record<AuthProfileFailureReason, number>;
  soonestExpiry: { provider: string; remainingMs: number } | null;
}> {
  const store = loadProviderCooldownStore(agentDir);
  const now = Date.now();
  
  const activeCooldowns = Object.values(store.cooldowns).filter(c => c.until > now);
  const cooldownsByReason = {} as Record<AuthProfileFailureReason, number>;
  
  for (const cooldown of activeCooldowns) {
    cooldownsByReason[cooldown.reason] = (cooldownsByReason[cooldown.reason] ?? 0) + 1;
  }
  
  // Encontrar el que expira más pronto
  let soonest: { provider: string; until: number } | null = null;
  for (const [provider, cooldown] of Object.entries(store.cooldowns)) {
    if (cooldown.until > now) {
      if (!soonest || cooldown.until < soonest.until) {
        soonest = { provider, until: cooldown.until };
      }
    }
  }
  
  const soonestWithRemaining = soonest
    ? {
        provider: soonest.provider,
        remainingMs: Math.max(0, soonest.until - now),
      }
    : null;
  
  return {
    totalProviders: Object.keys(store.cooldowns).length,
    activeCooldowns: activeCooldowns.length,
    cooldownsByReason,
    soonestExpiry: soonestWithRemaining,
  };
}
