#!/usr/bin/env python3
"""Replace this app's legacy catch-all Nginx proxy with static-file delivery.

The workflow creates a timestamped backup and validates Nginx before reload.
This script intentionally preserves the surrounding server/TLS configuration.
"""

from pathlib import Path
import re
import sys


def block_end(source: str, start: int) -> int | None:
    """Return the first balanced block end after an opening brace."""
    depth = 0
    for position in range(start, len(source)):
        if source[position] == "{":
            depth += 1
        elif source[position] == "}":
            depth -= 1
            if depth == 0:
                return position + 1
    return None


def main() -> None:
    path = Path(sys.argv[1])
    source = path.read_text(encoding="utf-8")
    server_start = server_end = None
    for candidate in re.finditer(r"(?m)^[ \t]*server[ \t]*\{", source):
        candidate_end = block_end(source, candidate.start())
        if candidate_end is None:
            continue
        candidate_text = source[candidate.start():candidate_end]
        if re.search(r"server_name[^;]*\bapp\.17design\.fun\b", candidate_text) and re.search(r"listen[ \t]+443\b", candidate_text):
            server_start, server_end = candidate.start(), candidate_end
            break
    if server_start is None or server_end is None:
        raise SystemExit("HTTPS server block for app.17design.fun was not found.")

    server_text = source[server_start:server_end]
    match = re.search(r"(?m)^(?P<indent>[ \t]*)location[ \t]+/[ \t]*\{", server_text)
    if not match:
        raise SystemExit("No catch-all location block found.")
    start = server_start + match.start()
    end = block_end(source, start)
    if end is None:
        raise SystemExit("Could not find the end of the catch-all location block.")

    indent = match.group("indent")
    replacement = f"""{indent}# 17design-static-shell: static pages never depend on Node availability
{indent}location ^~ /api/ {{
{indent}    proxy_pass http://127.0.0.1:8787;
{indent}    proxy_http_version 1.1;
{indent}    proxy_set_header Host $host;
{indent}    proxy_set_header X-Real-IP $remote_addr;
{indent}    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
{indent}    proxy_set_header X-Forwarded-Proto $scheme;
{indent}    proxy_read_timeout 300s;
{indent}}}

{indent}location / {{
{indent}    root /home/ubuntu/17_design/dist;
{indent}    try_files $uri $uri/ /index.html;
{indent}}}"""
    path.write_text(source[:start] + replacement + source[end:], encoding="utf-8")


if __name__ == "__main__":
    main()
