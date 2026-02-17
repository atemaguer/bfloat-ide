/**
 * AskUserQuestion Component
 *
 * Renders Claude's clarifying questions as an interactive form.
 * Users can select from predefined options or enter custom text.
 *
 * Based on Claude Agent SDK AskUserQuestion tool format:
 * - Each question has 2-4 options
 * - Options can be single or multi-select
 * - Supports free-text "Other" input
 */

import { memo, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, MessageCircleQuestion, ChevronRight } from 'lucide-react'

// Question option from the SDK
export interface QuestionOption {
  label: string
  description: string
}

// Single question from the SDK
export interface Question {
  question: string
  header: string
  options: QuestionOption[]
  multiSelect: boolean
}

// Input format from the AskUserQuestion tool
export interface AskUserQuestionInput {
  questions: Question[]
  // Answers are added after user responds
  answers?: Record<string, string>
}

// Props for the component
interface AskUserQuestionProps {
  input: AskUserQuestionInput
  onSubmit: (answers: Record<string, string>) => void
  isSubmitting?: boolean
  isAnswered?: boolean
}

// Single option button
interface OptionButtonProps {
  option: QuestionOption
  isSelected: boolean
  onClick: () => void
  disabled?: boolean
}

const OptionButton = memo(function OptionButton({
  option,
  isSelected,
  onClick,
  disabled,
}: OptionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`
        ask-user-option
        ${isSelected ? 'selected' : ''}
        ${disabled ? 'disabled' : ''}
      `}
    >
      <div className="ask-user-option-check">
        {isSelected && <Check size={12} strokeWidth={3} />}
      </div>
      <div className="ask-user-option-content">
        <span className="ask-user-option-label">{option.label}</span>
        <span className="ask-user-option-description">{option.description}</span>
      </div>
    </button>
  )
})

// Single question component
interface QuestionCardProps {
  question: Question
  value: string | string[]
  onChange: (value: string | string[]) => void
  disabled?: boolean
}

const QuestionCard = memo(function QuestionCard({
  question,
  value,
  onChange,
  disabled,
}: QuestionCardProps) {
  const [showOther, setShowOther] = useState(false)
  const [otherText, setOtherText] = useState('')

  const selectedValues = Array.isArray(value) ? value : value ? [value] : []

  const handleOptionClick = useCallback(
    (optionLabel: string) => {
      if (disabled) return

      if (question.multiSelect) {
        // Toggle selection for multi-select
        const newValues = selectedValues.includes(optionLabel)
          ? selectedValues.filter((v) => v !== optionLabel)
          : [...selectedValues, optionLabel]
        onChange(newValues)
        setShowOther(false)
      } else {
        // Single select
        onChange(optionLabel)
        setShowOther(false)
      }
    },
    [question.multiSelect, selectedValues, onChange, disabled]
  )

  const handleOtherClick = useCallback(() => {
    if (disabled) return
    setShowOther(true)
    if (!question.multiSelect) {
      onChange('')
    }
  }, [disabled, question.multiSelect, onChange])

  const handleOtherChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const text = e.target.value
      setOtherText(text)
      if (question.multiSelect) {
        // For multi-select, add "Other" value
        const otherValues = selectedValues.filter(
          (v) => question.options.some((o) => o.label === v)
        )
        if (text) {
          onChange([...otherValues, text])
        } else {
          onChange(otherValues)
        }
      } else {
        onChange(text)
      }
    },
    [question.multiSelect, question.options, selectedValues, onChange]
  )

  return (
    <div className="ask-user-question-card">
      <div className="ask-user-question-header">
        <span className="ask-user-question-badge">{question.header}</span>
        <h3 className="ask-user-question-text">{question.question}</h3>
      </div>

      <div className="ask-user-question-options">
        {question.options.map((option) => (
          <OptionButton
            key={option.label}
            option={option}
            isSelected={selectedValues.includes(option.label)}
            onClick={() => handleOptionClick(option.label)}
            disabled={disabled}
          />
        ))}

        {/* Other option */}
        <button
          type="button"
          onClick={handleOtherClick}
          disabled={disabled}
          className={`
            ask-user-option other
            ${showOther ? 'selected' : ''}
            ${disabled ? 'disabled' : ''}
          `}
        >
          <div className="ask-user-option-check">
            {showOther && <Check size={12} strokeWidth={3} />}
          </div>
          <div className="ask-user-option-content">
            <span className="ask-user-option-label">Other</span>
            <span className="ask-user-option-description">Provide your own answer</span>
          </div>
        </button>

        {/* Other text input */}
        <AnimatePresence>
          {showOther && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="ask-user-other-input-wrapper"
            >
              <input
                type="text"
                value={otherText}
                onChange={handleOtherChange}
                placeholder="Type your answer..."
                className="ask-user-other-input"
                autoFocus
                disabled={disabled}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {question.multiSelect && (
        <p className="ask-user-hint">Select all that apply</p>
      )}
    </div>
  )
})

// Main component
export const AskUserQuestion = memo(function AskUserQuestion({
  input,
  onSubmit,
  isSubmitting = false,
  isAnswered = false,
}: AskUserQuestionProps) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})

  const handleQuestionChange = useCallback(
    (questionText: string, value: string | string[]) => {
      setAnswers((prev) => ({
        ...prev,
        [questionText]: value,
      }))
    },
    []
  )

  const handleSubmit = useCallback(() => {
    // Convert answers to the expected format (join arrays with ", ")
    const formattedAnswers: Record<string, string> = {}
    for (const [question, answer] of Object.entries(answers)) {
      if (Array.isArray(answer)) {
        formattedAnswers[question] = answer.join(', ')
      } else {
        formattedAnswers[question] = answer
      }
    }
    onSubmit(formattedAnswers)
  }, [answers, onSubmit])

  // Check if all questions have been answered
  const allAnswered = input.questions.every((q) => {
    const answer = answers[q.question]
    if (Array.isArray(answer)) {
      return answer.length > 0
    }
    return !!answer
  })

  // If already answered, show the answers
  if (isAnswered && input.answers) {
    return (
      <div className="ask-user-container answered">
        <div className="ask-user-header">
          <MessageCircleQuestion size={16} />
          <span>Questions answered</span>
        </div>
        <div className="ask-user-answers">
          {input.questions.map((q) => (
            <div key={q.question} className="ask-user-answer-item">
              <span className="ask-user-answer-question">{q.header}:</span>
              <span className="ask-user-answer-value">
                {input.answers?.[q.question] || 'No answer'}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="ask-user-container">
      <div className="ask-user-header">
        <MessageCircleQuestion size={16} />
        <span>Claude has some questions</span>
      </div>

      <div className="ask-user-questions">
        {input.questions.map((question) => (
          <QuestionCard
            key={question.question}
            question={question}
            value={answers[question.question] || (question.multiSelect ? [] : '')}
            onChange={(value) => handleQuestionChange(question.question, value)}
            disabled={isSubmitting}
          />
        ))}
      </div>

      <div className="ask-user-footer">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!allAnswered || isSubmitting}
          className="ask-user-submit"
        >
          {isSubmitting ? (
            'Submitting...'
          ) : (
            <>
              Continue
              <ChevronRight size={16} />
            </>
          )}
        </button>
      </div>
    </div>
  )
})

AskUserQuestion.displayName = 'AskUserQuestion'
