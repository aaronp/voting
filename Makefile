PORT ?= 8000

.PHONY: dev test

test:
	bun test

# Serves the repo as GitHub Pages does: Tally.dc.html at /, everything else beside it (so ?src=examples/... works).
dev:
	@echo "Example: http://localhost:$(PORT)/?src=examples/harbor-commons/tally.json"
	@bun -e 'const s = Bun.serve({ port: $(PORT), async fetch(req) { const p = new URL(req.url).pathname; const f = Bun.file(p === "/" ? "Tally.dc.html" : "." + p); return p.includes("..") || !(await f.exists()) ? new Response("Not found", { status: 404 }) : new Response(f); } }); console.log("Serving on " + s.url.href + " (Ctrl-C to stop)")'
