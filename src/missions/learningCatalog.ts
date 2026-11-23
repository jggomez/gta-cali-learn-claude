/**
 * "Aprender jugando": maps every learning mechanic in the game to a real lesson of the free
 * AcaDevHack courses (Claude Code desde cero / Claude para todos). Pure data + link builders;
 * Spanish copy for each key lives in LOCALE_DEVHACK.learning (src/config/localeCali.ts).
 */

export type CourseId = 'claude-code-desde-cero' | 'claude-para-todos';

export type LessonKey =
  | 'cc_agentic_loop'
  | 'cc_commands'
  | 'cc_claude_md'
  | 'cc_plan_mode'
  | 'cc_context'
  | 'cc_permissions_hooks'
  | 'cc_mcp'
  | 'cc_skills'
  | 'cc_subagents'
  | 'cpt_prompt_4'
  | 'cpt_files'
  | 'cpt_artifacts'
  | 'cpt_projects'
  | 'cpt_privacy';

export interface LessonRef {
  readonly courseId: CourseId;
  /** Course-player session id (the Claude Code course's ids do not follow lesson order). */
  readonly sessionId: string;
  /** 1-based lesson number as shown in the course syllabus. */
  readonly lessonNumber: number;
}

export const LESSONS: Readonly<Record<LessonKey, LessonRef>> = {
  cc_agentic_loop: { courseId: 'claude-code-desde-cero', sessionId: 's1', lessonNumber: 1 },
  cc_commands: { courseId: 'claude-code-desde-cero', sessionId: 's2', lessonNumber: 2 },
  cc_claude_md: { courseId: 'claude-code-desde-cero', sessionId: 's3', lessonNumber: 3 },
  cc_plan_mode: { courseId: 'claude-code-desde-cero', sessionId: 's4', lessonNumber: 4 },
  cc_context: { courseId: 'claude-code-desde-cero', sessionId: 's5', lessonNumber: 5 },
  cc_permissions_hooks: { courseId: 'claude-code-desde-cero', sessionId: 's6', lessonNumber: 6 },
  cc_mcp: { courseId: 'claude-code-desde-cero', sessionId: 's7', lessonNumber: 7 },
  cc_skills: { courseId: 'claude-code-desde-cero', sessionId: 's11', lessonNumber: 8 },
  cc_subagents: { courseId: 'claude-code-desde-cero', sessionId: 's9', lessonNumber: 9 },
  cpt_prompt_4: { courseId: 'claude-para-todos', sessionId: 's2', lessonNumber: 2 },
  cpt_files: { courseId: 'claude-para-todos', sessionId: 's3', lessonNumber: 3 },
  cpt_artifacts: { courseId: 'claude-para-todos', sessionId: 's4', lessonNumber: 4 },
  cpt_projects: { courseId: 'claude-para-todos', sessionId: 's5', lessonNumber: 5 },
  cpt_privacy: { courseId: 'claude-para-todos', sessionId: 's8', lessonNumber: 8 },
};

const SITE = 'https://devhack.co';

export interface LessonLinks {
  /** Public course landing page (no login). */
  readonly courseUrl: string;
  /** Free signup for the course (no login). */
  readonly signupUrl: string;
  /** Exact lesson inside the course player (requires a logged-in student). */
  readonly lessonUrl: string;
}

export function lessonLinks(key: LessonKey): LessonLinks {
  const lesson = LESSONS[key];
  return {
    courseUrl: `${SITE}/academy-ai/${lesson.courseId}/`,
    signupUrl: `${SITE}/acadevhack-virtual/registro/?curso=${lesson.courseId}`,
    lessonUrl: `${SITE}/acadevhack-virtual/player/?id=${lesson.courseId}&session=${lesson.sessionId}`,
  };
}

/** The ten hidden "Cartas Claude" collectibles, one per lesson (ids match claudeCardSpots.ts). */
export const CLAUDE_CARD_LESSONS = {
  card_agentic_loop: 'cc_agentic_loop',
  card_claude_md: 'cc_claude_md',
  card_plan_mode: 'cc_plan_mode',
  card_context: 'cc_context',
  card_hooks: 'cc_permissions_hooks',
  card_mcp: 'cc_mcp',
  card_subagents: 'cc_subagents',
  card_skills: 'cc_skills',
  card_prompt_4: 'cpt_prompt_4',
  card_artifacts: 'cpt_artifacts',
} as const satisfies Record<string, LessonKey>;

export type ClaudeCardKey = keyof typeof CLAUDE_CARD_LESSONS;

export const CLAUDE_CARD_KEYS = Object.keys(CLAUDE_CARD_LESSONS) as ClaudeCardKey[];

/** One-shot learning toasts keyed by the mechanic that triggers them. */
export type LearningTipId =
  | 'tip_rewind'
  | 'tip_clear_spray'
  | 'tip_hook_nitro'
  | 'tip_plan_mode'
  | 'tip_first_card'
  | 'tip_all_cards'
  | 'tip_hack';

export const TIP_LESSONS: Readonly<Record<LearningTipId, LessonKey>> = {
  tip_rewind: 'cc_context',
  tip_clear_spray: 'cc_context',
  tip_hook_nitro: 'cc_permissions_hooks',
  tip_plan_mode: 'cc_plan_mode',
  tip_first_card: 'cc_agentic_loop',
  tip_all_cards: 'cc_skills',
  tip_hack: 'cc_commands',
};
