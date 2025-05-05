// EarthFast Secure Viewer extension
// This file contains additional functionality for secure viewer mode

(function(window, document, EarthFast) {
'use strict';

// StageManager module - Handles the loading stages UI
EarthFast.StageManager = (function() {
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
    if (status === 'running' && !EarthFast.AppState.stages[stageId].started) {
      EarthFast.AppState.stages[stageId].started = true;
      EarthFast.AppState.stages[stageId].startTime = Date.now();
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
    if ((status === 'success' || status === 'error') &&
        !EarthFast.AppState.stages[stageId].completed) {
      EarthFast.AppState.stages[stageId].completed = true;
      EarthFast.AppState.stages[stageId].endTime = Date.now();
      if (timeEl) {
        timeEl.textContent = EarthFast.Utils.formatTimeDuration(
            EarthFast.AppState.stages[stageId].startTime,
            EarthFast.AppState.stages[stageId].endTime);
      }
    }
  }

  // Get the next stage in the sequence
  function getNextStage(currentStageId) {
    const currentIndex = EarthFast.EARTHFAST_CONFIG.stages.sequence.indexOf(currentStageId);
    if (currentIndex !== -1 &&
        currentIndex < EarthFast.EARTHFAST_CONFIG.stages.sequence.length - 1) {
      return EarthFast.EARTHFAST_CONFIG.stages.sequence[currentIndex + 1];
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
    const hasManifestRequests = EarthFast.AppState.requests.some(
        req => req.isTrackedRequest && req.resource &&
            EarthFast.EARTHFAST_CONFIG.resources.manifest.includes(req.resource));

    if (hasManifestRequests && !EarthFast.AppState.stages['stage-manifest'].started) {
      updateStageStatus('stage-manifest', 'running');
    }

    if (EarthFast.AppState.manifestNodes.success >=
            Math.floor(EarthFast.AppState.manifestNodes.total / 2) + 1 &&
        EarthFast.AppState.stages['stage-manifest'].started &&
        !EarthFast.AppState.stages['stage-manifest'].completed) {
      updateStageStatus('stage-manifest', 'success');
    }
  }

  function updateIndexStage() {
    const indexRequests = EarthFast.AppState.requests.filter(
        req => req.isTrackedRequest && req.rawRequest &&
            EarthFast.EARTHFAST_CONFIG.resources.index.includes(req.rawRequest.resource));

    if (indexRequests.length > 0 && !EarthFast.AppState.stages['stage-index'].started) {
      updateStageStatus('stage-index', 'running');
    }

    const successfulIndexRequest = indexRequests.find(req => req.rawRequest.success);
    if (successfulIndexRequest && !EarthFast.AppState.stages['stage-index'].completed) {
      updateStageStatus(
          'stage-index', 'success', '<p>Successfully loaded index.html from content nodes.</p>');
    }
  }

  function updateResourcesStage() {
    const resourceRequests = EarthFast.AppState.requests.filter(
        req => req.isTrackedRequest && req.rawRequest &&
            !EarthFast.EARTHFAST_CONFIG.resources.ignored.includes(req.rawRequest.resource) &&
            !req.rawRequest.url.endsWith('/index.html'));

    if (resourceRequests.length > 0 && !EarthFast.AppState.stages['stage-resources'].started) {
      updateStageStatus('stage-resources', 'running');
    }

    const successfulResources =
        EarthFast.AppState.requests
            .filter(
                req => req.isTrackedRequest && req.rawRequest && req.rawRequest.status === 200 &&
                    !EarthFast.EARTHFAST_CONFIG.resources.ignored.includes(
                        req.rawRequest.resource) &&
                    !req.rawRequest.url.endsWith('/index.html'))
            .length;

    // Mark the stage as complete if we have enough successful resources
    if (successfulResources >= EarthFast.EARTHFAST_CONFIG.requests.minSuccessfulResources &&
        !EarthFast.AppState.stages['stage-resources'].completed) {
      updateStageStatus('stage-resources', 'success');

      // Start the ready stage if it hasn't started yet
      if (!EarthFast.AppState.stages['stage-ready'].started) {
        updateStageStatus('stage-ready', 'running');
      }
    }
  }

  function updateReadyStage() {
    // Check if all previous stages are complete
    const allPreviousStagesComplete = EarthFast.AppState.stages['stage-manifest'].completed &&
        EarthFast.AppState.stages['stage-index'].completed &&
        EarthFast.AppState.stages['stage-resources'].completed;

    if (allPreviousStagesComplete && !EarthFast.AppState.stages['stage-ready'].completed) {
      console.log('All stages complete, completing Ready stage');
      const messageDiv = document.getElementById('stage-ready-message');
      if (messageDiv) {
        messageDiv.innerHTML = '<p>All resources have been loaded successfully.</p>';
      }
      updateStageStatus('stage-ready', 'success');
      EarthFast.DOM.spinner.classList.add('hidden');
      EarthFast.DOM.descriptionText.innerHTML = 'Securely loaded';
    }

    const readyButton = EarthFast.DOM.stageReadyButton;
    if (readyButton) {
      readyButton.style.display = EarthFast.EARTHFAST_CONFIG.ui.button.ready.defaultDisplay;
      readyButton.disabled = !allPreviousStagesComplete;
      readyButton.style.opacity = allPreviousStagesComplete ?
          EarthFast.EARTHFAST_CONFIG.ui.button.ready.enabledOpacity :
          EarthFast.EARTHFAST_CONFIG.ui.button.ready.disabledOpacity;
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
})();

// Enhance the RequestTracker for secure viewer mode
EarthFast.enhanceRequestTracker = function() {
  // Format a tracked request for display (enhanced for secure viewer)
  function formatTrackedRequest(request) {
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

  // Update the requests log display
  function updateRequestsLog() {
    if (!EarthFast.DOM.requestsLog) return;

    EarthFast.DOM.requestsLog.innerHTML = '';

    EarthFast.AppState.requests.forEach(req => {
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

      EarthFast.DOM.requestsLog.appendChild(item);
    });
  }

  // Update the request stats display
  function updateRequestStats() {
    if (!EarthFast.DOM.requestsStats) return;

    EarthFast.DOM.requestsStats.innerHTML = `
        <div>Total: ${EarthFast.AppState.requestStats.total} | Success: ${
        EarthFast.AppState.requestStats.success} | Failed: ${
        EarthFast.AppState.requestStats.failed} | Nodes: ${
        EarthFast.AppState.requestStats.nodes.size}</div>
      `;
  }

  // Override formatTrackedRequest with enhanced version
  EarthFast.RequestTracker.formatTrackedRequest = formatTrackedRequest;

  // Override update methods with enhanced versions
  EarthFast.RequestTracker.updateRequestsLog = updateRequestsLog;
  EarthFast.RequestTracker.updateRequestStats = updateRequestStats;

  // Update the requests table with improved performance
  function updateRequestsTable() {
    const tableBody = EarthFast.DOM.requestsTableBody;
    if (!tableBody) return;

    // Create a document fragment for better performance
    const fragment = document.createDocumentFragment();

    // Clear table
    tableBody.innerHTML = '';

    // Filter requests for the table
    const filteredRequests = EarthFast.AppState.requests.filter(
        req => req.isTrackedRequest && req.rawRequest &&
            !EarthFast.EARTHFAST_CONFIG.resources.ignored.includes(req.rawRequest.resource) &&
            !EarthFast.EARTHFAST_CONFIG.resources.ignoredMethods.includes(req.rawRequest.method) &&
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
      EarthFast.StageManager.updateExpandedSectionHeights();
      return;
    }

    // Get successful requests for stage status update later
    const successfulRequests =
        resourceRequests.filter(req => req.rawRequest && req.rawRequest.success);

    // Limit to the most recent requests for display
    const limitedRequests =
        resourceRequests.slice(0, EarthFast.EARTHFAST_CONFIG.requests.maxRequests);

    // Store the count of displayed successful requests - count EXACTLY what we're displaying
    const displayedSuccessfulCount =
        limitedRequests.filter(req => req.rawRequest && req.rawRequest.success).length;

    // Add rows to the table
    limitedRequests.forEach(req => {
      const tr = document.createElement('tr');
      const request = req.rawRequest;

      // Generate ID if it doesn't exist
      if (!req.id) {
        req.id = EarthFast.RequestTracker.generateRequestId();
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
    EarthFast.StageManager.updateExpandedSectionHeights();

    // If we have enough successful requests, check if we need to update content
    if (successfulRequests.length >= EarthFast.EARTHFAST_CONFIG.requests.minSuccessfulResources) {
      // If the stage is already completed, just update the content
      if (EarthFast.AppState.stages['stage-resources'] &&
          EarthFast.AppState.stages['stage-resources'].completed) {
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

  EarthFast.RequestTracker.updateRequestsTable = updateRequestsTable;

  // Update manifest request information
  function updateManifestRequest(request, requestId) {
    if (!EarthFast.AppState.stages['stage-manifest'].started) {
      EarthFast.StageManager.updateStageStatus('stage-manifest', 'running');
    }

    const nodeId = request.node;

    // Register this node if it doesn't exist
    if (!EarthFast.AppState.manifestNodes.nodes[nodeId]) {
      EarthFast.AppState.manifestNodes.nodes[nodeId] = {
        status: request.success ? 'success' : 'error',
        statusCode: request.status || 0,
        hash: null,
        requestId: requestId
      };
      EarthFast.AppState.manifestNodes.total++;

      if (request.success) {
        EarthFast.AppState.manifestNodes.success++;
      }
    }

    // Update the progress in the UI
    const progressEl = document.getElementById('stage-manifest-progress');
    if (progressEl) {
      progressEl.innerHTML =
          `<div class="stage-progress-text">${EarthFast.AppState.manifestNodes.success}/${
              EarthFast.AppState.manifestNodes.total} nodes</div>`;
    }

    // Update the manifest nodes list
    updateManifestNodesList();

    // Check if we have enough successful responses for consensus
    if (EarthFast.AppState.manifestNodes.success >=
            EarthFast.EARTHFAST_CONFIG.stages.manifest.minSuccessNodes &&
        !EarthFast.AppState.stages['stage-manifest'].completed) {
      EarthFast.StageManager.updateStageStatus('stage-manifest', 'success');

      // Start the index stage if it hasn't started yet
      if (!EarthFast.AppState.stages['stage-index'].started) {
        EarthFast.StageManager.updateStageStatus('stage-index', 'running');
      }
    }
  }

  EarthFast.RequestTracker.updateManifestRequest = updateManifestRequest;

  // Update the list of nodes that provided the manifest
  function updateManifestNodesList() {
    const listEl = document.getElementById('manifest-nodes-list');
    if (!listEl) return;

    // Create a document fragment for better performance
    const fragment = document.createDocumentFragment();

    // Clear existing list
    listEl.innerHTML = '';

    // Process manifest nodes in a deterministic order
    const sortedNodes = Object.entries(EarthFast.AppState.manifestNodes.nodes)
                            .sort((a, b) => a[0].localeCompare(b[0]));

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
    EarthFast.StageManager.updateExpandedSectionHeights();
  }

  EarthFast.RequestTracker.updateManifestNodesList = updateManifestNodesList;

  // Enhance the addRequestFromTracker method
  const originalAddRequestFromTracker = EarthFast.RequestTracker.addRequestFromTracker;

  EarthFast.RequestTracker.addRequestFromTracker = function(request) {
    originalAddRequestFromTracker(request);

    // Add secure viewer specific handling
    if (request.resource === 'earthfast.json' || request.resource === 'armada.json') {
      updateManifestRequest(request, request.id || EarthFast.RequestTracker.generateRequestId());
    }

    // Update UI
    updateRequestsTable();

    // Start resources stage if needed
    if (EarthFast.AppState.stages['stage-resources'] &&
        !EarthFast.AppState.stages['stage-resources'].started) {
      EarthFast.StageManager.updateStageStatus('stage-resources', 'running');
    }
  };
};

// Enhanced service worker message handler for secure viewer
EarthFast.secureViewerMessageHandler = function(event) {
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
      EarthFast.RequestTracker.addRequest('info', `Service worker ${eventType.toLowerCase()}`);
      break;

    case 'MANIFEST_FETCH_ERROR':
    case 'MANIFEST_FETCH_FAILURE_NO_CONSENSUS':
    case 'CONTENT_CHECKSUM_MISMATCH':
    case 'CONTENT_NODE_FETCH_FAILURE':
    case 'CONTENT_NODES_FETCH_FAILURE':
      EarthFast.Utils.handleError(error, 'stage-resources', true);
      break;

    case 'REQUEST_TRACKED':
      try {
        EarthFast.RequestTracker.addRequestFromTracker(event.data.request);
        // Use the debounced version for performance on rapid updates
        EarthFast.debouncedRequestsUpdate();
      } catch (err) {
        EarthFast.Utils.handleError(err, 'request-tracking', true);
      }
      break;

    case 'ALL_REQUESTS':
      try {
        EarthFast.AppState.requests =
            EarthFast.AppState.requests.filter(req => !req.isTrackedRequest);
        EarthFast.RequestTracker.processRequestsData(event.data.requests);
      } catch (err) {
        EarthFast.Utils.handleError(err, 'process-requests', true);
      }
      break;

    case 'REQUESTS_CLEARED':
      try {
        EarthFast.AppState.requests =
            EarthFast.AppState.requests.filter(req => !req.isTrackedRequest);
        EarthFast.RequestTracker.updateRequestsLog();
      } catch (err) {
        EarthFast.Utils.handleError(err, 'clear-requests', true);
      }
      break;

    case 'PRELOADING_COMPLETE':
      console.log('PRELOADING_COMPLETE event received');
      EarthFast.AppState.preloadingComplete = true;
      // Print stage status for debugging
      EarthFast.Utils.debugStages();
      EarthFast.StageManager.updateAllStages();
      // Print stage status after update
      console.log('Stage status after update:');
      EarthFast.Utils.debugStages();
      break;

    case 'PRELOADING_ERROR':
      EarthFast.AppState.preloadingComplete = true;
      EarthFast.Utils.handleError(
          event.data.error || 'Unknown preloading error', 'preloading', true);
      EarthFast.StageManager.updateAllStages();
      break;

    default:
      if (event.data.error) {
        EarthFast.Utils.handleError(event.data.error, 'unknown-event', true);
      }
  }
};

// Create debounced version of update functions
EarthFast.debouncedRequestsUpdate = EarthFast.Utils.debounce(function() {
  if (EarthFast.RequestTracker.updateRequestsTable) {
    EarthFast.RequestTracker.updateRequestsTable();
  }
  if (EarthFast.StageManager.updateAllStages) {
    EarthFast.StageManager.updateAllStages();
  }
}, 200);

// Enhanced service worker handlers for secure viewer
EarthFast.secureViewerServiceWorkerHandlers = {
  onRegisterSuccess(reg) {
    if (reg.active && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({type: 'GET_ALL_REQUESTS'});
      EarthFast.Utils.reloadAfterWallTime(0, true);
    } else {
      if (EarthFast.EARTHFAST_CONFIG.ui.spinner.defaultDisplay) {
        document.body.classList.remove('hidden');
      }

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'activated') {
            EarthFast.Utils.reloadAfterWallTime(500, true);
          }
        });
      });
    }
  },

  onRegisterError(err) {
    EarthFast.Utils.fail('Service worker registration failed: ' + err, true);
  }
};

// Initialize secure viewer mode
EarthFast.initSecureViewer = function() {
  // Ensure DOM is initialized - this is important to prevent TypeError
  if (!EarthFast.DOM) {
    console.error('EarthFast.DOM not initialized yet. Call EarthFast.init(true) first.');
    return;
  }

  // Initialize stages
  EarthFast.EARTHFAST_CONFIG.stages.sequence.forEach(stageId => {
    EarthFast.AppState
        .stages[stageId] = {started: false, completed: false, startTime: null, endTime: null};
  });

  // Add event listeners for stage headers
  const stageHeaders = document.querySelectorAll('.stage-toggle-header');
  if (stageHeaders && stageHeaders.length > 0) {
    stageHeaders.forEach(header => {
      header.addEventListener('click', () => {
        const stage = header.closest('.stage');
        if (stage) {
          stage.classList.toggle('expanded');

          const content = stage.querySelector('.stage-content');
          if (content) {
            if (stage.classList.contains('expanded')) {
              content.style.height = 'auto';
            } else {
              content.style.height = '0';
            }
          }
        }
      });
    });
  }

  // Check each DOM element before using it
  if (EarthFast.DOM.stagesContainer) {
    EarthFast.DOM.stagesContainer.style.display = 'block';
  }

  if (EarthFast.DOM.stageReadyButton) {
    EarthFast.DOM.stageReadyButton.disabled = true;
    EarthFast.DOM.stageReadyButton.style.opacity = '0';
    EarthFast.DOM.stageReadyButton.style.cursor = 'not-allowed';
  }

  if (EarthFast.DOM.devToolsNotice) {
    EarthFast.DOM.devToolsNotice.classList.add('show');
  }

  if (EarthFast.DOM.startLoadingButton) {
    EarthFast.DOM.startLoadingButton.style.display = 'block';
  }

  if (EarthFast.DOM.spinner) {
    EarthFast.DOM.spinner.style.display = 'none';
  }

  // Add click event listener if button exists
  if (EarthFast.DOM.startLoadingButton) {
    EarthFast.DOM.startLoadingButton.addEventListener('click', () => {
      if (EarthFast.DOM.devToolsNotice) {
        EarthFast.DOM.devToolsNotice.classList.remove('show');
      }

      if (EarthFast.DOM.startLoadingButton) {
        EarthFast.DOM.startLoadingButton.style.display = 'none';
      }

      document.body.classList.remove('regular-flow');

      if (EarthFast.DOM.devToolsInstructions) {
        EarthFast.DOM.devToolsInstructions.style.display = 'block';
      }

      // Add the Service Worker message handler for secure viewer
      navigator.serviceWorker.addEventListener('message', EarthFast.secureViewerMessageHandler);

      // Register the Service Worker
      navigator.serviceWorker
          .register(
              EarthFast.EARTHFAST_CONFIG.serviceWorker.path,
              {scope: EarthFast.EARTHFAST_CONFIG.serviceWorker.scope})
          .then(EarthFast.secureViewerServiceWorkerHandlers.onRegisterSuccess)
          .catch(EarthFast.secureViewerServiceWorkerHandlers.onRegisterError);
    });
  }
};

// Expose the module
window.EarthFastSecureViewer = EarthFast;
})(window, document, window.EarthFast || {});
