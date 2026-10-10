from __future__ import annotations

import math
from itertools import combinations
from typing import Any

import numpy as np
import pandas as pd

from app.models import PortfolioAnalysisRequest


def _matrix(frame: pd.DataFrame) -> dict[str, dict[str, float]]:
    labels = [str(label) for label in frame.columns]
    correlation = frame.corr().fillna(0.0).to_numpy(dtype=float)
    return {
        row: {
            column: round(float(correlation[row_index, column_index]), 8)
            for column_index, column in enumerate(labels)
        }
        for row_index, row in enumerate(labels)
    }


def analyze_portfolio(request: PortfolioAnalysisRequest) -> dict[str, Any]:
    strategy_frame = pd.DataFrame(request.strategyReturns, dtype="float64")
    names = [str(name) for name in strategy_frame.columns]
    weight_values = np.array([request.weights[name] for name in names], dtype=float)
    weight_values = weight_values / weight_values.sum()
    covariance = strategy_frame.cov().to_numpy(dtype=float) * 252
    portfolio_variance = float(weight_values.T @ covariance @ weight_values)
    portfolio_volatility = math.sqrt(max(0.0, portfolio_variance))
    if portfolio_volatility > 0:
        marginal = covariance @ weight_values / portfolio_volatility
        components = weight_values * marginal / portfolio_volatility
    else:
        marginal = np.zeros(len(names))
        components = np.zeros(len(names))
    risk_contributions = {
        name: {
            "weight": round(float(weight_values[index]), 8),
            "marginalRiskContribution": round(float(marginal[index]), 8),
            "riskContribution": round(float(components[index]), 8),
        }
        for index, name in enumerate(names)
    }
    rolling: dict[str, dict[str, float | None]] = {}
    for left, right in combinations(names, 2):
        pair = f"{left}|{right}"
        rolling[pair] = {}
        for window in sorted(set(request.rollingWindows)):
            series = strategy_frame[left].rolling(window).corr(strategy_frame[right]).dropna()
            rolling[pair][str(window)] = (
                round(float(series.iloc[-1]), 8) if not series.empty else None
            )
    theme_concentration: dict[str, float] = {}
    for index, name in enumerate(names):
        theme = request.strategyThemes.get(name, "UNCLASSIFIED")
        theme_concentration[theme] = theme_concentration.get(theme, 0.0) + float(
            weight_values[index]
        )
    correlation = strategy_frame.corr().fillna(0.0).to_numpy(dtype=float)
    concentrated_pairs: list[dict[str, float | str]] = []
    for left, right in combinations(names, 2):
        value = float(correlation[names.index(left), names.index(right)])
        allocation = float(weight_values[names.index(left)] + weight_values[names.index(right)])
        if value >= 0.8 and allocation >= 0.5:
            concentrated_pairs.append(
                {
                    "left": left,
                    "right": right,
                    "correlation": round(value, 8),
                    "combinedWeight": round(allocation, 8),
                }
            )
    max_source = max(
        risk_contributions.items(), key=lambda item: item[1]["riskContribution"], default=None
    )
    return {
        "engineVersion": "1.6.0",
        "strategyCorrelationMatrix": _matrix(strategy_frame),
        "assetCorrelationMatrix": _matrix(pd.DataFrame(request.assetReturns, dtype="float64"))
        if request.assetReturns
        else {},
        "rollingCorrelations": rolling,
        "portfolioAnnualVolatility": round(portfolio_volatility, 8),
        "riskContributions": risk_contributions,
        "themeConcentration": {
            key: round(value, 8) for key, value in sorted(theme_concentration.items())
        },
        "maximumRiskSource": {
            "strategy": max_source[0],
            **max_source[1],
        }
        if max_source
        else None,
        "highCorrelationPairs": concentrated_pairs,
        "diversificationWarning": (
            "当前多个策略的收益和回撤高度相关，表面分散并未形成真实风险分散。"
            if concentrated_pairs
            else None
        ),
    }
