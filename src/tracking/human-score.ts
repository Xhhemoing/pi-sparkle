import type { CountableList, HumanSignal, OptionalScore, ShortRuleBucket } from "./types.js";
import { UNOBSERVED } from "./types.js";

export interface HumanScoreInput {
  readonly userText?: string;
  readonly list?: CountableList;
}

const SHORT_CONFIRM = /^(ok|okay|lgtm|yes|y|行|好|继续|嗯|可以)\s*[.。!！]*$/i;
const REQUIREMENT_ONLY =
  /^(另外|还有|再加|还要|also\b|please also\b|add\b|再补)[\s\S]*$/i;
const NEGATION =
  /不行|拒绝|回滚|rollback|重来|否定|stop|停下|不要|错了|有误|有问题|reject/i;

const TEN_POINT_SLASH = /(?<![0-9.])(\d+(?:\.\d+)?)\s*\/\s*10(?![0-9])/i;
const TEN_POINT_FEN = /(?<![0-9.])(\d+(?:\.\d+)?)\s*分/;

const OPERATION_REJECT =
  /这个(操作|步骤|改动).*(不行|拒绝|不对).{0,12}(计划|方案).*(可以|还行|没问题)|reject this (operation|step|change).{0,24}(plan|方案).*(ok|fine|ok)/i;
const NAMED_ERROR_CONTINUE =
  /(错了|有误|有问题|typo|wrong name).{0,16}(继续|先往下|continue)|named error.{0,16}continue/i;
const WHOLE_REJECT =
  /回滚|rollback|全部(拒绝|否定|重来)|推倒重来|停下来|不要了|reject all|stop\b/i;

export function extractHumanScore(input: HumanScoreInput): HumanSignal {
  const ratio = extractRatio(input.list);
  if (ratio !== undefined) return ratio;

  const text = input.userText?.trim() ?? "";
  if (text === "") return { kind: "unobserved" };
  if (SHORT_CONFIRM.test(text)) return { kind: "unobserved" };
  if (REQUIREMENT_ONLY.test(text) && !NEGATION.test(text)) return { kind: "unobserved" };

  const tenPoint = extractTenPoint(text);
  if (tenPoint !== undefined) return tenPoint;

  const shortRule = extractShortRule(text);
  if (shortRule !== undefined) return shortRule;

  return { kind: "unobserved" };
}

export function hasObviousHumanProblem(signal: HumanSignal): boolean {
  if (signal.kind === "ratio") return signal.agreed < signal.evaluable || signal.safetyRejected;
  if (signal.kind === "ten-point") return signal.mark < 8;
  if (signal.kind === "short-rule") return true;
  return false;
}

export function humanScoreValue(signal: HumanSignal): OptionalScore {
  if (signal.kind === "unobserved") return UNOBSERVED;
  return signal.H;
}

function extractRatio(list: CountableList | undefined): HumanSignal | undefined {
  if (list === undefined || list.items.length === 0) return undefined;
  const evaluable = list.items.length;
  const agreedIds = new Set(list.agreedIds);
  let agreed = 0;
  let safetyRejected = false;
  for (const item of list.items) {
    if (agreedIds.has(item.id)) {
      agreed += 1;
      continue;
    }
    if (item.class === "permission" || item.class === "security") {
      safetyRejected = true;
    }
  }
  return {
    kind: "ratio",
    H: agreed / evaluable,
    agreed,
    evaluable,
    safetyRejected
  };
}

function extractTenPoint(text: string): HumanSignal | undefined {
  const slashMatches = [...text.matchAll(new RegExp(TEN_POINT_SLASH.source, "gi"))];
  const fenMatches = [...text.matchAll(new RegExp(TEN_POINT_FEN.source, "g"))];

  if (slashMatches.length > 1 || fenMatches.length > 1) return undefined;

  const slashMark =
    slashMatches[0]?.[1] !== undefined ? Number(slashMatches[0][1]) : undefined;
  const fenMark = fenMatches[0]?.[1] !== undefined ? Number(fenMatches[0][1]) : undefined;

  if (slashMark !== undefined && fenMark !== undefined && slashMark !== fenMark) {
    return undefined;
  }

  const mark = slashMark ?? fenMark;
  if (mark === undefined || !Number.isFinite(mark) || mark < 0 || mark > 10) return undefined;
  return { kind: "ten-point", H: mark / 10, mark };
}

function extractShortRule(text: string): HumanSignal | undefined {
  if (OPERATION_REJECT.test(text)) return shortRule("operation-reject", 0.35);
  if (NAMED_ERROR_CONTINUE.test(text)) return shortRule("named-error-continue", 0.45);
  if (WHOLE_REJECT.test(text)) return shortRule("whole-reject", 0.15);
  return undefined;
}

function shortRule(bucket: ShortRuleBucket, H: number): HumanSignal {
  return { kind: "short-rule", H, bucket };
}
