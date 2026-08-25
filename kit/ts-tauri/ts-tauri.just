# TypeScript Tauri (React webview) gates — a just LIBRARY:
#
#     import '.dev/kit/ts-tauri/ts-tauri.just'
#
# Same React overlay as ts-web (hooks + jsx-a11y + DOM). Zustand / invoke
# stay prose. The Rust side is `just rust-check`, not this recipe.
# Copy eslint.react.js → eslint.config.js and tsconfig.webview.json →
# tsconfig.json. Map: README.md.

ts_tauri_dir := "."   # overridden from the root justfile (managed block)

ts-tauri-lint:
    cd {{ts_tauri_dir}} && npm exec --no-install -- eslint .
ts-tauri-check: ts-tauri-lint
    cd {{ts_tauri_dir}} && npm exec --no-install -- tsc --noEmit
    cd {{ts_tauri_dir}} && npm exec --no-install -- vitest run

ts-tauri-mutate:
    cd {{ts_tauri_dir}} && npm exec --no-install -- stryker run --incremental
