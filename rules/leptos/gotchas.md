# Leptos Gotchas (0.8+)

## Component Children

- `Children` = `Box<dyn FnOnce() -> AnyView>` — rendered once
- `ChildrenFn` = `Box<dyn Fn() -> AnyView>` — required for conditional or repeated rendering
- `ChildrenMut` = `Box<dyn FnMut() -> AnyView>` — when mutation between renders is needed
- `<Show>` children must be `Fn`, not `FnOnce` → use `ChildrenFn` for wrapper components used inside `<Show>`
- Use `StoredValue` for non-Copy data accessed inside `Fn` children (see `patterns.md`)

## `<For>` Syntax

`let:entry` syntax has known issues in 0.8 (span/macro interactions) — prefer explicit `children` prop:

```rust
// FRAGILE — let: syntax, test carefully
<For each=move || items.get() key=|item| item.id let:item>
    <Item item=item />
</For>

// PREFERRED — explicit, no macro surprises
<For
    each=move || items.get()
    key=|item| item.id
    children=move |item| view! { <Item item=item /> }
/>
```

## Compilation

- Complex views can hit `queries overflow the depth limit!` → add to `lib.rs`:
  ```rust
  #![recursion_limit = "512"]
  ```
- `leptos_router` and `leptos_meta` 0.8 do **not** have a `"hydrate"` feature — only `leptos` itself does
- Import `web_sys` as `leptos::web_sys` (re-exported), not as a direct crate dependency

## Props

- Prefer `String` over `&str` for component props — use `.to_string()` at call sites
- `into` attribute (`#[prop(into)]`) can ease ergonomics for string props

## WASM Safety

- Server functions and anything that uses tokio/mio are **not** WASM-safe
- Crates used by both SSR and WASM must be free of tokio, mio, or other non-WASM dependencies
- Gate SSR-only dependencies behind feature flags if the crate targets both environments
