<p align="right"><a href="../zh/webui.md">中文</a> · <b>English</b></p>

# The studio (WebUI): design and upkeep

The studio is not "a tab inside an admin console" but "TA's little world": she is a breathing, shape-shifting, expressive glow of soul living at the center of the interface. Here you see her, get to know her and write her nature, and you can undo changes that feel wrong, but you cannot rewrite her.

## Design goals

- **She is the center.** Interface text calls her "TA"; the glow, sky and motion change with her state, they are not decoration.
- **Mood is the theme.** Seven themes — lively, sweet, calm, low, irritable, sleepy, night — with thresholds matching `moodLabel()`, so the theme agrees with the mood she names. Palette, sky, particles and the pace of motion move smoothly with mood and rhythm; once she is asleep the whole interface turns to night.
- **One scene per area**: Now is the sky, Inner life is the starfield, People is a galaxy, Lifetime is a diary, Time is a workbench, Chat is a messenger, Memory is a bookshelf, Nature is a greenhouse, System is a workbench.
- **Sources are visible.** Every change can be opened to see its source and undone. The interface shows her, not settings.
- **Restraint.** Decoration appears only in navigation, headers and empty states and never covers real content. "Reduce motion" and the system's reduced-motion setting switch off particles and morphing; particles are capped and pause when the tab is hidden.

## Information architecture

| Group | Entry | Its one job |
| --- | --- | --- |
| TA | Now | Her as she is: mood, what she is doing, what she said lately, what she is waiting for, today's timeline, usage and run status |
| TA | Inner life | The star map of threads of self, the notes wall, the mood ribbon |
| TA | People | The people galaxy, person details, how she is in each group |
| TA | Lifetime | Diary, reviews, my journey and chapters, promises and anticipation, the bookshelf |
| Daily life | Time | The record of her actual life: activities, to-dos, works, ongoing projects, experiences |
| Daily life | Chat | Sessions, live chat and "why she said that", feedback, session settings, simulation, replay |
| Daily life | Memory | What she remembers, the reference bookshelf |
| Settings | Nature | The only part you write: name, character, interests, boundaries, bottom lines, daily rhythm, daily tokens, trial chat |
| Settings | System | Connect QQ (OneBot 11 or the official bot, either-or), model library, run switches |
| Settings | Plugins | Plugins that ship with her and ones already installed, the market, things she wants to do that need your yes, import and development |

On a phone the bottom bar holds "Now, Chat, Inner life, Lifetime" and the other entries are under "More". Links from the old studio (`#her`, `#live`, `#spaces`, `#lab`, `#knowledge`, `#models`, `#connect`, …) jump to their new places automatically.

## Top right: language

The switch in the top-right corner toggles between "中文" and "English". Chinese is the default; the choice is kept in the browser's `localStorage` (`luckyLocale`) and mirrored on `<html lang>`. Switching language does not reload data while there is an unsaved draft. The guide link points to `/guide.html` or `/guide.en.html` by language.

Strings are keyed by their Chinese original. **Her own content is never translated**: what she says, her diary, thoughts, reasons, memories and people's names are shown in elements marked `data-own` and stay as written. Server-side text visible in the interface (errors, readiness checks, labels) is translated at the API exit according to the `X-LuckyTri-Locale` request header; what is stored in the database is never translated.

## Layout and who owns scrolling

On desktop the studio is a fixed-viewport workbench: sidebar, header, content stage. `min-height: 0` must run through every flex/grid parent so scrolling is taken by the innermost content and the number of records never changes the page height.

- Chat: messages scroll on their own; the right side is this session; feedback is paginated and long feedback cannot stretch the page.
- List-plus-form pages: the list scrolls, the form scrolls, and the save button stays in a bottom action bar.
- Memory: the list scrolls on its own and is paginated; adding moves into a dialog.
- Replay: messages, logs and raw detail each scroll separately, so long JSON cannot push the layout apart.
- Phone: navigation at the bottom, columns stacked, every long panel has a defined height; no horizontal scrolling at any width.

## Implementation boundaries

Vue 3 + Vite + TypeScript, with no design-system dependency.

```text
studio-web/src/
  App.vue          shell: navigation, top bar (with the language switch), theme and sky
  router.ts        entries, navigation groups, legacy link map
  pages.ts         page loader table
  pages/           one folder per entry
  plates/          request wrappers for the server API
  stores/          shared state: studio, presence
  mood/            mood themes and glow state
  components/      shell · sky · ta (the glow) · ui (shared controls)
  i18n/            index.ts (t, N_, localized, locale) · en/ (English dictionaries)
  styles/          tokens · base · themes
```

Live messages follow new arrivals while you are at the bottom and keep their place while you read older ones. Switching session clears the old view and checks which session an async result belongs to. Errors surface as brief toasts, a failed save keeps the draft, and leaving a page with an unsaved draft asks first. The browser's native confirm boxes and token prompt were replaced by in-interface dialogs.

## Verification and release

- `npm run build:ui`: builds the `public/app` that ships with the project; rebuild and commit it together after any frontend change.
- `npm run test:ui`: a separate temporary database and a simulated channel, nothing is sent to real groups; it covers the smoke flow (sessions, simulated messages, memory, models, both ways of connecting QQ, the guide page), the little world (mood themes and night, pinned theme, reduced motion, star-map undo, person details, diary and promises), navigation caching, the time page, performance, and the English interface (Chinese may only appear inside her own content), at widths 1440 / 820 / 390.
- `node tests/ui/ta.mjs --serve`: opens an example world that has lived three days, handy for looking at the interface directly.
- Screenshots go only into the ignored `workspace/` folder; real chat screenshots and configuration must never be committed.

System → Runtime includes a manual version check against npm, with the current version, last successful check and release notes. Results are cached for five minutes; failures retain the last known information. Checking does not install or restart.
