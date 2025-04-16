// register.js - Custom module resolver for ts-node
const path = require('path');
const fs = require('fs');
const originalResolveFilename = require('module')._resolveFilename;

// Override the module resolution to handle .js extension imports in TypeScript files
require('module')._resolveFilename = function(request, parent, isMain) {
  // Only handle .js imports from vendor/multiformats
  if (request.endsWith('.js') && parent && parent.filename.includes('vendor/multiformats')) {
    const tsPath = request.replace(/\.js$/, '.ts');
    try {
      // Calculate the absolute path of the requested module
      const basedir = path.dirname(parent.filename);
      const absolutePath = path.resolve(basedir, tsPath);

      // Check if the .ts version exists
      if (fs.existsSync(absolutePath)) {
        return absolutePath;
      }
    } catch (e) {
      // Fall back to original resolution if anything goes wrong
    }
  }
  return originalResolveFilename(request, parent, isMain);
};
