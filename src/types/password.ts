export interface CustomField {
  id: string;
  label: string;
  value: string;
  protection: CustomFieldProtection
  readonly: boolean;
}

export type CustomFieldProtection = 'none'|'secret'|'encrypted';

export interface PasswordEntry {
  id: string;
  title: string;
  username: string;
  password: string;
  passwordReadonly: boolean;
  url: string;
  notes: string;
  hashtags: string[];
  customFields: CustomField[];
  createdAt: Date;
  updatedAt: Date;
}
