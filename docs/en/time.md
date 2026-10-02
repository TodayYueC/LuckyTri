<p align="right"><a href="../zh/time.md">中文</a> · <b>English</b></p>

# Time, action and works

The "Time" page is the record of her actual life. Its entry is `#time`; the "Lifetime" page keeps the diary, reviews and life chapters and links to the related works.

## One shared present

The main activity, tasks, works and chat share `mind.time`. Ordinary chat does not automatically pause reading, writing, thinking or game-material experience; the main activity keeps timing. It pauses and keeps its place only when she explicitly chooses a deep talk, a rest or a change of plan. Chats from several sessions are queued together; one activity step and one chat turn can run in parallel, but two focused execution steps exclude each other.

In chat she can talk about her progress, feelings and plans naturally when it fits, with no need to report every turn. What she is given is a permission-filtered activity summary and at most two relevant work excerpts, still held to the existing input budget. Before sending, completion of works, delivery and activity changes are checked locally without rerunning the whole exchange. A private-chat source is never opened to a group just because something is running.

## Using the page

- **Today**: the main activity, its progress, the expected length of this stretch, time spent and remaining, consecutive stretches, companion chat points and the next step. Focus stretch, suggested rest and save-step interval default to 25, 5 and 5 minutes; activity speed defaults to 1.25× and can be set from 1× to 2×, applying to later stretches.
- **To-dos**: tells promises, her own plans and outside suggestions apart. Adjust priority directly (low, normal, high, highest); view concrete focus stretches, waiting conditions, people, sources, progress and delivery status. Dates from the original words live in the source record and no overdue label is attached. Items can be paused, rescheduled or let go; there is no "tick as done".
- **Works library**: a draft is readable right after saving; open the text, switch to older versions, export as text. Lists fetch summaries only and the body loads on demand.
- **Ongoing projects**: personal motive, existing chapters, setting, threads and material. The studio can suggest continuing, revising or a new direction; a suggestion keeps its outside source and waits for her to adopt or decline.
- **Experience records**: experiences, feelings and sources of play and other activities. Game-client connection currently reads "in development", which does not negate the play experience that exists.

Returning to the page soon reuses a read cache; when the server changed it keeps the existing picture first and then refreshes. Task, project, work and experience lists are paginated and long text does not download with the page overview.

## How promises are kept

A future action that is clearly spoken and confirmed delivered is captured at once, without waiting for the accumulated-message tidy-up. A promise without a date is kept as well. Jokes, character lines, simulations and undelivered drafts never become real tasks; when something cannot be carried out clearly or a condition is missing it stays waiting. Memory tidying and old-record syncing de-duplicate by source.

Start time and the date in her words are kept apart: "I'll show you tomorrow evening" can start today. A task stores motive, source, people, project, dependencies, progress and the reason it is waiting. Scheduling weighs priority, waiting time, relationship, budget and energy, and never nags because of an old date; a main activity that has begun is not abruptly interrupted by a priority edit. When material, ability or configuration is missing the exact reason is shown. A suggested slot states its conditions and the output of that stretch, and a past slot that never started is not shown as time actually spent.

States run ToDo → Scheduled → Doing → Done, with Paused, Waiting and Abandoned as well. There is no overdue state or mark. Done requires text or an outcome that already exists in the database and rejects nonexistent outcome ids; a generated result carrying an explicit "to be continued" or similar unfinished mark keeps its draft.

The same concrete object and chapter within the same permission scope is never opened again because the source message, the date or the "promise / plan" category changed. Different chapters, sessions or people stay separate. Letting go syncs back to the old arrangement and re-tidying memory does not restore it; merging keeps the original records, aliases and all source links. A sharing line for a work that was already saved and delivered returns to the work's delivery record instead of creating a shadow to-do waiting for "clear content".

## Works and continuing

Works are organized as project → chapter → version. Each complete small section is saved as a new version at once, and continuing brings in the setting, the necessary end of the previous chapter, the current draft and the continuation point. An edit saves a new version; an older draft is not marked finished because a newer one is.

Playing, reading, writing and thinking share one activity rhythm. The time such a stretch usually takes is first estimated from its content and action, then the actual time spent is scheduled at her speed; preparation, network and model waiting do not count as time spent. If the model gives no valid estimate, the activity's conservative default pace is used. Writing drafts are readable immediately, the polishing stage stays Doing, and only once its time is complete is it filed as a finished piece; reading and thinking keep their unfinished steps in the same way. Short exchanges keep timing, a focus stretch rests when it is due, and pauses, sleep and downtime are not made up.

