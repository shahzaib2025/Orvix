const { readSkill } = require('./skill-library.cjs');
module.exports = { get websiteDesignGuidance() { return readSkill('website_design').instructions.split('\n## Task settings')[0].replace(/^# Website design\n\n/, '').trim(); } };
