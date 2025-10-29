// Copyright 2025 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Root from '../root/root.js';

import * as DispatchHttpRequestClient from './DispatchHttpRequestClient.js';
import type {DispatchHttpRequestRequest} from './InspectorFrontendHostAPI.js';

export enum SubscriptionStatus {
  ENABLED = 'SUBSCRIPTION_STATE_ENABLED',
  PENDING = 'SUBSCRIPTION_STATE_PENDING',
  CANCELED = 'SUBSCRIPTION_STATE_CANCELED',
  REFUNDED = 'SUBSCRIPTION_STATE_REFUNDED',
  AWAITING_FIX = 'SUBSCRIPTION_STATE_AWAITING_FIX',
  ON_HOLD = 'SUBSCRIPTION_STATE_ACCOUNT_ON_HOLD',
}

export enum SubscriptionTier {
  PREMIUM_ANNUAL = 'SUBSCRIPTION_TIER_PREMIUM_ANNUAL',
  PREMIUM_MONTHLY = 'SUBSCRIPTION_TIER_PREMIUM_MONTHLY',
  PRO_ANNUAL = 'SUBSCRIPTION_TIER_PRO_ANNUAL',
  PRO_MONTHLY = 'SUBSCRIPTION_TIER_PRO_MONTHLY',
}

export enum EligibilityStatus {
  ELIGIBLE = 'ELIGIBLE',
  NOT_ELIGIBLE = 'NOT_ELIGIBLE',
}

export enum EmailPreference {
  ENABLED = 'ENABLED',
  DISABLED = 'DISABLED',
}

interface CheckElibigilityResponse {
  createProfile: EligibilityStatus;
}

interface BatchGetAwardsResponse {
  awards?: Award[];
}

export interface Award {
  name: string;
  badge: {
    title: string,
    description: string,
    imageUri: string,
    deletableByUser: boolean,
  };
  title: string;
  description: string;
  imageUri: string;
  createTime: string;
  awardingUri: string;
}

export interface Profile {
  // Resource name of the profile.
  // Format: profiles/{obfuscated_profile_id}
  name: string;
  activeSubscription?: {
    subscriptionStatus: SubscriptionStatus,
    // To ensure forward compatibility, we accept any string, allowing the server to
    // introduce new subscription tiers without breaking older clients.
    subscriptionTier: SubscriptionTier|string,
  };
}

export interface GetProfileResponse {
  profile: Profile|null;
  isEligible: boolean;
}

/**
 * The `batchGet` awards endpoint returns badge names with an
 * obfuscated user ID (e.g., `profiles/12345/awards/badge-name`).
 * This function normalizes them to use `me` instead of the ID
 * (e.g., `profiles/me/awards/badge-path`) to match the format
 * used for client-side requests.
 **/
