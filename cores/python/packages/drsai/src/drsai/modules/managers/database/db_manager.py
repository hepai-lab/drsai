import threading
from datetime import datetime
from pathlib import Path
from typing import Any, List, Optional, Union, Dict

from loguru import logger
from sqlalchemy import event, exc, inspect, text
from sqlmodel import Session, SQLModel, and_, create_engine, select

from autogen_core import (
    ComponentModel,
    ComponentBase,
    Component,
)
from pydantic import BaseModel

from ..datamodel import DatabaseModel, Response, AgentJson
from .schema_manager import SchemaManager

from drsai.configs import CONST

class DatabaseManagerConfig(BaseModel):
    engine_uri: str
    base_dir: Optional[Path] = None

class DatabaseManager(ComponentBase[BaseModel], Component[DatabaseManagerConfig]):
    """A database manager component for managing database operations."""

    component_type = "database_manager"
    component_config_schema = DatabaseManagerConfig
    component_provider_override = "drsai.DatabaseManager"

    _init_lock = threading.Lock()
    _delete_lock = threading.Lock()     # Serialize DELETE-heavy ops to prevent SQLite corruption

    def __init__(self, engine_uri: str, base_dir: Optional[Path] = None):
        """
        Initialize DatabaseManager with database connection settings.
        Does not perform any database operations.

        Args:
            engine_uri (str): Database connection URI (e.g. sqlite:///db.sqlite3)
            base_dir (Path, optional): Base directory for migration files. If None, uses current directory. Default: None.
        """
        # check_same_thread=False allows SQLite connections to be shared across
        # threads (asyncio thread, tkinter main thread, pystray thread).
        # SQLAlchemy's QueuePool handles connection reuse safely.
        connection_args = {"check_same_thread": False} if "sqlite" in engine_uri else {}

        # check if base_dir is valid
        if base_dir is None:
            base_dir = Path(CONST.FS_DIR)
        else:
            if isinstance(base_dir, str):
                base_dir = Path(base_dir)
        # check if base_dir is a valid directory
        if not base_dir.is_dir():
            base_dir.mkdir(parents=True, exist_ok=True)  # 自动创建所有父级目录
            print(f"Created database directory at: {base_dir.absolute()}")


        self.engine = create_engine(engine_uri, connect_args=connection_args)

        # Enable WAL mode and set busy_timeout for SQLite to prevent
        # "database disk image is malformed" under concurrent writes
        # from parallel sub-agents sharing the same DB file.
        if "sqlite" in engine_uri:
            @event.listens_for(self.engine, "connect")
            def _set_sqlite_pragma(dbapi_connection, connection_record):
                cursor = dbapi_connection.cursor()
                cursor.execute("PRAGMA journal_mode=WAL")
                cursor.execute("PRAGMA busy_timeout=5000")
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.close()

        self.schema_manager = SchemaManager(
            engine=self.engine,
            base_dir=base_dir,
        )

    def _should_auto_upgrade(self) -> bool:
        """
        Check if auto upgrade should run based on schema differences
        """
        needs_upgrade, _ = self.schema_manager.check_schema_status()
        return needs_upgrade

    def initialize_database(
        self, auto_upgrade: bool = False, force_init_alembic: bool = True
    ) -> Response:
        """
        Initialize database and migrations in the correct order.

        Args:
            auto_upgrade (bool, optional): If True, automatically generate and apply migrations for schema changes. Default: False.
            force_init_alembic (bool, optional): If True, reinitialize alembic configuration even if it exists. Default: True
        """
        if not self._init_lock.acquire(blocking=False):
            return Response(
                message="Database initialization already in progress", status=False
            )

        try:
            # Enable foreign key constraints for SQLite
            if "sqlite" in str(self.engine.url):
                with self.engine.connect() as conn:
                    conn.execute(text("PRAGMA foreign_keys=ON"))
            
            # Repair FTS5 tables BEFORE schema check so that broken vtables
            # don't cause compare_metadata to fail with "vtable constructor
            # failed" during check_schema_status() / ensure_schema_up_to_date().
            self._create_fts_tables()

            inspector = inspect(self.engine)
            tables_exist = inspector.get_table_names()
            if not tables_exist:
                logger.info("Creating database tables...")
                SQLModel.metadata.create_all(self.engine)

                if not self.schema_manager.initialize_migrations(force=force_init_alembic):
                    return Response(message="Failed to initialize migrations", status=False)

                result_message = "Database initialized successfully"

            elif auto_upgrade or self._should_auto_upgrade():
                logger.info("Checking database schema...")
                if not self.schema_manager.ensure_schema_up_to_date():
                    return Response(message="Database upgrade failed", status=False)
                result_message = "Database schema is up to date"

            else:
                result_message = "Database is ready"

            # Run _create_fts_tables() again after migration to ensure FTS
            # tables survive any Alembic migration that might have dropped
            # shadow tables.
            self._create_fts_tables()
            return Response(message=result_message, status=True)

        except Exception as e:
            error_msg = f"Database initialization failed: {str(e)}"
            logger.error(error_msg)
            return Response(message=error_msg, status=False)
        finally:
            self._init_lock.release()

    # ------------------------------------------------------------------
    # FTS5 full-text search tables (managed outside Alembic)
    # ------------------------------------------------------------------

    def _create_fts_tables(self) -> None:
        """Create FTS5 virtual tables and triggers for session message search.

        Uses the external-content pattern:
          - ``session_messages_fts`` / ``session_messages_fts_trigram``: content
            is read directly from ``sessionmessage.content`` via ``content_rowid=id``.
          - ``session_summaries_fts`` / ``session_summaries_fts_trigram``: summary
            and keywords are read from ``sessionsummary`` via ``content_rowid=id``.
          - Triggers keep all FTS indexes in sync on INSERT / UPDATE / DELETE
            with zero application-level overhead.
          - ``..._trigram`` variants use the trigram tokenizer for CJK and
            substring search.

        All statements use IF NOT EXISTS — safe to call on every startup.
        Old standalone summaries FTS tables (without ``content=``) are migrated
        automatically.
        """
        # ------------------------------------------------------------------
        # Migrate old standalone summaries FTS tables to external-content
        # ------------------------------------------------------------------
        with self.engine.connect() as conn:
            for table_name in ("session_summaries_fts", "session_summaries_fts_trigram"):
                row = conn.execute(
                    text("SELECT sql FROM sqlite_master WHERE type='table' AND name=:name"),
                    {"name": table_name},
                ).fetchone()
                if row and row[0] and "content=" not in (row[0] or ""):
                    logger.info(
                        f"Migrating {table_name} from standalone to external-content mode"
                    )
                    conn.execute(text(f"DROP TABLE IF EXISTS {table_name}"))
                    conn.commit()

        # ------------------------------------------------------------------
        # Detect and repair broken FTS5 virtual tables
        # ------------------------------------------------------------------
        # Alembic migrations (or manual schema changes) can drop FTS5 shadow
        # tables (*_data, *_idx, *_docsize, *_config) while leaving the
        # virtual table entry in sqlite_master.  When this happens, the vtable
        # constructor fails on first use ("vtable constructor failed") and
        # MATCH queries return errors / empty results.
        #
        # We detect this by checking whether the *_data shadow table exists.
        # If the vtable is registered but its shadow table is missing, we DROP
        # the vtable so that the CREATE VIRTUAL TABLE IF NOT EXISTS below
        # will recreate it from scratch (with all shadow tables).
        _fts_vtables = [
            "session_messages_fts",
            "session_messages_fts_trigram",
            "session_summaries_fts",
            "session_summaries_fts_trigram",
            "session_search_fts",
        ]
        _broken_vtables: list[str] = []
        with self.engine.connect() as conn:
            raw = conn.connection
            for vt_name in _fts_vtables:
                # Check if the virtual table is registered in sqlite_master
                row = raw.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                    (vt_name,),
                ).fetchone()
                if not row:
                    continue  # vtable doesn't exist yet — CREATE will make it

                # Check if the shadow table *_data exists
                shadow_exists = raw.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                    (f"{vt_name}_data",),
                ).fetchone()
                if shadow_exists:
                    continue  # shadow table present — vtable is healthy

                # vtable exists in sqlite_master but shadow table is missing → broken
                _broken_vtables.append(vt_name)

            # Repair all broken vtables in a single writable_schema session
            if _broken_vtables:
                _shadow_suffixes = ("_data", "_idx", "_docsize", "_config")
                _trigger_suffixes = ("_insert", "_delete", "_update")
                for vt_name in _broken_vtables:
                    logger.warning(
                        f"FTS5 table '{vt_name}' is broken (shadow table missing) "
                        f"— dropping and recreating"
                    )
                    # A normal DROP TABLE fails on a broken vtable because
                    # SQLite tries to invoke the vtable constructor (xConnect)
                    # to call xDestroy, which fails since shadow tables are
                    # missing.  Workaround: use writable_schema pragma to
                    # delete the sqlite_master entry directly, then clean up
                    # orphaned shadow tables using their exact names (NOT LIKE,
                    # which would match sibling vtables such as
                    # session_messages_fts_trigram).
                    raw.execute("PRAGMA writable_schema=1")
                    raw.execute(
                        "DELETE FROM sqlite_master WHERE name=? AND type='table'",
                        (vt_name,),
                    )
                    for suffix in _shadow_suffixes:
                        raw.execute(
                            "DELETE FROM sqlite_master WHERE name=? AND type='table'",
                            (f"{vt_name}{suffix}",),
                        )
                    raw.execute("PRAGMA writable_schema=0")
                    # Drop triggers normally (they don't need the vtable to exist)
                    for suffix in _trigger_suffixes:
                        raw.execute(f"DROP TRIGGER IF EXISTS {vt_name}{suffix}")
                # IMPORTANT: use raw.commit() (DBAPI-level commit), NOT
                # conn.commit() (SQLAlchemy-level).  The PRAGMA writable_schema
                # changes are executed on the raw DBAPI connection and are not
                # tracked by SQLAlchemy's transaction manager.  Using
                # conn.commit() would commit SQLAlchemy's (empty) transaction
                # but leave the PRAGMA changes uncommitted, and a new pooled
                # connection would still see the old (broken) vtable entry.
                raw.commit()
                # Invalidate this pooled connection so that executescript()
                # below gets a fresh sqlite3 connection.  SQLite caches the
                # schema per-connection; after deleting a vtable entry via
                # writable_schema, the cache still holds the old (broken)
                # vtable instance and CREATE VIRTUAL TABLE IF NOT EXISTS would
                # see the stale entry and silently skip or fail.
                conn.invalidate()

        fts_sql = """
        CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts USING fts5(
            content,
            content=sessionmessage,
            content_rowid=id
        );

        CREATE TRIGGER IF NOT EXISTS session_messages_fts_insert
            AFTER INSERT ON sessionmessage
        BEGIN
            INSERT INTO session_messages_fts(rowid, content)
            VALUES (new.id, new.content);
        END;

        CREATE TRIGGER IF NOT EXISTS session_messages_fts_delete
            AFTER DELETE ON sessionmessage
        BEGIN
            INSERT INTO session_messages_fts(session_messages_fts, rowid, content)
            VALUES('delete', old.id, old.content);
        END;

        CREATE TRIGGER IF NOT EXISTS session_messages_fts_update
            AFTER UPDATE ON sessionmessage
        BEGIN
            INSERT INTO session_messages_fts(session_messages_fts, rowid, content)
                VALUES('delete', old.id, old.content);
            INSERT INTO session_messages_fts(rowid, content)
                VALUES (new.id, new.content);
        END;

        CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts_trigram USING fts5(
            content,
            content=sessionmessage,
            content_rowid=id,
            tokenize='trigram'
        );

        CREATE TRIGGER IF NOT EXISTS session_messages_fts_trigram_insert
            AFTER INSERT ON sessionmessage
        BEGIN
            INSERT INTO session_messages_fts_trigram(rowid, content)
            VALUES (new.id, new.content);
        END;

        CREATE TRIGGER IF NOT EXISTS session_messages_fts_trigram_delete
            AFTER DELETE ON sessionmessage
        BEGIN
            INSERT INTO session_messages_fts_trigram(session_messages_fts_trigram, rowid, content)
            VALUES('delete', old.id, old.content);
        END;

        CREATE TRIGGER IF NOT EXISTS session_messages_fts_trigram_update
            AFTER UPDATE ON sessionmessage
        BEGIN
            INSERT INTO session_messages_fts_trigram(session_messages_fts_trigram, rowid, content)
                VALUES('delete', old.id, old.content);
            INSERT INTO session_messages_fts_trigram(rowid, content)
                VALUES (new.id, new.content);
        END;

        -- Summaries: external-content (content is read from sessionsummary).
        -- Triggers keep the index in sync — no manual INSERTs needed.
        CREATE VIRTUAL TABLE IF NOT EXISTS session_summaries_fts USING fts5(
            summary,
            keywords,
            content=sessionsummary,
            content_rowid=id,
            tokenize='porter unicode61'
        );

        CREATE TRIGGER IF NOT EXISTS session_summaries_fts_insert
            AFTER INSERT ON sessionsummary
        BEGIN
            INSERT INTO session_summaries_fts(rowid, summary, keywords)
            VALUES (new.id, new.summary, new.keywords);
        END;

        CREATE TRIGGER IF NOT EXISTS session_summaries_fts_delete
            AFTER DELETE ON sessionsummary
        BEGIN
            INSERT INTO session_summaries_fts(session_summaries_fts, rowid, summary, keywords)
            VALUES('delete', old.id, old.summary, old.keywords);
        END;

        CREATE TRIGGER IF NOT EXISTS session_summaries_fts_update
            AFTER UPDATE ON sessionsummary
        BEGIN
            INSERT INTO session_summaries_fts(session_summaries_fts, rowid, summary, keywords)
                VALUES('delete', old.id, old.summary, old.keywords);
            INSERT INTO session_summaries_fts(rowid, summary, keywords)
                VALUES (new.id, new.summary, new.keywords);
        END;

        CREATE VIRTUAL TABLE IF NOT EXISTS session_summaries_fts_trigram USING fts5(
            summary,
            keywords,
            content=sessionsummary,
            content_rowid=id,
            tokenize='trigram'
        );

        CREATE TRIGGER IF NOT EXISTS session_summaries_fts_trigram_insert
            AFTER INSERT ON sessionsummary
        BEGIN
            INSERT INTO session_summaries_fts_trigram(rowid, summary, keywords)
            VALUES (new.id, new.summary, new.keywords);
        END;

        CREATE TRIGGER IF NOT EXISTS session_summaries_fts_trigram_delete
            AFTER DELETE ON sessionsummary
        BEGIN
            INSERT INTO session_summaries_fts_trigram(session_summaries_fts_trigram, rowid, summary, keywords)
            VALUES('delete', old.id, old.summary, old.keywords);
        END;

        CREATE TRIGGER IF NOT EXISTS session_summaries_fts_trigram_update
            AFTER UPDATE ON sessionsummary
        BEGIN
            INSERT INTO session_summaries_fts_trigram(session_summaries_fts_trigram, rowid, summary, keywords)
                VALUES('delete', old.id, old.summary, old.keywords);
            INSERT INTO session_summaries_fts_trigram(rowid, summary, keywords)
                VALUES (new.id, new.summary, new.keywords);
        END;
        """

        try:
            with self.engine.connect() as conn:
                # 直接使用底层 sqlite3 连接的 executescript，
                # 它会正确处理 trigger body 中的分号，不会被截断。
                # executescript 内部已隐式提交，无需再 conn.commit()。
                raw_conn = conn.connection
                raw_conn.executescript(fts_sql)
            logger.info("FTS5 tables initialized")
        except Exception as e:
            logger.warning(f"Failed to initialize FTS5 tables: {e}")

        # ------------------------------------------------------------------
        # FTS index health check + rebuild if empty
        # ------------------------------------------------------------------
        # Even after the broken-vtable repair above, the index can still be
        # empty if the vtable was freshly recreated.  An external-content FTS5
        # table with no index returns zero MATCH results even though the backing
        # rows exist.  Detect this by checking the *_idx shadow table row count
        # and issue the FTS5 'rebuild' command when needed.
        _fts_tables_to_check = [
            ("session_messages_fts", "sessionmessage"),
            ("session_messages_fts_trigram", "sessionmessage"),
            ("session_summaries_fts", "sessionsummary"),
            ("session_summaries_fts_trigram", "sessionsummary"),
        ]
        try:
            with self.engine.connect() as conn:
                raw = conn.connection
                for fts_name, backing_table in _fts_tables_to_check:
                    try:
                        idx_count = raw.execute(
                            f"SELECT COUNT(*) FROM {fts_name}_idx"
                        ).fetchone()[0]
                    except Exception:
                        # Shadow table doesn't exist — vtable creation may have
                        # failed; skip this table.
                        continue
                    try:
                        backing_count = raw.execute(
                            f"SELECT COUNT(*) FROM {backing_table}"
                        ).fetchone()[0]
                    except Exception:
                        backing_count = 0

                    if backing_count > 0 and idx_count == 0:
                        logger.info(
                            f"{fts_name} index is empty ({idx_count} idx rows "
                            f"vs {backing_count} {backing_table}) — rebuilding FTS index"
                        )
                        raw.execute(
                            f"INSERT INTO {fts_name}({fts_name}) VALUES('rebuild')"
                        )
                        # Use raw.commit() (DBAPI-level) to ensure the rebuild
                        # is committed to disk — conn.commit() only commits
                        # SQLAlchemy's transaction, which may not track raw
                        # DBAPI statements.
                        raw.commit()
                        logger.info(f"{fts_name} index rebuilt successfully")
        except Exception as e:
            logger.warning(f"Failed to check/rebuild FTS index: {e}")

        # ------------------------------------------------------------------
        # Session management indexes (for TUI session smart search)
        # ------------------------------------------------------------------
        
        # Fix old buggy triggers that used FTS5 'delete' command incorrectly.
        # The old triggers used INSERT INTO...VALUES('delete',...) which causes
        # "SQL logic error" on non-external-content FTS5 tables. Replace them
        # with standard DELETE FROM statements.
        try:
            with self.engine.connect() as conn:
                raw_conn = conn.connection
                # Check if old buggy triggers exist
                cursor = raw_conn.execute(
                    "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='session_search_fts_update'"
                )
                row = cursor.fetchone()
                if row and row[0] and "VALUES('delete'" in row[0]:
                    logger.info("Dropping old buggy FTS triggers and recreating")
                    raw_conn.execute("DROP TRIGGER IF EXISTS session_search_fts_insert")
                    raw_conn.execute("DROP TRIGGER IF EXISTS session_search_fts_delete")
                    raw_conn.execute("DROP TRIGGER IF EXISTS session_search_fts_update")
                    raw_conn.commit()
        except Exception as e:
            logger.warning(f"Failed to check/drop old FTS triggers: {e}")
        
        session_indexes_sql = """
        -- Composite index: user_id + workdir (fast workdir lookup)
        CREATE INDEX IF NOT EXISTS idx_thread_user_workdir
        ON thread(user_id, json_extract(meta, '$.workdir'));

        -- Composite index: user_id + updated_at (recent sessions query)
        CREATE INDEX IF NOT EXISTS idx_thread_user_updated
        ON thread(user_id, updated_at DESC);

        -- Index: user_id + archived (filter out archived sessions)
        CREATE INDEX IF NOT EXISTS idx_thread_user_archived
        ON thread(user_id, json_extract(meta, '$.archived'));

        -- Session FTS5 search table (name + preview + workdir + tags)
        CREATE VIRTUAL TABLE IF NOT EXISTS session_search_fts USING fts5(
            thread_id UNINDEXED,
            user_id UNINDEXED,
            name,
            preview,
            workdir,
            tags,
            tokenize='trigram'
        );

        -- Triggers to keep session_search_fts in sync
        CREATE TRIGGER IF NOT EXISTS session_search_fts_insert
            AFTER INSERT ON thread
        BEGIN
            INSERT INTO session_search_fts(thread_id, user_id, name, preview, workdir, tags)
            VALUES (
                NEW.thread_id,
                NEW.user_id,
                COALESCE(json_extract(NEW.meta, '$.name'), ''),
                '',
                COALESCE(json_extract(NEW.meta, '$.workdir'), ''),
                COALESCE(json_extract(NEW.meta, '$.tags'), '[]')
            );
        END;

        CREATE TRIGGER IF NOT EXISTS session_search_fts_delete
            AFTER DELETE ON thread
        BEGIN
            DELETE FROM session_search_fts WHERE rowid = OLD.id;
        END;

        CREATE TRIGGER IF NOT EXISTS session_search_fts_update
            AFTER UPDATE ON thread
        BEGIN
            DELETE FROM session_search_fts WHERE rowid = OLD.id;
            INSERT INTO session_search_fts(thread_id, user_id, name, preview, workdir, tags)
            VALUES (
                NEW.thread_id,
                NEW.user_id,
                COALESCE(json_extract(NEW.meta, '$.name'), ''),
                '',
                COALESCE(json_extract(NEW.meta, '$.workdir'), ''),
                COALESCE(json_extract(NEW.meta, '$.tags'), '[]')
            );
        END;
        """
        # Use raw sqlite3 executescript — same pattern as fts_sql above.
        # executescript handles semicolons inside trigger bodies correctly
        # (unlike split(';') which truncates CREATE TRIGGER ... BEGIN ... END).
        # It also performs an implicit commit, so no conn.commit() is needed.
        try:
            with self.engine.connect() as conn:
                raw_conn = conn.connection
                raw_conn.executescript(session_indexes_sql)
            logger.info("Session search indexes initialized")
        except Exception as e:
            logger.warning(f"Failed to initialize session search indexes: {e}")

        # ------------------------------------------------------------------
        # Backfill: populate session_search_fts with existing Thread rows
        # ------------------------------------------------------------------
        # The INSERT trigger only fires on NEW inserts; the 95+ historical
        # Thread rows that existed BEFORE session_search_fts was created are
        # missing from the FTS index. We must backfill them once so that
        # /find and smart_search can discover old sessions.
        #
        # The backfill is idempotent — it INSERT OR REPLACEs by rowid (Thread.id),
        # so running it again on subsequent startups is safe.
        try:
            with self.engine.connect() as conn:
                # Check how many rows are missing
                count_fts = conn.execute(
                    text("SELECT COUNT(*) FROM session_search_fts")
                ).scalar() or 0
                count_thread = conn.execute(
                    text("SELECT COUNT(*) FROM thread")
                ).scalar() or 0

                if count_fts < count_thread:
                    logger.info(
                        f"Backfilling session_search_fts: {count_fts}/{count_thread} rows indexed"
                    )
                    conn.execute(text("""
                        INSERT OR REPLACE INTO session_search_fts(rowid, thread_id, user_id, name, preview, workdir, tags)
                        SELECT
                            t.id,
                            t.thread_id,
                            t.user_id,
                            COALESCE(json_extract(t.meta, '$.name'), ''),
                            '',
                            COALESCE(json_extract(t.meta, '$.workdir'), ''),
                            COALESCE(json_extract(t.meta, '$.tags'), '[]')
                        FROM thread t
                    """))
                    conn.commit()
                    new_count = conn.execute(
                        text("SELECT COUNT(*) FROM session_search_fts")
                    ).scalar() or 0
                    logger.info(f"Backfill complete: {new_count}/{count_thread} rows indexed")
                else:
                    logger.info("session_search_fts already fully indexed, no backfill needed")
        except Exception as e:
            logger.warning(f"Failed to backfill session_search_fts: {e}")

        # ------------------------------------------------------------------
        # Data migration: Set updated_at for old rows with NULL updated_at
        # ------------------------------------------------------------------
        # Legacy Thread rows created before updated_at tracking may have NULL
        # values, which breaks ORDER BY updated_at DESC. Backfill them with:
        # 1. created_at if available
        # 2. CURRENT_TIMESTAMP as fallback for very old rows without timestamps
        try:
            with self.engine.connect() as conn:
                # First, try to use created_at
                result1 = conn.execute(text("""
                    UPDATE thread 
                    SET updated_at = created_at 
                    WHERE updated_at IS NULL AND created_at IS NOT NULL
                """))
                # Then, use current time for rows with both NULL
                result2 = conn.execute(text("""
                    UPDATE thread 
                    SET updated_at = CURRENT_TIMESTAMP,
                        created_at = CURRENT_TIMESTAMP
                    WHERE updated_at IS NULL
                """))
                conn.commit()
                total = result1.rowcount + result2.rowcount
                if total > 0:
                    logger.info(f"Migrated {total} Thread rows to set updated_at/created_at")
        except Exception as e:
            logger.warning(f"Failed to migrate Thread.updated_at: {e}")

    # ------------------------------------------------------------------

    def reset_db(self, recreate_tables: bool = True) -> Response:
        """
        Reset the database by dropping all tables and optionally recreating them.

        Args:
            recreate_tables (bool, optional): If True, recreates the tables after dropping them. Set to False if you want to call create_db_and_tables() separately. Default: True.
        """
        if not self._init_lock.acquire(blocking=False):
            logger.warning("Database reset already in progress")
            return Response(
                message="Database reset already in progress", status=False, data=None
            )

        try:
            # Dispose existing connections
            self.engine.dispose()
            with Session(self.engine) as session:
                try:
                    # Disable foreign key checks for SQLite
                    if "sqlite" in str(self.engine.url):
                        session.connection().execute(text("PRAGMA foreign_keys=OFF"))

                    # Drop all tables
                    SQLModel.metadata.drop_all(self.engine)
                    logger.info("All tables dropped successfully")

                    # Re-enable foreign key checks for SQLite
                    if "sqlite" in str(self.engine.url):
                        session.connection().execute(text("PRAGMA foreign_keys=ON"))

                    session.commit()

                except Exception as e:
                    session.rollback()
                    raise e
                finally:
                    session.close()
                    self._init_lock.release()

            if recreate_tables:
                logger.info("Recreating tables...")
                self.initialize_database(auto_upgrade=False, force_init_alembic=True)

            return Response(
                message="Database reset successfully"
                if recreate_tables
                else "Database tables dropped successfully",
                status=True,
                data=None,
            )

        except Exception as e:
            error_msg = f"Error while resetting database: {str(e)}"
            logger.error(error_msg)
            return Response(message=error_msg, status=False, data=None)
        finally:
            if self._init_lock.locked():
                self._init_lock.release()
                logger.info("Database reset lock released")

    def upsert(self, model: DatabaseModel, return_json: bool = True) -> Response:
        """Create or update an entity

        Args:
            model (DatabaseModel): The model instance to create or update
            return_json (bool, optional): If True, returns the model as a dictionary. If False, returns the SQLModel instance. Default: True.

        Returns:
            Response: Contains status, message and data (either dict or SQLModel based on return_json)
        """
        status = True
        model_class = type(model)
        existing_model = None

        with Session(self.engine) as session:
            try:
                existing_model = session.exec(
                    select(model_class).where(model_class.id == model.id)
                ).first()
                if existing_model:
                    # Update all fields except timestamps (which are auto-managed)
                    for key, value in model.model_dump().items():
                        if key not in ('created_at', 'id'):  # Preserve id and creation time
                            setattr(existing_model, key, value)
                    # Always update the timestamp on any modification
                    existing_model.updated_at = datetime.now()
                    model = existing_model  # Use the updated existing model
                    session.add(model)
                else:
                    session.add(model)
                session.commit()
                session.refresh(model)
            except Exception as e:
                session.rollback()
                logger.error(
                    "Error while updating/creating "
                    + str(model_class.__name__)
                    + ": "
                    + str(e)
                )
                status = False

        return Response(
            message=(
                f"{model_class.__name__} Updated Successfully"
                if existing_model
                else f"{model_class.__name__} Created Successfully"
            ),
            status=status,
            data=model.model_dump() if return_json else model,
        )

    def get(
        self,
        model_class: type[DatabaseModel],
        filters: dict[str, Any] | None = None,
        return_json: bool = False,
        order: str = "desc",
        order_by: str = "created_at",
    ) -> Response:
        """List entities
        
        Args:
            model_class: The model class to query
            filters: Dictionary of field=value filters
            return_json: If True, returns dicts; if False, returns SQLModel instances
            order: Sort direction - "asc" or "desc"
            order_by: Field name to sort by (default: "created_at")
        """
        with Session(self.engine) as session:
            result = []
            status = True
            status_message = ""

            try:
                statement = select(model_class)
                if filters:
                    conditions = [
                        getattr(model_class, col) == value
                        for col, value in filters.items()
                    ]
                    statement = statement.where(and_(*conditions))

                if hasattr(model_class, order_by) and order:
                    order_by_clause = getattr(
                        getattr(model_class, order_by), order
                    )()  # Dynamically apply asc/desc
                    statement = statement.order_by(order_by_clause)

                items = session.exec(statement).all()
                result = [
                    item.model_dump(mode="json") if return_json else item
                    for item in items
                ]
                status_message = f"{model_class.__name__} Retrieved Successfully"
            except Exception as e:
                session.rollback()
                status = False
                status_message = f"Error while fetching {model_class.__name__}"
                logger.error(
                    "Error while getting items: "
                    + str(model_class.__name__)
                    + " "
                    + str(e)
                )

            return Response(message=status_message, status=status, data=result)

    def delete(
        self, model_class: type[SQLModel], filters: dict[str, Any] | None = None
    ) -> Response:
        """Delete an entity

        Serialised via ``_delete_lock`` so that concurrent sub-agent
        cleanups do not contend on the same SQLite file.
        """
        status_message = ""
        status = True

        with self._delete_lock:
            with Session(self.engine) as session:
                try:
                    if "sqlite" in str(self.engine.url):
                        session.connection().execute(text("PRAGMA foreign_keys=ON"))
                    statement = select(model_class)
                    if filters:
                        conditions = [
                            getattr(model_class, col) == value
                            for col, value in filters.items()
                        ]
                        statement = statement.where(and_(*conditions))

                    rows = session.exec(statement).all()

                    if rows:
                        for row in rows:
                            session.delete(row)
                        session.commit()
                        status_message = f"{model_class.__name__} Deleted Successfully"
                    else:
                        status_message = "Row not found"
                        logger.info(f"Row with filters {filters} not found")

                except exc.IntegrityError as e:
                    session.rollback()
                    status = False
                    status_message = f"Integrity error: The {model_class.__name__} is linked to another entity and cannot be deleted. {e}"
                    # Log the specific integrity error
                    logger.error(status_message)
                except Exception as e:
                    session.rollback()
                    status = False
                    status_message = f"Error while deleting: {e}"
                    logger.error(status_message)

        return Response(message=status_message, status=status, data=None)
    
    # TODO: 重启后端的智能体和多智能体系统应用

    # async def import_team(
    #     self,
    #     team_config: Union[str, Path, Dict[str, Any]],
    #     user_id: str,
    #     check_exists: bool = False,
    # ) -> Response:
    #     try:
    #         # Load config if path provided
    #         if isinstance(team_config, (str, Path)):
    #             config = await TeamManager.load_from_file(team_config)
    #         else:
    #             config = team_config

    #         # Check existence if requested
    #         if check_exists:
    #             existing = await self._check_team_exists(config, user_id)
    #             if existing:
    #                 return Response(
    #                     message="Identical team configuration already exists",
    #                     status=True,
    #                     data={"id": existing.id},
    #                 )

    #         # Store in database
    #         team_db = Team(user_id=user_id, component=config, created_at=datetime.now())

    #         result = self.upsert(team_db)
    #         return result

    #     except Exception as e:
    #         logger.error(f"Failed to import team: {str(e)}")
    #         return Response(message=str(e), status=False)

    # async def import_teams_from_directory(
    #     self, directory: Union[str, Path], user_id: str, check_exists: bool = False
    # ) -> Response:
    #     """
    #     Import all team configurations from a directory.

    #     Args:
    #         directory (str | Path): Path to directory containing team configs
    #         user_id (str): User ID to associate with imported teams
    #         check_exists (bool, optional): Whether to check for existing teams. Default: False.

    #     Returns:
    #         Response: Contains import results for all files
    #     """
    #     try:
    #         # Load all configs from directory
    #         configs = await TeamManager.load_from_directory(directory)

    #         results: List[Dict[str, Any]] = []
    #         for config in configs:
    #             try:
    #                 result = await self.import_team(
    #                     team_config=config, user_id=user_id, check_exists=check_exists
    #                 )

    #                 if not result.data:
    #                     raise ValueError("No data returned from import")

    #                 # Add result info
    #                 results.append(
    #                     {
    #                         "status": result.status,
    #                         "message": result.message,
    #                         "id": result.data.get("id") if result.status else None,
    #                     }
    #                 )

    #             except Exception as e:
    #                 logger.error(f"Failed to import team config: {str(e)}")
    #                 results.append({"status": False, "message": str(e), "id": None})

    #         return Response(
    #             message="Directory import complete", status=True, data=results
    #         )

    #     except Exception as e:
    #         logger.error(f"Failed to import directory: {str(e)}")
    #         return Response(message=str(e), status=False)

    # async def _check_team_exists(
    #     self, config: Dict[str, Any], user_id: str
    # ) -> Optional[Team]:
    #     """Check if identical team config already exists"""
    #     teams = self.get(Team, {"user_id": user_id}).data

    #     if not teams:
    #         return None

    #     for team in teams:
    #         if team.component == config:
    #             return team

    #     return None

    async def close(self) -> None:
        """Close database connections and cleanup resources"""
        logger.info("Closing database connections...")
        try:
            # Dispose of the SQLAlchemy engine
            self.engine.dispose()
            logger.info("Database connections closed successfully")
        except Exception as e:
            logger.error(f"Error closing database connections: {str(e)}")
            raise
    
    @classmethod
    def _from_config(
        cls, 
        config: DatabaseManagerConfig, 
        **kwargs
        ) -> "DatabaseManager":
        """Create a new instance of the component from a config"""
        return cls(engine_uri=config.engine_uri, base_dir=config.base_dir)
    
    def _to_config(self) -> DatabaseManagerConfig:
        """Convert the component to a config"""
        return DatabaseManagerConfig(
            engine_uri=str(self.engine.url),
            base_dir=str(self.schema_manager.base_dir)
        )
