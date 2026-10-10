from __future__ import annotations

import io
import zipfile
from datetime import date, timedelta

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.backtest import Portfolio, calculate_metrics, run_backtest
from app.creator_factor_research import (
    causal_percentile,
    parse_finra_margin_xlsx,
    simulate_monthly_policy,
)
from app.indicators import rsi, sma
from app.main import app
from app.models import (
    BacktestRequest,
    MarketBar,
    PortfolioAnalysisRequest,
    RobustnessValidationRequest,
    SignalGenerationRequest,
    validate_strategy_parameters,
)
from app.portfolio_analysis import analyze_portfolio
from app.tqqq_drawdown_research import DrawdownRule, drawdown_states, simulate_drawdown_rule
from app.validation import generate_latest_signal, run_robustness_validation
from app.volatility_overlay_research import (
    OverlayPolicy,
    monthly_inverse_variance_targets,
    simulate_exposure_policy,
)


def test_creator_factor_percentiles_are_causal() -> None:
    index = pd.date_range("2020-01-31", periods=6, freq="ME")
    original = pd.Series([1, 2, 3, 4, 5, 6], index=index, dtype="float64")
    changed = original.copy()
    changed.iloc[-1] = -1_000
    original_ranks = causal_percentile(original, minimum_history=2)
    changed_ranks = causal_percentile(changed, minimum_history=2)
    pd.testing.assert_series_equal(original_ranks.iloc[:-1], changed_ranks.iloc[:-1])
    assert original_ranks.iloc[-1] != changed_ranks.iloc[-1]


def test_creator_factor_finra_parser_uses_conservative_publication_lag() -> None:
    worksheet = """<?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1">
          <c r="A1" t="inlineStr"><is><t>Year-Month</t></is></c>
          <c r="B1" t="inlineStr"><is><t>Debit</t></is></c>
        </row>
        <row r="2"><c r="A2" t="inlineStr"><is><t>2024-01</t></is></c><c r="B2"><v>100</v></c></row>
        <row r="3"><c r="A3" t="inlineStr"><is><t>2024-02</t></is></c><c r="B3"><v>110</v></c></row>
      </sheetData>
    </worksheet>"""
    content = io.BytesIO()
    with zipfile.ZipFile(content, mode="w") as archive:
        archive.writestr("xl/worksheets/sheet1.xml", worksheet)
    frame = parse_finra_margin_xlsx(content.getvalue())
    assert frame.index[0] == pd.Timestamp("2024-02-25")
    assert frame.index[1] == pd.Timestamp("2024-03-25")
    assert frame.iloc[1]["marginDebtMom"] == pytest.approx(0.1)


def test_creator_factor_signal_executes_at_next_open() -> None:
    index = pd.to_datetime(["2024-01-02", "2024-01-03", "2024-01-04"])
    market = pd.DataFrame(
        {
            "adjustedOpen": [10.0, 20.0, 30.0],
            "adjustedClose": [10.0, 20.0, 30.0],
        },
        index=index,
    )
    targets = pd.Series([0.0], index=pd.to_datetime(["2024-01-02"]), dtype="float64")
    result = simulate_monthly_policy(
        market,
        targets,
        date(2024, 1, 2),
        date(2024, 1, 4),
    )
    assert result["executionCount"] == 2
    assert float(result["finalEquity"]) > 190_000


def bars(
    closes: list[float],
    *,
    opens: list[float] | None = None,
    volumes: list[float] | None = None,
    dividends: dict[int, float] | None = None,
    splits: dict[int, float] | None = None,
) -> list[dict[str, object]]:
    start = date(2024, 1, 2)
    opens = opens or closes
    return [
        {
            "symbol": "TEST",
            "tradeDate": start + timedelta(days=index),
            "open": opens[index],
            "high": max(opens[index], close) * 1.02,
            "low": min(opens[index], close) * 0.98,
            "close": close,
            "adjustedClose": close,
            "volume": volumes[index] if volumes is not None else 1000,
            "dividend": (dividends or {}).get(index, 0),
            "splitFactor": (splits or {}).get(index, 1),
            "currency": "USD",
            "source": "TEST",
        }
        for index, close in enumerate(closes)
    ]


