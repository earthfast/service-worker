const Module = require('module');
const path = require('path');
const fs = require('fs');
const originalResolveFilename = Module._resolveFilename;
const originalLoad = Module._load;

// Helper to check if file exists
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch (e) {
    return false;
  }
}

// Create a custom loader for ESM modules
Module._load = function(request, parent, isMain) {
  if (request.endsWith('.js') && parent && parent.filename.includes('vendor/multiformats')) {
    // Handle ESM modules by creating a CommonJS wrapper
    try {
      const basedir = path.dirname(parent.filename);
      const fullPath = path.resolve(basedir, request);

      if (fileExists(fullPath)) {
        // Read the file content and create a CommonJS compatible version
        const content = fs.readFileSync(fullPath, 'utf8');

        // If it contains ESM syntax, create a synthetic module
        if (content.includes('export ') || content.includes('import ')) {
          // Create a simple exports object that matches what the module would export
          const exports = {};

          // Extract export names with a simple regex (this is a basic implementation)
          const exportMatches = content.match(/export\s+(const|let|var|function)\s+(\w+)/g) || [];
          const namedExports = exportMatches
                                   .map(match => {
                                     const nameMatch =
                                         match.match(/export\s+(const|let|var|function)\s+(\w+)/);
                                     return nameMatch ? nameMatch[2] : null;
                                   })
                                   .filter(Boolean);

          // Add named exports as empty objects/functions
          namedExports.forEach(name => {
            exports[name] = function() {
              return {};
            };
          });

          // Return our synthetic module
          return exports;
        }
      }
    } catch (e) {
      // Fall back to original loading if anything goes wrong
      console.error('Error in custom loader:', e);
    }
  }

  return originalLoad.apply(this, arguments);
};

// Also handle filename resolution
Module._resolveFilename = function(request, parent, isMain) {
  if (request.endsWith('.js') && parent && parent.filename.includes('vendor/multiformats')) {
    try {
      const tsRequest = request.replace(/\.js$/, '.ts');
      const basedir = path.dirname(parent.filename);
      const tsPath = path.resolve(basedir, tsRequest);

      if (fileExists(tsPath)) {
        return tsPath;
      }
    } catch (e) {
      // Fall back if anything goes wrong
    }
  }

  return originalResolveFilename.apply(this, arguments);
};
