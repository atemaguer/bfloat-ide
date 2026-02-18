import { useState, useEffect } from 'react'
import { useStore } from '@/app/hooks/useStore'
import { motion, AnimatePresence } from 'framer-motion'
import { providerAuthStore } from '@/app/stores/provider-auth'
import { WelcomeStep } from './steps/WelcomeStep'
import { AIProviderStep } from './steps/AIProviderStep'
import { SuccessStep } from './steps/SuccessStep'

const TOTAL_STEPS = 3

interface StepProps {
  onNext: () => void
  onBack?: () => void
}

export function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const [currentStep, setCurrentStep] = useState(0)
  const tokens = useStore(providerAuthStore.tokens)

  // Load tokens on mount
  useEffect(() => {
    providerAuthStore.loadFromStorage()
  }, [])

  const handleNext = () => {
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep((prev) => prev + 1)
    }
  }

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1)
    }
  }

  const handleComplete = () => {
    onComplete()
  }

  // Check if can proceed to next step
  const canProceedFromAIStep = tokens.anthropic !== null || tokens.openai !== null

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return <WelcomeStep onNext={handleNext} />
      case 1:
        return (
          <AIProviderStep
            onNext={handleNext}
            onBack={handleBack}
            canProceed={canProceedFromAIStep}
          />
        )
      case 2:
        return <SuccessStep onComplete={handleComplete} />
      default:
        return null
    }
  }

  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center">
      {/* Progress Indicator */}
      <div className="absolute top-8 flex gap-2">
        {Array.from({ length: TOTAL_STEPS }).map((_, index) => (
          <div
            key={index}
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              index === currentStep
                ? 'bg-[#3b82f6] w-6'
                : index < currentStep
                  ? 'bg-[#3b82f6]/60'
                  : 'bg-muted'
            }`}
          />
        ))}
      </div>

      {/* Step Content */}
      <div className="w-full max-w-xl px-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {renderStep()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
