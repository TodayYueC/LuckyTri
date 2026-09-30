import { unpackVector } from "./retrieval.js";

const BANDS = 12,
  BITS = 6;
export const VECTOR_CANDIDATES = 256;

// Deterministic random hyperplanes: index signatures remain valid across
// restarts and do not depend on the order documents were imported.
function signatures(vector) {
  const result = [];
  for (let band = 0; band < BANDS; band++) {
    let bucket = 0;
    for (let bit = 0; bit < BITS; bit++) {
      let sum = 0;
      for (let dimension = 0; dimension < vector.length; dimension++) {
        let seed =
          Math.imul(dimension + 1, 0x9e3779b1) ^
          Math.imul(band * BITS + bit + 1, 0x85ebca6b);
        seed = Math.imul(seed ^ (seed >>> 16), 0x7feb352d);
        sum += vector[dimension] * (seed >>> 31 ? 1 : -1);
      }
      if (sum >= 0) bucket |= 1 << bit;
    }
    result.push({ band, bucket });
  }
  return result;
}

export function ensureVectorIndex(db) {
  const rows = db.prepare(
    "SELECT id,embedding FROM core_chunks WHERE vector_indexed=0 AND embedding IS NOT NULL",
  );
  const insert = db.prepare(
    "INSERT OR IGNORE INTO core_vector_buckets(dimension,band,bucket,chunk_id) VALUES (?,?,?,?)",
  );
  const mark = db.prepare("UPDATE core_chunks SET vector_indexed=1 WHERE id=?");
  db.exec("SAVEPOINT vector_index");
  try {
    for (const row of rows.iterate()) {
      const vector = unpackVector(row.embedding);
      if (
        vector?.length &&
        vector.every(Number.isFinite) &&
        vector.some((value) => value !== 0)
      )
        for (const { band, bucket } of signatures(vector))
          insert.run(vector.length, band, bucket, row.id);
      mark.run(row.id);
    }
    db.exec("RELEASE vector_index");
  } catch (error) {
    db.exec("ROLLBACK TO vector_index");
    db.exec("RELEASE vector_index");
    throw error;
  }
}

export function vectorCandidates(db, vector, collections, cutoff) {
  if (!vector?.length || !vector.every(Number.isFinite)) return [];
  const buckets = signatures(vector).flatMap(({ band, bucket }) =>
    [
      bucket,
      ...Array.from({ length: BITS }, (_, bit) => bucket ^ (1 << bit)),
    ].map((value) => ({ band, bucket: value })),
  );
  return db
    .prepare(
      `SELECT b.chunk_id FROM core_vector_buckets b
    JOIN core_chunks c ON c.id=b.chunk_id JOIN core_documents d ON d.id=c.document_id
    WHERE b.dimension=? AND (${buckets.map(() => "(b.band=? AND b.bucket=?)").join(" OR ")})
    AND c.collection_id IN (${collections.map(() => "?").join(",")}) AND d.status='ready' AND d.created<=?
    GROUP BY b.chunk_id ORDER BY COUNT(*) DESC, c.created DESC, b.chunk_id LIMIT ?`,
    )
    .all(
      vector.length,
      ...buckets.flatMap((item) => [item.band, item.bucket]),
      ...collections,
      cutoff,
      VECTOR_CANDIDATES,
    )
    .map((row) => row.chunk_id);
}
