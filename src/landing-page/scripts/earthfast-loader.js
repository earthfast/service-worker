// EarthFast Loading Screen Application
(function(window, document) {
'use strict';

// Application configuration
const EARTHFAST_CONFIG = {
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

// Get URL parameters and initialize mode
const urlParams = new URLSearchParams(window.location.search);
const isSecureViewer = urlParams.has('secure_viewer');

// DOM references for easier access throughout the application
const DOM = {
  requestsLog: null,
  requestsStats: null,
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

// Utils module - General utility functions
const Utils = (function() {
  // Debug function to help diagnose stage status issues
  function debugStages() {
    if (!isSecureViewer) return;

    console.group('Stage Status Debug');
    Object.entries(AppState.stages).forEach(([stageId, stageInfo]) => {
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
  function handleError(error, source, isSecureViewerMode = true) {
    console.error(`Error in ${source}:`, error);

    if (isSecureViewerMode && RequestTracker) {
      RequestTracker.addRequest('error', `${source}: ${error}`, true);

      // Update UI for relevant stages if appropriate
      if (AppState.stages[source] && !AppState.stages[source].completed) {
        StageManager.updateStageStatus(source, 'error', `<p>${error}</p>`);
      }
    }

    return false;  // For use in promise chains
  }

  // Handler for service worker failures
  function fail(message, isSecureViewerMode = true) {
    handleError(message, 'service-worker', isSecureViewerMode);

    document.body.classList.remove('hidden');
    DOM.spinner.classList.add('hidden');
    DOM.descriptionText.innerHTML =
        '<span style="color: #FF4D4D; margin-right: 5px;">&#x2716;</span>Failed to load';

    // Only add stage updates in secure viewer mode if we didn't call handleError
    if (isSecureViewerMode) {
      StageManager.updateStageStatus(
          'stage-sw-register', 'error', `<p>Service worker registration failed: ${message}</p>`);
    }
  }

  // Reload handler for both modes
  const reloadAfterWallTime = (function(initDate) {
    return function(delayMs, isSecureViewerMode = true) {
      const msSinceInit = Date.now() - initDate;
      const timeout = Math.max(0, delayMs - msSinceInit);

      if (isSecureViewerMode) {
        // Specific logic for secure viewer mode
        if (AppState.readyToLoad && !AppState.hasRedirected) {
          setTimeout(() => {
            AppState.hasRedirected = true;
            const url = new URL(window.location.href);
            url.searchParams.delete('secure_viewer');
            window.location.href = url.toString();
          }, timeout);
        } else {
          if (AppState.stages['stage-manifest'] && !AppState.stages['stage-manifest'].started) {
            StageManager.updateStageStatus('stage-manifest', 'running');
          }

          if (AppState.stages['stage-ready'] && !AppState.stages['stage-ready'].started) {
            StageManager.updateStageStatus('stage-ready', 'running');
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
const AppState = (function() {
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

    // Initialize stages - only needed in secure viewer mode
    _stages = {};

    // If in secure viewer mode, initialize stage states
    if (isSecureViewer) {
      EARTHFAST_CONFIG.stages.sequence.forEach(stageId => {
        _stages[stageId] = {started: false, completed: false, startTime: null, endTime: null};
      });
    }
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

// StageManager module - Handles the loading stages UI
// Only initialize in secure viewer mode to save memory and processing
const StageManager = isSecureViewer ? (function() {
  // Update visual state of a stage
  function updateStageStatus(stageId, status, message = null) {
    const stage = document.getElementById(stageId);
    const icon = document.getElementById(`${stageId}-icon`);
    const content = document.getElementById(`${stageId}-content`);
    const timeEl = document.getElementById(`${stageId}-time`);

    if (!stage || !icon) {
      console.error(`Stage elements not found for ${stageId}`);
      return;
    }

    // Remove previous classes from stage and icon
    stage.classList.remove('running');
    icon.classList.remove('pending', 'running', 'success', 'error');

    // If the stage is starting
    if (status === 'running' && !AppState.stages[stageId].started) {
      AppState.stages[stageId].started = true;
      AppState.stages[stageId].startTime = Date.now();
      icon.classList.add('running');
      stage.classList.add('expanded', 'running');

      // Adjust height automatically
      const contentWrapper = stage.querySelector('.stage-content');
      if (contentWrapper) {
        contentWrapper.style.height = 'auto';
      }
    }

    // Update content if a message is provided, but handle stage-ready differently
    if (message && content) {
      if (stageId === 'stage-ready') {
        const messageDiv = document.getElementById('stage-ready-message');
        if (messageDiv) {
          messageDiv.innerHTML = message;
        }
      } else {
        content.innerHTML = message;
      }
      updateExpandedSectionHeights();
    }

    // Update icon according to status
    icon.classList.add(status);

    // If the stage is completed
    if ((status === 'success' || status === 'error') && !AppState.stages[stageId].completed) {
      AppState.stages[stageId].completed = true;
      AppState.stages[stageId].endTime = Date.now();
      if (timeEl) {
        timeEl.textContent = Utils.formatTimeDuration(
            AppState.stages[stageId].startTime, AppState.stages[stageId].endTime);
      }
    }
  }

  // Get the next stage in the sequence
  function getNextStage(currentStageId) {
    const currentIndex = EARTHFAST_CONFIG.stages.sequence.indexOf(currentStageId);
    if (currentIndex !== -1 && currentIndex < EARTHFAST_CONFIG.stages.sequence.length - 1) {
      return EARTHFAST_CONFIG.stages.sequence[currentIndex + 1];
    }
    return null;
  }

  // Update heights of all expanded sections
  function updateExpandedSectionHeights() {
    document.querySelectorAll('.stage.expanded').forEach(stage => {
      const content = stage.querySelector('.stage-content');
      if (content) {
        content.style.height = 'auto';
      }
    });
  }

  // Update all stage statuses
  function updateAllStages() {
    updateManifestStage();
    updateIndexStage();
    updateResourcesStage();
    updateReadyStage();
  }

  function updateManifestStage() {
    const hasManifestRequests = AppState.requests.some(
        req => req.isTrackedRequest && req.resource &&
            EARTHFAST_CONFIG.resources.manifest.includes(req.resource));

    if (hasManifestRequests && !AppState.stages['stage-manifest'].started) {
      updateStageStatus('stage-manifest', 'running');
    }

    if (AppState.manifestNodes.success >= Math.floor(AppState.manifestNodes.total / 2) + 1 &&
        AppState.stages['stage-manifest'].started && !AppState.stages['stage-manifest'].completed) {
      updateStageStatus('stage-manifest', 'success');
    }
  }

  function updateIndexStage() {
    const indexRequests = AppState.requests.filter(
        req => req.isTrackedRequest && req.rawRequest &&
            EARTHFAST_CONFIG.resources.index.includes(req.rawRequest.resource));

    if (indexRequests.length > 0 && !AppState.stages['stage-index'].started) {
      updateStageStatus('stage-index', 'running');
    }

    const successfulIndexRequest = indexRequests.find(req => req.rawRequest.success);
    if (successfulIndexRequest && !AppState.stages['stage-index'].completed) {
      updateStageStatus(
          'stage-index', 'success', '<p>Successfully loaded index.html from content nodes.</p>');
    }
  }

  function updateResourcesStage() {
    const resourceRequests = AppState.requests.filter(
        req => req.isTrackedRequest && req.rawRequest &&
            !EARTHFAST_CONFIG.resources.ignored.includes(req.rawRequest.resource) &&
            !req.rawRequest.url.endsWith('/index.html'));

    if (resourceRequests.length > 0 && !AppState.stages['stage-resources'].started) {
      updateStageStatus('stage-resources', 'running');
    }

    const successfulResources =
        AppState.requests
            .filter(
                req => req.isTrackedRequest && req.rawRequest && req.rawRequest.status === 200 &&
                    !EARTHFAST_CONFIG.resources.ignored.includes(req.rawRequest.resource) &&
                    !req.rawRequest.url.endsWith('/index.html'))
            .length;

    // Mark the stage as complete if we have enough successful resources
    if (successfulResources >= EARTHFAST_CONFIG.requests.minSuccessfulResources &&
        !AppState.stages['stage-resources'].completed) {
      // Use a simple message here to mark completion - the detailed message is in
      // updateRequestsTable
      updateStageStatus('stage-resources', 'success');

      // Start the ready stage if it hasn't started yet
      if (!AppState.stages['stage-ready'].started) {
        updateStageStatus('stage-ready', 'running');
      }
    }
  }

  function updateReadyStage() {
    // Check if all previous stages are complete
    const allPreviousStagesComplete = AppState.stages['stage-manifest'].completed &&
        AppState.stages['stage-index'].completed && AppState.stages['stage-resources'].completed;

    if (allPreviousStagesComplete && !AppState.stages['stage-ready'].completed) {
      console.log('All stages complete, completing Ready stage');
      const messageDiv = document.getElementById('stage-ready-message');
      if (messageDiv) {
        messageDiv.innerHTML = '<p>All resources have been loaded successfully.</p>';
      }
      updateStageStatus('stage-ready', 'success');
      DOM.spinner.classList.add('hidden');
      DOM.descriptionText.innerHTML = 'Securely loaded';
    }

    const readyButton = DOM.stageReadyButton;
    if (readyButton) {
      readyButton.style.display = EARTHFAST_CONFIG.ui.button.ready.defaultDisplay;
      readyButton.disabled = !allPreviousStagesComplete;
      readyButton.style.opacity = allPreviousStagesComplete ?
          EARTHFAST_CONFIG.ui.button.ready.enabledOpacity :
          EARTHFAST_CONFIG.ui.button.ready.disabledOpacity;
      readyButton.style.cursor = allPreviousStagesComplete ? 'pointer' : 'not-allowed';
    }
  }

  // Public API
  return {
    updateStageStatus,
    getNextStage,
    updateExpandedSectionHeights,
    updateAllStages,
    updateManifestStage,
    updateIndexStage,
    updateResourcesStage,
    updateReadyStage
  };
})() :
                                      {
                                        // Dummy version for normal mode to prevent errors
                                        updateStageStatus: function() { /* dummy */ },
                                        getNextStage: () => null,
                                        updateExpandedSectionHeights: function() { /* dummy */ },
                                        updateAllStages: function() { /* dummy */ },
                                        updateManifestStage: function() { /* dummy */ },
                                        updateIndexStage: function() { /* dummy */ },
                                        updateResourcesStage: function() { /* dummy */ },
                                        updateReadyStage: function() { /* dummy */ }
                                      };

// RequestTracker module - Handles tracking and displaying network requests
const RequestTracker = (function() {
  // Add a request to the log
  function addRequest(type, message, isError = false) {
    if (!isSecureViewer) return;  // Not needed in normal mode

    const timestamp = Utils.formatTimestamp();
    AppState.requests.unshift({timestamp, type, message, isError});

    // Keep only the latest maxRequests
    if (AppState.requests.length > EARTHFAST_CONFIG.requests.maxRequests) {
      AppState.requests.pop();
    }

    updateRequestsLog();
  }

  // Add a tracked request from the service worker
  function addRequestFromTracker(request) {
    try {
      const requestId = request.id || generateRequestId();

      // Update stats
      AppState.requestStats.total++;
      if (request.success) {
        AppState.requestStats.success++;
      } else {
        AppState.requestStats.failed++;
      }
      AppState.requestStats.nodes.add(request.node);

      // Add to requests array
      AppState.requests.unshift({
        id: requestId,
        timestamp: Utils.formatRequestTimestamp(request.timestamp),
        type: request.success ? 'success' : 'error',
        message: formatTrackedRequest(request),
        isError: !request.success,
        isTrackedRequest: true,
        rawRequest: request
      });

      // Keep only the latest maxRequests
      if (AppState.requests.length > EARTHFAST_CONFIG.requests.maxRequests) {
        AppState.requests.pop();
      }

      // Only update UI in secure viewer mode
      if (isSecureViewer) {
        // Update UI
        updateRequestsTable();

        // Handle manifest
        if (request.resource === 'earthfast.json' || request.resource === 'armada.json') {
          updateManifestRequest(request, requestId);
        }

        // Update logs and stats
        updateRequestsLog();
        updateRequestStats();
      }
    } catch (error) {
      console.error('Error processing request:', error);
    }
  }

  // Generate a unique ID for each request
  function generateRequestId() {
    AppState.requestCounter++;
    return `req-${AppState.requestCounter.toString().padStart(4, '0')}`;
  }

  // Format a tracked request for display
  function formatTrackedRequest(request) {
    if (!isSecureViewer) return '';  // Not needed in normal mode

    let statusClass = request.success ? 'status-ok' : 'status-error';
    let statusText = request.status ? request.status : (request.success ? 'OK' : 'Failed');

    return `<div class="request-details">
                <span>
                  <span class="node-info">${request.node}</span> ›
                  <span class="resource-info">${request.resource || 'unknown'}</span>
                </span>
                <span class="request-status ${statusClass}">${statusText}</span>
              </div>`;
  }

  // Update the request stats display
  function updateRequestStats() {
    if (!isSecureViewer || !DOM.requestsStats) return;

    DOM.requestsStats.innerHTML = `
        <div>Total: ${AppState.requestStats.total} | Success: ${
        AppState.requestStats.success} | Failed: ${AppState.requestStats.failed} | Nodes: ${
        AppState.requestStats.nodes.size}</div>
      `;
  }

  // Update the requests log display
  function updateRequestsLog() {
    if (!isSecureViewer || !DOM.requestsLog) return;

    DOM.requestsLog.innerHTML = '';

    AppState.requests.forEach(req => {
      const item = document.createElement('div');
      item.classList.add('request-item');
      if (req.isError) {
        item.classList.add('error');
      } else if (req.type === 'success') {
        item.classList.add('success');
      }

      const timestamp = document.createElement('span');
      timestamp.classList.add('timestamp');
      timestamp.textContent = req.timestamp;

      item.appendChild(timestamp);

      // For tracked requests, use innerHTML to include the formatted HTML
      if (req.isTrackedRequest) {
        const contentSpan = document.createElement('span');
        contentSpan.innerHTML = req.message;
        item.appendChild(contentSpan);
      } else {
        item.appendChild(document.createTextNode(`[${req.type}] ${req.message}`));
      }

      DOM.requestsLog.appendChild(item);
    });
  }

  // Update the requests table with improved performance
  function updateRequestsTable() {
    if (!isSecureViewer) return;  // Not needed in normal mode

    const tableBody = DOM.requestsTableBody;
    if (!tableBody) return;  // Early return if table doesn't exist

    // Create a document fragment for better performance
    const fragment = document.createDocumentFragment();

    // Clear table
    tableBody.innerHTML = '';

    // Filter requests for the table
    const filteredRequests = AppState.requests.filter(
        req => req.isTrackedRequest && req.rawRequest &&
            !EARTHFAST_CONFIG.resources.ignored.includes(req.rawRequest.resource) &&
            !EARTHFAST_CONFIG.resources.ignoredMethods.includes(req.rawRequest.method) &&
            typeof req.rawRequest.status === 'number' &&
            !req.rawRequest.resource.endsWith('.DS_Store'));

    // Group by resource and keep the most recent successful, or the most recent if none are
    // successful
    const uniqueRequestsMap = new Map();
    filteredRequests.forEach(req => {
      const key = req.rawRequest.resource;
      if (!uniqueRequestsMap.has(key)) {
        uniqueRequestsMap.set(key, req);
      } else {
        const existing = uniqueRequestsMap.get(key);
        // Prefer the most recent successful
        if (req.rawRequest.success && !existing.rawRequest.success) {
          uniqueRequestsMap.set(key, req);
        } else if (req.rawRequest.success === existing.rawRequest.success) {
          // If both are successful or both failed, keep the most recent
          if (req.rawRequest.timestamp > existing.rawRequest.timestamp) {
            uniqueRequestsMap.set(key, req);
          }
        }
      }
    });
    const resourceRequests = Array.from(uniqueRequestsMap.values());

    // If no requests, show message
    if (resourceRequests.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
          <td colspan="5" style="text-align: center; padding: 20px;">
            No requests detected yet.
            Requests will appear automatically when made.
          </td>
        `;
      fragment.appendChild(tr);

      // Update table and section heights
      tableBody.appendChild(fragment);
      StageManager.updateExpandedSectionHeights();
      return;
    }

    // Get successful requests for stage status update later
    const successfulRequests =
        resourceRequests.filter(req => req.rawRequest && req.rawRequest.success);

    // Limit to the most recent requests for display
    const limitedRequests = resourceRequests.slice(0, EARTHFAST_CONFIG.requests.maxRequests);

    // Store the count of displayed successful requests - count EXACTLY what we're displaying
    const displayedSuccessfulCount =
        limitedRequests.filter(req => req.rawRequest && req.rawRequest.success).length;

    // Add rows to the table
    limitedRequests.forEach(req => {
      const tr = document.createElement('tr');
      const request = req.rawRequest;

      // Generate ID if it doesn't exist
      if (!req.id) {
        req.id = generateRequestId();
      }

      const statusClass = request.success ? 'status-ok' : 'status-error';
      const statusText = request.status ? request.status : (request.success ? 'OK' : 'Failed');

      tr.innerHTML = `
          <td><span class="request-id">${req.id}</span></td>
          <td>${req.timestamp}</td>
          <td><span class="resource-info">${request.resource || 'unknown'}</span></td>
          <td><span class="node-info">${request.node}</span></td>
          <td><span class="request-status ${statusClass}">${statusText}</span></td>
        `;

      fragment.appendChild(tr);
    });

    // Append all rows at once for better performance
    tableBody.appendChild(fragment);

    // Update expanded section heights after adding new content
    StageManager.updateExpandedSectionHeights();

    // If we have enough successful requests, check if we need to update content
    if (successfulRequests.length >= EARTHFAST_CONFIG.requests.minSuccessfulResources) {
      // If the stage is already completed, just update the content
      if (AppState.stages['stage-resources'] && AppState.stages['stage-resources'].completed) {
        // Get the stage content element
        const contentEl = document.getElementById('stage-resources-content');
        if (contentEl) {
          // Update only the content without changing stage state
          contentEl.innerHTML = `
            <p>Successfully loaded ${displayedSuccessfulCount} resources from content nodes.</p>
            <p class="help-text">Tip: Use these filters in the Network panel to see different types of requests:</p>
            <ul class="filter-list">
              <li><span class="filter-type">CSS:</span> <code class="filter-code">*.css</code></li>
              <li><span class="filter-type">JavaScript:</span> <code class="filter-code">*.js</code></li>
              <li><span class="filter-type">Images:</span> <code class="filter-code">*.svg, *.png, *.jpg</code></li>
            </ul>
            <div class="table-container">
              <table class="requests-table" id="requests-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Time</th>
                    <th>Resource</th>
                    <th>Node</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody id="requests-table-body">
                </tbody>
              </table>
            </div>
          `;

          // Re-add the rows to the new table
          const newTableBody = document.getElementById('requests-table-body');
          if (newTableBody) {
            newTableBody.innerHTML = tableBody.innerHTML;
          }
        }
      }
    }
  }

  // Update manifest request information
  function updateManifestRequest(request, requestId) {
    if (!isSecureViewer) return;  // Not needed in normal mode

    if (!AppState.stages['stage-manifest'].started) {
      StageManager.updateStageStatus('stage-manifest', 'running');
    }

    const nodeId = request.node;

    // Register this node if it doesn't exist
    if (!AppState.manifestNodes.nodes[nodeId]) {
      AppState.manifestNodes.nodes[nodeId] = {
        status: request.success ? 'success' : 'error',
        statusCode: request.status || 0,
        hash: null,
        requestId: requestId
      };
      AppState.manifestNodes.total++;

      if (request.success) {
        AppState.manifestNodes.success++;
      }
    }

    // Update the progress in the UI
    const progressEl = document.getElementById('stage-manifest-progress');
    if (progressEl) {
      progressEl.innerHTML = `<div class="stage-progress-text">${AppState.manifestNodes.success}/${
          AppState.manifestNodes.total} nodes</div>`;
    }

    // Update the manifest nodes list
    updateManifestNodesList();

    // Check if we have enough successful responses for consensus
    if (AppState.manifestNodes.success >= EARTHFAST_CONFIG.stages.manifest.minSuccessNodes &&
        !AppState.stages['stage-manifest'].completed) {
      StageManager.updateStageStatus('stage-manifest', 'success');

      // Start the index stage if it hasn't started yet
      if (!AppState.stages['stage-index'].started) {
        StageManager.updateStageStatus('stage-index', 'running');
      }
    }
  }

  // Update the list of nodes that provided the manifest
  function updateManifestNodesList() {
    if (!isSecureViewer) return;  // Not needed in normal mode

    const listEl = document.getElementById('manifest-nodes-list');
    if (!listEl) return;  // Early return if element doesn't exist

    // Create a document fragment for better performance
    const fragment = document.createDocumentFragment();

    // Clear existing list
    listEl.innerHTML = '';

    // Process manifest nodes in a deterministic order
    const sortedNodes =
        Object.entries(AppState.manifestNodes.nodes).sort((a, b) => a[0].localeCompare(b[0]));

    sortedNodes.forEach(([nodeId, data]) => {
      const li = document.createElement('li');
      li.className = 'manifest-item';

      const statusClass = data.status === 'success' ? 'status-ok' : 'status-error';
      const statusText = data.status === 'success' ? 'OK' : 'Failed';

      li.innerHTML = `
          <span class="manifest-node">${nodeId}</span>
          <span class="manifest-status ${statusClass}">${statusText}</span>
          <span class="request-id">${data.requestId}</span>
          ${data.hash ? `<span class="manifest-hash">${data.hash}</span>` : ''}
        `;

      fragment.appendChild(li);
    });

    // Append all items at once
    listEl.appendChild(fragment);

    // Update heights after modifying content
    StageManager.updateExpandedSectionHeights();
  }

  // Process all requests data at once
  function processRequestsData(requests) {
    const sortedRequests = [...requests].sort((a, b) => b.timestamp - a.timestamp);

    sortedRequests.forEach(request => {
      addRequestFromTracker(request);
    });

    // Only update UI in secure viewer mode
    if (isSecureViewer) {
      // Explicitly start resources stage if there are requests
      if (sortedRequests.length > 0 && AppState.stages['stage-resources'] &&
          !AppState.stages['stage-resources'].started) {
        StageManager.updateStageStatus('stage-resources', 'running');
      }

      // Force table update
      updateRequestsTable();
    }

    return sortedRequests;
  }

  // Public API
  return {
    addRequest,
    addRequestFromTracker,
    generateRequestId,
    formatTrackedRequest,
    updateRequestStats,
    updateRequestsLog,
    updateRequestsTable,
    updateManifestRequest,
    updateManifestNodesList,
    processRequestsData
  };
})();

// ServiceWorkerManager module - Handles service worker registration and messaging
const ServiceWorkerManager = (function() {
  // Initialize service worker
  function initialize(isSecureViewerMode = false) {
    // Early return if service worker is not supported
    if (!('serviceWorker' in navigator)) {
      document.cookie = 'supportsSW=false; path=/';
      if (isSecureViewerMode) {
        Utils.fail('Service worker not supported by this browser', true);
      } else {
        Utils.fail('Service worker not supported by this browser', false);
        window.location.reload();
      }
      return;
    }

    // Add the Service Worker message handler
    navigator.serviceWorker.addEventListener(
        'message',
        isSecureViewerMode ? serviceWorkerHandlers.secureViewer.onMessage :
                             serviceWorkerHandlers.normal.onMessage);

    // Register the Service Worker
    navigator.serviceWorker
        .register(
            EARTHFAST_CONFIG.serviceWorker.path, {scope: EARTHFAST_CONFIG.serviceWorker.scope})
        .then(
            isSecureViewerMode ? serviceWorkerHandlers.secureViewer.onRegisterSuccess :
                                 serviceWorkerHandlers.normal.onRegisterSuccess)
        .catch(
            isSecureViewerMode ? serviceWorkerHandlers.secureViewer.onRegisterError :
                                 serviceWorkerHandlers.normal.onRegisterError);
  }

  // Service worker handlers for different modes
  const serviceWorkerHandlers = {
    // Normal mode handlers - Simplified version that only does what is necessary
    normal: {
      onMessage(event) {
        const eventType = event.data.type ? event.data.type : event.data.action;

        switch (eventType) {
          case 'INITIALIZED':
            if (navigator.serviceWorker.controller) {
              navigator.serviceWorker.controller.postMessage({type: 'GET_ALL_REQUESTS'});
            }
            Utils.reloadAfterWallTime(0, false);
            break;
          case 'PRELOADING_COMPLETE':
            AppState.preloadingComplete = true;
            Utils.reloadAfterWallTime(0, false);
            break;
        }
      },

      onRegisterSuccess(reg) {
        if (reg.active) {
          Utils.reloadAfterWallTime(0, false);
        } else {
          if (EARTHFAST_CONFIG.ui.spinner.defaultDisplay) {
            document.body.classList.remove('hidden');
          }
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'activated') {
                Utils.reloadAfterWallTime(500, false);
              }
            });
          });
        }
      },

      onRegisterError(err) {
        Utils.fail('Service worker registration failed: ' + err, false);
      }
    },

    // Secure viewer mode handlers
    secureViewer: {
      onMessage(event) {
        const eventType = event.data.type ? event.data.type : event.data.action;
        const error = event.data.error || '';

        switch (eventType) {
          case 'INITIALIZED':
            if (event.data.nodes && event.data.nodes.length > 0) {
              const progressEl = document.getElementById('stage-manifest-progress');
              if (progressEl) {
                progressEl.innerHTML =
                    `<div class="stage-progress-text">0/${event.data.nodes.length} nodes</div>`;
              }

              const nodesList = document.getElementById('manifest-nodes-list');
              if (nodesList) {
                const nodesListHtml = event.data.nodes
                                          .map(node => `<li class="manifest-item">
                    <span class="manifest-node">${node}</span>
                    <span class="manifest-status status-pending">Pending</span>
                  </li>`).join('');
                nodesList.innerHTML = nodesListHtml;
              }
            }

            if (navigator.serviceWorker.controller) {
              navigator.serviceWorker.controller.postMessage({type: 'GET_ALL_REQUESTS'});
            }
            break;

          case 'VERSION_DETECTED':
          case 'VERSION_READY':
            RequestTracker.addRequest('info', `Service worker ${eventType.toLowerCase()}`);
            break;

          case 'MANIFEST_FETCH_ERROR':
          case 'MANIFEST_FETCH_FAILURE_NO_CONSENSUS':
          case 'CONTENT_CHECKSUM_MISMATCH':
          case 'CONTENT_NODE_FETCH_FAILURE':
          case 'CONTENT_NODES_FETCH_FAILURE':
            Utils.handleError(error, 'stage-resources', true);
            break;

          case 'REQUEST_TRACKED':
            try {
              RequestTracker.addRequestFromTracker(event.data.request);
              if (AppState.stages['stage-resources'] &&
                  !AppState.stages['stage-resources'].started) {
                StageManager.updateStageStatus('stage-resources', 'running');
              }

              // Use the debounced version for performance on rapid updates
              debouncedRequestsUpdate();
            } catch (err) {
              Utils.handleError(err, 'request-tracking', true);
            }
            break;

          case 'ALL_REQUESTS':
            try {
              AppState.requests = AppState.requests.filter(req => !req.isTrackedRequest);
              RequestTracker.processRequestsData(event.data.requests);
            } catch (err) {
              Utils.handleError(err, 'process-requests', true);
            }
            break;

          case 'REQUESTS_CLEARED':
            try {
              AppState.requests = AppState.requests.filter(req => !req.isTrackedRequest);
              RequestTracker.updateRequestsLog();
            } catch (err) {
              Utils.handleError(err, 'clear-requests', true);
            }
            break;

          case 'PRELOADING_COMPLETE':
            console.log('PRELOADING_COMPLETE event received');
            AppState.preloadingComplete = true;
            // Print stage status for debugging
            Utils.debugStages();
            StageManager.updateAllStages();
            // Print stage status after update
            console.log('Stage status after update:');
            Utils.debugStages();
            break;

          case 'PRELOADING_ERROR':
            AppState.preloadingComplete = true;
            Utils.handleError(event.data.error || 'Unknown preloading error', 'preloading', true);
            StageManager.updateAllStages();
            break;

          default:
            if (event.data.error) {
              Utils.handleError(event.data.error, 'unknown-event', true);
            }
        }
      },

      onRegisterSuccess(reg) {
        if (reg.active && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({type: 'GET_ALL_REQUESTS'});
          Utils.reloadAfterWallTime(0, true);
        } else {
          if (EARTHFAST_CONFIG.ui.spinner.defaultDisplay) {
            document.body.classList.remove('hidden');
          }

          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'activated') {
                Utils.reloadAfterWallTime(500, true);
              }
            });
          });
        }
      },

      onRegisterError(err) {
        Utils.fail('Service worker registration failed: ' + err, true);
      }
    }
  };

  // Return public API
  return {initialize, serviceWorkerHandlers};
})();

// Create debounced versions of expensive update functions
// This function should only be relevant in secure viewer mode
const debouncedRequestsUpdate = isSecureViewer ? Utils.debounce(() => {
  RequestTracker.updateRequestsTable();
  StageManager.updateAllStages();
}, 200) : function() { /* dummy */ };  // Dummy function in normal mode

// Initialize the application
function initializeApp() {
  // Initialize state first
  AppState.initialize();

  // Set domain in UI
  DOM.domain.innerText = location.host;
  document.body.classList.remove('hidden');

  // Only add event listeners for stages in secure viewer mode
  if (isSecureViewer) {
    // Add event listeners for stage headers
    document.querySelectorAll('.stage-toggle-header').forEach(header => {
      header.addEventListener('click', () => {
        const stage = header.closest('.stage');
        stage.classList.toggle('expanded');

        const content = stage.querySelector('.stage-content');
        if (stage.classList.contains('expanded')) {
          content.style.height = 'auto';
        } else {
          content.style.height = '0';
        }
      });
    });
  }

  // Add event listener for stage-ready button (works in both modes)
  if (DOM.stageReadyButton) {
    DOM.stageReadyButton.addEventListener('click', () => {
      if (!isSecureViewer) {
        AppState.readyToLoad = true;
        location.reload();
      } else {
        // In secure viewer mode, remove the parameter and redirect
        const url = new URL(window.location.href);
        url.searchParams.delete('secure_viewer');
        window.location.href = url.toString();
      }
    });
  }

  if (isSecureViewer) {
    // Code specific to secure viewer mode
    if (DOM.stagesContainer) {
      DOM.stagesContainer.style.display = 'block';
    }

    if (DOM.stageReadyButton) {
      DOM.stageReadyButton.disabled = true;
      DOM.stageReadyButton.style.opacity = '0';
      DOM.stageReadyButton.style.cursor = 'not-allowed';
    }

    DOM.devToolsNotice.classList.add('show');
    DOM.startLoadingButton.style.display = 'block';
    DOM.spinner.style.display = 'none';

    DOM.startLoadingButton.addEventListener('click', () => {
      DOM.devToolsNotice.classList.remove('show');
      DOM.startLoadingButton.style.display = 'none';
      document.body.classList.remove('regular-flow');
      DOM.devToolsInstructions.style.display = 'block';
      ServiceWorkerManager.initialize(true);
    });
  } else {
    // Code specific to normal mode
    if (DOM.stagesContainer) {
      DOM.stagesContainer.style.display = 'none';
    }
    // Initialize the service worker immediately in normal mode
    ServiceWorkerManager.initialize(false);
  }
}

// Start the application when the DOM is loaded
window.addEventListener('load', initializeApp);
})(window, document);
