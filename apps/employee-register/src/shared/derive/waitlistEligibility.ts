export type WaitlistEntryEligibilityInput = {
  id: string;
  status: string;
  desiredTier: string;
};

type InventoryAvailability = {
  rawRooms: Record<string, number>;
} | null;

type EligibilityResult = {
  offeredCountByTier: Record<string, number>;
  isEntryOfferEligible: (entry: WaitlistEntryEligibilityInput) => boolean;
  eligibleEntryCount: number;
  hasEligibleEntries: boolean;
};

export function deriveWaitlistEligibility(
  entries: WaitlistEntryEligibilityInput[],
  inventoryAvailable: InventoryAvailability
): EligibilityResult {
  const offeredCountByTier = entries.reduce<Record<string, number>>((acc, entry) => {
    if (entry.status === 'OFFERED') {
      acc[entry.desiredTier] = (acc[entry.desiredTier] || 0) + 1;
    }
    return acc;
  }, {});

  const isEntryOfferEligible = (entry: WaitlistEntryEligibilityInput): boolean => {
    if (entry.status === 'OFFERED') return true;
    if (entry.status !== 'ACTIVE') return false;
    if (!inventoryAvailable) return false;
    const tier = entry.desiredTier;
    const raw = Number(inventoryAvailable.rawRooms?.[tier] ?? 0);
    const offered = Number(offeredCountByTier[tier] ?? 0);
    return raw - offered > 0;
  };

  const eligibleEntryCount = entries.filter(isEntryOfferEligible).length;

  return {
    offeredCountByTier,
    isEntryOfferEligible,
    eligibleEntryCount,
    hasEligibleEntries: eligibleEntryCount > 0,
  };
}
