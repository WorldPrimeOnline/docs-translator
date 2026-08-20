/**
 * Freedom Pay XML request/response handling — isolated behind this module so nothing
 * else in the codebase depends on the underlying parser directly.
 *
 * No XML parsing library existed anywhere in this repository before this integration
 * (verified against package.json — `docx`/`jszip` handle OOXML zip archives, not
 * arbitrary XML strings). fast-xml-parser was added as a new dependency: small,
 * zero-dependencies-of-its-own, actively maintained. Explicitly avoided regex-based
 * XML parsing per the integration plan's security review.
 */
import { XMLParser, XMLBuilder, XMLValidator } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: true, trimValues: true, ignoreDeclaration: true });
const builder = new XMLBuilder({ format: false });

/**
 * Parses a Freedom Pay XML response into a flat string map. The root element name is
 * not assumed (docs.freedompay.kz shows `<response>` for the Result URL ACK schema;
 * the exact root tag for init_payment/get_status3.php/revoke responses was not
 * independently re-verified in the latest documentation pass — this function is
 * tolerant of any single root element name, unwrapping it automatically).
 */
export function parseFreedomPayXml(raw: string): Record<string, string> {
  const validation = XMLValidator.validate(raw);
  if (validation !== true) {
    throw new Error(`Malformed XML: ${validation.err.msg}`);
  }

  const parsed = parser.parse(raw) as Record<string, unknown>;
  const keys = Object.keys(parsed);
  const firstKey = keys[0];
  const root = (keys.length === 1 && firstKey !== undefined ? parsed[firstKey] : parsed) as Record<string, unknown>;

  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(root ?? {})) {
    if (value === null || value === undefined || typeof value === 'object') continue;
    flat[key] = String(value);
  }
  return flat;
}

/** Builds the `<response>...</response>` XML WPO must return from the Result URL. */
export function buildFreedomPayResponseXml(fields: Record<string, string>): string {
  const built = builder.build({ response: fields }) as string;
  return `<?xml version="1.0" encoding="UTF-8"?>${built}`;
}
