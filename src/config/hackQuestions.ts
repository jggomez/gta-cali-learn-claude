/**
 * Question bank for the "Hackeo de la tomba" mini-game. Adapted (shortened to three options) from
 * the exams of the free AcaDevHack courses "Claude Code desde cero" and "Claude para todos".
 * Player-facing course content in Spanish and English (same order, same correct answers);
 * `HACK_QUESTIONS` is the bank for the active UI language.
 */

import type { LessonKey } from '../missions/learningCatalog';
import { ACTIVE_LANGUAGE } from './language';

export interface HackQuestion {
  readonly prompt: string;
  readonly options: readonly [string, string, string];
  readonly correctIndex: 0 | 1 | 2;
  readonly lesson: LessonKey;
}

export const HACK_QUESTIONS_ES: readonly HackQuestion[] = [
  {
    prompt: 'La conversación ya está enorme y sigues en el mismo bug. ¿Qué comando la resume?',
    options: ['/compact', '/model', '/help'],
    correctIndex: 0,
    lesson: 'cc_context',
  },
  {
    prompt: 'Terminaste una tarea y arrancas otra distinta. ¿Cómo limpias la conversación?',
    options: ['/rewind', '/clear', '/init'],
    correctIndex: 1,
    lesson: 'cc_context',
  },
  {
    prompt: '¿Qué comando te deja volver atrás las ediciones que hizo Claude?',
    options: ['/compact', '/help', '/rewind'],
    correctIndex: 2,
    lesson: 'cc_context',
  },
  {
    prompt: '¿Dónde va lo que Claude Code debe saber de tu proyecto en cada sesión?',
    options: ['En CLAUDE.md', 'En el chat de ayer', 'En un post-it'],
    correctIndex: 0,
    lesson: 'cc_claude_md',
  },
  {
    prompt: '¿Qué comando crea un CLAUDE.md inicial para tu proyecto?',
    options: ['/clear', '/init', '/model'],
    correctIndex: 1,
    lesson: 'cc_claude_md',
  },
  {
    prompt: '¿Qué hace Claude en modo Plan?',
    options: ['Edita todo de una', 'Borra el repo', 'Propone un plan sin tocar archivos'],
    correctIndex: 2,
    lesson: 'cc_plan_mode',
  },
  {
    prompt: 'El plan de Claude pone el código en lib/ pero tu spec dice src/. ¿Qué haces?',
    options: ['Lo corriges antes de aprobar', 'Apruebas igual', 'Cierras Claude Code'],
    correctIndex: 0,
    lesson: 'cc_plan_mode',
  },
  {
    prompt: 'Claude corre las pruebas y una falla. ¿Qué hace normalmente?',
    options: ['Se rinde', 'Lee el error, ajusta y vuelve a probar', 'Borra la prueba'],
    correctIndex: 1,
    lesson: 'cc_agentic_loop',
  },
  {
    prompt: '¿Qué distingue a Claude Code de un chat donde copias y pegas código?',
    options: ['Solo da consejos', 'Necesita internet lento', 'Lee, edita y corre comandos en tu proyecto'],
    correctIndex: 2,
    lesson: 'cc_agentic_loop',
  },
  {
    prompt: 'En Claude Code, ¿con qué símbolo mencionas un archivo?',
    options: ['@', '#', '$'],
    correctIndex: 0,
    lesson: 'cc_commands',
  },
  {
    prompt: '¿Con qué símbolo corres un comando de terminal dentro de Claude Code?',
    options: ['?', '!', '%'],
    correctIndex: 1,
    lesson: 'cc_commands',
  },
  {
    prompt: 'Quieres que Claude NUNCA lea tu archivo .env. ¿Qué usas?',
    options: ['Pedírselo amablemente', 'Un comentario en el código', 'Una regla de permisos deny'],
    correctIndex: 2,
    lesson: 'cc_permissions_hooks',
  },
  {
    prompt: '¿Qué corre las pruebas solo, siempre, después de cada edición de Claude?',
    options: ['Un hook', 'Un emoji', 'Un /clear'],
    correctIndex: 0,
    lesson: 'cc_permissions_hooks',
  },
  {
    prompt: '¿Qué le da a Claude el servidor MCP de Playwright?',
    options: ['Más memoria RAM', 'Un navegador real para probar tu app', 'Un modelo nuevo'],
    correctIndex: 1,
    lesson: 'cc_mcp',
  },
  {
    prompt: 'Clonas un repo que trae servidores MCP. ¿Qué haces antes de aprobarlos?',
    options: ['Los apruebas todos', 'Reinicias el PC', 'Revisas qué ejecuta cada uno'],
    correctIndex: 2,
    lesson: 'cc_mcp',
  },
  {
    prompt: 'Repites la misma plantilla varias veces por semana. ¿Dónde la guardas?',
    options: ['En una skill', 'En la papelera', 'En un sticker'],
    correctIndex: 0,
    lesson: 'cc_skills',
  },
  {
    prompt: 'En un equipo de subagentes, ¿quién decide que la tarea quedó terminada?',
    options: ['El más rápido', 'Un agente juez que decide con evidencia', 'Nadie'],
    correctIndex: 1,
    lesson: 'cc_subagents',
  },
  {
    prompt: '¿Cuáles son las 4 piezas para pedirle bien a Claude?',
    options: ['Hola, gracias, chao, emoji', 'Rápido, largo, corto, ya', 'Rol, contexto, tarea y formato'],
    correctIndex: 2,
    lesson: 'cpt_prompt_4',
  },
  {
    prompt: '¿Qué cambia más la calidad de una respuesta de Claude?',
    options: ['El contexto que le das', 'Escribir en mayúsculas', 'Preguntar 10 veces'],
    correctIndex: 0,
    lesson: 'cpt_prompt_4',
  },
  {
    prompt: 'Claude te da una cifra muy precisa sin fuente. ¿Qué haces?',
    options: ['La copias tal cual', 'Pides la fuente y la verificas', 'La redondeas'],
    correctIndex: 1,
    lesson: 'cpt_files',
  },
  {
    prompt: 'Subes un PDF y Claude te da 5 puntos clave. ¿Cómo sabes que no inventó?',
    options: ['Confías', 'Le preguntas si inventó', 'Pides la página o cita de cada punto'],
    correctIndex: 2,
    lesson: 'cpt_files',
  },
  {
    prompt: 'Quieres una calculadora que ajustas conversando. ¿Qué función de Claude usas?',
    options: ['Un artifact', 'Un correo', 'Una foto'],
    correctIndex: 0,
    lesson: 'cpt_artifacts',
  },
  {
    prompt: 'Siempre repites tu cargo y tu tono. ¿Qué te ahorra repetirlo?',
    options: ['Un chat nuevo cada vez', 'Un proyecto con instrucciones', 'Escribir más rápido'],
    correctIndex: 1,
    lesson: 'cpt_projects',
  },
  {
    prompt: 'Vas a analizar quejas con nombres y teléfonos. ¿Qué haces primero?',
    options: ['Las subes así', 'Las imprimes', 'Quitas los datos personales'],
    correctIndex: 2,
    lesson: 'cpt_privacy',
  },
];

