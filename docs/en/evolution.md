<p align="right"><a href="../zh/evolution.md">中文</a> · <b>English</b></p>

# Long-term evolution charter

Treat LuckyTri as an agent that keeps growing through long iteration, not as a chatbot that slowly collects features.

The ultimate goal is for LuckyTri to move from a program that only responds to an agent with a stable personality, continuous memory, a sense of time, independent judgment, inner goals and consistent behavior over the long run.

Long-term directions:
1. Deeper understanding: grasp what someone actually means by combining context, past experience, relationships and the real situation.
2. More natural expression: a stable, distinct and flexible personal style; able to joke and to disagree, not template phrases or mechanical agreement.
3. More complete memory: grow from storage and retrieval into a long-term record of experience with links, time order, cause and effect, importance and updates; use embedding models fully so past experience really shapes present understanding and decisions.
4. A more coherent inner world: self-image, preferences, goals, relationships and simulated emotion influence one another and evolve with experience, instead of starting over in every conversation.
5. More meaningful autonomy: notice problems, arrange things, look back, form goals and act, with motives, reasons and continuity, respecting people's wishes and permissions.
6. More real growth: revise old views with new experience, change preferences, reinterpret the past, question earlier judgments; keep the core personality continuous without locking it to the initial persona forever.
7. Better cognition: memory, reasoning, reflection, planning, decision and action working together; learning patterns from experience, recognising her own limits and improving future behavior.

Engineering principles:
- Do not assume any architecture is the final answer; judge new techniques by how the project actually behaves.
- Improve foundations and how modules work together before adding features, prompts or model calls. Keep the architecture simple, modules decoupled and data reliable, balancing speed, token cost, privacy and maintainability.
- Evaluate continuously (real interaction, long-term memory tests, behavior consistency tests, user feedback). Every change needs a clear goal, a verifiable gain and a way back.
- Do not mistake "more human-like" for "smarter", or complex behavior for consciousness. Do not shape an ideal persona with piles of rules; let reliable memory, continuing experience, sound cognitive mechanisms and gradually opened autonomy make her behavior grow in a natural, stable and explainable way.
- Ask of every change: does this really bring LuckyTri closer to the goal?

In the end: let her connect her experiences into a history that keeps developing; she should not stay forever as she was first designed.

## How this charter is used

- Each change states which direction it serves and how its gain is verified: the evaluations in `scripts/dev/` (`evaluate-recall.js`, `evaluate-turn-cost.js`, `benchmark-recall-scale.js` and others) compare before and after, and the numbers go into the commit message or report.
- Changes without a verifiable gain, or that only "look better" through longer prompts, are not merged; changes that make the evaluations worse are rolled back.
- Mind tables stay append-only, every change cites its source, and revocations leave tombstones (see [Architecture](architecture.md)). That is what makes growth traceable and reversible, and no new mechanism is an exception.
