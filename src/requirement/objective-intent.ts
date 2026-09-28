/** Deterministic Chinese/English intent signals. These never grant authority. */
export type TestIntent = "required" | "forbidden" | "unspecified";

const ENGLISH_ACTION = /\b(implement|fix|add|refactor|test|review|migrate|integrate|document|investigate|inspect|analyze|analyse|plan|change|update|rename)\b/i;
const CHINESE_ACTION = /修复|实现|添加|新增|重构|测试|审查|迁移|集成|记录|调查|分析|检查|规划|修改|更新|重命名|补充/u;
const CHINESE_WORDS = new Intl.Segmenter("zh", { granularity: "word" });

export function isObjectiveVague(objective: string, namedTargets: readonly string[]): boolean {
  const text = objective.trim();
  const actionText = namedTargets.reduce((value, target) => value.replaceAll(target, " "), text);
  if (!ENGLISH_ACTION.test(actionText) && !CHINESE_ACTION.test(actionText)) return true;
  // A concrete file plus an action need not contain four English words.
  if (namedTargets.length > 0) return false;
  if (text.length < 12) return true;
  const wordCount = /\p{Script=Han}/u.test(text)
    ? [...CHINESE_WORDS.segment(text)].filter((part) => part.isWordLike).length
    : text.split(/\s+/).filter(Boolean).length;
  return wordCount < 4;
}

/** Only explicit no-write directives; a 'read-only endpoint' is a feature. */
export function isReadOnlyObjective(objective: string): boolean {
  return [
    /(?:只|仅)(?:做)?(?:分析|调查|调研|审查|检查|阅读|解释|评审)/u,
    /(?:^|[，。；;:\s])只读(?:模式|检查|分析|调查|审查|阅读|[，。；;:\s]|$)/u,
    /(?:不要|不得|禁止|不允许|不准|不)\s*(?:修改|改动|编辑|写入)\s*(?:(?:任何|所有)?(?:文件|代码|源代码)|工作区|工作目录)/u,
    /(?:不要|不得|禁止|不)\s*(?:修改|改动|写入)\s*(?=[，。；;.!?]|$)/u,
    /\b(?:only\s+(?:investigate|inspect|analy[sz]e|review)|(?:investigation|inspection|analysis|review)[ -]only)\b/i,
    /\b(?:investigate|inspect|analy[sz]e|review)\s+only\b/i,
    /(?:^|[;.!?]\s*)read[- ]only(?:\s+(?:mode|inspection|review))?(?:\s*[:,;.!?]|\s*$)/i,
    /\b(?:in|use)\s+read[- ]only\s+mode\b/i,
    /\b(?:do not|don't|never)\s+(?:write|modify|edit|change)\s+(?:(?:any|the)\s+)?(?:source\s+)?(?:files?|code|workspace)\b/i,
    /\bwithout\s+(?:writing|modifying|editing|changing)\s+(?:(?:any|the)\s+)?(?:source\s+)?(?:files?|code|workspace)\b/i
  ].some((pattern) => pattern.test(objective));
}

export function testIntent(objective: string): TestIntent {
  // 'Do not skip tests' requires tests, unlike 'skip tests'.
  const text = objective.replace(/\b(?:do not|don't|never)\s+skip\s+(?:the\s+)?(?:(?:any|new|additional|existing|unit|integration|regression)\s+)*tests?\b/gi, "require tests");
  // A ban on creating tests does not cancel an explicit run of existing tests.
  const executionScope = text
    .replace(/(?:不要|无需|不需要|不必|禁止|不得|不)\s*(?:再)?(?:添加|新增|增加|补充|编写)(?:任何|相关|额外的?|新的?|单元|集成|回归|自动化|\s)*测试/gu, "")
    .replace(/\b(?:do not|don't|never)\s+(?:add|write)\s+(?:(?:any|new|additional|unit|integration|regression)\s+)*tests?\b/gi, "")
    .replace(/\b(?:no|without)\s+(?:new|additional)\s+tests?\b/gi, "");
  const existingExecution = /\b(?:run|execute)\s+(?:the\s+)?existing\s+(?:(?:unit|integration|regression)\s+)*tests?\b|(?:运行|执行|跑)\s*(?:现有|已有|既有)(?:的|单元|集成|回归|\s)*测试/iu.test(executionScope);
  const scopedText = existingExecution ? executionScope : text;
  const forbidden = [
    /(?:不要|无需|不需要|不必|禁止|不得|不)(?:再)?(?:添加|增加|补充|编写|运行|执行|跑)?(?:任何|相关|额外的?|新的?|现有|已有|既有|的|单元|集成|回归|自动化|\s)*测试/u,
    /\b(?:no|without|skip|omit)\s+(?:(?:any|new|additional|existing|unit|integration|regression)\s+)*(?:tests?|testing)\b(?!\s+(?:failures?|errors?|regressions?))/i,
    /\b(?:do not|don't|never)\s+(?:(?:add|write|run|execute)\s+)?(?:the\s+)?(?:(?:any|new|additional|existing|unit|integration|regression)\s+)*(?:tests?|testing)\b/i
  ].some((pattern) => pattern.test(scopedText));
  if (forbidden) return "forbidden";
  return /\b(tests?|testing|coverage|qa)\b|测试|覆盖率/iu.test(text) ? "required" : "unspecified";
}

/** Stable values plus legacy/localized labels; unknown text is not permission. */
export function isInvestigationAnswer(answer: string | undefined): boolean {
  const value = answer?.trim().toLowerCase() ?? "";
  return ["investigation-only", "investigation only", "read-only", "只读", "仅分析", "只分析", "仅调查", "仅审查"].includes(value)
    || isReadOnlyObjective(value);
}

export function answerRequestsTests(answer: string | undefined): boolean {
  const value = answer?.trim().toLowerCase() ?? "";
  return ["yes", "tests-required", "tests-and-code-change", "tests and a code change", "是", "需要", "需要测试"].includes(value);
}
