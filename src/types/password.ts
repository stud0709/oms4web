export interface CustomField {
  id: string;
  label: string;
  value: string;
  isSecret: boolean;
}

export interface PasswordEntry {
  id: string;
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  hashtags: string[];
  customFields: CustomField[];
  createdAt: Date;
  updatedAt: Date;
}
