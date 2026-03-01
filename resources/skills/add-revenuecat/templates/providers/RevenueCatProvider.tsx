import Purchases, { LOG_LEVEL } from "react-native-purchases";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";
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

interface RevenueCatContextType {
  isReady: boolean;
  customerInfo: Purchases.CustomerInfo | null;
  isPro: boolean;
}

const RevenueCatContext = createContext<RevenueCatContextType>({
  isReady: false,
  customerInfo: null,
  isPro: false,
});

export function useRevenueCat() {
  return useContext(RevenueCatContext);
}

export default function RevenueCatProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<Purchases.CustomerInfo | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function initPurchases() {
      if (__DEV__) {
        Purchases.setLogLevel(LOG_LEVEL.DEBUG);
      }

      try {
        await ensurePurchasesConfigured();
        const info = await Purchases.getCustomerInfo();
        if (isMounted) {
          setCustomerInfo(info);
          setIsReady(true);
        }
      } catch (error) {
        if (isUninitializedPurchasesError(error)) {
          // Fallback path if an API call races configuration during app startup.
          await ensurePurchasesConfigured();
          const info = await Purchases.getCustomerInfo();
          if (isMounted) {
            setCustomerInfo(info);
            setIsReady(true);
          }
          return;
        }

        console.warn("RevenueCat initialization failed:", error);
      }
    }

    initPurchases();

    const listener = (info: Purchases.CustomerInfo) => {
      if (isMounted) {
        setCustomerInfo(info);
      }
    };
    Purchases.addCustomerInfoUpdateListener(listener);

    return () => {
      isMounted = false;
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, []);

  // Check if user has "premium" entitlement - adjust this to match your entitlement ID
  const isPro = customerInfo?.entitlements.active["premium"] !== undefined;

  return (
    <RevenueCatContext.Provider value={{ isReady, customerInfo, isPro }}>
      {children}
    </RevenueCatContext.Provider>
  );
}
