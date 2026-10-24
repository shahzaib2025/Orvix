// Validate model proposals before indexing, reviewing or executing them.
function validateValue(value, schema, location) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (schema.type && !types.includes(actual) && !(types.includes('integer') && Number.isSafeInteger(value))) throw new Error(`${location} must be ${types.join(' or ')}.`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${location} must be one of: ${schema.enum.join(', ')}.`);
  if (actual === 'object') {
    for (const key of schema.required ?? []) if (value[key] === undefined) throw new Error(`${location}.${key} is required.`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.additionalProperties === false && !schema.properties?.[key]) throw new Error(`${location}.${key} is not a supported argument.`);
      if (schema.properties?.[key]) validateValue(item, schema.properties[key], `${location}.${key}`);
    }
  }
  if (actual === 'array') {
    if (schema.minItems && value.length < schema.minItems || schema.maxItems && value.length > schema.maxItems) throw new Error(`${location} has an invalid number of items.`);
    value.forEach((item, index) => validateValue(item, schema.items ?? {}, `${location}[${index}]`));
  }
}
function validateTool(definition, input) {
  if (!definition) throw new Error('Tool unavailable in this access mode.');
  validateValue(input, definition.parameters, definition.name);
  if (definition.name === 'verify_work' && input.phase === 'reproduce' && !String(input.expected_output ?? '').trim()) throw new Error('Reproduction requires expected_output: use a stable assertion/error fragment from the source or observed baseline, not a guessed test reporter summary.');
}
module.exports = { validateTool };
