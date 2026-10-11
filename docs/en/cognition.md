<p align="right"><a href="../zh/cognition.md">中文</a> · <b>English</b></p>

# Cognition and memory

She is still one turn call, not one model call per layer. What was added is a hint while a message is waiting, one recall path, episode threads, working memory, and lessons written in solitude from experience.

## How a message moves

1. It is stored in `core_events`. The speaker's query vector is computed while the batch is waiting.
2. Messages in one session become one turn. `understanding.js` joins one person's consecutive lines and notes tone, stance and time expressions. Those are hints.
3. `mind/recall` takes vector, full-text and structured candidates together, fuses them by reciprocal rank, then reranks by person, age and source. Permission is applied before ranking.
4. Working memory keeps the current stretch verbatim. Older stretches are a summary plus semantic recall. Open episodes appear on a relationship as `goingOn`.
5. One turn call. A model sometimes nests `choice` inside `understanding` or `contribution`. Normalization puts the fields back where the contract says they belong.
6. The reply is checked and sent. Background consolidation writes facts and episodes. An episode whose follow-up time has arrived, or a promise that is due, is only a candidate during solitude. It still passes the existing initiative gates.

When the embedding service is down, recall falls back to full text, structured lookup and recent context. The turn still runs.

## Storage

`DATABASE_VERSION` is 5. `mind_index`, `mind_index_fts` and `mind_vectors` are derived and can be rebuilt. `mind_episodes` is append-only: a status change is a new row in the same `thread_id`. `mind_self` gained a `lesson` kind and a `subject`. A lesson must cite experience that did not come from the model. The same experience is used once. Two independent pieces move it from `emerging` to `active`. A counterexample revises it downward.

A fact can be archived. Archiving only removes it from ordinary recall. When a person asks for deletion, the source, the index row and the vector are removed together.

## Embeddings

The configured embedding model uses the OpenAI-compatible `/embeddings` endpoint, in batches, 2048 dimensions by default. Asking for 1024 works and is similar. The Ark multimodal endpoint takes one item at a time. Cosine between a short chat line and a stored fact is low, so a hit counts when it stands above the median of the nearest batch, with different floors for the speaker, people present, and everyone else. Queries have their own request lane and do not queue behind conversation. Background backfill is paced and slows down on HTTP 429.

On a backup copy, with 1024 dimensions and about 40 paraphrased real facts: lexical Recall@5 was 0.475; hybrid recall with feature rerank was 0.950, and the average number returned fell from 12 to about 3.9. There is no separate model reranker.

## What evaluation showed

Before these changes, a recent day of live turns had a median of about 35 seconds, and about 8.4 seconds before the first model call. Memory consolidation succeeded 13 times out of about 230. Priority lanes, persisted backoff, picking a free slot, and skipping a knowledge embedding when the library has no vectors, are there to stop failed retries and the queue in front of a turn.

On the same 24 historical turns, the baseline passed 24/24. After tone fields were added, one run failed because JSON fields were nested in the wrong object. Normalization lifts a misplaced `choice`, `tone` or `stance`. Expression hints appear only when openings repeat, questions keep ending the line, or replies keep getting longer.
