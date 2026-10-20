/**
 * Public surface of the data layer. React hooks live in `./hooks` and are deliberately not
 * re-exported here, so non-UI code (`ai/`, `audio/`) never pulls React in.
 */
export { DB_NAME, SCHEMA_VERSIONS, STORES_V1, createDb, db } from './schema';
export type { OrbitDB, SchemaVersion } from './schema';
export { NotFoundError } from './internal';
export * from './repos';
export * from './backup';
export * from './crypto';
export * from './lookup';
export * from './maintenance';
export * from './persist';
export * from './settings';
export * from './trash';
