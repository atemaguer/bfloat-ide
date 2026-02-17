import { useState } from "react";
import Purchases, { PurchasesPackage } from "react-native-purchases";

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

      const { customerInfo } = await Purchases.purchasePackage(pkg);

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

      const customerInfo = await Purchases.restorePurchases();

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
