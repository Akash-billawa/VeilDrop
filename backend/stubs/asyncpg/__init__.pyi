from __future__ import annotations

from collections.abc import Awaitable, Callable, Iterator, Mapping
from contextlib import AbstractAsyncContextManager
from typing import Any, TypeVar

T = TypeVar("T")

class PostgresError(Exception): ...
class UniqueViolationError(PostgresError): ...
class IntegrityConstraintViolationError(PostgresError): ...

class Record(Mapping[str, Any]):
    def __getitem__(self, key: str) -> Any: ...
    def __iter__(self) -> Iterator[str]: ...
    def __len__(self) -> int: ...
    def get(self, key: str, default: Any = None) -> Any: ...

class Connection:
    async def set_type_codec(
        self,
        typename: str,
        *,
        schema: str | None = ...,
        encoder: Callable[[Any], Any] | None = ...,
        decoder: Callable[[Any], Any] | None = ...,
        format: str = ...,
    ) -> None: ...
    async def execute(self, query: str, *args: Any, timeout: float | None = ...) -> str: ...
    async def fetch(self, query: str, *args: Any, timeout: float | None = ...) -> list[Record]: ...
    async def fetchrow(self, query: str, *args: Any, timeout: float | None = ...) -> Record | None: ...
    async def fetchval(self, query: str, *args: Any, timeout: float | None = ..., column: int = ...) -> Any: ...
    def transaction(
        self,
        *,
        isolation: str | None = ...,
        readonly: bool = ...,
        deferrable: bool = ...,
    ) -> AbstractAsyncContextManager[Any]: ...

class Pool:
    def acquire(self) -> AbstractAsyncContextManager[Connection]: ...
    async def close(self) -> None: ...

async def create_pool(
    dsn: str | None = ...,
    *,
    min_size: int = ...,
    max_size: int = ...,
    statement_cache_size: int = ...,
    command_timeout: float | None = ...,
    init: Callable[[Connection], Awaitable[Any]] | None = ...,
    **kwargs: Any,
) -> Pool: ...
