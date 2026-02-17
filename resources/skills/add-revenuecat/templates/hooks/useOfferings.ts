import { useEffect, useState } from "react";
import Purchases, { PurchasesOfferings } from "react-native-purchases";

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
      const fetchedOfferings = await Purchases.getOfferings();
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
