import { lt, valid } from 'semver';

/**
 * Whether the running Runtipi version is lower than the minimum version a manifest requires.
 * Builds whose version is not valid semver (for example development builds) are never considered too old.
 */
export const isBelowMinTipiVersion = (currentVersion: string, minTipiVersion?: string | null) => {
  if (!minTipiVersion || !valid(currentVersion) || !valid(minTipiVersion)) {
    return false;
  }

  return lt(currentVersion, minTipiVersion);
};
