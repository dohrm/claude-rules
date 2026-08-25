---
paths:
  - "**/*.ts"
  - "**/*.tsx"
title: "Tauri App Architecture"
---

Applicable to Tauri v2 apps using Preact/React + TypeScript.

`just ts-tauri-check` is the React overlay (hooks + jsx-a11y + DOM). It
does not see `invoke` / `listen` wrappers or Zustand stores. The Rust
host is `just rust-check`.

The layers come from `portal-flat/principle.md`; this rule is its **transport**, the
desktop counterpart of `portal-http/react.md`. Install `portal-flat` and `tauri`,
never `portal-http` — the two transports contradict each other by design.

## Transport — Tauri IPC, Not HTTP

Tauri apps communicate via `invoke()` (request/response) and `listen()` (push events).
There is no HTTP API, no REST, no OpenAPI spec.

**No TanStack Query.** The pull-based caching model does not fit:
- IPC is local (microsecond latency) — caching adds overhead without benefit
- Most data is push-based (events from the Rust backend) — not request/response
- Streaming data requires incremental store updates, not cache invalidation

All state goes through **Zustand stores**, organized by the flat-domain rule.

## State Model

Three categories — the same as `portal-flat/principle.md`, different tooling:

| Category | Lives in | Tool | Updated by |
|----------|----------|------|------------|
| **Server state** | `features/{domain}/api/` | Zustand store | `invoke()` results + Tauri events |
| **App state** | `core/` | Zustand store or Context | Tauri events (connection, health) |
| **Local state** | `features/{domain}/logic/` | component state or a small store | UI interactions |

Server state lives in `api/` — the backend boundary — for the same reason it does in
an HTTP portal: `logic/` is screen behaviour, never a home for backend data.

### Store pattern

```typescript
// features/chat/api/store.ts
import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

interface ChatStore {
  messages: Message[]
  streaming: string
  loadHistory: (sessionId: string) => Promise<void>
  appendStream: (content: string) => void
  finalizeMessage: () => void
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  streaming: '',

  loadHistory: async (sessionId) => {
    const messages = await invoke<Message[]>('load_messages', { sessionId })
    set({ messages })
  },

  appendStream: (content) =>
    set((s) => ({ streaming: s.streaming + content })),

  finalizeMessage: () => {
    const { messages, streaming } = get()
    set({
      messages: [...messages, { role: 'assistant', content: streaming }],
      streaming: '',
    })
  },
}))
```

## IPC Wrappers — `core/tauri/`

Typed `invoke()` wrappers and event listeners live in `core/tauri/`.
Features never call `invoke()` or `listen()` directly — they go through core.

```
core/
└── tauri/
    ├── commands.ts    # Typed invoke() wrappers per Rust command
    └── events.ts      # Typed listen() wrappers per Tauri event
```

```typescript
// core/tauri/commands.ts
import { invoke } from '@tauri-apps/api/core'

export const commands = {
  loadMessages: (sessionId: string) =>
    invoke<Message[]>('load_messages', { sessionId }),

  sendMessage: (sessionId: string, text: string) =>
    invoke<void>('send_message', { sessionId, text }),

  requestPairing: (url: string, label: string) =>
    invoke<PairRequestResult>('request_pairing', { url, label }),
} as const
```

```typescript
// core/tauri/events.ts
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export function onAssistantStream(
  handler: (payload: { sessionId: string; content: string; phase: string }) => void
): Promise<UnlistenFn> {
  return listen('ozzie://assistant-stream', (event) => handler(event.payload))
}

export function onPromptRequest(
  handler: (payload: { sessionId: string; token: string; message: string }) => void
): Promise<UnlistenFn> {
  return listen('ozzie://prompt-request', (event) => handler(event.payload))
}
```

## Event → Store Wiring

Event listeners are set up in a top-level provider or effect, wiring Tauri events to Zustand stores.
This is the only place where `core/tauri/events` and `features/*/logic/` meet.

```typescript
// providers.tsx or a dedicated core/tauri/bridge.ts
import { onAssistantStream, onPromptRequest } from '@/core/tauri/events'
import { useChatStore } from '@/features/chat/api/store'

// Setup once at app mount
onAssistantStream(({ content, phase }) => {
  if (phase === 'delta') useChatStore.getState().appendStream(content)
  if (phase === 'done') useChatStore.getState().finalizeMessage()
})
```

Dependency arrows match `portal-flat/principle.md`; features reach the backend
through `core/tauri/` (commands + events), not `core/http/`. Features never
import `@tauri-apps/api` directly.

## Store Hygiene

A store is a cache with no expiry, so its lifecycle is explicit: reset every
server-state store on logout or identity change, and on the events that invalidate
what it holds. Stale store data outlives a session exactly the way a stale query
cache does.

## Rules

- No TanStack Query — all server state in Zustand stores, under `features/{domain}/api/`
- Server-state stores are reset on logout / identity change
- Business decisions stay in the Rust backend — the UI renders them (`portal-flat/principle.md`)
- No raw `invoke()` or `listen()` in features — always go through `core/tauri/`
- Events update stores, components subscribe to stores — no event listeners in components
- Cross-feature data: each feature fetches independently via `core/tauri/commands`; Zustand handles deduplication if needed
- App-wide state (connection, health) in `core/`, not in features
