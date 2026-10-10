"use client";

import type { ReviewRecord } from "@xichu-risk/shared";
import { useEffect, useState, type FormEvent } from "react";

import { PageHeader } from "@/components/page-header";
import { fetchWithFallback, postJson, type DataSource } from "@/lib/api-client";
import { mockReviews } from "@/lib/mock-data";

export default function ReviewsPage() {
  const [records, setRecords] = useState<ReviewRecord[]>(mockReviews);
  const [source, setSource] = useState<DataSource>("mock");
  const [title, setTitle] = useState("");
  const [symbol, setSymbol] = useState("");
  const [mistakeType, setMistakeType] = useState("OVER_POSITION");
  const [summary, setSummary] = useState("");
  const [lesson, setLesson] = useState("");
  const [actionRule, setActionRule] = useState("");

  useEffect(() => {
    let active = true;
    void fetchWithFallback<ReviewRecord[]>("/reviews", mockReviews).then((result) => {
      if (!active) return;
      setRecords(result.data);
      setSource(result.source);
    });
    return () => {
      active = false;
    };
  }, []);

  async function addReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let record: ReviewRecord;
    try {
      record = await postJson<ReviewRecord>("/reviews", {
        actionRule,
        lesson,
        mistakeType,
        summary,
        symbol,
        title,
      });
      setSource("api");
    } catch {
      record = {
        actionRule,
        id: String(Date.now()),
        lesson,
        mistakeType,
        summary,
        symbol: symbol.toUpperCase(),
        title,
      };
      setSource("mock");
    }
    setRecords((current) => [record, ...current]);
    setTitle("");
    setSymbol("");
    setSummary("");
    setLesson("");
    setActionRule("");
  }

  return (
    <>
      <PageHeader
        description={`把一次错误转化为以后必须遵守的明确规则 · ${source === "api" ? "SQL Server 持久化" : "Mock fallback"}`}
        title="交易复盘"
      />

      <div className="reviews-layout">
        <form className="business-form" onSubmit={addReview}>
          <div className="form-section-title">
            <h2>新增复盘记录</h2>
            <p>API 可用时保存到 SQL Server，断开时保留本地 fallback。</p>
          </div>
          <div className="form-grid">
            <label>
              <span>标题</span>
              <input onChange={(event) => setTitle(event.target.value)} required value={title} />
            </label>
            <label>
              <span>股票代码</span>
              <input onChange={(event) => setSymbol(event.target.value)} required value={symbol} />
            </label>
            <label className="form-field--wide">
              <span>错误类型</span>
              <select onChange={(event) => setMistakeType(event.target.value)} value={mistakeType}>
                <option value="OVER_POSITION">仓位过重</option>
                <option value="LEVERAGED_ETF_ABUSE">滥用杠杆 ETF</option>
                <option value="NO_STOP_LOSS">没有止损</option>
                <option value="EMOTIONAL_TRADING">情绪化交易</option>
                <option value="OVER_CONCENTRATION">主题过度集中</option>
              </select>
            </label>
            <label className="form-field--wide">
              <span>总结</span>
              <textarea
                onChange={(event) => setSummary(event.target.value)}
                required
                rows={3}
                value={summary}
              />
            </label>
            <label className="form-field--wide">
              <span>教训</span>
              <textarea
                onChange={(event) => setLesson(event.target.value)}
                required
                rows={3}
                value={lesson}
              />
            </label>
            <label className="form-field--wide">
              <span>后续规则</span>
              <textarea
                onChange={(event) => setActionRule(event.target.value)}
                required
                rows={3}
                value={actionRule}
              />
            </label>
          </div>
          <button className="primary-button" type="submit">
            保存复盘记录
          </button>
        </form>

        <section className="review-records">
          <div className="form-section-title">
            <h2>复盘记录</h2>
            <p>{records.length} 条记录</p>
          </div>
          {records.map((record) => (
            <article className="review-record" key={record.id}>
              <div>
                <strong>{record.title}</strong>
                <span>{record.symbol}</span>
                <em>{record.mistakeType}</em>
              </div>
              <dl>
                <div>
                  <dt>总结</dt>
                  <dd>{record.summary}</dd>
                </div>
                <div>
                  <dt>教训</dt>
                  <dd>{record.lesson}</dd>
                </div>
                <div>
                  <dt>后续规则</dt>
                  <dd>{record.actionRule}</dd>
                </div>
              </dl>
            </article>
          ))}
        </section>
      </div>
    </>
  );
}
