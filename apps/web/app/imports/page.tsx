"use client";

import type {
  AccountView,
  ImportBatchDetail,
  ImportBatchSummary,
  ImportRecordView,
} from "@xichu-risk/shared";
import {
  AlertTriangle,
  CheckCircle2,
  FileSearch,
  FileUp,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";

import { PageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { fetchWithFallback, patchJson, postJson, type DataSource } from "@/lib/api-client";
import { formatCurrency } from "@/lib/formatters";
import { mockAccount } from "@/lib/mock-data";

const recordTypeOptions = [
  ["TRADE", "买入/卖出"],
  ["POSITION", "持仓"],
  ["COMMISSION", "手续费"],
  ["DIVIDEND", "股息"],
  ["WITHHOLDING_TAX", "预扣税"],
  ["INTEREST", "利息"],
  ["DEPOSIT", "入金"],
  ["WITHDRAWAL", "出金"],
  ["CASH_BALANCE", "现金余额"],
  ["FX_TRANSACTION", "外汇交易"],
  ["CORPORATE_ACTION", "公司行动/拆分"],
  ["NAV_SNAPSHOT", "账户净值"],
] as const;

type CorrectionState = {
  recordType: string;
  symbol: string;
  transactionDate: string;
  currency: string;
  action: string;
  quantity: string;
  price: string;
  currentPrice: string;
  amount: string;
  commission: string;
  realizedPnl: string;
  costBasis: string;
  marketValue: string;
  fxRateToBase: string;
  corporateActionType: string;
  splitRatio: string;
  resolutionNote: string;
};

const emptyCorrection: CorrectionState = {
  recordType: "TRADE",
  symbol: "",
  transactionDate: "",
  currency: "USD",
  action: "BUY",
  quantity: "",
  price: "",
  currentPrice: "",
  amount: "",
  commission: "",
  realizedPnl: "",
  costBasis: "",
  marketValue: "",
  fxRateToBase: "",
  corporateActionType: "",
  splitRatio: "",
  resolutionNote: "",
};

export default function ImportsPage() {
  const [accounts, setAccounts] = useState<AccountView[]>([mockAccount]);
  const [accountId, setAccountId] = useState(mockAccount.id);
  const [batches, setBatches] = useState<ImportBatchSummary[]>([]);
  const [batch, setBatch] = useState<ImportBatchDetail | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<DataSource>("mock");
  const [phase, setPhase] = useState<
    "idle" | "reading" | "previewing" | "confirming" | "rolling-back" | "done"
  >("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [editingRecord, setEditingRecord] = useState<ImportRecordView | null>(null);
  const [correction, setCorrection] = useState<CorrectionState>(emptyCorrection);

  async function loadWorkspace() {
    const [accountResult, batchResult] = await Promise.all([
      fetchWithFallback<AccountView[]>("/accounts", [mockAccount]),
      fetchWithFallback<ImportBatchSummary[]>("/imports", []),
    ]);
    setAccounts(accountResult.data);
    setSource(accountResult.source === "api" && batchResult.source === "api" ? "api" : "mock");
    setBatches(batchResult.data);
    if (!accountResult.data.some((account) => account.id === accountId)) {
      setAccountId(accountResult.data[0]?.id ?? mockAccount.id);
    }
  }

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetchWithFallback<AccountView[]>("/accounts", [mockAccount]),
      fetchWithFallback<ImportBatchSummary[]>("/imports", []),
    ]).then(([accountResult, batchResult]) => {
      if (!active) return;
      setAccounts(accountResult.data);
      setSource(accountResult.source === "api" && batchResult.source === "api" ? "api" : "mock");
      setBatches(batchResult.data);
      if (!accountResult.data.some((account) => account.id === mockAccount.id)) {
        setAccountId(accountResult.data[0]?.id ?? mockAccount.id);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const pendingRecords = useMemo(
    () => batch?.records.filter((record) => record.status === "PENDING") ?? [],
    [batch],
  );

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setBatch(null);
    setError("");
    setMessage(selected ? `已选择 ${selected.name}，等待解析预览。` : "");
    setProgress(0);
    setPhase("idle");
  }

  async function previewFile() {
    if (!file) {
      setError("请先选择 IBKR CSV 文件");
      return;
    }
    if (file.size > 20_000_000) {
      setError("文件超过 20 MB，请缩小报表日期范围后重试");
      return;
    }
    setError("");
    setMessage("正在读取本地 CSV，不会在确认前修改账户数据。 ");
    setPhase("reading");
    setProgress(20);
    try {
      const content = await file.text();
      setPhase("previewing");
      setProgress(55);
      const result = await postJson<ImportBatchDetail>("/imports/preview", {
        accountId,
        fileName: file.name,
        content,
      });
      setBatch(result);
      setSource("api");
      setProgress(100);
      setPhase("done");
      setMessage(result.result.message ?? "解析完成，请核对预览结果后确认导入。");
      await loadWorkspace();
    } catch (caught) {
      setPhase("idle");
      setProgress(0);
      setError(errorText(caught));
    }
  }

  async function confirmImport() {
    if (!batch) return;
    setError("");
    setMessage("正在事务导入并重算账户、持仓、权益曲线和风控结果……");
    setPhase("confirming");
    setProgress(45);
    try {
      const result = await postJson<ImportBatchDetail>(`/imports/${batch.id}/confirm`);
      setBatch(result);
      setProgress(100);
      setPhase("done");
      setMessage(result.result.message ?? "导入完成。");
      window.dispatchEvent(new CustomEvent("xichu:data-updated"));
      await loadWorkspace();
    } catch (caught) {
      setPhase("idle");
      setProgress(0);
      setError(errorText(caught));
    }
  }

  async function rollbackImport(batchId: string) {
    if (!window.confirm("确认撤销这个导入批次？系统将恢复导入前的账户和持仓快照。")) return;
    setError("");
    setMessage("正在事务回滚并恢复风控结果……");
    setPhase("rolling-back");
    setProgress(45);
    try {
      const result = await postJson<ImportBatchDetail>(`/imports/${batchId}/rollback`);
      if (batch?.id === batchId) setBatch(result);
      setProgress(100);
      setPhase("done");
      setMessage("批次已撤销，账户、持仓、权益快照和风险报警已恢复。");
      window.dispatchEvent(new CustomEvent("xichu:data-updated"));
      await loadWorkspace();
    } catch (caught) {
      setPhase("idle");
      setProgress(0);
      setError(errorText(caught));
    }
  }

  async function openBatch(batchId: string) {
    const result = await fetchWithFallback<ImportBatchDetail | null>(`/imports/${batchId}`, null);
    if (result.data) {
      setBatch(result.data);
      setSource(result.source);
      setMessage(`已打开批次 ${result.data.fileName}`);
      setError("");
    }
  }

  function startCorrection(record: ImportRecordView) {
    setEditingRecord(record);
    setCorrection({
      recordType: record.recordType === "UNKNOWN" ? "TRADE" : record.recordType,
      symbol: record.symbol ?? "",
      transactionDate: record.transactionDate?.slice(0, 10) ?? "",
      currency: record.currency ?? "USD",
      action: record.action ?? "BUY",
      quantity: numberInput(record.quantity),
      price: numberInput(record.price),
      currentPrice: numberInput(record.normalized.currentPrice),
      amount: numberInput(record.amount),
      commission: numberInput(record.commission),
      realizedPnl: numberInput(record.realizedPnl),
      costBasis: numberInput(record.normalized.costBasis),
      marketValue: numberInput(record.normalized.marketValue),
      fxRateToBase: numberInput(record.normalized.fxRateToBase),
      corporateActionType: record.normalized.corporateActionType ?? "",
      splitRatio: numberInput(record.normalized.splitRatio),
      resolutionNote: "",
    });
  }

  async function saveCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!batch || !editingRecord) return;
    setError("");
    try {
      const payload = Object.fromEntries(
        Object.entries(correction).map(([key, value]) => [
          key,
          numericCorrectionFields.has(key) && value !== "" ? Number(value) : value || undefined,
        ]),
      );
      const result = await patchJson<ImportBatchDetail>(
        `/imports/${batch.id}/records/${editingRecord.id}`,
        payload,
      );
      setBatch(result);
      setEditingRecord(null);
      setCorrection(emptyCorrection);
      setMessage("待确认记录已重新校验，请继续处理剩余记录。");
    } catch (caught) {
      setError(errorText(caught));
    }
  }

  const busy = ["reading", "previewing", "confirming", "rolling-back"].includes(phase);

  return (
    <>
      <PageHeader
        description={`IBKR Activity Statement CSV · 预览、校验、去重、事务导入与可撤销批次 · ${source === "api" ? "SQL Server" : "Mock fallback"}`}
        title="数据导入"
      />

      <div className="import-step-strip" aria-label="导入流程">
        <span className={batch ? "is-complete" : "is-active"}>1 选择文件</span>
        <span
          className={batch && batch.status === "PREVIEW" ? "is-active" : batch ? "is-complete" : ""}
        >
          2 解析预览
        </span>
        <span className={batch?.pendingRecords ? "is-warning" : batch ? "is-complete" : ""}>
          3 字段校验
        </span>
        <span className={batch?.status === "COMPLETED" ? "is-complete" : ""}>4 确认导入</span>
        <span className={batch?.status === "COMPLETED" ? "is-complete" : ""}>5 风控重算</span>
      </div>

      <div className="import-layout">
        <section className="import-upload-card">
          <div className="form-section-title">
            <h2>上传 IBKR CSV</h2>
            <p>选择文件只做解析预览，点击“确认导入”后才会在一个数据库事务中记账。</p>
          </div>
          <label className="import-account-field">
            <span>导入到系统账户</span>
            <select
              disabled={busy}
              onChange={(event) => setAccountId(event.target.value)}
              value={accountId}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} · {account.baseCurrency}
                  {account.brokerAccountId
                    ? ` · ${account.brokerAccountId}`
                    : " · 尚未绑定 IBKR 账户号"}
                </option>
              ))}
            </select>
          </label>
          <label className="file-dropzone">
            <UploadCloud aria-hidden="true" size={30} />
            <strong>{file ? file.name : "选择 IBKR Activity Statement CSV"}</strong>
            <span>
              {file
                ? `${formatFileSize(file.size)} · 本地读取`
                : "支持传统 Activity Statement 与 Activity Flex Query CSV，最大 20 MB"}
            </span>
            <input accept=".csv,text/csv" disabled={busy} onChange={chooseFile} type="file" />
          </label>
          <div className="import-upload-actions">
            <button
              className="primary-button"
              disabled={!file || busy || source === "mock"}
              onClick={previewFile}
              type="button"
            >
              {phase === "reading" || phase === "previewing" ? (
                <RefreshCw className="spin" size={15} />
              ) : (
                <FileSearch size={15} />
              )}
              解析并预览
            </button>
            <span>
              {source === "mock"
                ? "API 未连接：可以查看页面，但不会伪造导入结果。"
                : "正式导入前不会改动交易、持仓或账户数据。"}
            </span>
          </div>
        </section>

        <aside className="import-guidance">
          <ShieldCheck aria-hidden="true" size={24} />
          <h2>受控导入原则</h2>
          <ul>
            <li>Trade ID、Execution ID 或业务哈希保证重复文件不重复记账。</li>
            <li>外币缺少 FX Rate、拆分比例不明确或类型未知时进入待确认。</li>
            <li>确认时批量写入；账户、持仓、快照或风控任一步失败会整体回滚。</li>
            <li>已完成批次可追踪并按最新批次优先顺序撤销。</li>
          </ul>
        </aside>
      </div>

      {(busy || message || error) && (
        <section className={["import-progress", error ? "import-progress--error" : ""].join(" ")}>
          <div>
            {error ? (
              <AlertTriangle size={17} />
            ) : progress === 100 ? (
              <CheckCircle2 size={17} />
            ) : (
              <RefreshCw className="spin" size={17} />
            )}
            <strong>{error || message}</strong>
          </div>
          <span>
            <i style={{ width: `${progress}%` }} />
          </span>
        </section>
      )}

      {batch && (
        <>
          <section className="import-preview-header">
            <div>
              <FileUp size={20} />
              <span>
                <small>当前预览批次</small>
                <strong>{batch.fileName}</strong>
              </span>
            </div>
            <div
              className={`account-match account-match--${String(batch.result.matchStatus ?? "MISSING").toLowerCase()}`}
            >
              <small>账户匹配</small>
              <strong>{matchLabel(batch.result.matchStatus)}</strong>
              <span>{batch.result.message}</span>
            </div>
            <div className="import-preview-actions">
              <span className={`import-status import-status--${batch.status.toLowerCase()}`}>
                {batchStatusLabel(batch.status)}
              </span>
              {batch.status === "PREVIEW" || batch.status === "FAILED" ? (
                <button
                  className="primary-button"
                  disabled={busy || batch.pendingRecords > 0}
                  onClick={confirmImport}
                  type="button"
                >
                  <ShieldCheck size={15} />
                  确认导入
                </button>
              ) : null}
            </div>
          </section>

          <div className="import-stat-grid">
            <article>
              <span>文件记录</span>
              <strong>{batch.totalRecords}</strong>
              <small>可识别财务数据行</small>
            </article>
            <article className="is-success">
              <span>校验通过</span>
              <strong>{batch.validRecords}</strong>
              <small>等待确认写入</small>
            </article>
            <article className={batch.pendingRecords ? "is-warning" : ""}>
              <span>待确认</span>
              <strong>{batch.pendingRecords}</strong>
              <small>必须人工修正</small>
            </article>
            <article>
              <span>重复记录</span>
              <strong>{batch.duplicateRecords}</strong>
              <small>自动跳过不记账</small>
            </article>
            <article className="is-success">
              <span>已导入</span>
              <strong>{batch.importedRecords}</strong>
              <small>事务提交记录</small>
            </article>
            <article>
              <span>报表区间</span>
              <strong className="import-stat-date">{dateRange(batch)}</strong>
              <small>{batch.statementAccountId ?? "未提供账户号"}</small>
            </article>
          </div>

          {pendingRecords.length > 0 && (
            <Panel
              description="这些数据不会被静默丢弃；必须明确修正为系统记录后才能确认导入。"
              title={`待确认记录 · ${pendingRecords.length}`}
            >
              <div className="pending-record-list">
                {pendingRecords.map((record) => (
                  <button
                    className={editingRecord?.id === record.id ? "is-active" : ""}
                    key={record.id}
                    onClick={() => startCorrection(record)}
                    type="button"
                  >
                    <span>
                      <strong>
                        第 {record.sourceRow} 行 · {record.sourceSection}
                      </strong>
                      <small>
                        {record.symbol ?? record.normalized.description ?? "未识别记录"}
                      </small>
                    </span>
                    <em>{record.validationErrors.join("；")}</em>
                    <b>人工修正</b>
                  </button>
                ))}
              </div>
              {editingRecord && (
                <form className="record-correction-form" onSubmit={saveCorrection}>
                  <div className="form-section-title">
                    <h2>修正第 {editingRecord.sourceRow} 行</h2>
                    <p>只填写可靠信息；系统会再次执行字段、账户、币种及业务规则校验。</p>
                  </div>
                  <div className="record-correction-grid">
                    <CorrectionSelect
                      label="记录类型"
                      name="recordType"
                      options={recordTypeOptions}
                      state={correction}
                      setState={setCorrection}
                    />
                    <CorrectionInput
                      label="股票代码"
                      name="symbol"
                      state={correction}
                      setState={setCorrection}
                    />
                    <CorrectionInput
                      label="日期"
                      name="transactionDate"
                      state={correction}
                      setState={setCorrection}
                      type="date"
                    />
                    <CorrectionInput
                      label="币种"
                      name="currency"
                      state={correction}
                      setState={setCorrection}
                    />
                    <CorrectionSelect
                      label="方向"
                      name="action"
                      options={[
                        ["BUY", "买入"],
                        ["SELL", "卖出"],
                      ]}
                      state={correction}
                      setState={setCorrection}
                    />
                    <CorrectionInput
                      label="数量"
                      name="quantity"
                      state={correction}
                      setState={setCorrection}
                      type="number"
                    />
                    <CorrectionInput
                      label="成交价"
                      name="price"
                      state={correction}
                      setState={setCorrection}
                      type="number"
                    />
                    <CorrectionInput
                      label="当前价"
                      name="currentPrice"
                      state={correction}
                      setState={setCorrection}
                      type="number"
                    />
                    <CorrectionInput
                      label="金额"
                      name="amount"
                      state={correction}
                      setState={setCorrection}
                      type="number"
                    />
                    <CorrectionInput
                      label="手续费"
                      name="commission"
                      state={correction}
                      setState={setCorrection}
                      type="number"
                    />
                    <CorrectionInput
                      label="已实现盈亏"
                      name="realizedPnl"
                      state={correction}
                      setState={setCorrection}
                      type="number"
                    />
                    <CorrectionInput
                      label="成本基础"
                      name="costBasis"
                      state={correction}
                      setState={setCorrection}
                      type="number"
                    />
                    <CorrectionInput
                      label="当前市值"
                      name="marketValue"
                      state={correction}
                      setState={setCorrection}
                      type="number"
                    />
                    <CorrectionInput
                      label="汇率到基础币"
                      name="fxRateToBase"
                      state={correction}
                      setState={setCorrection}
                      type="number"
                    />
                    <CorrectionInput
                      label="公司行动类型"
                      name="corporateActionType"
                      state={correction}
                      setState={setCorrection}
                    />
                    <CorrectionInput
                      label="拆分比例"
                      name="splitRatio"
                      state={correction}
                      setState={setCorrection}
                      type="number"
                    />
                    <label className="correction-note">
                      <span>修正依据</span>
                      <textarea
                        required
                        rows={3}
                        value={correction.resolutionNote}
                        onChange={(event) =>
                          setCorrection((current) => ({
                            ...current,
                            resolutionNote: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div className="record-correction-actions">
                    <button className="primary-button" type="submit">
                      保存并重新校验
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => setEditingRecord(null)}
                      type="button"
                    >
                      取消
                    </button>
                  </div>
                </form>
              )}
            </Panel>
          )}

          <Panel
            description="预览记录同时展示类型、去重状态、关键字段和失败原因。"
            title="解析记录"
          >
            <div className="table-scroll import-record-table">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>行</th>
                    <th>类型</th>
                    <th>状态</th>
                    <th>日期</th>
                    <th>代码/说明</th>
                    <th>方向</th>
                    <th className="number-cell">数量</th>
                    <th className="number-cell">价格</th>
                    <th className="number-cell">金额</th>
                    <th>校验结果</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.records.map((record) => (
                    <tr key={record.id}>
                      <td className="mono">{record.sourceRow}</td>
                      <td>{recordTypeLabel(record.recordType)}</td>
                      <td>
                        <span
                          className={`import-record-status import-record-status--${record.status.toLowerCase()}`}
                        >
                          {recordStatusLabel(record.status)}
                        </span>
                      </td>
                      <td>{record.transactionDate?.slice(0, 10) ?? "—"}</td>
                      <td>
                        <strong className="symbol">{record.symbol ?? "—"}</strong>
                        <small className="table-subtext">{record.normalized.description}</small>
                      </td>
                      <td>{record.action ?? "—"}</td>
                      <td className="number-cell mono">{record.quantity ?? "—"}</td>
                      <td className="number-cell mono">
                        {record.price === null ? "—" : formatCurrency(record.price)}
                      </td>
                      <td className="number-cell mono">
                        {record.amount === null ? "—" : formatCurrency(record.amount)}
                      </td>
                      <td
                        className={
                          record.validationErrors.length ? "import-error-cell" : "import-ok-cell"
                        }
                      >
                        {record.validationErrors.length
                          ? record.validationErrors.join("；")
                          : record.status === "DUPLICATE"
                            ? "已存在，跳过"
                            : "字段通过"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {batch.status === "COMPLETED" && (
            <section className="import-result-banner">
              <CheckCircle2 size={22} />
              <div>
                <strong>导入及风控重算已完成</strong>
                <span>
                  账户权益 {formatOptionalCurrency(batch.result.totalEquity)} · 现金{" "}
                  {formatOptionalCurrency(batch.result.cashBalance)} · 风险等级{" "}
                  {batch.result.riskLevel ?? "—"} · 报警 {batch.result.riskAlertCount ?? 0} 条
                </span>
              </div>
              <div>
                <Link href="/">查看首页</Link>
                <Link href="/positions">查看持仓</Link>
                <Link href="/risk">查看风控</Link>
              </div>
            </section>
          )}
        </>
      )}

      <Panel
        description="每次预览、确认、失败和撤销都有独立批次记录；撤销采用最新批次优先，避免覆盖后续账务。"
        title="导入批次记录"
      >
        {batches.length === 0 ? (
          <div className="import-empty">
            <FileUp size={24} />
            <strong>还没有导入批次</strong>
            <span>上传 CSV 并完成预览后，批次会显示在这里。</span>
          </div>
        ) : (
          <div className="batch-list">
            {batches.map((item) => (
              <article key={item.id}>
                <button className="batch-main" onClick={() => openBatch(item.id)} type="button">
                  <span>
                    <strong>{item.fileName}</strong>
                    <small>
                      {new Date(item.createdAt).toLocaleString("zh-CN")} ·{" "}
                      {item.statementAccountId ?? "未提供账户号"}
                    </small>
                  </span>
                  <em>
                    {item.importedRecords} 导入 / {item.duplicateRecords} 重复 /{" "}
                    {item.pendingRecords} 待确认
                  </em>
                  <b className={`import-status import-status--${item.status.toLowerCase()}`}>
                    {batchStatusLabel(item.status)}
                  </b>
                </button>
                {item.status === "COMPLETED" ? (
                  <button
                    className="rollback-button"
                    disabled={busy}
                    onClick={() => rollbackImport(item.id)}
                    type="button"
                  >
                    <RotateCcw size={14} />
                    撤销批次
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
}

function CorrectionInput({
  label,
  name,
  state,
  setState,
  type = "text",
}: {
  label: string;
  name: keyof CorrectionState;
  state: CorrectionState;
  setState: (value: React.SetStateAction<CorrectionState>) => void;
  type?: "date" | "number" | "text";
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        step={type === "number" ? "any" : undefined}
        type={type}
        value={state[name]}
        onChange={(event) => setState((current) => ({ ...current, [name]: event.target.value }))}
      />
    </label>
  );
}

function CorrectionSelect({
  label,
  name,
  options,
  state,
  setState,
}: {
  label: string;
  name: keyof CorrectionState;
  options: readonly (readonly [string, string])[];
  state: CorrectionState;
  setState: (value: React.SetStateAction<CorrectionState>) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <select
        value={state[name]}
        onChange={(event) => setState((current) => ({ ...current, [name]: event.target.value }))}
      >
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

const numericCorrectionFields = new Set([
  "quantity",
  "price",
  "currentPrice",
  "amount",
  "commission",
  "realizedPnl",
  "costBasis",
  "marketValue",
  "fxRateToBase",
  "splitRatio",
]);

function numberInput(value: number | null): string {
  return value === null ? "" : String(value);
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请查看后端日志";
}
function formatFileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
function formatOptionalCurrency(value?: number): string {
  return value === undefined ? "—" : formatCurrency(value);
}
function dateRange(batch: ImportBatchSummary): string {
  return `${batch.statementStart?.slice(0, 10) ?? "未知"} → ${batch.statementEnd?.slice(0, 10) ?? "未知"}`;
}
function matchLabel(status?: string): string {
  return (
    (
      {
        EXACT: "精确匹配",
        UNBOUND: "首次绑定",
        MISSING: "手动选择",
        MISMATCH: "账户不一致",
        MULTIPLE: "多账户文件",
      } as Record<string, string>
    )[status ?? ""] ?? "待核对"
  );
}
function batchStatusLabel(status: string): string {
  return (
    (
      {
        PREVIEW: "等待确认",
        IMPORTING: "导入中",
        COMPLETED: "已完成",
        FAILED: "失败已回滚",
        ROLLED_BACK: "已撤销",
      } as Record<string, string>
    )[status] ?? status
  );
}
function recordStatusLabel(status: string): string {
  return (
    (
      {
        VALID: "有效",
        PENDING: "待确认",
        DUPLICATE: "重复",
        IMPORTED: "已导入",
        FAILED: "失败",
        ROLLED_BACK: "已撤销",
      } as Record<string, string>
    )[status] ?? status
  );
}
function recordTypeLabel(type: string): string {
  return Object.fromEntries(recordTypeOptions)[type] ?? type;
}
