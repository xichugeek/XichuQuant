from __future__ import annotations

import numpy as np
import pandas as pd


def sma(values: list[float] | pd.Series, period: int) -> pd.Series:
    if period <= 0:
        raise ValueError("period 必须大于 0")
    series = values if isinstance(values, pd.Series) else pd.Series(values, dtype="float64")
    return series.astype("float64").rolling(window=period, min_periods=period).mean()


def rsi(values: list[float] | pd.Series, period: int = 14) -> pd.Series:
    if period <= 1:
        raise ValueError("period 必须大于 1")
    series = values if isinstance(values, pd.Series) else pd.Series(values, dtype="float64")
    delta = series.astype("float64").diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    average_gain = gain.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    average_loss = loss.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    relative_strength = average_gain / average_loss.replace(0, np.nan)
    result = 100 - 100 / (1 + relative_strength)
    result = result.mask((average_loss == 0) & (average_gain > 0), 100)
    result = result.mask((average_loss == 0) & (average_gain == 0), 50)
    return result
