# Leptos Patterns (0.8+)

## Signals — Choosing the Right Primitive

| Primitive | Reactive | Ownership | Use for |
|-----------|----------|-----------|---------|
| `RwSignal<T>` | ✅ | Arena-allocated | Local component state, read-write in one value |
| `ReadSignal<T>` / `WriteSignal<T>` | ✅ | Arena-allocated | Split read/write access |
| `ArcRwSignal<T>` | ✅ | Ref-counted | Cross-owner / cross-component sharing |
| `StoredValue<T>` | ❌ | Arena-allocated | Non-reactive data in reactive closures (callbacks, config) |
| `Memo<T>` | ✅ (derived) | Arena-allocated | Derived values, computed once per dependency change |

Use `StoredValue` for non-Copy data that does **not** need to trigger re-renders.
Use `RwSignal` when the value must trigger reactivity.

## Resource + Suspense

Standard pattern for async data fetching. The source signal drives re-fetching automatically:

```rust
let items = Resource::new(
    move || search.get(),          // source: re-runs fetcher when this changes
    |s| {
        let search = if s.is_empty() { None } else { Some(s) };
        list_items(search)
    },
);

view! {
    <Suspense fallback=|| view! { <Skeleton /> }>
        {move || items.get().map(|result| match result {
            Ok(items) => view! { /* render */ }.into_any(),
            Err(e) => view! { <ErrorMessage error=e.to_string() /> }.into_any(),
        })}
    </Suspense>
}
```

Use `LocalResource` when the future does not need to be `Send` (client-side only, no SSR):

```rust
let items = LocalResource::new(move || fetch_local(search.get()));
```

## StoredValue for Non-Copy Data in Reactive Closures

Use when non-Copy data must be accessed inside `Fn` closures (`Show`, `For`, effects):

```rust
let data = StoredValue::new(expensive_data);

view! {
    <Show when=move || open.get()>
        {move || data.get_value()}
    </Show>
}
```

## Control Flow — `Either` vs `into_any()`

For binary branches, prefer `Either` to preserve type information:

```rust
// GOOD — typed, no erasure
view! {
    {if logged_in {
        Either::Left(view! { <Dashboard /> })
    } else {
        Either::Right(view! { <Login /> })
    }}
}

// Use into_any() when branches have more than 2 types or in match arms
view! {
    {move || match state.get() {
        State::Loading => view! { <Spinner /> }.into_any(),
        State::Error(e) => view! { <Error msg=e /> }.into_any(),
        State::Ready(data) => view! { <Content data=data /> }.into_any(),
    }}
}
```

## Action / ServerAction

Use `Action` for async mutations (form submissions, imperative async calls):

```rust
let create_user = ServerAction::<CreateUser>::new();

view! {
    // .pending() — true while awaiting
    <Show when=move || create_user.pending().get()>
        <Spinner />
    </Show>

    // .value() — most recent result (None before first run)
    {move || create_user.value().get().map(|res| match res {
        Ok(_) => view! { <SuccessMessage /> }.into_any(),
        Err(e) => view! { <ErrorMessage error=e.to_string() /> }.into_any(),
    })}

    <ActionForm action=create_user>
        <input type="text" name="username" />
        <button type="submit">"Create"</button>
    </ActionForm>
}
```

Key properties: `.pending()`, `.value()`, `.input()` (current arg while pending), `.version()` (completion count).

## Async Actions in Event Handlers

Clone outside the `move` closure, then again inside the async block:

```rust
on:click={
    let id = id.clone();           // clone OUTSIDE move closure
    move |_: leptos::ev::MouseEvent| {
        let id = id.clone();       // clone again for async block
        leptos::task::spawn_local(async move {
            match do_thing(id).await {
                Ok(_) => { /* handle success */ }
                Err(e) => { /* handle error */ }
            }
        });
    }
}
```

## Server Functions

```rust
#[server]
pub async fn list_items(search: Option<String>) -> Result<Vec<ItemView>, ServerFnError> {
    // Extract typed context (DI via Leptos context)
    let store = item_store()?;
    let result = store
        .filter(search)
        .await
        .map_err(|e| ServerFnError::new(e.to_string()))?;
    Ok(result)
}
```

- Server functions are SSR-only — do not reference WASM-incompatible types
- Extract dependencies via typed Leptos contexts, not global state
