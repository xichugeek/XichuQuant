import { z } from "zod";

export const nonEmptyTextSchema = z.string().trim().min(1, "此项不能为空");
export const positiveMoneySchema = z.coerce.number().finite().positive("金额必须大于 0");
export const stockSymbolSchema = z
  .string()
  .trim()
  .min(1, "请输入标的代码")
  .max(16, "标的代码过长")
  .transform((value) => value.toUpperCase());
