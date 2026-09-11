const SENSITIVE_IDENTIFIER = /(?:secret|token|jwt|password|passwd|credential|api[_-]?key|access[_-]?key|refresh[_-]?token|auth[_-]?token|private[_-]?key)/i;
const LOG_METHODS = new Set(['log', 'info']);

function isLoggingCall(node) {
  if (node.type !== 'CallExpression' || node.callee.type !== 'MemberExpression') {
    return false;
  }

  const { object, property, computed } = node.callee;
  return (
    !computed &&
    property.type === 'Identifier' &&
    LOG_METHODS.has(property.name) &&
    ((object.type === 'Identifier' && object.name === 'console') ||
      (object.type === 'Identifier' && object.name === 'logger'))
  );
}

function getSensitiveIdentifiers(node, identifiers = new Set(), visited = new Set()) {
  if (!node || visited.has(node)) return identifiers;
  visited.add(node);

  if (node.type === 'Identifier' && SENSITIVE_IDENTIFIER.test(node.name)) {
    identifiers.add(node);
    return identifiers;
  }

  if (node.type === 'Property' && node.shorthand && node.value.type === 'Identifier') {
    getSensitiveIdentifiers(node.value, identifiers, visited);
    return identifiers;
  }

  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'loc' || key === 'range' || key === 'tokens' || key === 'comments') {
      continue;
    }

    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item.type === 'string') getSensitiveIdentifiers(item, identifiers, visited);
      }
    } else if (child && typeof child.type === 'string') {
      getSensitiveIdentifiers(child, identifiers, visited);
    }
  }

  return identifiers;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevent sensitive data from being written to application logs',
    },
    hasSuggestions: true,
    schema: [],
    messages: {
      sensitiveLog: 'Do not log sensitive value "{{name}}". Log a sanitized or redacted value instead.',
      redact: 'Replace with a redacted placeholder',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        if (!isLoggingCall(node)) return;

        for (const identifier of getSensitiveIdentifiers(node)) {
          context.report({
            node: identifier,
            messageId: 'sensitiveLog',
            data: { name: identifier.name },
            suggest: [
              {
                messageId: 'redact',
                fix(fixer) {
                  if (identifier.parent?.type === 'Property' && identifier.parent.shorthand) {
                    return fixer.replaceText(identifier.parent, `${identifier.name}: '[REDACTED]'`);
                  }
                  return fixer.replaceText(identifier, "'[REDACTED]'");
                },
              },
            ],
          });
        }
      },
    };
  },
};
