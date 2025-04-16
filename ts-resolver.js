// spec/helpers/ts-resolver.js
const Module = require('module');
const originalResolveFilename = Module._resolveFilename;

// Override module resolution only during tests
Module._resolveFilename = function(request, parent, isMain) {
  if (request.endsWith('.js') && request.includes('/vendor/')) {
    try {
      return originalResolveFilename(request.replace(/\.js$/, '.ts'), parent, isMain);
    } catch (e) {
      // If .ts version doesn't exist, try original
    }
  }
  return originalResolveFilename(request, parent, isMain);
};
