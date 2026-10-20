/**
 * Public surface of the AI layer. Features import from `../ai` and nowhere deeper.
 * The layer knows nothing about React and reaches storage only through `db` repositories.
 *
 *   const { llm, stt } = createAiServices(await settingsRepo.getSettings());
 *   await processCapture(captureId, { llm, stt });            // transcribe → extract → resolve → review
 *   await generateReview('week', today, { llm });             // rules always, model on top when given
 *   await findPatterns({ llm });                              // candidates, merged with known patterns
 *   const answer = await ask('Что я обещал?', { llm });       // answer with [c1]/[i2] links to records
 *   const pack = await buildContextPack({ privacy: 'initials', maxTokens: 6000 });
 *   const { conversations } = parseExport(fileText);          // ChatGPT / Claude exports
 */

// Providers and errors
export * from './errors';
export { checkAiReadiness, createAiServices, createLlmProvider, createSttProvider, isMockAiBuild } from './providers/factory';
export type { AiFactoryOptions, AiReadiness, AiServices } from './providers/factory';
export { manualBridge, sharedManualProvider } from './providers/manual';
export type { ManualBridge, ManualProvider, ManualRequestKind, ManualRequestView, SubmitResult } from './providers/manual';
export { createMockLlmProvider } from './providers/mock';
export { createMockStt, MOCK_TRANSCRIPT } from './providers/stt/mock';
export { isBrowserSpeechAvailable } from './providers/stt/browser';
export { estimateCostUsd } from './providers/pricing';
export type {
  ChatRequest,
  ChatResult,
  LlmProvider,
  LlmProviderId,
  ModelTier,
  Msg,
  StructuredRequest,
  StructuredResult,
  SttProvider,
  SttProviderId,
  TranscribeOptions,
  TranscribeResult,
  Usage,
} from './providers/types';
export { recordLlmUsage, recordSttUsage } from './usage';

// Capture → structure
export { processCapture } from './pipeline';
export type { PipelineUsage, ProcessDeps, ProcessOutcome, ProcessResult } from './pipeline';
export { applyGlossary, buildSttPrompt, transcribeCapture } from './transcribe';
export type { TranscribeDeps } from './transcribe';
export { applyMoodSuggestion } from './checkin-suggest';
export type { AmbiguousMention, MergeSuggestion } from './entities';
export { findDuplicate, findMergeCandidates, resolveByName } from './resolver';
export { SCHEMA_NAMES } from './prompts/schemas';
export type { Extraction } from './prompts/schemas';

// Reviews, patterns, questions
export { buildReviewDigest, generateReview, rulesReview } from './reviews';
export type { ReviewDeps, ReviewDigest, ReviewResult } from './reviews';
export { findPatterns } from './patterns';
export type { PatternSearchDeps, PatternSearchResult } from './patterns';
export { ASK_LIMITS, QUICK_QUESTIONS, ask, parseCitations, retrieveMaterials, segmentAnswer } from './ask';
export type { AnswerSegment, AskAnswer, AskDeps, AskSource, Citation, Materials, Retriever } from './ask';

// Context for other AIs, imports
export * from './contextpack';
export { createScrubber } from './privacy';
export type { Scrubber } from './privacy';
export { ImportError, conversationToCapture, importConversations, parseExport, parseExportData, parsePastedChat } from './importers';
export type { ImportOptions, ImportResult, ImportSource, ImportedConversation, ImportedMessage, ParsedExport } from './importers';
