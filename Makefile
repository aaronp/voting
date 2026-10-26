PORT ?= 8000

.PHONY: dev test vendor

test:
	bun test

# Serves the repo as GitHub Pages does: Tally.dc.html at /, everything else beside it (so ?src=examples/... works).
dev:
	@echo "Example: http://localhost:$(PORT)/?src=examples/harbor-commons/tally.json"
	@bun -e 'const s = Bun.serve({ port: $(PORT), async fetch(req) { const p = new URL(req.url).pathname; const f = Bun.file(p === "/" ? "Tally.dc.html" : "." + p); return p.includes("..") || !(await f.exists()) ? new Response("Not found", { status: 404 }) : new Response(f); } }); console.log("Serving on " + s.url.href + " (Ctrl-C to stop)")'

# Rebuilds the one crypto file the app loads (blake3 + ed25519, pinned in package.json). vendor/noble.js is committed.
vendor: node_modules/@noble/curves
	bun build vendor/noble.entry.js --outfile vendor/noble.js --format esm --minify
node_modules/@noble/curves: package.json
	bun install