def request(
    market_bars: list[dict[str, object]],
    *,
    strategy_type: str = "BuyAndHold",
    parameters: dict[str, object] | None = None,
    capital: float = 1000,
    commission: float = 0,
    slippage: float = 0,
    price_mode: str = "ADJUSTED",
    evidence: list[dict[str, object]] | None = None,
) -> BacktestRequest:
    return BacktestRequest.model_validate(
        {
            "strategyType": strategy_type,
            "parameters": parameters or {"positionPercent": 100},
            "bars": market_bars,
            "initialCapital": capital,
            "commissionRate": commission,
            "slippageRate": slippage,
            "priceMode": price_mode,
            "evidence": evidence or [],
        }
    )


def symbol_bars(
    symbol: str,
    closes: list[float],
    *,
    opens: list[float] | None = None,
) -> list[dict[str, object]]:
    result = bars(closes, opens=opens)
    for row in result:
        row["symbol"] = symbol
    return result


def test_ohlc_validation_rejects_invalid_prices() -> None:
    invalid = bars([10])[0]
    invalid["high"] = 8
    with pytest.raises(ValidationError, match="最高价不能低于最低价"):
        MarketBar.model_validate(invalid)


def test_strategy_parameter_validation_is_strict() -> None:
    with pytest.raises(ValidationError, match="longPeriod 必须大于 shortPeriod"):
        validate_strategy_parameters(
            "MovingAverageCross", {"shortPeriod": 60, "longPeriod": 20, "positionPercent": 50}
        )
    with pytest.raises(ValidationError):
        validate_strategy_parameters("BuyAndHold", {"positionPercent": 101})
    with pytest.raises(ValidationError):
        validate_strategy_parameters(
            "TimeSeriesMomentum", {"lookbackDays": 19, "positionPercent": 100}
        )
    with pytest.raises(ValidationError, match="trendSlopeLookback 必须小于 trendPeriod"):
        validate_strategy_parameters(
            "FundamentalLiquidityCrowding",
            {"trendPeriod": 20, "trendSlopeLookback": 20},
        )


def three_layer_parameters() -> dict[str, object]:
    return {
        "trendPeriod": 20,
        "trendSlopeLookback": 5,
        "liquidityPeriod": 10,
        "minimumDollarVolumeRatio": 0.5,
        "maximumIlliquidityMultiple": 3,
        "crowdingPeriod": 10,
        "maximumCrowdingZScore": 2.5,
        "crowdingVolumeMultiple": 1.5,
        "positionPercent": 70,
        "stopLossCondition": "流动性压力或拥挤断裂代理触发",
        "exitCondition": "方向代理失效，或任一压力层触发",
    }


def test_three_layer_strategy_exits_when_crowding_and_liquidity_break() -> None:
    closes = [100 + index * 0.2 for index in range(80)] + [180, 116]
    volumes = [1_000 for _ in range(80)] + [20_000, 1_000]
    result = run_backtest(
        request(
            bars(closes, volumes=volumes),
            strategy_type="FundamentalLiquidityCrowding",
            parameters=three_layer_parameters(),
            capital=10_000,
        )
    )
    sides = [trade["side"] for trade in result["trades"]]
    assert sides[:2] == ["BUY", "SELL"]
    assert result["trades"][1]["triggerReason"] == "三层证据缺失、过期或越过风险阈值"


def test_three_layer_latest_signal_blocks_holding_during_crowding_break() -> None:
    closes = [100 + index * 0.2 for index in range(40)] + [170]
    volumes = [1_000 for _ in range(40)] + [20_000]
    signal_request = SignalGenerationRequest.model_validate(
        {
            "strategyType": "FundamentalLiquidityCrowding",
            "parameters": three_layer_parameters(),
            "bars": bars(closes, volumes=volumes),
            "currentQuantity": 10,
            "targetAmount": 7_000,
        }
    )
    signal = generate_latest_signal(signal_request)
    assert signal["action"] == "SELL"
    assert signal["reason"] == "三层证据缺失、过期或越过风险阈值"


def verified_three_layer_evidence(available_day: int = 25) -> list[dict[str, object]]:
    observed = date(2024, 1, 2) + timedelta(days=available_day - 5)
    available = date(2024, 1, 2) + timedelta(days=available_day)
    values = {
        "FUNDAMENTAL_GROWTH_SCORE": 0.4,
        "ORDER_BOOK_IMBALANCE": 0.2,
        "FINANCIAL_CONDITIONS_Z": -0.2,
        "SHORT_INTEREST_PERCENT": 8,
        "DAYS_TO_COVER": 2,
    }
    return [
        {
            "symbol": "GLOBAL" if metric == "FINANCIAL_CONDITIONS_Z" else "TEST",
            "metricCode": metric,
            "value": value,
            "observedAt": observed,
            "availableAt": available,
            "source": "OFFICIAL_TEST",
            "verificationStatus": "VERIFIED",
        }
        for metric, value in values.items()
    ]


