const { RuleTester } = require('eslint');
const rule = require('./no-secret-logging');

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

ruleTester.run('no-secret-logging', rule, {
  valid: [
    'console.log(userId);',
    'logger.info({ publicKey });',
    'logger.debug(secretKey);',
    'console.error(accessToken);',
    'console.log("token");',
  ],
  invalid: [
    {
      code: 'console.log(secretKey);',
      errors: [{ messageId: 'sensitiveLog', suggestions: [{ messageId: 'redact', output: "console.log('[REDACTED]');" }] }],
    },
    {
      code: 'logger.info({ token });',
      errors: [{ messageId: 'sensitiveLog', suggestions: [{ messageId: 'redact', output: "logger.info({ token: '[REDACTED]' });" }] }],
    },
    {
      code: 'console.log(`authorization: ${jwtToken}`);',
      errors: [{ messageId: 'sensitiveLog', suggestions: [{ messageId: 'redact', output: "console.log(`authorization: ${'[REDACTED]'}`);" }] }],
    },
    {
      code: 'logger.info({ request: { apiKey, userId } });',
      errors: [{ messageId: 'sensitiveLog', suggestions: [{ messageId: 'redact', output: "logger.info({ request: { apiKey: '[REDACTED]', userId } });" }] }],
    },
  ],
});
