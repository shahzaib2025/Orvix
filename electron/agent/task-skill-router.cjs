// Local conservative routing. No provider call, workspace scan, or permission change.
const skills = require('./skill-library.cjs');
const { isReportOnlySteer } = require('./steer-policy.cjs');
const { taskTechnicalSkills } = require('./skill-policy.cjs');
const { freshWebsite } = require('./design-diversity.cjs');
function selectTaskSkills(request, { previousRequest = '', designProfile = 'normal', policy } = {}) {
  const raw = String(request ?? '');
  if (isReportOnlySteer(raw) || /^(?:stop|cancel|pause)(?:\s+(?:now|the task|work))?[.!\s]*$/i.test(raw.trim())) return [];
  // References, quoted examples and pasted code do not become executable task instructions.
  const clean = text => String(text).replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]*)`/g, (_, value) => skills.listSkills().some(s => s.id === value) ? value : ' ')
    .replace(/"[^"\n]*"|“[^”\n]*”|(?<!\w)'[^'\n]*'(?!\w)/g, ' ').replace(/^\s*>.*$/gm, '');
  const current = clean(raw);
  if (/\b(?:don't|do not|without|skip)\s+(?:use\s+|read\s+|load\s+)?(?:any\s+|all\s+)?skills\b|\bno\s+skills\b/i.test(current)) return [];
  const continuation = /^(?:please\s+)?(?:continue|resume|finish|complete|keep going|carry on|proceed)\b/i.test(current.trim())
    || /^(?:please\s+)?(?:fix|improve|test|check|adjust|update)\s+(?:it|this|that)\b/i.test(current.trim());
  const text = continuation ? clean(previousRequest) + '\n' + current : current;
  // Planning restrictions also contain verbs such as create/test. Do not let
  // those prohibited actions activate implementation workflows. A subsequent
  // authorized build or check of an existing page still needs its own guides.
  const affirmative = text.replace(/\b(?:do not|don['’]?t|never)\s+[^.!?;\n]*?(?=\b(?:but|however|then)\b|[.!?;\n]|$)/gi, ' ');
  const followOnWork = /\b(?:then|afterwards?|next)\s+(?:please\s+)?(?:build|implement|code|create)\b/i.test(affirmative)
    || /\b(?:test|verify|preview|inspect|check)\b[^.!?;\n]{0,45}\b(?:existing|current|built|live|rendered)\b[^.!?;\n]{0,30}\b(?:website|webpage|page|hero|browser)\b/i.test(affirmative);
  const optionsOnly = !followOnWork && /\b(?:website|webpage|landing\s+page|hero)\b/i.test(text)
    && /\b(?:options|directions|concepts|blueprint)\b/i.test(text)
    && /\b(?:options|directions|concepts|blueprint)(?:\s+and\s+(?:a\s+)?plan)?\s+only\b|\bonly\s+(?:provide|give|show|return|develop|plan)\b[^.!?\n]{0,60}\b(?:options|directions|concepts|blueprint)\b|\b(?:do not|don['’]?t)\s+(?:build|implement|code)\b|\b(?:do not|don['’]?t)\s+create\s+(?:(?:a|an|the|any|new|actual|real)\s+){0,3}(?:website|webpage|landing\s+page|hero|project\s+files)\b|\b(?:no code|without coding)\b/i.test(text);
  const chosen = new Map();
  const add = (id, reason) => chosen.set(id, { id, reason });
  const action = /\b(?:plan|develop|propose|draw|show|visualize|explain|add|create|build|make|edit|implement|change|modify|write|remove|delete|extend|migrate|repair|fix|debug|inspect|review|assess|critique|refine|improve|update|test|verify|research|investigate|compare|find|search|why|diagnose|refactor)\b/i.test(text);
  const instructionLookup = /\b(?:read|list|explain)\b.{0,60}\b(?:skills?|instructions|catalog)\b/i.test(text) && !/\b(?:implement|repair|build|create|refine)\b/i.test(text);
  if (instructionLookup) return [];
  if (action && !instructionLookup) {
    if (/\b(?:mermaid|diagrams?|flowcharts?|sequence diagram|interactive (?:visual|simulation|explanation)|visualize)\b/i.test(text)
      && !/\b(?:don't|do not|without|skip|no)\s+(?:a\s+|any\s+)?(?:diagrams?|flowcharts?|visualizations?)\b/i.test(text)) {
      add('diagrams', 'The request benefits from an inline diagram or interactive visual explanation.');
    }
    const projectTarget = /\b(?:code|file|source|function|component|app|website|webpage|site|standalone\s+hero|hero\s+section|program|feature|bug|behavior|script|project|api|module|screen|layout|skills?|registry|tool|database|migration|style|interface|repository|repo)\b/i.test(text);
    const implementation = /\b(?:add|build|create|edit|implement|change|modify|refactor|repair|fix|update|write|remove|delete|extend|migrate)\b/i.test(text) && projectTarget;
    const testingRequest = /\b(?:test|verify|check)\b/i.test(text) && projectTarget;
    const changeReviewRequest = /\b(?:review|inspect|audit)\b/i.test(text) && /\b(?:changes?|diff|patch|commit|pull request|code|source|files?)\b/i.test(text);
    if (implementation && !optionsOnly) {
      add('change_review', 'The request changes project code and benefits from a focused review of the actual edits before handoff.');
      add('project_testing', 'The request changes project behavior and benefits from the smallest relevant project check.');
    } else if (testingRequest && !optionsOnly) add('project_testing', 'The request asks to test or verify a project outcome.');
    if (changeReviewRequest && !optionsOnly) add('change_review', 'The request asks for a review of actual project changes.');
    const frontend = /\b(?:website|webpage|web\s+page|landing\s+page|standalone\s+hero|hero\s+(?:section|layout)|frontend|front.end|user\s+interface|graphical\s+interface|ui|browser|html|css|responsive|viewport|canvas|form|button|modal|navigation)\b/i.test(text);
    const defect = /\b(?:repair|fix|debug|diagnose|bug|broken|failure|crash|regression|not working|not rendering|overflow|blocked|incorrect|error)\b/i.test(text);
    if (defect) add('bug_repair', 'The request asks to investigate or repair an observed failure.');
    if (/\brefactor(?:ing)?\b|\b(?:restructure|rename)\b.{0,50}\b(?:code|function|class|module|symbol)\b/i.test(text)) add('refactor', 'The request changes code structure or symbols while preserving behavior.');
    if (frontend && !optionsOnly) add('browser_verification', 'The request involves browser presentation or an observable frontend behavior.');
    const freshDesign = frontend && /\b(?:create|build|make|design|redesign|restyle)\b/i.test(text) && !defect;
    const optionPlanning = frontend && /\b(?:plan|develop|propose|compare|show|create|make)\b/i.test(text)
      && /\b(?:design|layout|website|webpage|hero|landing\s+page)\s+(?:options|directions|concepts)\b/i.test(text);
    if (!defect && designProfile !== 'none' && (freshWebsite(text) || optionPlanning))
      add('website_layout_options', 'Develop credible spatial alternatives and a concrete selected layout without expanding the requested scope.');
    const visual = frontend && /\b(?:premium|attractive|dull|composition|typography|visual|critique|polish|redesign|restyle|design quality)\b/i.test(text);
    if (freshDesign || visual || optionPlanning) {
      add('visual_composition', 'The request creates or assesses a visual composition.');
      if (designProfile !== 'none') add(designProfile === 'max' ? 'website_design_max' : designProfile === 'medium' ? 'website_design_medium' : 'website_design', 'Use the selected design profile for this visual request.');
    }
    if (/\b(?:research|deep\s+research|look up|search online|search the web|latest|official documentation|investigate|ecosystem|trade-?offs?)\b/i.test(text)
      || /\bcompare\b.{0,70}\b(?:providers?|models?|libraries|frameworks?|products?|apis?|tools?|options|architectures?)\b/i.test(text)
        && !/\b(?:screenshots?|designs?|files?|outputs?)\b/i.test(text)) add('research', 'The request needs deep research or external technical source evidence.');
    const verbs = text.match(/\b(?:repair|fix|build|create|implement|extend|verify|write|run|test|refactor)\b/gi) ?? [];
    if (/\b(?:dependent|deliverables|multi.step|several|multiple|ambiguous|unclear|workflow|resume)\b|\bremaining\s+(?:work|tasks|steps|deliverables|requirements)\b/i.test(text)
      || /\b(?:then|after)\b/i.test(text) && verbs.length > 1
      || /\b(?:full|complete|whole)\s+(?:website|application|app|system)\b/i.test(text)) add('task_planning', 'The request has dependent deliverables, material ambiguity, or resumed work.');
    for (const id of taskTechnicalSkills(text)) add(id, 'The request explicitly requires 3D or external 3D asset engineering.');
  }
  for (const entry of skills.listSkills()) {
    if (new RegExp('\\b(?:read|use|load|follow|apply)\\b.{0,45}\\b' + entry.id + '\\b', 'i').test(current)) add(entry.id, 'The human explicitly requested this registered skill.');
    if (new RegExp("\\b(?:don't|do not|skip|avoid)\\b.{0,45}\\b" + entry.id + '\\b', 'i').test(current)) chosen.delete(entry.id);
  }
  const available = new Set(skills.selectedSkills({ designProfile, policy }).map(s => s.id));
  return [...chosen.values()].filter(item => available.has(item.id));
}
function prepareTaskSkills({ request, previousRequest, designProfile, policy, existing = [], evidence, taskId, requestId, emit = () => {} }) {
  const selection = selectTaskSkills(request, { previousRequest, designProfile, policy });
  const loaded = [], failures = [];
  for (const item of selection) {
    try {
      const skill = skills.readSkill(item.id);
      const previous = existing.find(s => s.id === item.id && s.contentHash === skill.contentHash && s.evidenceId);
      let evidenceId = previous?.evidenceId;
      if (!evidenceId) {
        const callId = 'auto-skill-' + item.id + '-' + Date.now();
        const startedAt = Date.now();
        emit({ type: 'tool', phase: 'started', callId, name: 'read_agent_skill', input: JSON.stringify({id:item.id}), detail:skill.name, startedAt });
        const output = JSON.stringify(skill);
        evidenceId = evidence.record(taskId, requestId, { kind:'tool', name:'read_agent_skill', input:{id:item.id}, failed:false, selectionReason:item.reason }, output).id;
        emit({ type:'tool', phase:'completed', callId, name:'read_agent_skill', input:JSON.stringify({id:item.id}), detail:skill.name, failed:false, output:output.slice(0,12000), truncated:output.length>12000, evidenceId, startedAt, durationMs:Date.now()-startedAt });
      }
      loaded.push({...skill,evidenceId});
      item.status = previous ? 'reused' : 'loaded'; item.contentHash=skill.contentHash; item.evidenceId=evidenceId;
    } catch(error) {
      item.status='failed';item.error=error.message;failures.push(item);
      item.failedEvidenceId=evidence.record(taskId,requestId,{kind:'tool',name:'read_agent_skill',input:{id:item.id},failed:true,selectionReason:item.reason},error.message).id;
      emit({type:'activity',message:error.message});
    }
  }
  if (selection.length) evidence.record(taskId, requestId, {kind:'skill_selection',name:'automatic_skill_selection'}, JSON.stringify(selection));
  const text = selection.length ? '\nAutomatic skills for the current request (locally read; earlier automatic selections are superseded):\n'
    + JSON.stringify(selection) + skills.loadedSkillContext(loaded,{designProfile}) : '';
  return { selection, loaded, failures, text };
}
module.exports={selectTaskSkills,prepareTaskSkills};
