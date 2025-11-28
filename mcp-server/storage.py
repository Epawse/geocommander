"""Simple SQLite-based logging for chat and tool calls.

This module provides a minimal persistence layer for conversation
history and tool usage without introducing extra dependencies.
"""

from __future__ import annotations

import os
import json
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


DB_PATH = os.getenv(
    "CHAT_DB_PATH",
    os.path.join(os.path.dirname(__file__), "chat_logs.db")
)


def _get_conn() -> sqlite3.Connection:
    """Create a new database connection."""
    return sqlite3.connect(DB_PATH)


def init_db() -> None:
    """Initialize database and create tables if they do not exist."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        # Base table definition (includes mode column)
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                direction TEXT,
                role TEXT,
                message TEXT,
                tool_action TEXT,
                tool_arguments TEXT,
                thinking TEXT,
                llm_provider TEXT,
                llm_model TEXT,
                created_at TEXT,
                mode TEXT
            )
            """
        )

        # For existing databases created before `mode` was introduced,
        # add the column if it is missing.
        try:
            cur.execute("PRAGMA table_info(chat_logs)")
            cols = [row[1] for row in cur.fetchall()]
            if "mode" not in cols:
                cur.execute("ALTER TABLE chat_logs ADD COLUMN mode TEXT")
        except Exception:
            # Schema migration failures are non-fatal for the application.
            pass

        conn.commit()
    finally:
        conn.close()


def log_chat_message(
    *,
    session_id: Optional[str],
    direction: str,
    role: str,
    message: str,
    tool_action: Optional[str] = None,
    tool_arguments: Optional[Dict[str, Any]] = None,
    thinking: Optional[str] = None,
    llm_provider: Optional[str] = None,
    llm_model: Optional[str] = None,
    mode: Optional[str] = None,
) -> None:
    """Persist a single chat message and optional tool call info.

    Errors are intentionally swallowed to avoid impacting the main flow.
    """
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO chat_logs (
                session_id,
                direction,
                role,
                message,
                tool_action,
                tool_arguments,
                thinking,
                llm_provider,
                llm_model,
                created_at,
                mode
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                direction,
                role,
                message,
                tool_action,
                json.dumps(tool_arguments, ensure_ascii=False)
                if tool_arguments
                else None,
                thinking,
                llm_provider,
                llm_model,
                # 使用带时区的 UTC 时间，前端会自动转换为本地时间
                datetime.now(timezone.utc).isoformat(),
                mode,
            ),
        )
        conn.commit()
    except Exception:
        # Logging failures should not break the main application.
        pass
    finally:
        conn.close()