def test_three_layer_real_mode_blocks_entry_until_all_verified_evidence_is_available() -> None:
    parameters = {
        **three_layer_parameters(),
        "dataMode": "REQUIRE_VERIFIED_REAL",
        "orderBookMaxAgeDays": 7,
        "fundamentalMaxAgeDays": 140,
        "financingMaxAgeDays": 30,
        "shortInterestMaxAgeDays": 30,
    }
    without_evidence = run_backtest(
        request(
            bars([100 + index * 0.3 for index in range(50)]),
            strategy_type="FundamentalLiquidityCrowding",
            parameters=parameters,
        )
    )
    assert without_evidence["trades"] == []

    with_evidence = run_backtest(
        request(
            bars([100 + index * 0.3 for index in range(35)]),
            strategy_type="FundamentalLiquidityCrowding",
            parameters=parameters,
            evidence=verified_three_layer_evidence(),
        )
    )
    assert with_evidence["trades"][0]["side"] == "BUY"


def test_three_layer_real_mode_does_not_use_future_disclosures() -> None:
    future_evidence = verified_three_layer_evidence(available_day=90)
    parameters = {
        **three_layer_parameters(),
        "dataMode": "REQUIRE_VERIFIED_REAL",
        "orderBookMaxAgeDays": 7,
    }
    result = run_backtest(
        request(
            bars([100 + index * 0.3 for index in range(50)]),
            strategy_type="FundamentalLiquidityCrowding",
            parameters=parameters,
            evidence=future_evidence,
        )
    )
    assert result["trades"] == []


def test_sma_and_rsi_indicators() -> None:
    moving_average = sma([1, 2, 3, 4, 5], 3)
    assert moving_average.iloc[-1] == 4
    oscillator = rsi(list(range(1, 25)), 14)
    assert oscillator.iloc[-1] == 100


def test_close_signal_executes_at_next_open_without_future_lookahead() -> None:
    result = run_backtest(request(bars([10, 11, 12], opens=[10, 20, 999])))
    assert result["trades"][0]["signalTime"] == "2024-01-02"
    assert result["trades"][0]["executionTime"] == "2024-01-03"
    assert result["trades"][0]["executionPrice"] == 20
    changed_future = run_backtest(request(bars([10, 11, 9000], opens=[10, 20, 9000])))
    assert changed_future["trades"][0] == result["trades"][0]


def test_commission_and_slippage_are_charged() -> None:
    result = run_backtest(request(bars([10, 10, 10]), commission=0.01, slippage=0.01, capital=1000))
    trade = result["trades"][0]
    assert trade["executionPrice"] == pytest.approx(10.1)
    assert trade["commission"] > 0
    assert trade["slippage"] > 0
    assert result["metrics"]["finalEquity"] < 1000


def test_ibkr_tiered_base_commission_is_per_share_with_order_minimum() -> None:
    backtest_request = BacktestRequest.model_validate(
        {
            "strategyType": "BuyAndHold",
            "parameters": {"positionPercent": 100},
            "bars": bars([10, 10, 10]),
            "initialCapital": 10_000,
            "commissionModel": "IBKR_US_EQUITY_TIERED_BASE",
            "commissionRate": 0.001,
            "slippageRate": 0,
        }
    )

    result = run_backtest(backtest_request)
    trade = result["trades"][0]

    assert trade["quantity"] == 999
    assert trade["commission"] == pytest.approx(999 * 0.0035)
    assert result["equityPoints"][1]["cash"] >= 0
    assert result["metrics"]["totalReturn"] == result["metrics"]["benchmarkReturn"]
    assert "不含会随路由和成交变化" in result["riskNotice"]


def test_insufficient_cash_rejects_buy_without_negative_balance() -> None:
    result = run_backtest(request(bars([100, 100, 100]), capital=10))
    assert result["trades"] == []
    assert result["rejectedOrders"][0]["reason"] == "现金不足，无法购买最小一股"
    assert all(point["cash"] >= 0 for point in result["equityPoints"])


def test_raw_split_and_dividend_adjust_quantity_and_cash() -> None:
    market = bars(
        [100, 100, 50, 50],
        opens=[100, 100, 50, 50],
        dividends={2: 1},
        splits={2: 2},
    )
    result = run_backtest(request(market, price_mode="RAW_WITH_ACTIONS"))
    assert result["positions"][0]["quantity"] == 20
    assert result["equityPoints"][2]["cash"] == 20
    assert result["equityPoints"][2]["equity"] == 1020


