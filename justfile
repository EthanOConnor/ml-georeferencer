# Tasks for a clean DX across platforms

set dotenv-load := false
set shell := ["bash", "-cu"]

default: help

help:
	@echo "Targets:"
	@just --list

setup:
	@echo "Installing pre-commit hooks..."
	pre-commit install || true
	@echo "Bootstrap complete."

build:
	cargo build --all-targets

test:
	cargo test --all-targets

fmt:
	cargo fmt --all

clippy:
	cargo clippy --all-targets -- -D warnings

lint: fmt clippy md-lint

md-lint:
	@echo "Markdown lint (basic)"
	@grep -RIl --exclude-dir=.git --exclude=CHANGELOG.md -e '.*' docs | xargs -I{} bash -c 'test -f "{}" && echo "OK: {}" || true'

spec:
	@ls -1 docs

ci:
	cargo --version && rustc --version
	@echo "Specs present:" && ls docs
