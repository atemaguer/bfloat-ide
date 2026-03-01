import { useState } from "react";
import Purchases, { PurchasesPackage } from "react-native-purchases";
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

interface UsePurchasesResult {
  purchasePackage: (pkg: PurchasesPackage) => Promise<boolean>;
  restorePurchases: () => Promise<boolean>;
  isProcessing: boolean;
  error: Error | null;
}

/**
 * Hook for handling RevenueCat purchases and restores
 *
 * @example
 * const { purchasePackage, restorePurchases, isProcessing } = usePurchases();
 *
 * const handlePurchase = async (pkg: PurchasesPackage) => {
 *   const success = await purchasePackage(pkg);
 *   if (success) {
 *     // Purchase successful - user now has access
 *   }
 * };
 *
 * const handleRestore = async () => {
 *   const success = await restorePurchases();
 *   if (success) {
 *     // Restore successful
 *   }
 * };
 */
export function usePurchases(): UsePurchasesResult {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const purchasePackage = async (pkg: PurchasesPackage): Promise<boolean> => {
    try {
      setIsProcessing(true);
      setError(null);

      const { customerInfo } = await withConfiguredPurchases(() => Purchases.purchasePackage(pkg));

      // Check if any entitlements are now active
      const hasActiveEntitlement = Object.keys(customerInfo.entitlements.active).length > 0;

      return hasActiveEntitlement;
    } catch (err: any) {
      // User cancelled - this is not an error
      if (err.userCancelled) {
        return false;
      }

      setError(err instanceof Error ? err : new Error("Purchase failed"));
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  const restorePurchases = async (): Promise<boolean> => {
    try {
      setIsProcessing(true);
      setError(null);

      const customerInfo = await withConfiguredPurchases(() => Purchases.restorePurchases());

      // Check if any entitlements are now active
      const hasActiveEntitlement = Object.keys(customerInfo.entitlements.active).length > 0;

      return hasActiveEntitlement;
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Restore failed"));
      return false;
    } finally {
      setIsProcessing(false);
    }
  };

  return {
    purchasePackage,
    restorePurchases,
    isProcessing,
    error,
  };
}
