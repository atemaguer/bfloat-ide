import { Sparkles } from 'lucide-react'

interface WelcomeStepProps {
  onNext: () => void
}

export function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <div className="flex flex-col items-center text-center">
      {/* Icon */}
      <div className="w-20 h-20 rounded-2xl bg-[#3b82f6]/10 flex items-center justify-center mb-8">
        <Sparkles className="w-10 h-10 text-[#3b82f6]" />
      </div>

      {/* Title */}
      <h1 className="text-3xl font-bold text-[#e5e5e5] mb-4">
        Welcome to Bfloat
      </h1>

      {/* Description */}
      <p className="text-[#9a9a9a] text-lg mb-2">
        Let's get you set up in just a few steps.
      </p>
      <p className="text-[#9a9a9a] mb-12">
        You'll need to connect your AI subscription to start building amazing mobile apps.
      </p>

      {/* Get Started Button */}
      <button
        onClick={onNext}
        className="px-8 py-3 bg-[#3b82f6] hover:bg-[#2563eb] text-white font-medium rounded-xl transition-colors text-lg"
      >
        Get Started
      </button>
    </div>
  )
}
