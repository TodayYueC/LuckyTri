export { KnowledgeManager } from "./manager.js";
export { captureMemoryCandidate } from "./candidates.js";
export {
  deleteReviewedMemory,
  insertReviewedMemory,
  memoryValid,
  reviewCandidate,
  updateReviewedMemory,
} from "./reviewed.js";
export {
  deleteLegacyMemory,
  indexChunk,
  indexMemory,
  migrateKnowledge,
  upsertLegacyMemory,
} from "./schema.js";
export {
  asPlainDocument,
  chunkText,
  cosine,
  ftsMatchQuery,
  ftsTokens,
  lexicalTerms,
  overlapScore,
  packVector,
  unpackVector,
} from "./retrieval.js";
