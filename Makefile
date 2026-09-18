PYTHON := uv run
APP := app.main:app
QA := qa/visual

.PHONY: setup dev prod prod-port test lint format shots visual-baseline visual clean

## Instaluje zależności (tworzy .venv)
setup:
	uv sync

## Uruchamia serwer deweloperski (auto-reload)
dev:
	$(PYTHON) uvicorn $(APP) --reload

## Uruchamia serwer produkcyjny (gunicorn + 1 worker uvicorn; SQLite jest single-writer)
prod:
	$(PYTHON) gunicorn $(APP) -k uvicorn.workers.UvicornWorker -w 1 --bind 0.0.0.0:8000

## Uruchamia serwer produkcyjny na porcie z env PORT (np. Render)
prod-port:
	$(PYTHON) gunicorn $(APP) -k uvicorn.workers.UvicornWorker -w 1 --bind 0.0.0.0:$$PORT

## Uruchamia testy jednostkowe
test:
	$(PYTHON) pytest

## Instaluje zależności harnessa wizualnego (Playwright, pierwszy raz)
visual-setup:
	npm --prefix $(QA) install
	cd $(QA) && npx playwright install chromium

## Porównanie zrzutów ekranu z baseline'ami (14 widoków, desktop + mobile)
visual:
	npm --prefix $(QA) run check

## Odświeża baseline'y po świadomej zmianie wizualnej
visual-baseline:
	npm --prefix $(QA) run shots

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