def test_partial_sell_realized_pnl_and_remaining_cost() -> None:
    portfolio = Portfolio(cash=1000)
    portfolio.buy(10, 50, 0, date(2024, 1, 2))
    realized = portfolio.sell(4, 60, 0)
    assert realized == 40
    assert portfolio.quantity == 6
    assert portfolio.avg_cost == 50


def test_drawdown_profit_factor_win_rate_and_streaks() -> None:
    index = pd.date_range("2024-01-01", periods=5, freq="D")
    equity = pd.Series([100, 120, 90, 110, 115], index=index, dtype="float64")
    benchmark = pd.Series([100, 102, 104, 106, 108], index=index, dtype="float64")
    positions = pd.Series([0, 100, 80, 90, 0], index=index, dtype="float64")
    metrics, _ = calculate_metrics(
        equity, benchmark, [20, -10, 30, -5], [5, 3, 8, 2], positions, 4, 2, 100
    )
    assert metrics["maxDrawdown"] == -25
    assert metrics["winRate"] == 50
    assert metrics["profitFactor"] == pytest.approx(50 / 15)
    assert metrics["averageWin"] == 25
    assert metrics["averageLoss"] == 7.5
    assert metrics["expectancyPerTrade"] == 8.75
    assert metrics["expectancyR"] == pytest.approx(8.75 / 7.5)
    assert metrics["breakEvenWinRate"] == pytest.approx(7.5 / 32.5 * 100)
    assert metrics["maxConsecutiveWins"] == 1
    assert metrics["maxConsecutiveLosses"] == 1


def test_historical_tail_metrics_use_observed_daily_left_tail() -> None:
    index = pd.date_range("2024-01-01", periods=31, freq="D")
    daily_returns = [
        -0.12,
        -0.08,
        -0.04,
        -0.03,
        -0.02,
        *([0.01] * 25),
    ]
    equity_values = [100.0]
    for daily_return in daily_returns:
        equity_values.append(equity_values[-1] * (1 + daily_return))
    equity = pd.Series(equity_values, index=index, dtype="float64")
    benchmark = pd.Series(equity_values, index=index, dtype="float64")
    positions = pd.Series([0.0] * len(index), index=index, dtype="float64")

    metrics, _ = calculate_metrics(equity, benchmark, [], [], positions, 0, 0, 100)

    observed = pd.Series(daily_returns, dtype="float64") * 100
    expected_var = float(observed.quantile(0.05))
    expected_shortfall = float(observed[observed <= expected_var].mean())
    assert metrics["historicalVaR95"] == pytest.approx(expected_var)
    assert metrics["expectedShortfall95"] == pytest.approx(expected_shortfall)
    assert metrics["worstDailyReturn"] == -12


def test_tail_metrics_require_enough_observations_for_var_and_es() -> None:
    index = pd.date_range("2024-01-01", periods=5, freq="D")
    equity = pd.Series([100, 101, 99, 100, 98], index=index, dtype="float64")
    positions = pd.Series([0, 0, 0, 0, 0], index=index, dtype="float64")
    metrics, _ = calculate_metrics(equity, equity, [], [], positions, 0, 0, 100)

    assert metrics["historicalVaR95"] is None
    assert metrics["expectedShortfall95"] is None
    assert metrics["worstDailyReturn"] == pytest.approx(-2)


def test_same_input_and_seed_are_reproducible() -> None:
    market = bars([100 + (index % 9) * 2 - (index % 5) for index in range(100)])
    backtest_request = request(
        market,
        strategy_type="MovingAverageCross",
        parameters={"shortPeriod": 5, "longPeriod": 20, "positionPercent": 80},
    )
    assert run_backtest(backtest_request) == run_backtest(backtest_request)


def test_time_series_momentum_uses_warmup_without_polluting_evaluation_period() -> None:
    market = bars([100] * 20 + [110, 111, 112, 113])
    evaluation_start = market[20]["tradeDate"]
    backtest_request = BacktestRequest.model_validate(
        {
            "strategyType": "TimeSeriesMomentum",
            "parameters": {"lookbackDays": 20, "positionPercent": 100},
            "bars": market,
            "evaluationStartDate": evaluation_start,
            "initialCapital": 1000,
            "commissionRate": 0,
            "slippageRate": 0,
        }
    )
    result = run_backtest(backtest_request)

    assert len(result["equityPoints"]) == 4
    assert result["equityPoints"][0]["tradeDate"] == str(evaluation_start)
    assert result["trades"][0]["signalTime"] == str(evaluation_start)
    assert result["trades"][0]["executionTime"] == str(market[21]["tradeDate"])