def get_recent_logs(limit: int = 50) -> List[Dict[str, Any]]:
    """Return recent chat and tool call logs ordered from newest to oldest."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                id,
                session_id,
                direction,
                role,
                message,
                tool_action,
                tool_arguments,
                thinking,
                llm_provider,
                llm_model,
                created_at,
                mode
            FROM chat_logs
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        )
        rows = cur.fetchall()
        result: List[Dict[str, Any]] = []
        for (
            row_id,
            session_id,
            direction,
            role,
            message,
            tool_action,
            tool_arguments,
            thinking,
            llm_provider,
            llm_model,
            created_at,
            mode,
        ) in rows:
            try:
                args = json.loads(tool_arguments) if tool_arguments else None
            except Exception:
                args = None
            result.append(
                {
                    "id": row_id,
                    "session_id": session_id,
                    "direction": direction,
                    "role": role,
                    "message": message,
                    "tool_action": tool_action,
                    "tool_arguments": args,
                    "thinking": thinking,
                    "llm_provider": llm_provider,
                    "llm_model": llm_model,
                    "created_at": created_at,
                    "mode": mode,
                }
            )
        return result
    except Exception:
        return []
    finally:
        conn.close()


def get_recent_sessions(limit: int = 20) -> List[Dict[str, Any]]:
    """Return recent chat sessions aggregated by session_id."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        # Aggregate by session_id to get basic session stats
        # 获取最近会话的时间范围和消息数量
        cur.execute(
            """
            SELECT
                session_id,
                MIN(created_at) AS start_time,
                MAX(created_at) AS end_time,
                COUNT(*) AS message_count
            FROM chat_logs
            WHERE session_id IS NOT NULL
            GROUP BY session_id
            ORDER BY end_time DESC
            LIMIT ?
            """,
            (limit,),
        )
        rows = cur.fetchall()

        sessions: List[Dict[str, Any]] = []
        for session_id, start_time, end_time, message_count in rows:
            # 统计该会话中不同模式消息的数量
            cmd_count = 0
            conv_count = 0
            try:
                cur.execute(
                    """
                    SELECT
                        SUM(CASE WHEN mode = 'command' THEN 1 ELSE 0 END),
                        SUM(CASE WHEN mode = 'conversation' THEN 1 ELSE 0 END)
                    FROM chat_logs
                    WHERE session_id = ?
                    """,
                    (session_id,),
                )
                row_mode = cur.fetchone()
                if row_mode:
                    cmd_count, conv_count = row_mode
                    cmd_count = cmd_count or 0
                    conv_count = conv_count or 0
            except Exception:
                cmd_count = 0
                conv_count = 0

            # 根据统计结果决定会话模式（只返回 command 或 conversation）
            if cmd_count > 0 and conv_count == 0:
                mode: Optional[str] = "command"
            elif conv_count > 0 and cmd_count == 0:
                mode = "conversation"
            elif cmd_count == 0 and conv_count == 0:
                # 没有标记 mode 的老数据：默认归为对话模式
                mode = "conversation"
            else:
                # 同时包含两种模式：选择数量更多的一种，避免“混合模式”
                mode = "command" if cmd_count >= conv_count else "conversation"

            # 生成一个时间型标题（前端目前使用自己的格式，这里仅作后备字段）
            try:
                dt = datetime.fromisoformat(start_time) if start_time else None
                if dt:
                    title = dt.strftime("会话 %Y-%m-%d %H:%M")
                else:
                    title = "未命名会话"
            except Exception:
                title = "未命名会话"

            sessions.append(
                {
                    "session_id": session_id,
                    "title": title,
                    "start_time": start_time,
                    "end_time": end_time,
                    "message_count": message_count,
                    "mode": mode,
                }
            )

        return sessions
    except Exception:
        return []
    finally:
        conn.close()


def get_session_messages(session_id: str) -> List[Dict[str, Any]]:
    """Return all messages for a given session ordered by time."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                id,
                session_id,
                direction,
                role,
                message,
                tool_action,
                tool_arguments,
                thinking,
                llm_provider,
                llm_model,
                created_at,
                mode
            FROM chat_logs
            WHERE session_id = ?
            ORDER BY id ASC
            """,
            (session_id,),
        )
        rows = cur.fetchall()
        messages: List[Dict[str, Any]] = []
        for (
            row_id,
            sess_id,
            direction,
            role,
            message,
            tool_action,
            tool_arguments,
            thinking,
            llm_provider,
            llm_model,
            created_at,
            mode,
        ) in rows:
            try:
                args = json.loads(tool_arguments) if tool_arguments else None
            except Exception:
                args = None
            messages.append(
                {
                    "id": row_id,
                    "session_id": sess_id,
                    "direction": direction,
                    "role": role,
                    "message": message,
                    "tool_action": tool_action,
                    "tool_arguments": args,
                    "thinking": thinking,
                    "llm_provider": llm_provider,
                    "llm_model": llm_model,
                    "created_at": created_at,
                    "mode": mode,
                }
            )
        return messages
    except Exception:
        return []
    finally:
        conn.close()


def clear_logs() -> None:
    """Delete all chat logs."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM chat_logs")
        conn.commit()
    finally:
        conn.close()


def delete_session(session_id: str) -> None:
    """Delete all logs for a specific session."""
    conn = _get_conn()
    try:
        cur = conn.cursor()
        cur.execute(
            "DELETE FROM chat_logs WHERE session_id = ?",
            (session_id,),
        )
        conn.commit()
    finally:
        conn.close()
