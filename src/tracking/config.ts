import { DomainValidationError } from "../domain/errors.js";

export interface TrackingConfig {
  readonly version: 1;
  readonly softThreshold: number;
  readonly hardFailCap: number;
  readonly unobservedHighCap: number;
  readonly minorPDip: number;
}

export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  version: 1,
  softThreshold: 0.55,
  hardFailCap: 0.3,
  unobservedHighCap: 0.54,
  minorPDip: 0.03
};

/**
 * User-authored threshold change. The execution model cannot call this;
 * analysis may only propose a candidate that later uses this helper.
 */
export function applyUserThreshold(config: TrackingConfig, softThreshold: number): TrackingConfig {
  if (!Number.isFinite(softThreshold) || softThreshold <= 0 || softThreshold >= 1) {
    throw new DomainValidationError("soft threshold must be a finite number in (0, 1)");
  }
  return { ...config, softThreshold };
}

export function trackingConfig(overrides: Partial<Omit<TrackingConfig, "version">> = {}): TrackingConfig {
  return {
    version: 1,
    softThreshold: overrides.softThreshold ?? DEFAULT_TRACKING_CONFIG.softThreshold,
    hardFailCap: overrides.hardFailCap ?? DEFAULT_TRACKING_CONFIG.hardFailCap,
    unobservedHighCap: overrides.unobservedHighCap ?? DEFAULT_TRACKING_CONFIG.unobservedHighCap,
    minorPDip: overrides.minorPDip ?? DEFAULT_TRACKING_CONFIG.minorPDip
  };
}
