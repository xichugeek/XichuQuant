import { canonicalSection } from "./ibkr-field-map";
import type { IbkrAdapterResult, IbkrCsvAdapter, IbkrRawRecord } from "./ibkr-adapter";
import { parseStatementPeriod } from "./parser-utils";

export class ActivityStatementAdapter implements IbkrCsvAdapter {
  canParse(rows: string[][]): boolean {
    return rows.some((row) => /^(header|data)$/i.test(row[1] ?? ""));
  }

  parse(rows: string[][]): IbkrAdapterResult {
    const headers = new Map<string, string[]>();
    const records: IbkrRawRecord[] = [];
    const accountIds = new Set<string>();
    let statementStart: string | null = null;
    let statementEnd: string | null = null;
    let ignoredRows = 0;

    rows.forEach((row, index) => {
      const section = canonicalSection(row[0] ?? "");
      const descriptor = (row[1] ?? "").trim().toUpperCase();
      if (descriptor === "HEADER") {
        headers.set(section, row.slice(2));
        return;
      }
      if (descriptor !== "DATA") {
        ignoredRows += 1;
        return;
      }

      const header = headers.get(section);
      if (!header) {
        records.push({
          section,
          sourceRow: index + 1,
          values: Object.fromEntries(
            row.slice(2).map((value, valueIndex) => [`Column ${valueIndex + 1}`, value]),
          ),
        });
        return;
      }

      const values = Object.fromEntries(
        header.map((name, valueIndex) => [name, row[valueIndex + 2] ?? ""]),
      );
      if (section === "ACCOUNT_INFORMATION") {
        const fieldName = values["Field Name"] ?? values[header[0] ?? ""] ?? "";
        const fieldValue = values["Field Value"] ?? values[header[1] ?? ""] ?? "";
        if (/account/i.test(fieldName) && /^[A-Z]{1,3}\d{4,}$/i.test(fieldValue))
          accountIds.add(fieldValue);
        ignoredRows += 1;
        return;
      }
      if (section === "STATEMENT") {
        const periodValue =
          Object.entries(values).find(([key]) => /period/i.test(key))?.[1] ??
          Object.values(values).find((value) => /\s(?:-|to)\s/i.test(value));
        const period = periodValue ? parseStatementPeriod(periodValue) : null;
        if (period) {
          statementStart = period.start;
          statementEnd = period.end;
        }
        ignoredRows += 1;
        return;
      }

      const rowAccountId = Object.entries(values).find(([key]) =>
        /account\s*(?:id|number)?$/i.test(key),
      )?.[1];
      if (rowAccountId && /^[A-Z]{1,3}\d{4,}$/i.test(rowAccountId)) accountIds.add(rowAccountId);
      records.push({ section, sourceRow: index + 1, values });
    });

    const defaultAccountId = accountIds.size === 1 ? [...accountIds][0]! : "";
    if (defaultAccountId) {
      for (const record of records) {
        if (!Object.keys(record.values).some((key) => /account\s*(?:id|number)?$/i.test(key))) {
          record.values["Account ID"] = defaultAccountId;
        }
      }
    }

    return {
      adapter: "ACTIVITY_STATEMENT",
      accountIds: [...accountIds],
      statementStart,
      statementEnd,
      records,
      ignoredRows,
    };
  }
}
