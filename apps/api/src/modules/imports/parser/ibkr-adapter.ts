export type IbkrRawRecord = {
  section: string;
  sourceRow: number;
  values: Record<string, string>;
};

export type IbkrAdapterResult = {
  adapter: "ACTIVITY_STATEMENT" | "FLEX_QUERY";
  accountIds: string[];
  statementStart: string | null;
  statementEnd: string | null;
  records: IbkrRawRecord[];
  ignoredRows: number;
};

export interface IbkrCsvAdapter {
  canParse(rows: string[][]): boolean;
  parse(rows: string[][]): IbkrAdapterResult;
}
