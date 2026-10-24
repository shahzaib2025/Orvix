function validateWorkflow(steps) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('Provide browser workflow steps.');
  for (const step of steps) {
    if (!['click', 'fill', 'check', 'select', 'press', 'hover', 'scroll', 'reload', 'navigate', 'assert'].includes(step.action)) throw new Error('Unsupported browser workflow action.');
    if (['click', 'fill', 'check', 'select', 'press', 'hover', 'scroll'].includes(step.action) && !String(step.selector ?? '').trim()) throw new Error('An interaction needs an exact selector.');
    if (step.action === 'assert') {
      const check = step.assertion;
      if (!check || !['text', 'value', 'checked', 'visible', 'hidden', 'attribute', 'storage', 'url'].includes(check.kind)) throw new Error('Choose a supported state assertion.');
      if (!['storage', 'url'].includes(check.kind) && !String(check.selector ?? '').trim()) throw new Error('A DOM assertion needs a selector.');
      if (['text', 'value', 'attribute', 'storage', 'url'].includes(check.kind) && check.expected === undefined) throw new Error('Provide an explicit expected state.');
      if (check.kind === 'text' && !String(check.expected).trim()) throw new Error('A text assertion cannot be empty.');
      if (check.kind === 'checked' && typeof check.expected !== 'boolean') throw new Error('Expected checked state must be boolean.');
      if (check.kind === 'attribute' && !String(check.attribute ?? '').trim()) throw new Error('Name the attribute to check.');
      if (check.kind === 'storage' && (!check.key || /token|secret|password|credential|auth/i.test(check.key))) throw new Error('Use a non-sensitive application setting key.');
    }
  }
}
async function runBrowserWorkflow(page, steps, { signal, localUrl }) {
  validateWorkflow(steps);
  const results = []; let assertionCount = 0;
  for (let index = 0; index < steps.length; index++) {
    if (signal.aborted) throw new Error('Task cancelled.');
    const step = steps[index];
    try {
      const locator = step.selector ? page.locator(step.selector) : null;
      if (locator && await locator.count() !== 1) throw new Error('Interaction needs exactly one matching element.');
      if (step.action === 'click') await locator.click({ timeout: 4000 });
      else if (step.action === 'fill') await locator.fill(String(step.value ?? ''), { timeout: 4000 });
      else if (step.action === 'check') { if (typeof step.enabled !== 'boolean') throw new Error('Specify the checked state.'); await locator.setChecked(step.enabled, { timeout: 4000 }); }
      else if (step.action === 'select') await locator.selectOption(String(step.value), { timeout: 4000 });
      else if (step.action === 'press') await locator.press(String(step.key), { timeout: 4000 });
      else if (step.action === 'hover') await locator.hover({ timeout: 4000 });
      else if (step.action === 'scroll') await locator.scrollIntoViewIfNeeded({ timeout: 4000 });
      else if (step.action === 'reload') await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
      else if (step.action === 'navigate') await page.goto(localUrl(step.url), { waitUntil: 'domcontentloaded', timeout: 15000 });
      else if (step.action === 'assert') {
        assertionCount++;
        const check = step.assertion, element = check.selector ? page.locator(check.selector) : null;
        if (element && await element.count() > 1) throw new Error('Assertion selector is ambiguous.');
        const deadline = Date.now() + Math.min(10000, Math.max(100, Number(check.timeout_ms) || 3000));
        let actual, passed = false;
        do {
          if (signal.aborted) throw new Error('Task cancelled.');
          if (check.kind === 'text') actual = await element.textContent({ timeout: Math.max(100, deadline - Date.now()) });
          else if (check.kind === 'value') actual = await element.inputValue({ timeout: Math.max(100, deadline - Date.now()) });
          else if (check.kind === 'checked') actual = await element.isChecked({ timeout: Math.max(100, deadline - Date.now()) });
          else if (check.kind === 'visible' || check.kind === 'hidden') actual = await element.isVisible();
          else if (check.kind === 'attribute') actual = await element.getAttribute(check.attribute, { timeout: Math.max(100, deadline - Date.now()) });
          else if (check.kind === 'storage') actual = await page.evaluate(({ key, area }) => (area === 'session' ? sessionStorage : localStorage).getItem(key), { key: check.key, area: check.area });
          else actual = page.url();
          passed = check.kind === 'visible' ? actual === true : check.kind === 'hidden' ? actual === false : check.kind === 'text' && check.contains === true ? String(actual).includes(String(check.expected)) : actual === check.expected;
          if (passed || Date.now() >= deadline) break;
          await page.waitForTimeout(100);
        } while (Date.now() <= deadline);
        results.push({ index, action: 'assert', ...check, actual, status: passed ? 'passed' : 'failed', observedUrl: page.url() });
        if (!passed) break;
        continue;
      }
      results.push({ index, action: step.action, selector: step.selector, status: 'performed', observedUrl: page.url() });
    } catch (error) {
      if (signal.aborted) throw new Error('Task cancelled.');
      results.push({ index, action: step.action, status: 'failed', reason: String(error.message ?? error).slice(0, 500), observedUrl: page.url() }); break;
    }
  }
  return { status: results.some(item => item.status === 'failed') ? 'failed' : results.length !== steps.length || !assertionCount ? 'skipped' : 'passed', assertionCount, steps: results, finalUrl: page.url(), recordedAt: Date.now() };
}
module.exports = { runBrowserWorkflow, validateWorkflow };
