// EarthFast Loading Screen Core Application
(function(window, document) {
'use strict';

// Create the EarthFast namespace
const EarthFast = {};

// Application configuration
EarthFast.EARTHFAST_CONFIG = {
  // Service worker configuration
  serviceWorker: {path: '/earthfast-sw.js', scope: '/'},

  // Request tracking configuration
  requests: {maxRequests: 50, minSuccessfulResources: 5},

  // Stage configuration
  stages: {
    sequence: ['stage-manifest', 'stage-index', 'stage-resources', 'stage-ready'],
    manifest: {
      minSuccessNodes: 1  // Minimum number of successful nodes for consensus
    }
  },

  // UI configuration
  ui: {
    spinner: {defaultDisplay: localStorage.getItem('showSpinner') !== 'false'},
    button: {ready: {defaultDisplay: 'block', disabledOpacity: '0.5', enabledOpacity: '1'}}
  },

  // Resource types
  resources: {
    manifest: ['earthfast.json', 'armada.json'],
    index: ['index.html', '/index.html'],
    ignored: ['nodes', '.DS_Store'],
    ignoredMethods: ['OPTIONS']
  }
};

// Utils module - General utility functions
EarthFast.Utils = (function() {
  // Debug function to help diagnose stage status issues
  function debugStages() {
    console.group('Stage Status Debug');
    Object.entries(EarthFast.AppState.stages).forEach(([stageId, stageInfo]) => {
      console.log(`Stage: ${stageId}`);
      console.log(`- Started: ${stageInfo.started}`);
      console.log(`- Completed: ${stageInfo.completed}`);
      if (stageInfo.startTime) {
        console.log(`- Duration: ${
            formatTimeDuration(stageInfo.startTime, stageInfo.endTime || Date.now())}`);
      }
    });
    console.groupEnd();
  }

  // Debounce function to limit frequent calls to expensive operations
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Format timestamp for display
  function formatTimestamp() {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${
        now.getMinutes().toString().padStart(
            2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
  }

  // Format request timestamp for display
  function formatRequestTimestamp(timestamp) {
    const date = new Date(timestamp);
    return `${date.getHours().toString().padStart(2, '0')}:${
        date.getMinutes().toString().padStart(
            2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
  }

  // Format time duration for display
  function formatTimeDuration(startTime, endTime) {
    if (!startTime || !endTime) return '';
    const duration = Math.round((endTime - startTime) / 1000);
    if (duration < 60) {
      return `${duration}s`;
    } else {
      const minutes = Math.floor(duration / 60);
      const seconds = duration % 60;
      return `${minutes}m ${seconds}s`;
    }
  }

  // Enhanced error handling function
  function handleError(error, source, isSecureViewerMode = false) {
    console.error(`Error in ${source}:`, error);

    if (isSecureViewerMode && EarthFast.RequestTracker) {
      EarthFast.RequestTracker.addRequest('error', `${source}: ${error}`, true);

      // Update UI for relevant stages if appropriate
      if (EarthFast.AppState.stages[source] && !EarthFast.AppState.stages[source].completed) {
        if (EarthFast.StageManager) {
          EarthFast.StageManager.updateStageStatus(source, 'error', `<p>${error}</p>`);
        }
      }
    }

    return false;  // For use in promise chains
  }

  // Handler for service worker failures
  function fail(message, isSecureViewerMode = false) {
    handleError(message, 'service-worker', isSecureViewerMode);

    document.body.classList.remove('hidden');
    EarthFast.DOM.spinner.classList.add('hidden');
    EarthFast.DOM.descriptionText.innerHTML =
        '<span style="color: #FF4D4D; margin-right: 5px;">&#x2716;</span>Failed to load';

    // Only add stage updates in secure viewer mode
    if (isSecureViewerMode && EarthFast.StageManager) {
      EarthFast.StageManager.updateStageStatus(
          'stage-sw-register', 'error', `<p>Service worker registration failed: ${message}</p>`);
    }
  }

  // Reload handler for both modes
  const reloadAfterWallTime = (function(initDate) {
    return function(delayMs, isSecureViewerMode = false) {
      const msSinceInit = Date.now() - initDate;
      const timeout = Math.max(0, delayMs - msSinceInit);

      if (isSecureViewerMode) {
        // Specific logic for secure viewer mode
        if (EarthFast.AppState.readyToLoad && !EarthFast.AppState.hasRedirected) {
          setTimeout(() => {
            EarthFast.AppState.hasRedirected = true;
            const url = new URL(window.location.href);
            url.searchParams.delete('secure_viewer');
            window.location.href = url.toString();
          }, timeout);
        } else {
          if (EarthFast.AppState.stages['stage-manifest'] &&
              !EarthFast.AppState.stages['stage-manifest'].started) {
            EarthFast.StageManager.updateStageStatus('stage-manifest', 'running');
          }

          if (EarthFast.AppState.stages['stage-ready'] &&
              !EarthFast.AppState.stages['stage-ready'].started) {
            EarthFast.StageManager.updateStageStatus('stage-ready', 'running');
          }
        }
      } else {
        // Simple logic for normal mode
        setTimeout(() => {
          location.reload();
        }, timeout);
      }
    };
  })(Date.now());

  // Public API
  return {
    debugStages,
    debounce,
    formatTimestamp,
    formatRequestTimestamp,
    formatTimeDuration,
    handleError,
    fail,
    reloadAfterWallTime
  };
})();

// AppState module - Manages application state
EarthFast.AppState = (function() {
  // Private state
  let _readyToLoad = false;
  let _hasRedirected = false;
  let _preloadingComplete = false;
  let _requests = [];
  let _requestCounter = 0;
  let _manifestNodes = {total: 0, success: 0, nodes: {}};
  let _requestStats = {total: 0, success: 0, failed: 0, nodes: new Set()};
  let _stages = {};

  // Initialize app state
  function initialize() {
    // Reset state variables
    _readyToLoad = false;
    _hasRedirected = false;
    _preloadingComplete = false;

    // Initialize requests array
    _requests = [];
    _requestCounter = 0;

    // Initialize manifest nodes structure
    _manifestNodes = {total: 0, success: 0, nodes: {}};

    // Initialize request stats
    _requestStats = {total: 0, success: 0, failed: 0, nodes: new Set()};

    // Initialize stages
    _stages = {};
  }

  // Public API
  return {
    initialize,
    get readyToLoad() {
      return _readyToLoad;
    },
    set readyToLoad(value) {
      _readyToLoad = value;
    },
    get hasRedirected() {
      return _hasRedirected;
    },
    set hasRedirected(value) {
      _hasRedirected = value;
    },
    get preloadingComplete() {
      return _preloadingComplete;
    },
    set preloadingComplete(value) {
      _preloadingComplete = value;
    },
    get requests() {
      return _requests;
    },
    set requests(value) {
      _requests = value;
    },
    get requestCounter() {
      return _requestCounter;
    },
    set requestCounter(value) {
      _requestCounter = value;
    },
    get manifestNodes() {
      return _manifestNodes;
    },
    get requestStats() {
      return _requestStats;
    },
    get stages() {
      return _stages;
    }
  };
})();

// StageManager stub for normal mode - will be replaced in secure viewer mode
EarthFast.StageManager = {
  updateStageStatus: function() {
    return null;
  },
  getNextStage: function() {
    return null;
  },
  updateExpandedSectionHeights: function() {
    return null;
  },
  updateAllStages: function() {
    return null;
  },
  updateManifestStage: function() {
    return null;
  },
  updateIndexStage: function() {
    return null;
  },
  updateResourcesStage: function() {
    return null;
  },
  updateReadyStage: function() {
    return null;
  }
};

// RequestTracker module - Basic version for normal mode
EarthFast.RequestTracker = (function() {
  // Add a request to the log (basic version for normal mode)
  function addRequest() {
    // Not needed in normal mode
    return;
  }

  // Add a tracked request from the service worker
  function addRequestFromTracker(request) {
    try {
      const requestId = request.id || generateRequestId();

      // Update stats
      EarthFast.AppState.requestStats.total++;
      if (request.success) {
        EarthFast.AppState.requestStats.success++;
      } else {
        EarthFast.AppState.requestStats.failed++;
      }
      EarthFast.AppState.requestStats.nodes.add(request.node);

      // Add to requests array
      EarthFast.AppState.requests.unshift({
        id: requestId,
        timestamp: EarthFast.Utils.formatRequestTimestamp(request.timestamp),
        type: request.success ? 'success' : 'error',
        message: formatTrackedRequest(request),
        isError: !request.success,
        isTrackedRequest: true,
        rawRequest: request
      });

      // Keep only the latest maxRequests
      if (EarthFast.AppState.requests.length > EarthFast.EARTHFAST_CONFIG.requests.maxRequests) {
        EarthFast.AppState.requests.pop();
      }
    } catch (error) {
      console.error('Error processing request:', error);
    }
  }

  // Generate a unique ID for each request
  function generateRequestId() {
    EarthFast.AppState.requestCounter++;
    return `req-${EarthFast.AppState.requestCounter.toString().padStart(4, '0')}`;
  }

  // Format a tracked request for display (simplified for normal mode)
  function formatTrackedRequest() {
    return '';
  }

  // Process all requests data at once
  function processRequestsData(requests) {
    const sortedRequests = [...requests].sort((a, b) => b.timestamp - a.timestamp);

    sortedRequests.forEach(request => {
      addRequestFromTracker(request);
    });

    return sortedRequests;
  }

  // Stub methods for normal mode
  function updateRequestsLog() {
    return;
  }
  function updateRequestStats() {
    return;
  }

  // Public API
  return {
    addRequest,
    addRequestFromTracker,
    generateRequestId,
    formatTrackedRequest,
    updateRequestsLog,
    updateRequestStats,
    processRequestsData
  };
})();

// ServiceWorkerManager module - Handles service worker registration and messaging
EarthFast.ServiceWorkerManager = (function() {
  // Normal mode handlers
  const normalMessageHandlers = {
    onMessage(event) {
      const eventType = event.data.type ? event.data.type : event.data.action;

      switch (eventType) {
        case 'INITIALIZED':
          if (navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({type: 'GET_ALL_REQUESTS'});
          }
          EarthFast.Utils.reloadAfterWallTime(0, false);
          break;
        case 'PRELOADING_COMPLETE':
          EarthFast.AppState.preloadingComplete = true;
          EarthFast.Utils.reloadAfterWallTime(0, false);
          break;
      }
    },

    onRegisterSuccess(reg) {
      if (reg.active) {
        EarthFast.Utils.reloadAfterWallTime(0, false);
      } else {
        if (EarthFast.EARTHFAST_CONFIG.ui.spinner.defaultDisplay) {
          document.body.classList.remove('hidden');
        }
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated') {
              EarthFast.Utils.reloadAfterWallTime(500, false);
            }
          });
        });
      }
    },

    onRegisterError(err) {
      EarthFast.Utils.fail('Service worker registration failed: ' + err, false);
    }
  };

  // Initialize service worker for normal mode
  function initialize() {
    // Early return if service worker is not supported
    if (!('serviceWorker' in navigator)) {
      document.cookie = 'supportsSW=false; path=/';
      EarthFast.Utils.fail('Service worker not supported by this browser', false);
      window.location.reload();
      return;
    }

    // Add the Service Worker message handler
    navigator.serviceWorker.addEventListener('message', normalMessageHandlers.onMessage);

    // Register the Service Worker
    navigator.serviceWorker
        .register(
            EarthFast.EARTHFAST_CONFIG.serviceWorker.path,
            {scope: EarthFast.EARTHFAST_CONFIG.serviceWorker.scope})
        .then(normalMessageHandlers.onRegisterSuccess)
        .catch(normalMessageHandlers.onRegisterError);
  }

  // Return public API
  return {initialize, normalMessageHandlers};
})();

// Initialize the application for normal mode
EarthFast.init = function(isSecureViewer) {
  // Get DOM references
  EarthFast.DOM = {
    requestsLog: isSecureViewer ? document.getElementById('requests-log') : null,
    requestsStats: isSecureViewer ? document.getElementById('requests-stats') : null,
    stageReadyButton: document.getElementById('stage-ready-button'),
    devToolsNotice: document.getElementById('dev-tools-notice'),
    startLoadingButton: document.getElementById('start-loading-button'),
    devToolsInstructions: document.querySelector('.dev-tools-instructions'),
    spinner: document.getElementById('spinner'),
    descriptionText: document.getElementById('description-text'),
    domain: document.getElementById('domain'),
    stagesContainer: document.getElementById('stages-container'),
    requestsTableBody: isSecureViewer ? document.getElementById('requests-table-body') : null
  };

  // Initialize state first
  EarthFast.AppState.initialize();

  // Set domain in UI
  EarthFast.DOM.domain.innerText = location.host;
  document.body.classList.remove('hidden');

  // Add event listener for stage-ready button
  if (EarthFast.DOM.stageReadyButton) {
    EarthFast.DOM.stageReadyButton.addEventListener('click', () => {
      if (!isSecureViewer) {
        EarthFast.AppState.readyToLoad = true;
        location.reload();
      } else {
        // In secure viewer mode, remove the parameter and redirect
        const url = new URL(window.location.href);
        url.searchParams.delete('secure_viewer');
        window.location.href = url.toString();
      }
    });
  }

  if (!isSecureViewer) {
    // Code specific to normal mode
    if (EarthFast.DOM.stagesContainer) {
      EarthFast.DOM.stagesContainer.style.display = 'none';
    }
    // Initialize the service worker immediately in normal mode
    EarthFast.ServiceWorkerManager.initialize();
  }
};

// Expose the module
window.EarthFast = EarthFast;
})(window, document);
