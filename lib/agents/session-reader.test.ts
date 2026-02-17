/**
 * Test script for session-reader.ts
 *
 * Run with: npx tsx lib/agents/session-reader.test.ts
 *
 * This tests the session reading logic with real session files
 * from Claude and Codex CLI tools.
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { readSession, listSessions, sessionToMessages, type ParsedSession } from './session-reader'

// ============================================================================
// Test Utilities
// ============================================================================

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const RESET = '\x1b[0m'

function log(message: string, color: string = RESET) {
  console.log(`${color}${message}${RESET}`)
}

function logSection(title: string) {
  console.log('\n' + '='.repeat(60))
  log(title, CYAN)
  console.log('='.repeat(60))
}

function pass(test: string) {
  log(`✓ ${test}`, GREEN)
}

function fail(test: string, reason?: string) {
  log(`✗ ${test}`, RED)
  if (reason) {
    log(`  Reason: ${reason}`, YELLOW)
  }
}

function info(message: string) {
  log(`  ℹ ${message}`, YELLOW)
}

// ============================================================================
// Directory Structure Analysis
// ============================================================================

function analyzeClaudeDirectory() {
  logSection('Claude Session Storage Analysis')

  const claudeDir = path.join(os.homedir(), '.claude', 'projects')

  if (!fs.existsSync(claudeDir)) {
    fail('Claude projects directory exists', `Not found at ${claudeDir}`)
    return null
  }

  pass('Claude projects directory exists')

  const projectDirs = fs.readdirSync(claudeDir)
  info(`Found ${projectDirs.length} project directories`)

  // Find a project directory with sessions
  for (const dir of projectDirs) {
    const projectPath = path.join(claudeDir, dir)
    const stat = fs.statSync(projectPath)

    if (stat.isDirectory()) {
      const files = fs.readdirSync(projectPath)
      const sessionFiles = files.filter(f => f.endsWith('.jsonl'))

      if (sessionFiles.length > 0) {
        info(`Project "${dir}" has ${sessionFiles.length} session(s)`)

        // Return the first session for testing
        const sessionId = sessionFiles[0].replace('.jsonl', '')
        const sessionFile = path.join(projectPath, sessionFiles[0])
        const fileStat = fs.statSync(sessionFile)

        info(`Sample session: ${sessionId}`)
        info(`File size: ${Math.round(fileStat.size / 1024)} KB`)

        return {
          projectDir: dir,
          sessionId,
          sessionFile,
        }
      }
    }
  }

  info('No sessions found in any project directory')
  return null
}

function analyzeCodexDirectory() {
  logSection('Codex Session Storage Analysis')

  const codexDir = path.join(os.homedir(), '.codex', 'sessions')

  if (!fs.existsSync(codexDir)) {
    fail('Codex sessions directory exists', `Not found at ${codexDir}`)
    return null
  }

  pass('Codex sessions directory exists')

  // Recursively find all session files
  const sessionFiles: Array<{ file: string; path: string; depth: number }> = []

  function scanDir(dir: string, depth: number) {
    const entries = fs.readdirSync(dir)

    for (const entry of entries) {
      const fullPath = path.join(dir, entry)
      const stat = fs.statSync(fullPath)

      if (stat.isDirectory()) {
        scanDir(fullPath, depth + 1)
      } else if (entry.endsWith('.jsonl')) {
        sessionFiles.push({
          file: entry,
          path: fullPath,
          depth,
        })
      }
    }
  }

  scanDir(codexDir, 0)

  info(`Found ${sessionFiles.length} total session files`)

  // Analyze directory structure
  const depthCounts: Record<number, number> = {}
  for (const file of sessionFiles) {
    depthCounts[file.depth] = (depthCounts[file.depth] || 0) + 1
  }

  for (const [depth, count] of Object.entries(depthCounts)) {
    info(`Files at depth ${depth}: ${count}`)
  }

  if (sessionFiles.length > 0) {
    const sample = sessionFiles[0]
    info(`Sample file: ${sample.file}`)
    info(`Full path: ${sample.path}`)
    info(`Depth: ${sample.depth}`)

    // Read the first line to get session ID
    const content = fs.readFileSync(sample.path, 'utf-8')
    const firstLine = content.split('\n')[0]
    try {
      const header = JSON.parse(firstLine)
      if (header.id) {
        info(`Internal session ID: ${header.id}`)
      }
    } catch {
      // Ignore parse errors
    }

    return {
      file: sample.file,
      path: sample.path,
      depth: sample.depth,
    }
  }

  return null
}

// ============================================================================
// Session Reading Tests
// ============================================================================

async function testClaudeSessionReading(claudeSession: { projectDir: string; sessionId: string; sessionFile: string }) {
  logSection('Claude Session Reading Tests')

  // Test 1: Read session without project path (search all directories)
  console.log('\nTest 1: Read Claude session by ID only')
  const session1 = await readSession(claudeSession.sessionId, 'claude')

  if (session1) {
    pass('Session found without project path')
    info(`Messages: ${session1.messages.length}`)
    info(`CWD: ${session1.cwd || 'not set'}`)

    // Verify message structure
    const userMsgs = session1.messages.filter(m => m.role === 'user')
    const assistantMsgs = session1.messages.filter(m => m.role === 'assistant')
    info(`User messages: ${userMsgs.length}`)
    info(`Assistant messages: ${assistantMsgs.length}`)
  } else {
    fail('Session found without project path')
  }

  // Test 2: Read session with (guessed) project path
  // Try to decode the project path from the directory name
  console.log('\nTest 2: Read Claude session with project path')

  // Attempt to find the original project path by looking for bfloat-ide-projects
  const possiblePaths = [
    path.join(os.homedir(), '.bfloat-ide', 'projects'),
    path.join(os.homedir(), 'Development'),
  ]

  let foundWithPath = false
  for (const testPath of possiblePaths) {
    const session2 = await readSession(claudeSession.sessionId, 'claude', testPath)
    if (session2) {
      pass(`Session found with project path: ${testPath}`)
      foundWithPath = true
      break
    }
  }

  if (!foundWithPath) {
    info('Session not found with common project paths (expected for different projects)')
  }

  // Test 3: Convert session to chat messages
  console.log('\nTest 3: Convert session to chat messages')
  if (session1) {
    const chatMessages = sessionToMessages(session1)
    pass(`Converted to ${chatMessages.length} chat messages`)

    if (chatMessages.length > 0) {
      const first = chatMessages[0]
      info(`First message role: ${first.role}`)
      info(`First message content length: ${first.content.length}`)
      if (first.blocks) {
        info(`First message blocks: ${first.blocks.length}`)
      }
    }
  }

  return session1
}

async function testCodexSessionReading(codexSession: { file: string; path: string; depth: number }) {
  logSection('Codex Session Reading Tests')

  // Extract potential session ID from filename
  // Format: rollout-{date}-{uuid}.jsonl
  const filename = codexSession.file
  const match = filename.match(/rollout-[\d-]+T[\d-]+(?:\.[\d]+)?Z?-([a-f0-9-]+)\.jsonl/)

  let internalId: string | null = null

  // Read the internal session ID from session_meta
  const content = fs.readFileSync(codexSession.path, 'utf-8')
  const firstLine = content.split('\n')[0]
  try {
    const header = JSON.parse(firstLine)
    if (header.type === 'session_meta' && header.payload?.id) {
      internalId = header.payload.id
    }
    info(`Internal session ID from file: ${internalId}`)
  } catch {
    // Ignore parse errors
  }

  // Test 1: Try to find session by internal ID
  console.log('\nTest 1: Find Codex session by internal ID')
  if (internalId) {
    const session1 = await readSession(internalId, 'codex')

    if (session1) {
      pass('Session found by internal ID')
      info(`Messages: ${session1.messages.length}`)
      info(`CWD: ${session1.cwd || 'not set'}`)

      // Verify message structure
      const userMsgs = session1.messages.filter(m => m.role === 'user')
      const assistantMsgs = session1.messages.filter(m => m.role === 'assistant')
      info(`User messages: ${userMsgs.length}`)
      info(`Assistant messages: ${assistantMsgs.length}`)

      // Check for tool usage
      const toolMsgs = session1.messages.filter(m => {
        if (Array.isArray(m.content)) {
          return m.content.some(b => b.type === 'tool')
        }
        return false
      })
      info(`Messages with tools: ${toolMsgs.length}`)
    } else {
      fail('Session found by internal ID', 'findCodexSessionFile may not be searching deep enough')

      // Diagnose the issue
      info(`Session file is at depth ${codexSession.depth}`)
      if (codexSession.depth > 1) {
        info('ISSUE: Current implementation only searches 1 level deep')
        info('FIX: Need to traverse year/month/day directory structure')
      }
    }
  } else {
    info('Could not extract internal ID from session_meta')
  }

  // Test 2: Try various session ID formats
  console.log('\nTest 2: Test different session ID formats')

  // Try the UUID part from filename
  if (match && match[1]) {
    const uuidFromFilename = match[1]
    info(`Trying UUID from filename: ${uuidFromFilename}`)

    const session2 = await readSession(uuidFromFilename, 'codex')
    if (session2) {
      pass('Session found by UUID from filename')
      info(`Messages: ${session2.messages.length}`)
    } else {
      fail('Session found by UUID from filename')
    }
  } else {
    info(`Filename doesn't match expected pattern: ${filename}`)
  }

  // Test 3: Direct file reading (bypassing find)
  console.log('\nTest 3: Direct file parsing test')
  const directResult = await testDirectCodexParsing(codexSession.path)

  // Test 4: Convert to chat messages
  console.log('\nTest 4: Convert Codex session to chat messages')
  if (internalId) {
    const session = await readSession(internalId, 'codex')
    if (session) {
      const chatMessages = sessionToMessages(session)
      pass(`Converted to ${chatMessages.length} chat messages`)
      if (chatMessages.length > 0) {
        const first = chatMessages[0]
        info(`First message role: ${first.role}`)
        info(`First message content length: ${first.content.length}`)
      }
    }
  }

  return directResult
}

async function testDirectCodexParsing(filePath: string): Promise<ParsedSession | null> {
  info(`Directly parsing: ${filePath}`)

  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n').filter(l => l.trim())

  info(`Total lines: ${lines.length}`)

  let sessionMetaCount = 0
  let eventMsgCount = 0
  let userMessageCount = 0
  let responseItemCount = 0
  let functionCallCount = 0
  let assistantMsgCount = 0

  for (const line of lines) {
    try {
      const entry = JSON.parse(line)
      if (entry.type === 'session_meta') {
        sessionMetaCount++
        info(`Session ID: ${entry.payload?.id}`)
      } else if (entry.type === 'event_msg') {
        eventMsgCount++
        if (entry.payload?.type === 'user_message') {
          userMessageCount++
        }
      } else if (entry.type === 'response_item') {
        responseItemCount++
        if (entry.payload?.type === 'function_call') {
          functionCallCount++
        }
        if (entry.payload?.type === 'message' && entry.payload?.role === 'assistant') {
          assistantMsgCount++
        }
      }
    } catch {
      // Ignore
    }
  }

  info(`Session meta: ${sessionMetaCount}`)
  info(`Event messages: ${eventMsgCount}`)
  info(`User messages: ${userMessageCount}`)
  info(`Response items: ${responseItemCount}`)
  info(`Function calls: ${functionCallCount}`)
  info(`Assistant messages: ${assistantMsgCount}`)

  if (sessionMetaCount > 0 && (userMessageCount > 0 || assistantMsgCount > 0)) {
    pass('File contains valid Codex session data')
    return {} as ParsedSession // Placeholder to indicate success
  } else {
    fail('File contains valid Codex session data')
  }

  return null
}

// ============================================================================
// Issue Detection
// ============================================================================

function detectIssues(claudeResult: ParsedSession | null, codexFound: boolean) {
  logSection('Issues Detected')

  const issues: string[] = []

  if (!codexFound) {
    issues.push('CODEX_DEEP_TRAVERSAL: findCodexSessionFile does not traverse year/month/day directories fully')
  }

  if (issues.length === 0) {
    pass('No issues detected')
  } else {
    for (const issue of issues) {
      fail(issue)
    }
  }

  return issues
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function testLargeCodexSession() {
  logSection('Large Codex Session Test')

  // Find the largest Codex session file
  const sessionsDir = path.join(os.homedir(), '.codex', 'sessions')
  if (!fs.existsSync(sessionsDir)) {
    info('Codex sessions directory not found')
    return
  }

  // Find largest session
  let largestFile = ''
  let largestSize = 0

  function scanDir(dir: string) {
    const entries = fs.readdirSync(dir)
    for (const entry of entries) {
      const fullPath = path.join(dir, entry)
      const stat = fs.statSync(fullPath)
      if (stat.isDirectory()) {
        scanDir(fullPath)
      } else if (entry.endsWith('.jsonl') && stat.size > largestSize) {
        largestSize = stat.size
        largestFile = fullPath
      }
    }
  }

  scanDir(sessionsDir)

  if (!largestFile) {
    info('No Codex session files found')
    return
  }

  info(`Testing largest session: ${path.basename(largestFile)}`)
  info(`Size: ${Math.round(largestSize / 1024)} KB`)

  // Extract session ID
  const content = fs.readFileSync(largestFile, 'utf-8')
  const firstLine = content.split('\n')[0]
  let sessionId: string | null = null
  try {
    const header = JSON.parse(firstLine)
    if (header.type === 'session_meta' && header.payload?.id) {
      sessionId = header.payload.id
    }
  } catch {
    // Ignore
  }

  if (!sessionId) {
    info('Could not extract session ID')
    return
  }

  info(`Session ID: ${sessionId}`)

  // Read the session
  const session = await readSession(sessionId, 'codex')
  if (session) {
    pass('Session loaded successfully')
    info(`Total messages: ${session.messages.length}`)

    const userMsgs = session.messages.filter(m => m.role === 'user')
    const assistantMsgs = session.messages.filter(m => m.role === 'assistant')
    info(`User messages: ${userMsgs.length}`)
    info(`Assistant messages: ${assistantMsgs.length}`)

    // Count tool usage
    let toolCount = 0
    for (const msg of session.messages) {
      if (Array.isArray(msg.content)) {
        toolCount += msg.content.filter(b => b.type === 'tool').length
      }
    }
    info(`Tool usages: ${toolCount}`)

    // Show sample assistant message
    if (assistantMsgs.length > 0) {
      const sample = assistantMsgs[0]
      if (Array.isArray(sample.content)) {
        const textBlocks = sample.content.filter(b => b.type === 'text')
        if (textBlocks.length > 0 && 'content' in textBlocks[0]) {
          info(`Sample assistant text: "${(textBlocks[0].content as string).substring(0, 100)}..."`)
        }
      }
    }

    // Convert to chat messages
    const chatMessages = sessionToMessages(session)
    pass(`Converted to ${chatMessages.length} chat messages`)
  } else {
    fail('Session loaded')
  }
}

async function main() {
  console.log('\n' + '='.repeat(60))
  log('SESSION READER TEST SUITE', CYAN)
  console.log('='.repeat(60))
  log(`Running at: ${new Date().toISOString()}`)
  log(`Home directory: ${os.homedir()}`)

  // Analyze directories
  const claudeSession = analyzeClaudeDirectory()
  const codexSession = analyzeCodexDirectory()

  let claudeResult: ParsedSession | null = null
  let codexFound = false

  // Run Claude tests if we have sessions
  if (claudeSession) {
    claudeResult = await testClaudeSessionReading(claudeSession)
  }

  // Run Codex tests if we have sessions
  if (codexSession) {
    const result = await testCodexSessionReading(codexSession)
    codexFound = result !== null
  }

  // Test with a larger Codex session
  await testLargeCodexSession()

  // Detect and report issues
  const issues = detectIssues(claudeResult, codexFound)

  // Summary
  logSection('Test Summary')
  log(`Claude sessions found: ${claudeSession ? 'Yes' : 'No'}`)
  log(`Codex sessions found: ${codexSession ? 'Yes' : 'No'}`)
  log(`Issues detected: ${issues.length}`)

  if (issues.length > 0) {
    console.log('\nRecommended fixes:')
    for (const issue of issues) {
      if (issue.includes('CODEX_DEEP_TRAVERSAL')) {
        console.log('  - Update findCodexSessionFile to recursively traverse year/month/day directories')
        console.log('  - Current structure: ~/.codex/sessions/{year}/{month}/{day}/{filename}.jsonl')
      }
    }
  }
}

main().catch(console.error)