/** English version of the bank: same order, options and correct answers as the Spanish one. */
export const HACK_QUESTIONS_EN: readonly HackQuestion[] = [
  {
    prompt: 'The chat is huge and you\'re still on the same bug. Which command summarizes it?',
    options: ['/compact', '/model', '/help'],
    correctIndex: 0,
    lesson: 'cc_context',
  },
  {
    prompt: 'You finished a task and start a different one. How do you clear the conversation?',
    options: ['/rewind', '/clear', '/init'],
    correctIndex: 1,
    lesson: 'cc_context',
  },
  {
    prompt: 'Which command lets you undo the edits Claude made?',
    options: ['/compact', '/help', '/rewind'],
    correctIndex: 2,
    lesson: 'cc_context',
  },
  {
    prompt: 'Where does what Claude Code must know about your project go, every session?',
    options: ['In CLAUDE.md', 'In yesterday\'s chat', 'On a sticky note'],
    correctIndex: 0,
    lesson: 'cc_claude_md',
  },
  {
    prompt: 'Which command creates a starter CLAUDE.md for your project?',
    options: ['/clear', '/init', '/model'],
    correctIndex: 1,
    lesson: 'cc_claude_md',
  },
  {
    prompt: 'What does Claude do in Plan mode?',
    options: ['Edits everything at once', 'Deletes the repo', 'Proposes a plan without touching files'],
    correctIndex: 2,
    lesson: 'cc_plan_mode',
  },
  {
    prompt: 'Claude\'s plan puts the code in lib/ but your spec says src/. What do you do?',
    options: ['Correct it before approving', 'Approve anyway', 'Close Claude Code'],
    correctIndex: 0,
    lesson: 'cc_plan_mode',
  },
  {
    prompt: 'Claude runs the tests and one fails. What does it usually do?',
    options: ['Gives up', 'Reads the error, adjusts and tests again', 'Deletes the test'],
    correctIndex: 1,
    lesson: 'cc_agentic_loop',
  },
  {
    prompt: 'What sets Claude Code apart from a chat where you copy and paste code?',
    options: ['It only gives advice', 'It needs slow internet', 'It reads, edits and runs commands in your project'],
    correctIndex: 2,
    lesson: 'cc_agentic_loop',
  },
  {
    prompt: 'In Claude Code, which symbol mentions a file?',
    options: ['@', '#', '$'],
    correctIndex: 0,
    lesson: 'cc_commands',
  },
  {
    prompt: 'Which symbol runs a terminal command inside Claude Code?',
    options: ['?', '!', '%'],
    correctIndex: 1,
    lesson: 'cc_commands',
  },
  {
    prompt: 'You want Claude to NEVER read your .env file. What do you use?',
    options: ['Ask it nicely', 'A code comment', 'A deny permission rule'],
    correctIndex: 2,
    lesson: 'cc_permissions_hooks',
  },
  {
    prompt: 'What runs the tests automatically, always, after every Claude edit?',
    options: ['A hook', 'An emoji', 'A /clear'],
    correctIndex: 0,
    lesson: 'cc_permissions_hooks',
  },
  {
    prompt: 'What does the Playwright MCP server give Claude?',
    options: ['More RAM', 'A real browser to test your app', 'A new model'],
    correctIndex: 1,
    lesson: 'cc_mcp',
  },
  {
    prompt: 'You clone a repo that ships MCP servers. What do you do before approving them?',
    options: ['Approve them all', 'Restart your PC', 'Check what each one runs'],
    correctIndex: 2,
    lesson: 'cc_mcp',
  },
  {
    prompt: 'You repeat the same template several times a week. Where do you keep it?',
    options: ['In a skill', 'In the trash', 'On a sticker'],
    correctIndex: 0,
    lesson: 'cc_skills',
  },
  {
    prompt: 'In a team of subagents, who decides the task is done?',
    options: ['The fastest one', 'A judge agent that decides with evidence', 'Nobody'],
    correctIndex: 1,
    lesson: 'cc_subagents',
  },
  {
    prompt: 'What are the 4 pieces for asking Claude well?',
    options: ['Hi, thanks, bye, emoji', 'Fast, long, short, now', 'Role, context, task and format'],
    correctIndex: 2,
    lesson: 'cpt_prompt_4',
  },
  {
    prompt: 'What changes the quality of a Claude answer the most?',
    options: ['The context you give it', 'Writing in CAPS', 'Asking 10 times'],
    correctIndex: 0,
    lesson: 'cpt_prompt_4',
  },
  {
    prompt: 'Claude gives you a very precise number with no source. What do you do?',
    options: ['Copy it as is', 'Ask for the source and check it', 'Round it'],
    correctIndex: 1,
    lesson: 'cpt_files',
  },
  {
    prompt: 'You upload a PDF and Claude gives you 5 key points. How do you know it didn\'t make them up?',
    options: ['Trust it', 'Ask if it made them up', 'Ask for the page or quote for each point'],
    correctIndex: 2,
    lesson: 'cpt_files',
  },
  {
    prompt: 'You want a calculator you tweak by chatting. Which Claude feature do you use?',
    options: ['An artifact', 'An email', 'A photo'],
    correctIndex: 0,
    lesson: 'cpt_artifacts',
  },
  {
    prompt: 'You always repeat your job title and tone. What saves you repeating it?',
    options: ['A new chat every time', 'A project with instructions', 'Typing faster'],
    correctIndex: 1,
    lesson: 'cpt_projects',
  },
  {
    prompt: 'You\'ll analyze complaints with names and phone numbers. What do you do first?',
    options: ['Upload them as is', 'Print them', 'Remove the personal data'],
    correctIndex: 2,
    lesson: 'cpt_privacy',
  },
];

export const HACK_QUESTIONS: readonly HackQuestion[] =
  ACTIVE_LANGUAGE === 'en' ? HACK_QUESTIONS_EN : HACK_QUESTIONS_ES;
