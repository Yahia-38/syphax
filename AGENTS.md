<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Syphax code style

- Use arrow functions whenever possible in JavaScript.
- Use single quotes in JavaScript and JSX whenever possible.

## Syphax list and table design

- Never make a table or list scrollable. Use pagination instead.
- Every table and list must provide relevant search and filtering controls.

## Testing policy

- Run only tests targeted at the code being changed.
- Never run the full test suite unless the user explicitly asks for it.