def test_multi_horizon_trend_uses_only_completed_horizons_and_next_open() -> None:
    closes = [100 + index for index in range(70)]
    market = symbol_bars("QQQ", closes, opens=[value + 1 for value in closes])
    evaluation_start = market[60]["tradeDate"]
    model = BacktestRequest.model_validate(
        {
            "strategyType": "MultiHorizonTrend",
            "parameters": {
                "symbol": "QQQ",
                "lookbackDays": [20, 30, 40],
                "minimumPositiveHorizons": 2,
                "positionPercent": 100,
            },
            "bars": market,
            "evaluationStartDate": evaluation_start,
            "initialCapital": 10_000,
            "commissionRate": 0,
            "slippageRate": 0,
        }
    )

    result = run_backtest(model)

    assert result["trades"][0]["signalTime"] == str(evaluation_start)
    assert result["trades"][0]["executionTime"] == str(market[61]["tradeDate"])
    assert result["trades"][0]["executionPrice"] == market[61]["open"]


def test_dual_momentum_selects_relative_winner_above_defensive_hurdle() -> None:
    qqq = [100 + index * 2 for index in range(30)]
    spy = [100 + index for index in range(30)]
    shy = [100 + index * 0.05 for index in range(30)]
    market = [
        *symbol_bars("QQQ", qqq),
        *symbol_bars("SPY", spy),
        *symbol_bars("SHY", shy),
    ]
    evaluation_start = market[25]["tradeDate"]
    model = BacktestRequest.model_validate(
        {
            "strategyType": "DualMomentumRotation",
            "parameters": {
                "riskAssets": ["QQQ", "SPY"],
                "defensiveAsset": "SHY",
                "benchmarkSymbol": "QQQ",
                "lookbackDays": 20,
                "positionPercent": 100,
            },
            "bars": market,
            "evaluationStartDate": evaluation_start,
            "initialCapital": 10_000,
            "commissionRate": 0,
            "slippageRate": 0,
        }
    )

    result = run_backtest(model)

    assert result["trades"][0]["symbol"] == "QQQ"
    assert result["trades"][0]["signalTime"] == str(evaluation_start)
    assert result["trades"][0]["executionTime"] == str(market[26]["tradeDate"])


def test_core_satellite_keeps_core_and_rotates_only_satellite_sleeve() -> None:
    qqq = [100 + index for index in range(30)]
    gld = [100 + index * 2 for index in range(30)]
    tlt = [100 - index * 0.2 for index in range(30)]
    shy = [100 + index * 0.05 for index in range(30)]
    market = [
        *symbol_bars("QQQ", qqq),
        *symbol_bars("GLD", gld),
        *symbol_bars("TLT", tlt),
        *symbol_bars("SHY", shy),
    ]
    model = BacktestRequest.model_validate(
        {
            "strategyType": "CoreSatelliteMomentum",
            "parameters": {
                "coreSymbol": "QQQ",
                "corePercent": 70,
                "satelliteAssets": ["GLD", "TLT"],
                "defensiveAsset": "SHY",
                "benchmarkSymbol": "QQQ",
                "lookbackDays": 20,
                "positionPercent": 100,
            },
            "bars": market,
            "evaluationStartDate": market[25]["tradeDate"],
            "initialCapital": 10_000,
            "commissionRate": 0,
            "slippageRate": 0,
        }
    )

    result = run_backtest(model)
    symbols = {position["symbol"] for position in result["positions"]}

    assert symbols == {"QQQ", "GLD"}
    assert {trade["symbol"] for trade in result["trades"]} == {"QQQ", "GLD"}


def test_volatility_overlay_targets_use_only_completed_months_and_respect_cap() -> None:
    index = pd.bdate_range("2020-01-01", periods=400)
    calm_then_volatile = [
        100 * (1.001**day) if day < 300 else 100 * (1.001**300) * (1.03 ** ((day - 300) % 2))
        for day in range(400)
    ]
    close = pd.Series(calm_then_volatile, index=index, dtype="float64")

    original = monthly_inverse_variance_targets(close, OverlayPolicy())
    changed_future = close.copy()
    changed_future.iloc[-1] *= 10
    changed = monthly_inverse_variance_targets(changed_future, OverlayPolicy())

    cutoff = index[-2].to_period("M") - 1
    original_past = original.loc[original.index.to_period("M") <= cutoff]
    changed_past = changed.loc[changed.index.to_period("M") <= cutoff]
    pd.testing.assert_series_equal(original_past, changed_past)
    assert original.between(1.0, 1.1).all()


