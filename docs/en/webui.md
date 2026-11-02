<p align="right"><a href="../zh/webui.md">中文</a> · <b>English</b></p>

# The studio (WebUI): design and upkeep

The studio uses a desktop-first card layout. A compact header identifies the current area and a persistent rail provides six primary destinations. Content starts immediately, without decorative banners or a global back button.

## Design goals

- Consistent card edges, spacing, type and form controls; home cards share row boundaries.
- Preserve seven mood themes, the character orb and spring motion during interaction. A lightweight WebP sky replaces the continuously rendered particle canvas. Reduced motion follows both the user setting and the system preference.
- Use tabs for primary work and sheets for contextual details, sources, replay, session settings and creation. Header popovers contain appearance, connection status and settings.
- Preserve business APIs and all editing, history, undo, import and export operations. Regrouping destinations never changes stored data.

## Information architecture

| Destination      | Sections and functions                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Now              | Character status, today's events, anticipation, recent words, thoughts, unread messages, usage and totals                           |
| Chat             | Sessions, messages, simulation, reasons and replay; details and feedback in a sheet                                                 |
| Inner life       | Self threads, notes, mood history, sources and undo                                                                                 |
| Life             | Schedule (today, tasks, experiences), diary, anticipation, creations (works and projects), reviews and life story                   |
| Memory           | Conversation memory, reference library and reading history                                                                          |
| People           | People, group identities, account relationships, history and undo                                                                   |
| Settings popover | Character (profile, growth, routine/budget, prompts), system (connection, models, stickers, voice/media, runtime, storage), plugins |

Phones show the same six destinations in a bottom bar. Selecting the active destination preserves its section. Returning restores the section and scroll offset for the current visit. Existing URLs, including #time, #life, #spaces and #lab, remain supported.

## Home customization

Customize home shows or hides cards, reorders them with up/down controls and changes their spacing. Preferences are local to this browser under luckytri-home-layout-v1 and survive reloads. Malformed preferences fall back safely, unknown card IDs are ignored and at least one card stays visible. Character image and framing controls live in the profile card's image menu.

## Appearance and language

The appearance popover contains themes, reduced motion, wallpaper and language. Chinese is the default; luckyLocale remembers the language and updates html lang. Changing language never reloads unsaved drafts. The tutorial link follows the selected language.

Strings are keyed by their Chinese original. **Her own content is never translated**: what she says, her diary, thoughts, reasons, memories and people's names are shown in elements marked `data-own` and stay as written. Server-side text visible in the interface (errors, readiness checks, labels) is translated at the API exit according to the `X-LuckyTri-Locale` request header; what is stored in the database is never translated.

## Layout and who owns scrolling

On desktop the studio is a fixed-viewport workbench: sidebar, header, content stage. `min-height: 0` must run through every flex/grid parent so scrolling is taken by the innermost content and the number of records never changes the page height.

- Chat: messages scroll independently; session details and paginated feedback open in a sheet.
- List-plus-form pages: the list scrolls, the form scrolls, and the save button stays in a bottom action bar.
- Memory: the list scrolls on its own and is paginated; adding moves into a dialog.
- Replay: messages, logs and raw detail each scroll separately, so long JSON cannot push the layout apart.
- Phone: navigation at the bottom, columns stacked, every long panel has a defined height; no horizontal scrolling at any width.

## Implementation boundaries

StudioShell.vue owns navigation, header popovers and scroll restoration. navigation.ts maps the six destinations onto existing routes. useModal.ts owns the modal stack, focus cycling and Escape. Home preferences live in pages/now/home-layout.ts. CSS layers are declared before any styles load: base, components, then the unlayered studio design rules. Pages load on demand; five common pages may remain cached.

Vue 3 + Vite + TypeScript, with no design-system dependency.

```text
studio-web/src/
  App.vue          startup, access control, refresh and SSE lifecycle
  router.ts        routes and legacy link map
  navigation.ts    primary destinations and grouped sections
  pages.ts         page loader table
  pages/           one folder per entry
  plates/          request wrappers for the server API
  stores/          shared state: studio, presence
  mood/            mood themes and glow state
  components/      shell (StudioShell) · sky · ta · ui (controls and useModal)
  i18n/            index.ts (t, N_, localized, locale) · en/ (English dictionaries)
  styles/          tokens · base · themes · studio
```

Live messages follow new arrivals while you are at the bottom and keep their place while you read older ones. Switching session clears the old view and checks which session an async result belongs to. Errors surface as brief toasts, a failed save keeps the draft, and leaving a page with an unsaved draft asks first. The browser's native confirm boxes and token prompt were replaced by in-interface dialogs.

## Verification and release

- `npm run build:ui`: builds the `public/app` that ships with the project; rebuild and commit it together after any frontend change.
- `npm run test:ui`: a separate temporary database and a simulated channel, nothing is sent to real groups; it covers the smoke flow (sessions, simulated messages, memory, models, both ways of connecting QQ, the guide page), the little world (mood themes and night, pinned theme, reduced motion, star-map undo, person details, diary and promises), navigation caching, the time page, performance, and the English interface (Chinese may only appear inside her own content), at widths 1440 / 820 / 390.
- `node tests/ui/ta.mjs --serve`: opens an example world that has lived three days, handy for looking at the interface directly.
- Screenshots go only into the ignored `workspace/` folder; real chat screenshots and configuration must never be committed.
- Layout checks cover 28 routes and sections at five widths (1440, 1024, 820, 390 and 320), plus home alignment, saved customization, section restoration, unsaved drafts and keyboard focus in popovers and nested dialogs.

System → Runtime checks npm manually, with the current version, last successful check and release notes. Results are cached for five minutes; failures retain the last known information. Update and restart explicitly downloads and checks the program, saves a backup and switches instances. Progress survives restart, the page waits for reconnection, and repeated clicks do not launch a second install.

People → Relationships binds people or other robots by account, using themed choices for type, reciprocal roles, name and visibility. Person details show change history; ending a relationship does not delete encounters. Summaries load on demand alongside existing chat caching.
