export { KnowledgeManager } from "./manager.js";
export { indexChunk, indexMemory, migrateKnowledge } from "./schema.js";
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