def test_volatility_overlay_charges_margin_interest_and_never_exceeds_policy_cap() -> None:
    index = pd.bdate_range("2020-01-01", periods=40)
    market = pd.DataFrame(
        {"adjustedOpen": [100.0] * 40, "adjustedClose": [100.0] * 40}, index=index
    )
    rates = pd.Series([5.0] * 60, index=pd.date_range("2019-12-20", periods=60))
    result = simulate_exposure_policy(
        market,
        rates,
        index[0].date(),
        index[-1].date(),
        100_000,
        None,
        fixed_exposure=1.1,
    )

    assert result.metrics["totalFinancing"] > 0
    assert result.metrics["totalCommission"] > 0
    assert result.metrics["maximumObservedExposure"] <= 110.1
    assert result.metrics["finalEquity"] < 100_000


def test_tqqq_drawdown_state_uses_hysteresis_without_future_knowledge() -> None:
    index = pd.bdate_range("2020-01-01", periods=12)
    close = pd.Series(
        [100, 95, 89, 85, 88, 91, 94, 96, 97, 101, 102, 103],
        index=index,
        dtype="float64",
    )
    rule = DrawdownRule(-0.15, 0.05, "REPLACE_QQQ")
    original = drawdown_states(close, rule)
    changed_future = close.copy()
    changed_future.iloc[-1] = 1_000
    changed = drawdown_states(changed_future, rule)

    pd.testing.assert_series_equal(original.iloc[:-1], changed.iloc[:-1])
    assert original.iloc[3]
    assert not original.iloc[7]


def test_tqqq_replacement_rule_stays_funded_and_executes_after_close_signal() -> None:
    index = pd.bdate_range("2020-01-01", periods=10)
    market = pd.DataFrame(
        {
            "qqqOpen": [100.0] * 10,
            "qqqClose": [100, 100, 84, 83, 86, 94, 96, 97, 100, 101],
            "tqqqOpen": [50.0] * 10,
            "tqqqClose": [50, 50, 35, 34, 37, 43, 46, 48, 50, 51],
        },
        index=index,
    )
    rates = pd.Series([5.0] * 30, index=pd.date_range("2019-12-20", periods=30))
    result = simulate_drawdown_rule(
        market,
        rates,
        index[0].date(),
        index[-1].date(),
        DrawdownRule(-0.15, 0.05, "REPLACE_QQQ"),
    )

    assert result["executionCount"] >= 3
    assert result["totalFinancing"] == 0
    assert result["maximumTqqqWeight"] <= 5.1


def test_time_series_momentum_latest_signal_has_no_future_knowledge() -> None:
    market = bars([100] * 21 + [101])
    request_model = SignalGenerationRequest.model_validate(
        {
            "strategyType": "TimeSeriesMomentum",
            "parameters": {"lookbackDays": 20, "positionPercent": 100},
            "bars": market,
            "currentQuantity": 0,
            "targetAmount": 1000,
        }
    )

    signal = generate_latest_signal(request_model)

    assert signal["action"] == "BUY"
    assert signal["signalTradeDate"] == str(market[-1]["tradeDate"])


def test_fastapi_health_version_and_validation() -> None:
    client = TestClient(app)
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/version").json()["python"] == "3.12"
    response = client.post(
        "/strategies/validate",
        json={
            "strategyType": "MovingAverageCross",
            "parameters": {"shortPeriod": 20, "longPeriod": 60, "positionPercent": 95},
        },
    )
    assert response.status_code == 200
    assert response.json()["valid"] is True


def validation_market(count: int = 420, *, downtrend: bool = False) -> list[dict[str, object]]:
    prices = []
    for index in range(count):
        trend = -0.035 * index if downtrend else 0.045 * index
        cycle = 8 * __import__("math").sin(index / 9) + 3 * __import__("math").sin(index / 31)
        prices.append(max(5, 100 + trend + cycle))
    return bars(
        prices,
        opens=[
            price * (1 + 0.002 * __import__("math").sin(i / 7)) for i, price in enumerate(prices)
        ],
    )


