# Mode: batch — Bulk Offer Processing

Two usage modes: **conductor** (navigates portals in real time) or **standalone** (script for already collected URLs).

## Architecture

```
Claude Conductor (claude --allow-all)
  │
  │  Chrome: navigates portals (logged-in sessions)
  │  Reads DOM directly — the user sees everything in real time
  │
  ├─ Offer 1: reads JD from DOM + URL
  │    └─► copilot -p worker → report .md + PDF + tracker-line
  │
  ├─ Offer 2: click next, reads JD + URL
  │    └─► copilot -p worker → report .md + PDF + tracker-line
  │
  └─ End: merge tracker-additions → applications.md + summary
```

Each worker is a `copilot -p` child with a clean 200K token context. The conductor only orchestrates.

## Files

```
batch/
  batch-input.tsv               # URLs (by conductor or manual)
  batch-state.tsv               # Progress (auto-generated, gitignored)
  batch-runner.sh               # Standalone orchestrator script
  batch-prompt.md               # Prompt template for workers
  logs/                         # One log per offer (gitignored)
  tracker-additions/            # Tracker lines (gitignored)
```

## Mode A: Conductor

1. **Read state**: `batch/batch-state.tsv` → know what was already processed
2. **Navigate portal**: Chrome → search URL
3. **Extract URLs**: Read results DOM → extract URL list → append to `batch-input.tsv`
4. **For each pending URL**:
   a. Chrome: click on the offer → read JD text from DOM
   b. Save JD to `/tmp/batch-jd-{id}.txt`
   c. Calculate next sequential REPORT_NUM
   d. Execute via Bash:
      ```bash
      copilot -p --allow-all \
        --append-system-prompt-file batch/batch-prompt.md \
        "Process this offer. URL: {url}. JD: /tmp/batch-jd-{id}.txt. Report: {num}. ID: {id}"
      ```
   e. Update `batch-state.tsv` (completed/failed + score + report_num)
   f. Log to `logs/{report_num}-{id}.log`
   g. Chrome: go back → next offer
5. **Pagination**: If no more offers → click "Next" → repeat
6. **End**: Merge `tracker-additions/` → `applications.md` + summary

## Mode B: Standalone script

```bash
batch/batch-runner.sh [OPTIONS]
```

Options:
- `--dry-run` — list pending without executing
- `--retry-failed` — only retry failed ones
- `--start-from N` — start from ID N
- `--parallel N` — N workers in parallel
- `--max-retries N` — attempts per offer (default: 2)

## batch-state.tsv format

```
idurlstatusstarted_atcompleted_atreport_numscoreerrorretries
1https://...completed2026-...2026-...0024.2-0
2https://...failed2026-...2026-...--Error msg1
3https://...pending-----0
```

## Resumability

- If it dies → re-run → reads `batch-state.tsv` → skips completed
- Lock file (`batch-runner.pid`) prevents double execution
- Each worker is independent: failure in offer #47 doesn't affect the rest

## Workers (copilot -p)

Each worker receives `batch-prompt.md` as system prompt. It is self-contained.

The worker produces:
1. Report `.md` in `reports/`
2. PDF in `output/`
3. Tracker line in `batch/tracker-additions/{id}.tsv`
4. JSON result via stdout

## Error handling

| Error | Recovery |
|-------|----------|
| Inaccessible URL | Worker fails → conductor marks `failed`, next |
| JD behind login | Conductor tries to read DOM. If it fails → `failed` |
| Portal changes layout | Conductor reasons about HTML, adapts |
| Worker crashes | Conductor marks `failed`, next. Retry with `--retry-failed` |
| Conductor dies | Re-run → reads state → skips completed |
| PDF fails | Report .md is saved. PDF remains pending |
