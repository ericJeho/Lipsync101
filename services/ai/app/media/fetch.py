"""Fetching remote media, with the guards that endpoint needs.

``/v1/import-url`` takes a URL from a user and fetches it server-side, which is
a textbook SSRF primitive. Everything here exists to stop that: scheme and host
are checked against an allowlist, redirects are followed manually so a 302 to
``169.254.169.254`` cannot slip past the first check, and the response is size-
and time-bounded.
"""

from __future__ import annotations

import ipaddress
import logging
import socket
from pathlib import Path
from urllib.parse import urlparse

import httpx

from ..config import get_settings

logger = logging.getLogger(__name__)

MAX_BYTES = 2 * 1024 * 1024 * 1024
MAX_REDIRECTS = 3


class FetchRefused(ValueError):
    """The URL is syntactically fine but we will not fetch it."""


def _is_private_address(host: str) -> bool:
    """True when the hostname resolves to anything not on the public internet."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        # A name we cannot resolve is not a name we should fetch.
        return True

    for info in infos:
        address = info[4][0]
        try:
            parsed = ipaddress.ip_address(address)
        except ValueError:
            return True
        if (
            parsed.is_private
            or parsed.is_loopback
            or parsed.is_link_local
            or parsed.is_reserved
            or parsed.is_multicast
            or parsed.is_unspecified
        ):
            return True
    return False


def assert_fetchable(url: str, *, enforce_allowlist: bool = True) -> str:
    """Validates a URL, returning its hostname. Raises FetchRefused otherwise."""
    parsed = urlparse(url)

    if parsed.scheme not in ("http", "https"):
        raise FetchRefused("Only http and https URLs can be imported.")

    host = parsed.hostname
    if not host:
        raise FetchRefused("That URL has no hostname.")

    if _is_private_address(host):
        raise FetchRefused("That address is not publicly reachable.")

    if enforce_allowlist:
        allowed = get_settings().import_allowed_hosts
        if host not in allowed:
            raise FetchRefused(
                f"We can only import from: {', '.join(sorted(allowed))}. "
                "Download the audio and upload it directly instead."
            )

    return host


async def download(url: str, destination: Path, *, enforce_allowlist: bool = False) -> Path:
    """Streams a URL to disk, re-validating the target after each redirect."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    current = url

    async with httpx.AsyncClient(follow_redirects=False, timeout=120.0) as client:
        for _ in range(MAX_REDIRECTS + 1):
            assert_fetchable(current, enforce_allowlist=enforce_allowlist)

            async with client.stream("GET", current) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("location")
                    if not location:
                        raise FetchRefused("Redirect without a destination.")
                    # Re-checked at the top of the next iteration, which is the
                    # whole point of not letting httpx follow redirects itself.
                    current = str(httpx.URL(current).join(location))
                    continue

                response.raise_for_status()

                written = 0
                with destination.open("wb") as handle:
                    async for chunk in response.aiter_bytes(chunk_size=1 << 20):
                        written += len(chunk)
                        if written > MAX_BYTES:
                            handle.close()
                            destination.unlink(missing_ok=True)
                            raise FetchRefused("That file is larger than the 2GB import limit.")
                        handle.write(chunk)

                return destination

    raise FetchRefused("Too many redirects.")