@pytest.fixture(scope="module")
def robustness_result() -> dict[str, object]:
    request_model = RobustnessValidationRequest.model_validate(
        {
            "strategyType": "MovingAverageCross",
            "parameters": {"shortPeriod": 10, "longPeriod": 30, "positionPercent": 75},
            "bars": validation_market(),
            "inSampleRatio": 0.7,
            "walkForward": {
                "trainMonths": 6,
                "testMonths": 2,
                "anchored": True,
                "maxWindows": 3,
            },
            "parameterGrid": {
                "shortPeriod": [5, 10, 15],
                "longPeriod": [25, 30, 40],
                "positionPercent": [50, 75],
            },
            "minimumOutOfSampleTrades": 2,
            "randomSeed": 42,
        }
    )
    return run_robustness_validation(request_model)


def test_validation_split_is_chronological_without_random_shuffle(
    robustness_result: dict[str, object],
) -> None:
    split = robustness_result["split"]
    assert isinstance(split, dict)
    assert split["inSampleEnd"] < split["outSampleStart"]
    assert split["ratio"] == 0.7


def test_walk_forward_train_window_never_overlaps_future_test_data(
    robustness_result: dict[str, object],
) -> None:
    windows = robustness_result["walkForwardWindows"]
    assert isinstance(windows, list)
    assert len(windows) >= 2
    assert all(window["trainEnd"] < window["testStart"] for window in windows)


def test_parameter_sweep_changes_performance_and_marks_fragile_regions(
    robustness_result: dict[str, object],
) -> None:
    sweep = robustness_result["parameterSweep"]
    assert isinstance(sweep, dict)
    results = sweep["results"]
    returns = {row["metrics"]["totalReturn"] for row in results}
    assert len(returns) > 1
    assert sweep["summary"]["candidateCount"] == len(results)
    assert all("stabilityScore" in row and "flags" in row for row in results)


def test_stress_fees_slippage_delay_and_skipped_trades_are_traceable(
    robustness_result: dict[str, object],
) -> None:
    stress = robustness_result["stressTest"]
    assert isinstance(stress, dict)
    results = {row["scenarioCode"]: row for row in stress["results"]}
    assert len(results) == 11
    assert (
        results["COMMISSION_5X"]["metrics"]["totalCommission"]
        >= results["BASE_COMMISSION"]["metrics"]["totalCommission"]
    )
    assert {
        "SLIPPAGE_2X",
        "SLIPPAGE_5X",
        "ADVERSE_OPEN",
        "SIGNAL_DELAY_1D",
        "SKIP_TRADES_10_PERCENT",
    }.issubset(results)


def test_robustness_validation_is_reproducible_for_same_seed() -> None:
    payload = {
        "strategyType": "BuyAndHold",
        "parameters": {"positionPercent": 75},
        "bars": validation_market(180),
        "parameterGrid": {"positionPercent": [50, 75]},
        "walkForward": {"trainMonths": 3, "testMonths": 1, "anchored": True, "maxWindows": 2},
        "randomSeed": 7,
    }
    model = RobustnessValidationRequest.model_validate(payload)
    assert run_robustness_validation(model) == run_robustness_validation(model)


def test_negative_rsi_out_of_sample_strategy_is_rejected() -> None:
    model = RobustnessValidationRequest.model_validate(
        {
            "strategyType": "RsiMeanReversion",
            "parameters": {
                "period": 7,
                "buyThreshold": 45,
                "sellThreshold": 55,
                "positionPercent": 95,
                "minimumHoldingDays": 3,
            },
            "bars": validation_market(300, downtrend=True),
            "parameterGrid": {
                "period": [7],
                "buyThreshold": [40, 45],
                "sellThreshold": [55, 60],
                "positionPercent": [95],
                "minimumHoldingDays": [3],
            },
            "walkForward": {"trainMonths": 4, "testMonths": 2, "anchored": True, "maxWindows": 2},
            "minimumOutOfSampleTrades": 20,
        }
    )
    result = run_robustness_validation(model)
    assert result["recommendation"] == "REJECT"
    assert result["approvalCriteria"]["outOfSampleTradeCount"] is False
    assert result["approvalCriteria"]["positiveOutOfSampleExpectancy"] is False


def test_latest_signal_uses_only_bars_through_requested_trade_date() -> None:
    market = validation_market(80)
    request_model = SignalGenerationRequest.model_validate(
        {
            "strategyType": "BuyAndHold",
            "parameters": {"positionPercent": 50},
            "bars": market[:50],
            "currentQuantity": 0,
            "targetAmount": 5000,
        }
    )
    signal = generate_latest_signal(request_model)
    assert signal["action"] == "BUY"
    assert signal["signalTradeDate"] == str(market[49]["tradeDate"])
    assert signal["signalTradeDate"] != str(market[50]["tradeDate"])


