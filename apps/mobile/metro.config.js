// Metro configuration for the JARVIS monorepo.
//
// `@jarvis/shared` is a linked workspace package whose source is TypeScript, so
// Metro needs to watch the repository root and resolve modules from both the app
// and the root `node_modules`.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Source-only workspace packages ship .ts/.tsx that Metro must transform itself.
config.resolver.sourceExts = Array.from(new Set([...config.resolver.sourceExts, 'ts', 'tsx']));
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
