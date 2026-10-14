"""
Descarga de velas historicas de Binance (API publica, sin API key).

Estrategia identica a `fetchHistoricalKlines` de src/lib/market/binance.ts:
paginacion hacia atras con `endTime` y `limit=1000` (maximo por peticion),
cursor = apertura de la vela mas antigua - 1 ms. Cachea el JSON crudo en
ml/data/<symbol>-<interval>.json para no repetir descargas.

Solo se conservan velas CERRADAS (closeTime < tiempo de la descarga).
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from pathlib import Path

API_BASE = "https://api.binance.com"
DATA_DIR = Path(__file__).resolve().parent / "data"
PAGE_LIMIT = 1000
MAX_PAGES = 60
USER_AGENT = "ml-trainer/1.0 (research; offline)"


def _get_json(path: str, attempts: int = 4) -> object:
    last: Exception | None = None
    for attempt in range(attempts):
        if attempt > 0:
            time.sleep(min(2**attempt, 15))
        try:
            req = urllib.request.Request(
                f"{API_BASE}{path}",
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=30) as res:
                return json.load(res)
        except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
            last = err
    raise RuntimeError(f"Fallo de red consultando Binance ({path}): {last}")


def fetch_klines_raw(symbol: str, interval: str, count: int) -> list[list]:
    """Descarga `count` velas (paginas de 1000 hacia atras). crudo = klines."""
    clean = "".join(ch for ch in symbol.upper() if ch.isalnum())
    collected: list[list] = []
    now_ms = int(time.time() * 1000)
    cursor = now_ms
    for _ in range(MAX_PAGES):
        path = (
            f"/api/v3/klines?symbol={clean}&interval={interval}"
            f"&endTime={cursor}&limit={PAGE_LIMIT}"
        )
        page = _get_json(path)
        if not isinstance(page, list) or len(page) == 0:
            break
        collected = page + collected
        oldest_open = int(page[0][0])
        if len(collected) >= count or len(page) < PAGE_LIMIT:
            break
        cursor = oldest_open - 1
        time.sleep(0.35)  # presupuesto de peso conservador
    # dedupe por openTime y recorte al final
    seen: dict[int, list] = {}
    for k in collected:
        seen[int(k[0])] = k
    ordered = [seen[t] for t in sorted(seen)]
    return ordered[-count:] if count > 0 else ordered


def to_candles(raw: list[list], symbol: str, interval: str) -> list[dict]:
    """Klines crudos -> dicts de velas CERRADAS (orden temporal ascendente)."""
    now_ms = int(time.time() * 1000)
    out = []
    for k in raw:
        close_time = int(k[6])
        if close_time >= now_ms:
            continue  # vela en formacion: fuera
        out.append(
            {
                "symbol": symbol.upper(),
                "interval": interval,
                "time": int(k[0]),
                "openTime": int(k[0]),
                "closeTime": close_time,
                "open": float(k[1]),
                "high": float(k[2]),
                "low": float(k[3]),
                "close": float(k[4]),
                "volume": float(k[5]),
            }
        )
    return out


def load_or_fetch(symbol: str, interval: str, count: int, refresh: bool = False) -> list[dict]:
    """Cache en ml/data: reutiliza si existe y tiene velas suficientes."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = DATA_DIR / f"{symbol.upper()}-{interval}.json"
    if cache_file.exists() and not refresh:
        try:
            raw = json.loads(cache_file.read_text(encoding="utf-8"))
            if len(raw) >= count:
                return to_candles(raw, symbol, interval)
        except (json.JSONDecodeError, KeyError, ValueError):
            pass
    raw = fetch_klines_raw(symbol, interval, max(count, PAGE_LIMIT))
    cache_file.write_text(json.dumps(raw), encoding="utf-8")
    return to_candles(raw, symbol, interval)
