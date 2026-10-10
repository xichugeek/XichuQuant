from __future__ import annotations

import math

import pandas as pd
import pytest

from app.macro_factor_research import (
    MacroRiskRule,
    build_macro_snapshots,
    last_trading_day_each_quarter,
    latest_causal_percentile,
    one_year_changes,
    rule_targets,
)


def test_one_year_changes_use_only_prior_asof_observation() -> None:
    values = pd.Series(
        [100.0, 101.0, 110.0],
        index=pd.to_datetime(["2019-01-04", "2019-01-07", "2020-01-06"]),
    )

    changes = one_year_changes(values, percentage=True)

    assert changes.index[-1] == pd.Timestamp("2020-01-06")
    assert changes.iloc[-1] == pytest.approx(0.10)


def test_latest_percentile_excludes_current_observation() -> None:
    values = pd.Series([1.0, 2.0, 3.0, 4.0])

    assert latest_causal_percentile(values, minimum_observations=3) == 1.0
    assert math.isnan(latest_causal_percentile(values.iloc[:3], minimum_observations=3))


def test_macro_snapshot_switches_to_successor_dollar_series_without_future_data() -> None:
    dates = [pd.Timestamp("2019-01-31"), pd.Timestamp("2019-02-28")]
    history_index = pd.date_range("2014-01-01", periods=1_300, freq="B")

    def series(start: float, step: float) -> pd.Series:
        return pd.Series(
            [start + step * index for index in range(len(history_index))],
            index=history_index,
            dtype="float64",
        )

    dff = {item: series(0.1, 0.001) for item in dates}
    vix = {item: series(10.0, 0.002) for item in dates}
    legacy = {dates[0]: series(90.0, 0.01)}
    successor = {dates[1]: series(200.0, -0.01)}

    snapshots = build_macro_snapshots(dates, dff, legacy, successor, vix)

    assert len(snapshots) == 2
    assert snapshots.loc[dates[0], "broadDollar12mReturn"] > 0
    assert snapshots.loc[dates[1], "broadDollar12mReturn"] < 0
    assert snapshots["compositeStress"].notna().all()


def test_macro_rule_only_changes_research_exposure_targets() -> None:
    snapshots = pd.DataFrame(
        {"compositeStress": [0.69, 0.70, math.nan]},
        index=pd.to_datetime(["2024-01-31", "2024-02-29", "2024-03-31"]),
    )
    rule = MacroRiskRule("compositeStress", 0.70, 0.50)

    targets = rule_targets(snapshots, rule)

    assert targets.iloc[0] == 1.0
    assert targets.iloc[1] == 0.5
    assert math.isnan(targets.iloc[2])


def test_quarterly_signal_dates_use_each_quarters_last_trading_day() -> None:
    index = pd.bdate_range("2024-01-01", "2024-12-31")

    dates = last_trading_day_each_quarter(index)

    assert dates == [
        pd.Timestamp("2024-03-29"),
        pd.Timestamp("2024-06-28"),
        pd.Timestamp("2024-09-30"),
        pd.Timestamp("2024-12-31"),
    ]
