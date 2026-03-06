/**
 * EAS Output Parser
 *
 * Parses EAS CLI output to extract progress information for the progress UI.
 * Detects various stages of the iOS build and submission process.
 */

export type DeployStep =
  | 'prepare'
  | 'upload'
  | 'queued'
  | 'build'
  | 'submit'
  | 'processing'
  | 'complete'
  | 'error'

export interface ProgressUpdate {
  step: DeployStep
  percent: number
  message: string
  detail?: string
  buildUrl?: string
  error?: string
}

interface ProgressPattern {
  pattern: RegExp
  step: DeployStep
  percent: number
  message: string
}

/**
 * Patterns to match EAS CLI output and map to progress stages
 * Ordered by expected occurrence in the deployment flow
 */
const PROGRESS_PATTERNS: ProgressPattern[] = [
  // Preparation phase
  {
    pattern: /Compressing project files/i,
    step: 'prepare',
    percent: 5,
    message: 'Compressing project files...',
  },
  {
    pattern: /Analyzing project/i,
    step: 'prepare',
    percent: 8,
    message: 'Analyzing project...',
  },
  {
    pattern: /Resolving configuration/i,
    step: 'prepare',
    percent: 10,
    message: 'Resolving configuration...',
  },

  // Upload phase
  {
    pattern: /Uploading.*EAS/i,
    step: 'upload',
    percent: 15,
    message: 'Uploading to EAS Build...',
  },
  {
    pattern: /Upload.*complete/i,
    step: 'upload',
    percent: 20,
    message: 'Upload complete',
  },

  // Queue phase (EAS free tier queue)
  {
    pattern: /Waiting in Free tier queue/i,
    step: 'queued',
    percent: 22,
    message: 'Waiting in build queue...',
  },
  {
    pattern: /Build queued/i,
    step: 'queued',
    percent: 21,
    message: 'Build queued...',
  },
  {
    pattern: /Waiting for build to complete/i,
    step: 'queued',
    percent: 23,
    message: 'Waiting for build slot...',
  },
  {
    pattern: /priority queue/i,
    step: 'queued',
    percent: 22,
    message: 'Waiting in queue...',
  },

  // Build phase
  {
    pattern: /Build started/i,
    step: 'build',
    percent: 25,
    message: 'Build started...',
  },
  {
    pattern: /Installing (dependencies|pods)/i,
    step: 'build',
    percent: 35,
    message: 'Installing dependencies...',
  },
  {
    pattern: /Running expo prebuild/i,
    step: 'build',
    percent: 40,
    message: 'Running Expo prebuild...',
  },
  {
    pattern: /Installing CocoaPods/i,
    step: 'build',
    percent: 45,
    message: 'Installing CocoaPods...',
  },
  {
    pattern: /Building iOS project/i,
    step: 'build',
    percent: 55,
    message: 'Building iOS project...',
  },
  {
    pattern: /Compiling/i,
    step: 'build',
    percent: 60,
    message: 'Compiling...',
  },
  {
    pattern: /Linking/i,
    step: 'build',
    percent: 65,
    message: 'Linking...',
  },
  {
    pattern: /Archiving/i,
    step: 'build',
    percent: 70,
    message: 'Creating archive...',
  },
  {
    pattern: /Signing/i,
    step: 'build',
    percent: 75,
    message: 'Signing build...',
  },
  {
    pattern: /Build finished/i,
    step: 'build',
    percent: 80,
    message: 'Build complete!',
  },

  // Submit phase
  {
    pattern: /Submitting.*App Store/i,
    step: 'submit',
    percent: 85,
    message: 'Submitting to App Store Connect...',
  },
  {
    pattern: /Uploading.*TestFlight/i,
    step: 'submit',
    percent: 88,
    message: 'Uploading to TestFlight...',
  },
  {
    pattern: /Upload.*App Store.*complete/i,
    step: 'submit',
    percent: 90,
    message: 'Upload to App Store complete',
  },

  // Processing phase
  {
    pattern: /Waiting for App Store.*process/i,
    step: 'processing',
    percent: 92,
    message: 'Waiting for App Store processing...',
  },
  {
    pattern: /Processing by App Store/i,
    step: 'processing',
    percent: 95,
    message: 'Processing by App Store...',
  },

  // Complete phase
  {
    pattern: /available on TestFlight/i,
    step: 'complete',
    percent: 100,
    message: 'Available on TestFlight!',
  },
  {
    pattern: /Successfully submitted/i,
    step: 'complete',
    percent: 100,
    message: 'Successfully submitted!',
  },
  {
    pattern: /submission.*successful/i,
    step: 'complete',
    percent: 100,
    message: 'Submission successful!',
  },
]