def test_delayed_signal_executes_after_next_open_without_lookahead() -> None:
    delayed = BacktestRequest.model_validate(
        {
            "strategyType": "BuyAndHold",
            "parameters": {"positionPercent": 100},
            "bars": bars([10, 11, 12, 13], opens=[10, 20, 30, 40]),
            "initialCapital": 1000,
            "commissionRate": 0,
            "slippageRate": 0,
            "signalDelayDays": 1,
        }
    )
    result = run_backtest(delayed)
    assert result["trades"][0]["executionTime"] == "2024-01-04"
    assert result["trades"][0]["executionPrice"] == 30


def test_minimum_holding_period_prevents_early_rsi_exit() -> None:
    closes = [100] * 10 + [95, 90, 85, 80, 82, 88, 95, 105, 110, 115, 120]
    unrestricted = run_backtest(
        request(
            bars(closes),
            strategy_type="RsiMeanReversion",
            parameters={
                "period": 3,
                "buyThreshold": 40,
                "sellThreshold": 60,
                "positionPercent": 80,
                "minimumHoldingDays": 0,
            },
        )
    )
    restricted = run_backtest(
        request(
            bars(closes),
            strategy_type="RsiMeanReversion",
            parameters={
                "period": 3,
                "buyThreshold": 40,
                "sellThreshold": 60,
                "positionPercent": 80,
                "minimumHoldingDays": 10,
            },
        )
    )
    unrestricted_sell = next(trade for trade in unrestricted["trades"] if trade["side"] == "SELL")
    restricted_sells = [trade for trade in restricted["trades"] if trade["side"] == "SELL"]
    assert (
        not restricted_sells
        or restricted_sells[0]["executionTime"] > unrestricted_sell["executionTime"]
    )


def test_portfolio_correlation_warns_when_apparent_diversification_is_highly_correlated() -> None:
    base = [0.01, -0.005, 0.012, 0.004, -0.003] * 12
    model = PortfolioAnalysisRequest.model_validate(
        {
            "strategyReturns": {
                "AAPL_BUY_HOLD": base,
                "QQQM_BUY_HOLD": [value * 0.98 + 0.0001 for value in base],
                "OTHER": [(-1 if index % 2 else 1) * 0.003 for index in range(len(base))],
            },
            "weights": {"AAPL_BUY_HOLD": 0.3, "QQQM_BUY_HOLD": 0.3, "OTHER": 0.1},
            "strategyThemes": {
                "AAPL_BUY_HOLD": "BIG_TECH",
                "QQQM_BUY_HOLD": "CORE_INDEX",
                "OTHER": "DEFENSIVE",
            },
            "rollingWindows": [20, 60],
        }
    )
    result = analyze_portfolio(model)
    assert result["strategyCorrelationMatrix"]["AAPL_BUY_HOLD"]["QQQM_BUY_HOLD"] > 0.99
    assert result["diversificationWarning"] == (
        "当前多个策略的收益和回撤高度相关，表面分散并未形成真实风险分散。"
    )
    assert "20" in result["rollingCorrelations"]["AAPL_BUY_HOLD|QQQM_BUY_HOLD"]


def test_portfolio_risk_contribution_and_theme_concentration_are_normalized() -> None:
    model = PortfolioAnalysisRequest.model_validate(
        {
            "strategyReturns": {
                "A": [0.01, 0.02, -0.01, 0.015, 0.005],
                "B": [-0.004, 0.003, 0.002, -0.001, 0.006],
            },
            "weights": {"A": 30, "B": 20},
            "strategyThemes": {"A": "BIG_TECH", "B": "DEFENSIVE"},
        }
    )
    result = analyze_portfolio(model)
    assert sum(item["weight"] for item in result["riskContributions"].values()) == pytest.approx(1)
    assert sum(result["themeConcentration"].values()) == pytest.approx(1)
    assert result["maximumRiskSource"]["strategy"] in {"A", "B"}


def test_portfolio_analysis_fastapi_endpoint_is_pure_and_has_no_broker_side_effects() -> None:
    client = TestClient(app)
    response = client.post(
        "/portfolios/analyze",
        json={
            "strategyReturns": {"A": [0.01, 0.02], "B": [0.005, -0.002]},
            "weights": {"A": 0.5, "B": 0.5},
        },
    )
    assert response.status_code == 200
    assert response.json()["engineVersion"] == "1.6.0"
