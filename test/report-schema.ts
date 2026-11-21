// The JSON Schema of the report (schema/report-v1.schema.json), compiled with Ajv for the tests.

import { readFileSync } from 'node:fs';

import { Ajv2020 } from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(new URL('../schema/report-v1.schema.json', import.meta.url), 'utf8')) as object;

export const validateReport = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true }).compile(schema);

/** The first errors of the last validation, as a message for an assertion. */
export function schemaErrors(): string {
  return JSON.stringify(validateReport.errors?.slice(0, 3));
}
