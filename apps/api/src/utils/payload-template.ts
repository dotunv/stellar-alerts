import Handlebars from 'handlebars';

export type PayloadTemplateErrorPhase = 'parse' | 'compile' | 'render' | 'json';

export interface PayloadTemplateSuccess {
  ok: true;
  body: string;
  payload: unknown;
}

export interface PayloadTemplateFailure {
  ok: false;
  error: string;
  phase: PayloadTemplateErrorPhase;
}

export type PayloadTemplateResult = PayloadTemplateSuccess | PayloadTemplateFailure;

const templateCache = new Map<string, HandlebarsTemplateDelegate>();

function formatTemplateError(error: unknown, phase: PayloadTemplateErrorPhase): PayloadTemplateFailure {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: message,
    phase,
  };
}

/**
 * Validates Handlebars template syntax by parsing the AST without executing helpers.
 */
export function validateHandlebarsTemplate(template: string): PayloadTemplateResult | { ok: true } {
  if (!template.trim()) {
    return { ok: false, error: 'Template must not be empty', phase: 'parse' };
  }

  try {
    Handlebars.parse(template);
    return { ok: true };
  } catch (error) {
    return formatTemplateError(error, 'parse');
  }
}

/**
 * Compiles a Handlebars template and caches the compiled delegate for reuse.
 */
export function compilePayloadTemplate(template: string): PayloadTemplateResult | HandlebarsTemplateDelegate {
  const syntax = validateHandlebarsTemplate(template);
  if (!('ok' in syntax) || syntax.ok !== true) {
    return syntax as PayloadTemplateFailure;
  }

  try {
    const cached = templateCache.get(template);
    if (cached) {
      return cached;
    }

    const compiled = Handlebars.compile(template, {
      strict: true,
      noEscape: true,
    });
    templateCache.set(template, compiled);
    return compiled;
  } catch (error) {
    return formatTemplateError(error, 'compile');
  }
}

/**
 * Renders a user-defined Handlebars template against webhook payment context data.
 */
export function renderPayloadTemplate(
  template: string,
  context: Record<string, unknown>
): PayloadTemplateResult {
  const compiled = compilePayloadTemplate(template);
  if (typeof compiled !== 'function') {
    return compiled;
  }

  try {
    const rendered = compiled(context).trim();
    if (!rendered) {
      return { ok: false, error: 'Template rendered an empty payload', phase: 'render' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rendered);
    } catch (error) {
      return formatTemplateError(error, 'json');
    }

    return {
      ok: true,
      body: JSON.stringify(parsed),
      payload: parsed,
    };
  } catch (error) {
    return formatTemplateError(error, 'render');
  }
}

/**
 * Applies an optional Handlebars payload template before webhook delivery.
 * Falls back to the default JSON payload when no template is configured.
 */
export function applyWebhookPayloadTemplate(
  sourcePayload: unknown,
  template?: string | null
): PayloadTemplateResult {
  if (!template || !template.trim()) {
    const body = JSON.stringify(sourcePayload);
    return {
      ok: true,
      body,
      payload: sourcePayload,
    };
  }

  const context =
    sourcePayload !== null && typeof sourcePayload === 'object'
      ? (sourcePayload as Record<string, unknown>)
      : { value: sourcePayload };

  return renderPayloadTemplate(template, context);
}

/** Clears compiled template cache — useful for tests. */
export function clearPayloadTemplateCache(): void {
  templateCache.clear();
}
