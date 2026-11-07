const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const toolsRoot = path.resolve(__dirname, "../tools") + path.sep;

// The Tools sources import siblings as "./name.js", the Node ESM form of a TypeScript file. Metro needs the real file name.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith(".") && moduleName.endsWith(".js") && context.originModulePath.startsWith(toolsRoot)) {
    return context.resolveRequest(context, moduleName.replace(/\.js$/, ".ts"), platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
