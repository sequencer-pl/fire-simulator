import sqlite3

from app.simulation.constants import ENGINE_VERSION
from app.storage import db


def test_init_db_migrates_v1_simulations_table(tmp_path):
    path = tmp_path / "legacy.db"
    with sqlite3.connect(path) as conn:
        conn.executescript(
            """
            CREATE TABLE simulations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                input_json TEXT NOT NULL,
                result_json TEXT NOT NULL,
                summary_json TEXT NOT NULL
            );
            INSERT INTO simulations
                (user_id, name, created_at, updated_at, input_json, result_json, summary_json)
            VALUES (1, 'stara', '2026-01-01', '2026-01-01', '{}', '{}', '{}');
            PRAGMA user_version = 1;
            """
        )

    db.set_db_path(str(path))
    try:
        db.init_db()
        with db.connect() as conn:
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            columns = {
                row["name"]
                for row in conn.execute("PRAGMA table_info(simulations)").fetchall()
            }
            row = conn.execute(
                "SELECT model_version FROM simulations ORDER BY id LIMIT 1"
            ).fetchone()
        assert version == 2
        assert "model_version" in columns
        assert row["model_version"] == ENGINE_VERSION
    finally:
        db.set_db_path(db.DEFAULT_DB_PATH)