/**
 * Error patterns to detect failures
 */
const ERROR_PATTERNS = [
  /Error:/i,
  /error:/i,
  /Build failed/i,
  /Failed to/i,
  /FAILURE/i,
  /Submission failed/i,
  /Authentication.*failed/i,
  /Invalid credentials/i,
]

/**
 * Pattern to extract build URL from output
 */
const BUILD_URL_PATTERN = /https:\/\/expo\.dev\/accounts\/[^\s]+\/builds\/[a-f0-9-]+/i

/**
 * Parse EAS CLI output and extract progress information
 */
export function parseEasOutput(data: string): ProgressUpdate | null {
  // Check for errors first
  for (const errorPattern of ERROR_PATTERNS) {
    if (errorPattern.test(data)) {
      // Extract the error message
      const errorMatch = data.match(/(?:Error:|error:)\s*(.+)/i)
      const errorMessage = sanitizeDeployError(errorMatch?.[1], 'An error occurred', 'eas-output-parser')

      return {
        step: 'error',
        percent: -1,
        message: 'Deployment failed',
        error: errorMessage,
      }
    }
  }

  // Check for build URL
  const buildUrlMatch = data.match(BUILD_URL_PATTERN)
  const buildUrl = buildUrlMatch?.[0]

  // Check progress patterns
  for (const { pattern, step, percent, message } of PROGRESS_PATTERNS) {
    if (pattern.test(data)) {
      return {
        step,
        percent,
        message,
        buildUrl,
      }
    }
  }

  // If we found a build URL but no other pattern, return it
  if (buildUrl) {
    return {
      step: 'build',
      percent: 30,
      message: 'Build in progress...',
      buildUrl,
    }
  }

  return null
}

/**
 * Create a progress tracker that accumulates output and extracts progress
 */
export function createProgressTracker(
  onProgress: (update: ProgressUpdate) => void
): (data: string) => void {
  let currentProgress: ProgressUpdate = {
    step: 'prepare',
    percent: 0,
    message: 'Preparing deployment...',
  }
  let accumulatedOutput = ''

  return (data: string) => {
    accumulatedOutput += data

    const update = parseEasOutput(data)
    if (update) {
      // Only update if progress is moving forward (or it's an error)
      if (update.step === 'error' || update.percent > currentProgress.percent) {
        currentProgress = {
          ...currentProgress,
          ...update,
          // Preserve buildUrl if we already have it
          buildUrl: update.buildUrl || currentProgress.buildUrl,
        }
        onProgress(currentProgress)
      } else if (update.buildUrl && !currentProgress.buildUrl) {
        // Update if we found a build URL
        currentProgress.buildUrl = update.buildUrl
        onProgress(currentProgress)
      }
    }
  }
}

/**
 * Get the display status for a deploy step
 */
export function getStepStatus(
  stepId: DeployStep,
  currentStep: DeployStep,
  hasError: boolean
): 'pending' | 'running' | 'complete' | 'error' {
  const stepOrder: DeployStep[] = ['prepare', 'upload', 'queued', 'build', 'submit', 'processing', 'complete']
  const currentIndex = stepOrder.indexOf(currentStep)
  const stepIndex = stepOrder.indexOf(stepId)

  if (hasError && stepId === currentStep) {
    return 'error'
  }

  if (stepIndex < currentIndex) {
    return 'complete'
  }

  if (stepIndex === currentIndex) {
    return 'running'
  }

  return 'pending'
}

/**
 * Get the steps for the progress UI
 */
export function getDeploySteps(): Array<{ id: DeployStep; label: string; description?: string }> {
  return [
    { id: 'prepare', label: 'Preparing project' },
    { id: 'upload', label: 'Uploading to EAS' },
    { id: 'queued', label: 'Waiting in queue', description: 'Free tier builds may wait during peak hours' },
    { id: 'build', label: 'Building iOS app' },
    { id: 'submit', label: 'Submitting to TestFlight' },
    { id: 'complete', label: 'Available on TestFlight' },
  ]
}
import { sanitizeDeployError } from './deploy-error'
