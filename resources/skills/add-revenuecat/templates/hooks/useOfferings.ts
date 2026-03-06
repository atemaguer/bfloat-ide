import { useEffect, useState } from "react";
import Purchases, { PurchasesOfferings } from "react-native-purchases";
import { Platform } from "react-native";

const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY;
let configurePromise: Promise<void> | null = null;

function isUninitializedPurchasesError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /no singleton instance|configure purchases/i.test(message);
}

async function ensurePurchasesConfigured(): Promise<void> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    return;
  }

  if (!apiKey) {
    throw new Error("EXPO_PUBLIC_REVENUECAT_API_KEY is not set.");
  }

  if (!configurePromise) {
    configurePromise = (async () => {
      await Purchases.configure({ apiKey });
    })().catch((error) => {
      configurePromise = null;
      throw error;
    });
  }

  await configurePromise;
}

async function withConfiguredPurchases<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isUninitializedPurchasesError(error)) {
      throw error;
    }

    await ensurePurchasesConfigured();
    return operation();
  }
}

interface UseOfferingsResult {
  offerings: PurchasesOfferings | null;
  currentOffering: Purchases.PurchasesOffering | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch RevenueCat offerings
 *
 * @example
 * const { currentOffering, isLoading } = useOfferings();
 *
 * if (isLoading) return <ActivityIndicator />;
 *
 * return (
 *   <View>
 *     {currentOffering?.availablePackages.map((pkg) => (
 *       <PackageItem key={pkg.identifier} package={pkg} />
 *     ))}
 *   </View>
 * );
 */
export function useOfferings(): UseOfferingsResult {
  const [offerings, setOfferings] = useState<PurchasesOfferings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchOfferings = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const fetchedOfferings = await withConfiguredPurchases(() => Purchases.getOfferings());
      setOfferings(fetchedOfferings);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to fetch offerings"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOfferings();
  }, []);

  return {
    offerings,
    currentOffering: offerings?.current ?? null,
    isLoading,
    error,
    refetch: fetchOfferings,
  };
}
