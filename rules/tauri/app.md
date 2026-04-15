---
title: "Tauri App Architecture"
---

Applicable to Tauri v2 apps using Preact/React + TypeScript.
Extends the `frontend-flat-domain` rule with Tauri-specific patterns.

## Transport — Tauri IPC, Not HTTP

Tauri apps communicate via `invoke()` (request/response) and `listen()` (push events).
There is no HTTP API, no REST, no OpenAPI spec.

**No TanStack Query.** The pull-based caching model does not fit:
- IPC is local (microsecond latency) — caching adds overhead without benefit
- Most data is push-based (events from the Rust backend) — not request/response
- Streaming data requires incremental store updates, not cache invalidation

All state goes through **Zustand stores**, organized by the flat-domain rule.

## State Model

Three categories — same as `frontend-flat-domain`, different tooling:

| Category | Lives in | Tool | Updated by |
|----------|----------|------|------------|
| **Server state** | `features/{domain}/logic/` | Zustand store | `invoke()` results + Tauri events |
| **App state** | `core/` | Zustand store or Context | Tauri events (connection, health) |
| **Local state** | `features/{domain}/logic/` | Zustand store | UI interactions |

### Store pattern

```typescript
// features/chat/logic/store.ts
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
import { useChatStore } from '@/features/chat/logic/store'

// Setup once at app mount
onAssistantStream(({ content, phase }) => {
  if (phase === 'delta') useChatStore.getState().appendStream(content)
  if (phase === 'done') useChatStore.getState().finalizeMessage()
})
```

## Dependency Flow

```
pages/ → features/ → ui/
pages/ → layouts/
features/ → core/tauri/   (commands + events)
features/ → core/config/
ui/ → (nothing)
core/ → (nothing — no feature imports)
```

Features consume `core/tauri/commands` for request/response and subscribe to events
via `core/tauri/events`. Features never import `@tauri-apps/api` directly.

## Rules

- No TanStack Query — all server state in Zustand stores
- No raw `invoke()` or `listen()` in features — always go through `core/tauri/`
- Events update stores, components subscribe to stores — no event listeners in components
- Cross-feature data: each feature fetches independently via `core/tauri/commands`; Zustand handles deduplication if needed
- App-wide state (connection, health) in `core/`, not in features
