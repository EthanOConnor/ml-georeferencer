# Contributing

We welcome issues and PRs. Please keep changes **deterministic** and **tested**.

- Follow the structure in `docs/`
- Add/modify schemas in `schemas/` with examples
- Keep any model binaries **out of git**; use `scripts/fetch-models.sh`

## Checks
```bash
just lint
just test   # once code exists
```