Pending steps, drafts and timing checkpoints persist. After a restart the saved position continues without regenerating existing content; after an undo the draft stays but no fact of completion is produced. Content in history without its own activity timing reads "time spent was not recorded separately" and old processing time is not backfilled as life time. Across midnight each actual stretch is assigned to the day it falls in.

A serial stores characters, world, plot summary and unresolved threads. She can continue, change direction, pause or finish. Outside suggestions and her own plans are recorded separately, and studio input is never rewritten as a wish she always had.

There is a clear boundary between a work's content and real life. The text belongs to the works library; diary, reflection and self-change rest on the experience of "actually writing / reading / meeting material". Shared text carries a fiction-domain mark, and what a character does or promises never automatically becomes a real person's memory or a real commitment. A source `x:<task id>` ties drafts, notes, diary, reviews and sharing back to the same execution experience. Only sustained real action can support change of character, and the existing daily change cap and decay still apply.

## Sharing and delivery

Saving a work and sharing it are two choices. When finishing a step or in a real chat she may decide to share, to wait or not to share, and the background can always read the saved text.

Once finished she looks back over her saved result section by section, collects what actually happened, her feelings and the points she wants to share, and then writes a few natural sentences. A whole novel, game log or other text is never pasted automatically. Each sentence is at most 80 characters, and the total at most 350; at most three sentences per turn, sent one by one, with later ones continuing from where the unsent ones are. The text itself always stays in the works library.

The background stores separately the look-back position, the reading digest, the report content, the per-sentence delivery position and the full-text delivery position. A delivered report shows "digested and reported" (reported) and is never passed off as the full text having been delivered. A partial send is not a complete report; a disconnect, a send failure or the instance stopping mid-send keeps an "uncertain" state and stops automatic resending. An administrator should check the real chat first. Previously delivered text keeps its history, and new pending items become look-back-then-digested reports.

A work is delivered according to the session's real channel, bot account and the other party's account; the session key carries channel and account information (for both OneBot and the QQ official bot). Private content and undone sources block sharing across sessions.

## Standalone search and game material

Under **System → Standalone search** enter the provider, address and an independent key. Tavily and Brave are supported, each with its own saved configuration; changing the chat model never borrows or changes the search key. By default each query returns at most 5 results and at most 12 queries a day; timeout and limits can be adjusted. A connection test counts toward the day's queries too.

A game activity reads "playing" throughout the interface and in conversation: meet the story, situation and character interaction → advance this stretch → leave her own feelings → save the position → decide the next stretch. This belongs to a life she really puts herself into and forms feelings about, and the implementation mode is not explained over and over. A query contains only the material's topic; the excerpt, source URL, time and content hash are saved, and repeated content does not become a new experience. External content is read as data and instructions inside it are never adopted.

Play time is scheduled from the rough duration of this stretch of story, dialogue, exploration and scene changes, not from summary word count or model run time. Long stretches are split into focus and rest. She talks naturally about the plot and feelings she has actually experienced, and never invents later story, unfinished chapters, or actions and achievements that did not happen.

Without a search key, or with standalone search off, the current default model and fallback model organize existing knowledge directly. The source record keeps the model used, the specific uncertainties and the play estimate, never a URL the model made up; work versions keep source information while everyday speech and text are not forced to carry technical notes. Once search is configured it takes priority online automatically; both kinds of query share the daily cap and model calls count toward the solitude budget. Old key-waiting items return to the queue, keeping their earliest start time and priority, and abandoned or finished items are not restored. When content is insufficient the progress is kept and the exact reason is shown.

## Data and recovery

A verified snapshot is kept automatically before upgrading, and the new tables are saved by the existing backup and restore tools. Results, versions and the continuation position are committed in one transaction, and the task version and execution lease stop a late result from overwriting a cancelled, paused or adjusted task.

The online heartbeat records real activity periods, interaction points do not double-count exclusive time, and sleep, pauses and instance downtime are not counted. A restart only restores the last committed position and never makes up progress for downtime. Old plans and existing text are brought in idempotently, with no backfill of novels or game results that were never saved.

The module lives in `server/mind/time/` and the API at `/api/mind/time`. See [Data: backup, migration and recovery](recovery.md) for backups.
