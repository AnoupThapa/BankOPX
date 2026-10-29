// Form definition shape (docs/08 §2). Pure data; no behaviour. FRM-06: every field has a type, validation and a privacy classification.
export const FIELD_TYPES = ['text', 'multiline', 'number', 'currency', 'percentage', 'date', 'select', 'radio', 'checkbox', 'multiselect', 'email', 'phone', 'file', 'consent', 'group', 'calculated'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
export const PRIVACY_CLASSES = ['public', 'internal', 'personal', 'sensitive', 'restricted'] as const;
export type Localised = { en: string; ne: string };

export interface FieldDef {
  key: string;
  type: FieldType;
  label: Localised;
  help?: Localised;
  required?: boolean;
  privacy: (typeof PRIVACY_CLASSES)[number];
  validation?: { minLength?: number; maxLength?: number; pattern?: string; min?: number; max?: number };
  options?: Array<{ value: string; label: Localised }>;
  visibleWhen?: { field: string; equals: string | boolean };
  documentKey?: string;                                  // file fields: the document requirement they capture
  accept?: Array<'image/jpeg' | 'image/png' | 'application/pdf'>;   // file fields: allowed formats (default: all three)
  maxBytes?: number;                                     // file fields: size cap (default 5 MB, hard cap 10 MB)
  fields?: FieldDef[];                                   // group
  repeatable?: { min: number; max: number };             // group (FRM-11)
  formula?: { op: 'sum' | 'difference' | 'product'; of: string[]; version: string };  // calculated (FRM-09)
}
export interface FormDef { fields: FieldDef[] }

export interface FieldError { path: string; code: string }
export interface Suggestion { path: string; suggested: string; reason: string }
export interface ValidationOutcome { errors: FieldError[]; suggestions: Suggestion[]; computed: Record<string, number> }
