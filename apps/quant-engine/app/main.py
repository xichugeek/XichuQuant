from __future__ import annotations

from typing import Any

from fastapi import FastAPI

from app.backtest import run_backtest
from app.indicators import rsi, sma
from app.models import (
    BacktestRequest,
    IndicatorRequest,
    PortfolioAnalysisRequest,
    RobustnessValidationRequest,
    SignalGenerationRequest,
    StrategyValidationRequest,
    validate_strategy_parameters,
)
from app.portfolio_analysis import analyze_portfolio
from app.validation import generate_latest_signal, run_robustness_validation

VERSION = "1.7.0"

app = FastAPI(
    title="XichuQuant Quant Engine / 西楚量化交易系统",
    description="纯行情、指标和回测计算服务；不连接账户数据库，不具备券商下单能力。",
    version=VERSION,
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"name": "xichu-quant-engine", "status": "ok", "version": VERSION}


@app.get("/version")
def version() -> dict[str, str]:
    return {"version": VERSION, "api": "v1", "python": "3.12"}


@app.post("/strategies/validate")
def validate_strategy(request: StrategyValidationRequest) -> dict[str, Any]:
    parameters = validate_strategy_parameters(request.strategyType, request.parameters)
    return {
        "valid": True,
        "strategyType": request.strategyType,
        "parameters": parameters.model_dump(),
        "schema": parameters.__class__.model_json_schema(),
    }


@app.post("/indicators/calculate")
def calculate_indicator(request: IndicatorRequest) -> dict[str, Any]:
    period = int(request.parameters.get("period", 14))
    result = (
        sma(request.values, period) if request.indicator == "SMA" else rsi(request.values, period)
    )
    return {
        "indicator": request.indicator,
        "values": [None if value != value else round(float(value), 8) for value in result],
    }


@app.post("/backtests/run")
def backtest(request: BacktestRequest) -> dict[str, Any]:
    return run_backtest(request)


@app.post("/validations/run")
def validate_robustness(request: RobustnessValidationRequest) -> dict[str, Any]:
    return run_robustness_validation(request)


@app.post("/signals/generate")
def generate_signal(request: SignalGenerationRequest) -> dict[str, Any]:
    return generate_latest_signal(request)


@app.post("/portfolios/analyze")
def portfolio_analysis(request: PortfolioAnalysisRequest) -> dict[str, Any]:
    return analyze_portfolio(request)
