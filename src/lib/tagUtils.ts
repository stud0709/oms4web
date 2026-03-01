export const normalizeTag = (tag: string) => tag.replace(/^#/, '').trim().replace(/[^a-zA-Z0-9-_]/g, '');