function normalizeBadgeName(name: string): string {
  return name.replace(/profiles\/[^/]+\/awards\//, 'profiles/me/awards/');
}

export const GOOGLE_DEVELOPER_PROGRAM_PROFILE_LINK = 'https://developers.google.com/profile/u/me';

async function makeHttpRequest<R>(request: DispatchHttpRequestRequest): Promise<R> {
  if (!isGdpProfilesAvailable()) {
    throw new DispatchHttpRequestClient.DispatchHttpRequestError(
        DispatchHttpRequestClient.ErrorType.HTTP_RESPONSE_UNAVAILABLE);
  }

  const response = await DispatchHttpRequestClient.makeHttpRequest(request) as R;
  return response;
}

const SERVICE_NAME = 'gdpService';
let gdpClientInstance: GdpClient|null = null;
export class GdpClient {
  #cachedProfilePromise?: Promise<Profile>;
  #cachedEligibilityPromise?: Promise<CheckElibigilityResponse>;

  private constructor() {
  }

  static instance({forceNew}: {
    forceNew: boolean,
  } = {forceNew: false}): GdpClient {
    if (!gdpClientInstance || forceNew) {
      gdpClientInstance = new GdpClient();
    }
    return gdpClientInstance;
  }

  /**
   * Fetches the user's GDP profile and eligibility status.
   *
   * It first attempts to fetch the profile. If the profile is not found
   * (a `NOT_FOUND` error), this is handled gracefully by treating the profile
   * as `null` and then proceeding to check for eligibility.
   *
   * @returns A promise that resolves with an object containing the `profile`
   * and `isEligible` status, or `null` if an unexpected error occurs.
   */
  async getProfile(): Promise<GetProfileResponse|null> {
    try {
      const profile = await this.#getProfile();
      return {
        profile,
        isEligible: true,
      };
    } catch (err: unknown) {
      if (err instanceof DispatchHttpRequestClient.DispatchHttpRequestError &&
          err.type === DispatchHttpRequestClient.ErrorType.HTTP_RESPONSE_UNAVAILABLE) {
        return null;
      }
    }

    try {
      const checkEligibilityResponse = await this.#checkEligibility();
      return {
        profile: null,
        isEligible: checkEligibilityResponse.createProfile === EligibilityStatus.ELIGIBLE,
      };
    } catch {
      return null;
    }
  }

  async #getProfile(): Promise<Profile> {
    if (this.#cachedProfilePromise) {
      return await this.#cachedProfilePromise;
    }

    this.#cachedProfilePromise = makeHttpRequest<Profile>({
                                   service: SERVICE_NAME,
                                   path: '/v1beta1/profile:get',
                                   method: 'GET',
                                 }).then(profile => {
      this.#cachedEligibilityPromise = Promise.resolve({createProfile: EligibilityStatus.ELIGIBLE});
      return profile;
    });

    return await this.#cachedProfilePromise;
  }

  async #checkEligibility(): Promise<CheckElibigilityResponse> {
    if (this.#cachedEligibilityPromise) {
      return await this.#cachedEligibilityPromise;
    }

    this.#cachedEligibilityPromise =
        makeHttpRequest({service: SERVICE_NAME, path: '/v1beta1/eligibility:check', method: 'GET'});

    return await this.#cachedEligibilityPromise;
  }

  /**
   * @returns null if the request fails, the awarded badge names otherwise.
   */
  async getAwardedBadgeNames({names}: {names: string[]}): Promise<Set<string>|null> {
    try {
      const response = await makeHttpRequest<BatchGetAwardsResponse>({
        service: SERVICE_NAME,
        path: '/v1beta1/profiles/me/awards:batchGet',
        method: 'GET',
        queryParams: {
          allowMissing: 'true',
          names,
        }
      });

      return new Set(response.awards?.map(award => normalizeBadgeName(award.name)) ?? []);
    } catch {
      return null;
    }
  }

  async createProfile({user, emailPreference}: {user: string, emailPreference: EmailPreference}):
      Promise<Profile|null> {
    try {
      const response = await makeHttpRequest<Profile>({
        service: SERVICE_NAME,
        path: '/v1beta1/profiles',
        method: 'POST',
        body: JSON.stringify({
          user,
          newsletter_email: emailPreference,
        }),
      });
      this.#clearCache();
      return response;
    } catch {
      return null;
    }
  }

  #clearCache(): void {
    this.#cachedProfilePromise = undefined;
    this.#cachedEligibilityPromise = undefined;
  }

  async createAward({name}: {name: string}): Promise<Award|null> {
    try {
      const response = await makeHttpRequest<Award>({
        service: SERVICE_NAME,
        path: '/v1beta1/profiles/me/awards',
        method: 'POST',
        body: JSON.stringify({
          awardingUri: 'devtools://devtools',
          name,
        })
      });
      return response;
    } catch {
      return null;
    }
  }
}

export function isGdpProfilesAvailable(): boolean {
  const isBaseFeatureEnabled = Boolean(Root.Runtime.hostConfig.devToolsGdpProfiles?.enabled);
  const isBrandedBuild = Boolean(Root.Runtime.hostConfig.devToolsGdpProfilesAvailability?.enabled);
  const isOffTheRecordProfile = Root.Runtime.hostConfig.isOffTheRecord;
  const isDisabledByEnterprisePolicy =
      getGdpProfilesEnterprisePolicy() === Root.Runtime.GdpProfilesEnterprisePolicyValue.DISABLED;
  return isBaseFeatureEnabled && isBrandedBuild && !isOffTheRecordProfile && !isDisabledByEnterprisePolicy;
}

export function getGdpProfilesEnterprisePolicy(): Root.Runtime.GdpProfilesEnterprisePolicyValue {
  return (
      Root.Runtime.hostConfig.devToolsGdpProfilesAvailability?.enterprisePolicyValue ??
      Root.Runtime.GdpProfilesEnterprisePolicyValue.DISABLED);
}

export function isBadgesEnabled(): boolean {
  const isBadgesEnabledByEnterprisePolicy =
      getGdpProfilesEnterprisePolicy() === Root.Runtime.GdpProfilesEnterprisePolicyValue.ENABLED;
  const isBadgesEnabledByFeatureFlag = Boolean(Root.Runtime.hostConfig.devToolsGdpProfiles?.badgesEnabled);
  return isBadgesEnabledByEnterprisePolicy && isBadgesEnabledByFeatureFlag;
}

export function isStarterBadgeEnabled(): boolean {
  return Boolean(Root.Runtime.hostConfig.devToolsGdpProfiles?.starterBadgeEnabled);
}
