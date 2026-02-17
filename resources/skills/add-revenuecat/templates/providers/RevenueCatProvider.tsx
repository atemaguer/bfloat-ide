import Purchases, { LOG_LEVEL } from "react-native-purchases";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";

const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY!;

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
    async function initPurchases() {
      if (__DEV__) {
        Purchases.setLogLevel(LOG_LEVEL.DEBUG);
      }

      if (Platform.OS === "ios") {
        await Purchases.configure({ apiKey });
      } else if (Platform.OS === "android") {
        await Purchases.configure({ apiKey });
      }

      // Get initial customer info
      const info = await Purchases.getCustomerInfo();
      setCustomerInfo(info);
      setIsReady(true);

      // Listen for customer info updates
      Purchases.addCustomerInfoUpdateListener((info) => {
        setCustomerInfo(info);
      });
    }

    initPurchases();
  }, []);

  // Check if user has "premium" entitlement - adjust this to match your entitlement ID
  const isPro = customerInfo?.entitlements.active["premium"] !== undefined;

  return (
    <RevenueCatContext.Provider value={{ isReady, customerInfo, isPro }}>
      {children}
    </RevenueCatContext.Provider>
  );
}
