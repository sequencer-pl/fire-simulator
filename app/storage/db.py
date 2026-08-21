import os
import sqlite3

DEFAULT_DB_PATH = os.environ.get(
    "FIRE_DB",
    os.path.join(os.path.dirname(__file__), "..", "..", "fire.db"),
)

_db_path = DEFAULT_DB_PATH

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS simulations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    input_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    summary_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_simulations_user ON simulations(user_id);

CREATE TABLE IF NOT EXISTS configs (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    config_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_presets_user ON presets(user_id);
"""


def set_db_path(path: str) -> None:
    """Override the database path (for testing)."""
    global _db_path
    _db_path = path


def get_db_path() -> str:
    return _db_path


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(_SCHEMA)


def create_user(email: str, password_hash: str, created_at: str) -> int:
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)",
            (email, password_hash, created_at),
        )
        return cur.lastrowid


def get_user_by_email(email: str) -> sqlite3.Row | None:
    with connect() as conn:
        return conn.execute(
            "SELECT id, email, password_hash, created_at FROM users WHERE email = ?",
            (email,),
        ).fetchone()


def get_user_by_id(user_id: int) -> sqlite3.Row | None:
    with connect() as conn:
        return conn.execute(
            "SELECT id, email, password_hash, created_at FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()


def insert_simulation(
    user_id: int,
    name: str,
    created_at: str,
    input_json: str,
    result_json: str,
    summary_json: str,
) -> int:
    with connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO simulations
                (user_id, name, created_at, updated_at, input_json, result_json, summary_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (user_id, name, created_at, created_at, input_json, result_json, summary_json),
        )
        return cur.lastrowid


def update_simulation_name(sim_id: int, user_id: int, name: str, updated_at: str) -> bool:
    with connect() as conn:
        cur = conn.execute(
            "UPDATE simulations SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            (name, updated_at, sim_id, user_id),
        )
        return cur.rowcount > 0


def get_simulation(sim_id: int, user_id: int | None = None) -> sqlite3.Row | None:
    with connect() as conn:
        if user_id is None:
            return conn.execute(
                "SELECT * FROM simulations WHERE id = ?",
                (sim_id,),
            ).fetchone()
        return conn.execute(
            "SELECT * FROM simulations WHERE id = ? AND user_id = ?",
            (sim_id, user_id),
        ).fetchone()


def list_simulations(user_id: int) -> list[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            """
            SELECT id, name, created_at, updated_at, summary_json
            FROM simulations
            WHERE user_id = ?
            ORDER BY updated_at DESC
            """,
            (user_id,),
        ).fetchall()


def delete_simulation(sim_id: int, user_id: int) -> bool:
    with connect() as conn:
        cur = conn.execute(
            "DELETE FROM simulations WHERE id = ? AND user_id = ?",
            (sim_id, user_id),
        )
        return cur.rowcount > 0


def duplicate_simulation(
    sim_id: int,
    user_id: int,
    new_name: str,
    created_at: str,
) -> int | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT input_json, result_json, summary_json "
            "FROM simulations WHERE id = ? AND user_id = ?",
            (sim_id, user_id),
        ).fetchone()
        if not row:
            return None
        cur = conn.execute(
            """
            INSERT INTO simulations
                (user_id, name, created_at, updated_at, input_json, result_json, summary_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                new_name,
                created_at,
                created_at,
                row["input_json"],
                row["result_json"],
                row["summary_json"],
            ),
        )
        return cur.lastrowid


def get_user_config(user_id: int) -> str | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT config_json FROM configs WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        return row["config_json"] if row else None


def save_user_config(user_id: int, config_json: str, updated_at: str) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO configs (user_id, config_json, updated_at) VALUES (?, ?, ?)",
            (user_id, config_json, updated_at),
        )


def delete_user_config(user_id: int) -> bool:
    with connect() as conn:
        cur = conn.execute(
            "DELETE FROM configs WHERE user_id = ?",
            (user_id,),
        )
        return cur.rowcount > 0


def list_user_presets(user_id: int) -> list[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT id, name, config_json, created_at FROM presets WHERE user_id = ? ORDER BY name",
            (user_id,),
        ).fetchall()


def get_preset(preset_id: int, user_id: int) -> sqlite3.Row | None:
    with connect() as conn:
        return conn.execute(
            "SELECT id, name, config_json FROM presets WHERE id = ? AND user_id = ?",
            (preset_id, user_id),
        ).fetchone()


def save_preset(user_id: int, name: str, config_json: str, created_at: str) -> int:
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO presets (user_id, name, config_json, created_at) VALUES (?, ?, ?, ?)",
            (user_id, name, config_json, created_at),
        )
        return cur.lastrowid


def delete_preset(preset_id: int, user_id: int) -> bool:
    with connect() as conn:
        cur = conn.execute(
            "DELETE FROM presets WHERE id = ? AND user_id = ?",
            (preset_id, user_id),
        )
        return cur.rowcount > 0
