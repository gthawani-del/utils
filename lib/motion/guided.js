import { makeProject, validateProject } from './project.js';

// This is a deterministic questionnaire and storyboard assembler, not an LLM.
// Suggestions are keyword matches for the user to confirm, never inferred facts.
export const PATTERNS = Object.freeze([
  { id: 'problem', label: 'Problem → solution', words: /\b(problem|struggle|struggles|delay|delays|delayed|lost|loses|bottleneck|repair|repairs|complaint|complaints)\b/i, reason: 'Your description mentions a problem or delay.' },
  { id: 'workflow', label: 'Document → workflow', words: /\b(document|agreement|contract|rule|rules|approval|approvals|request|requests|policy|policies|role|roles)\b/i, reason: 'Your description mentions rules, roles or requests.' },
  { id: 'systems', label: 'Connected systems', words: /\b(connect|connected|connection|connections|integrate|integration|systems|services|sync|synchronise|synchronize)\b/i, reason: 'Your description mentions connecting services or systems.' },
  { id: 'knowledge', label: 'Files → organised knowledge', words: /\b(file|files|folder|folders|knowledge|organise|organize|search|notes|documents)\b/i, reason: 'Your description mentions files, knowledge or organisation.' },
  { id: 'voice', label: 'Voice → action', words: /\b(voice|speech|spoken|speak|speaking|microphone|dictate|dictation)\b/i, reason: 'Your description mentions speech or voice.' },
  { id: 'walkthrough', label: 'Product walkthrough', words: /\b(product|app|application|website|screen|screens|demo|feature|features|walkthrough)\b/i, reason: 'Your description mentions a product or interface.' },
  { id: 'comparison', label: 'Before → after', words: /\b(before|after|compare|comparison|versus|vs|old|new|change|changes)\b/i, reason: 'Your description mentions a change or comparison.' },
  { id: 'checklist', label: 'Checklist → outcome', words: /\b(checklist|milestone|milestones|tasks|task|complete|completion|onboarding|steps)\b/i, reason: 'Your description mentions tasks, steps or completion.' },
]);

export function suggestPatterns(description) {
  if (typeof description !== 'string' || !description.trim() || description.length > 220) return [];
  return PATTERNS.filter(pattern => pattern.words.test(description)).map(({ id, label, reason }) => ({ id, label, reason }));
}

const DETAIL = Object.freeze({
  problem: { solution: 'What is your actual solution? Describe only what it really does.', points: ['Current problem', 'Proposed change', 'Desired outcome'] },
  workflow: { solution: 'Which agreement, rule or approval process should become a workflow?', points: ['First role or stage', 'Second role or stage', 'Third role or stage'] },
  systems: { solution: 'What should connect, and what information should move between them?', points: ['First system', 'Second system', 'Third system'] },
  knowledge: { solution: 'How should the supplied files or notes be organised and used?', points: ['Input files', 'Organised category', 'Useful output'] },
  voice: { solution: 'What spoken request should trigger which actual action?', points: ['Spoken request', 'Action to perform', 'Confirmation'] },
  walkthrough: { solution: 'Which actual product capability should the walkthrough demonstrate?', points: ['First screen or action', 'Second screen or action', 'Third screen or action'] },
  comparison: { solution: 'What changes between the before and after states? Use only known differences.', points: ['Before state', 'Actual change', 'After state'] },
  checklist: { solution: 'What process should this checklist help someone complete?', points: ['First task', 'Second task', 'Third task'] },
});

export function questionsFor(templateId = 'problem') {
  const detail = Object.hasOwn(DETAIL, templateId) ? DETAIL[templateId] : DETAIL.problem;
  return [
    { id: 'description', label: 'Your topic or problem', prompt: 'What is happening, and what do you want to explain?', maxLength: 220 },
    { id: 'audience', label: 'Audience', prompt: 'Who should watch this video?', maxLength: 80, choices: ['Customers', 'Team members', 'Residents', 'Committee members', 'Vendors'] },
    { id: 'consequence', label: 'Why it matters', prompt: 'What happens because of this problem, or why does this topic matter? Avoid unverified figures.', maxLength: 220 },
    { id: 'solution', label: 'Your approach', prompt: detail.solution, maxLength: 220 },
    { id: 'points', label: 'Three visual labels', prompt: 'Give the animation three short labels in the order you want them shown.', fields: [...detail.points], maxLength: 40 },
    { id: 'action', label: 'Next action', prompt: 'What should the viewer do next?', maxLength: 220, choices: ['Visit our website', 'Contact us', 'Try the product', 'Submit a request'] },
  ];
}

function validAnswer(value, limit) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
}
export function getMissingQuestions(answers = {}, templateId = answers?.templateId || 'problem') {
  const source = answers && typeof answers === 'object' ? answers : {};
  return questionsFor(templateId).filter(question => question.id === 'points'
    ? !Array.isArray(source.points) || source.points.length !== 3 || source.points.some(point => !validAnswer(point, 40))
    : !validAnswer(source[question.id], question.maxLength));
}

export function validateAnswers(answers) {
  if (!answers || typeof answers !== 'object' || !PATTERNS.some(pattern => pattern.id === answers.templateId)) {
    throw new Error('Choose and confirm a supported story pattern first.');
  }
  const missing = getMissingQuestions(answers);
  if (missing.length) throw new Error(`Review ${missing.map(question => question.label.toLowerCase()).join(', ')}. Complete the answers within the displayed character limits.`);
  return {
    templateId: answers.templateId,
    description: answers.description.trim(), audience: answers.audience.trim(),
    consequence: answers.consequence.trim(), solution: answers.solution.trim(),
    points: answers.points.map(point => point.trim()), action: answers.action.trim(),
  };
}

export function buildGuidedProject(answers, options = {}) {
  const approved = validateAnswers(answers);
  const duration = options.duration ?? 40;
  if (!Number.isFinite(duration) || duration < 10 || duration > 120) throw new Error('Choose 10–120 seconds for a five-scene guided story.');
  const project = makeProject(approved.templateId, {
    title: options.title || 'My guided story', format: options.format || 'vertical', language: options.language || 'en-IN',
  });
  const sections = [
    ['The challenge', approved.description, 'title'],
    ['Why it matters', approved.consequence, 'title'],
    ['The proposed approach', approved.solution, approved.templateId],
    ['How it works', approved.points.join('. ') + '.', approved.templateId],
    ['Your next step', approved.action, 'closing'],
  ];
  project.scenes = sections.map(([title, body, layout], index) => ({
    id: `scene-${index + 1}`, title, body, narration: body, layout,
    duration: duration / sections.length, effect: index === 3 ? 'stagger' : 'reveal',
    image: '', points: [...approved.points],
  }));
  return validateProject(project);
}
