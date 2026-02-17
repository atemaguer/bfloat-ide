import { CreditCard, Database, MessageSquare, Monitor, Rocket, Sparkles } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center px-6 py-20 relative overflow-hidden">
      {/* Background decoration */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-[40%] left-1/2 -translate-x-1/2 h-[600px] w-[600px] rounded-full bg-primary/[0.03] blur-3xl" />
        <div className="absolute top-1/2 -left-[10%] h-[400px] w-[400px] rounded-full bg-primary/[0.02] blur-3xl" />
        <div className="absolute -bottom-[20%] -right-[10%] h-[500px] w-[500px] rounded-full bg-primary/[0.02] blur-3xl" />
      </div>

      <main className="relative z-10 flex w-full max-w-3xl flex-col items-center gap-20 pt-12">
        {/* Hero */}
        <div className="flex flex-col items-center gap-5 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
            <Sparkles className="h-6 w-6 text-foreground" />
          </div>

          <h1 className="mt-1 text-4xl font-bold tracking-tight sm:text-5xl">Your project is ready.</h1>

          <p className="max-w-lg text-lg leading-relaxed text-muted-foreground">
            Describe what you want to build in the chat and watch it come to life. Every change previews instantly.
          </p>
        </div>

        {/* Getting started steps */}
        <div className="w-full max-w-xl">
          <h2 className="mb-6 text-center text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Get started
          </h2>
          <div className="flex flex-col gap-3">
            <Step
              number="1"
              title="Describe your app"
              description="Tell the AI what you want to build in plain English using the chat panel."
            />
            <Step
              number="2"
              title="Preview in real time"
              description="See your app update live in the preview panel as the AI writes your code."
            />
            <Step
              number="3"
              title="Iterate and refine"
              description="Ask for changes, add features, or fix issues — just keep chatting."
            />
          </div>
        </div>

        {/* What you can do */}
        <div className="w-full">
          <h2 className="mb-6 text-center text-sm font-medium uppercase tracking-widest text-muted-foreground">
            What you can build
          </h2>
          <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <FeatureCard
              icon={<MessageSquare className="h-5 w-5" />}
              title="AI-Powered Development"
              description="Chat with AI to generate pages, components, and full features from a description."
            />
            <FeatureCard
              icon={<Monitor className="h-5 w-5" />}
              title="Live Preview"
              description="Hot-reloading preview shows every change instantly — no manual refresh needed."
            />
            <FeatureCard
              icon={<Database className="h-5 w-5" />}
              title="Backend & Database"
              description="Add a Convex backend with real-time data, authentication, and file storage."
            />
            <FeatureCard
              icon={<CreditCard className="h-5 w-5" />}
              title="Payments"
              description="Connect Stripe to accept payments, manage subscriptions, and track revenue."
            />
            <FeatureCard
              icon={<Rocket className="h-5 w-5" />}
              title="One-Click Deploy"
              description="Ship to production with a single click. Your app gets a live URL instantly."
            />
            <FeatureCard
              icon={<Sparkles className="h-5 w-5" />}
              title="Auto-Fix Errors"
              description="Build errors are detected and fixed automatically — no manual debugging."
            />
          </div>
        </div>

        {/* Code hint */}
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-center text-sm text-muted-foreground">
            This page lives at{" "}
            <code className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-sm text-foreground">
              app/page.tsx
            </code>{" "}
            — ask the AI to replace it with your app.
          </p>
        </div>
      </main>
    </div>
  );
}

function Step({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {number}
      </div>
      <div className="pt-0.5">
        <h3 className="font-semibold leading-none">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="group rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:bg-accent/50">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-foreground transition-colors group-hover:bg-background">
        {icon}
      </div>
      <h3 className="font-semibold leading-none tracking-tight">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}
