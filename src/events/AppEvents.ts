export const AppEvents = {
  // Vault
  MATERIAL_CREATED: 'material:created',
  MATERIAL_TRASHED: 'material:trashed',
  MATERIAL_RESTORED: 'material:restored',
  MATERIAL_DELETED: 'material:deleted',
  VAULT_RECONCILED: 'vault:reconciled',

  // Structure
  TOPIC_CREATED: 'topic:created',
  TOPIC_DELETED: 'topic:deleted',
  FOLDER_CREATED: 'folder:created',
  FOLDER_DELETED: 'folder:deleted',

  // Theme
  THEME_UPDATED: 'theme:updated',
  OVERRIDES_UPDATED: 'overrides:updated',

  // Analytics
  USAGE_LOGGED: 'usage:logged',
  ACTIVITY_LOGGED: 'activity:logged',

  // Migration
  MIGRATION_STARTED: 'migration:started',
  MIGRATION_COMPLETE: 'migration:complete',
  MIGRATION_FAILED: 'migration:failed',
} as const;
