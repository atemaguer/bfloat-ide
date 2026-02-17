import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { IconSymbol } from "@/components/ui/icon-symbol";
import { Colors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { ScrollView, StyleSheet, View } from "react-native";

export default function HomeScreen() {
  const colorScheme = useColorScheme() ?? "light";
  const tint = Colors[colorScheme].tint;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: Colors[colorScheme].background }}
      contentContainerStyle={styles.scroll}>
      {/* Hero */}
      <View style={styles.hero}>
        <View style={[styles.iconBox, { borderColor: Colors[colorScheme].icon + "30" }]}>
          <IconSymbol name="sparkles" size={28} color={tint} />
        </View>
        <ThemedText type="title" style={styles.heading}>
          Your app is ready.
        </ThemedText>
        <ThemedText style={styles.subtitle}>
          Describe what you want to build in the chat and watch it come to life on your device.
        </ThemedText>
      </View>

      {/* Steps */}
      <ThemedView style={styles.section}>
        <ThemedText style={styles.sectionLabel}>GET STARTED</ThemedText>
        <Step
          number="1"
          title="Describe your app"
          description="Tell the AI what you want to build in plain English using the chat panel."
          tint={tint}
          colorScheme={colorScheme}
        />
        <Step
          number="2"
          title="Preview on device"
          description="See your app update live in the device preview as the AI writes your code."
          tint={tint}
          colorScheme={colorScheme}
        />
        <Step
          number="3"
          title="Iterate and refine"
          description="Ask for changes, add features, or fix issues — just keep chatting."
          tint={tint}
          colorScheme={colorScheme}
        />
      </ThemedView>

      {/* Features */}
      <ThemedView style={styles.section}>
        <ThemedText style={styles.sectionLabel}>WHAT YOU CAN BUILD</ThemedText>
        <View style={styles.featureGrid}>
          <FeatureCard
            icon="message.fill"
            title="AI-Powered Dev"
            description="Chat with AI to generate screens, components, and full features."
            colorScheme={colorScheme}
          />
          <FeatureCard
            icon="iphone"
            title="Live Preview"
            description="Hot-reloading preview on iOS and Android simulators."
            colorScheme={colorScheme}
          />
          <FeatureCard
            icon="externaldrive.fill"
            title="Backend & Auth"
            description="Add a Convex backend with database, auth, and file storage."
            colorScheme={colorScheme}
          />
          <FeatureCard
            icon="creditcard.fill"
            title="In-App Purchases"
            description="Connect RevenueCat for subscriptions and payments."
            colorScheme={colorScheme}
          />
          <FeatureCard
            icon="rocket.fill"
            title="App Store Deploy"
            description="Ship to the App Store and Google Play with one click."
            colorScheme={colorScheme}
          />
          <FeatureCard
            icon="sparkles"
            title="Auto-Fix Errors"
            description="Build errors are detected and fixed automatically."
            colorScheme={colorScheme}
          />
        </View>
      </ThemedView>

      {/* Code hint */}
      <View style={[styles.hint, { borderColor: Colors[colorScheme].icon + "30" }]}>
        <ThemedText style={styles.hintText}>
          This screen lives at <ThemedText type="defaultSemiBold">app/(tabs)/index.tsx</ThemedText> — ask the AI to
          replace it with your app.
        </ThemedText>
      </View>
    </ScrollView>
  );
}

function Step({
  number,
  title,
  description,
  tint,
  colorScheme,
}: {
  number: string;
  title: string;
  description: string;
  tint: string;
  colorScheme: "light" | "dark";
}) {
  return (
    <View
      style={[
        styles.stepRow,
        {
          backgroundColor: colorScheme === "dark" ? "#1c1c1e" : "#f5f5f7",
          borderColor: colorScheme === "dark" ? "#2c2c2e" : "#e5e5ea",
        },
      ]}>
      <View style={[styles.stepNumber, { backgroundColor: tint }]}>
        <ThemedText style={styles.stepNumberText}>{number}</ThemedText>
      </View>
      <View style={styles.stepContent}>
        <ThemedText type="defaultSemiBold">{title}</ThemedText>
        <ThemedText style={styles.stepDescription}>{description}</ThemedText>
      </View>
    </View>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  colorScheme,
}: {
  icon: string;
  title: string;
  description: string;
  colorScheme: "light" | "dark";
}) {
  return (
    <View
      style={[
        styles.featureCard,
        {
          backgroundColor: colorScheme === "dark" ? "#1c1c1e" : "#f5f5f7",
          borderColor: colorScheme === "dark" ? "#2c2c2e" : "#e5e5ea",
        },
      ]}>
      <View style={[styles.featureIcon, { backgroundColor: colorScheme === "dark" ? "#2c2c2e" : "#e5e5ea" }]}>
        <IconSymbol name={icon as any} size={18} color={Colors[colorScheme].text} />
      </View>
      <ThemedText type="defaultSemiBold" style={styles.featureTitle}>
        {title}
      </ThemedText>
      <ThemedText style={styles.featureDescription}>{description}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 40,
  },
  hero: {
    alignItems: "center",
    marginBottom: 40,
  },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  heading: {
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    textAlign: "center",
    opacity: 0.6,
    maxWidth: 300,
    lineHeight: 22,
  },
  section: {
    marginBottom: 32,
    backgroundColor: "transparent",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.5,
    opacity: 0.4,
    textAlign: "center",
    marginBottom: 16,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 8,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  stepContent: {
    flex: 1,
    gap: 2,
  },
  stepDescription: {
    fontSize: 14,
    opacity: 0.6,
    lineHeight: 20,
  },
  featureGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  featureCard: {
    width: "48.5%",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
  },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  featureTitle: {
    fontSize: 14,
  },
  featureDescription: {
    fontSize: 12,
    opacity: 0.5,
    lineHeight: 17,
  },
  hint: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
  },
  hintText: {
    fontSize: 13,
    textAlign: "center",
    opacity: 0.5,
  },
});
