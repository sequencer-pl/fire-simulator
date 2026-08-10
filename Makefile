PYTHON := uv run
APP := app.main:app

.PHONY: setup dev prod test lint format clean

## Instaluje zależności (tworzy .venv)
setup:
	uv sync

## Uruchamia serwer deweloperski (auto-reload)
dev:
	$(PYTHON) uvicorn $(APP) --reload

## Uruchamia serwer produkcyjny
prod:
	$(PYTHON) uvicorn $(APP) --host 0.0.0.0 --port 8000

## Uruchamia testy jednostkowe
test:
	$(PYTHON) pytest

## Uruchamia linter (ruff check)
lint:
	$(PYTHON) ruff check .

## Formatuje kod (ruff format)
format:
	$(PYTHON) ruff format .
	$(PYTHON) ruff check --fix .

## Czyści artefakty builda i cache
clean:
	rm -rf .pytest_cache .ruff_cache
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
